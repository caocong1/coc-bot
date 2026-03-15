/**
 * Campaign 模式消息处理器
 *
 * 负责：
 *  - 管理每个群的 SessionState（创建 / 恢复 / 结束）
 *  - 将群消息路由到 KPPipeline
 *  - 将骰子命令结果反馈给 KPPipeline（触发 AI KP 继续叙事）
 *  - 发送 KP 回复到群聊
 *
 * 命令：
 *   .room start [模板ID]   — 开团（生成 AI 多段开场白）
 *   .room pause            — 暂停（保存状态，不清历史）
 *   .room resume           — 继续（生成 AI 回顾摘要）
 *   .room stop             — 彻底结束
 *   .room load <文件名>       — 加载模组全文
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Database } from 'bun:sqlite';
import { DashScopeClient } from '../ai/client/DashScopeClient';
import { KPPipeline, type KPInput, type KPImage } from '../ai/pipeline/KPPipeline';
import { KnowledgeService } from '../knowledge/retrieval/KnowledgeService';
import { SessionState, type ScenarioImage } from './SessionState';
import { ModeResolver } from './ModeResolver';
import { CharacterStore } from '../commands/sheet/CharacterStore';
import { ImageLibrary } from '../knowledge/images/ImageLibrary';
import type { Character } from '@shared/types/Character';
import { listRoomRelationships } from '../storage/RoomDirectorStore';
import { getModuleRulePack, listModuleEntities, listModuleItems } from '../storage/ModuleAssetStore';
import { OpeningDirector } from './OpeningDirector';
import { SessionDirector } from './SessionDirector';
import { createDefaultRoomDirectorPrefs, type OpeningDirectorPlan, type RoomRelationship } from '@shared/types/StoryDirector';

const MANIFEST_PATH = 'data/knowledge/manifest.json';
const KP_MODEL = 'qwen3.5-plus';

/** Campaign 处理器返回值（支持文字 + 图片） */
export interface CampaignOutput {
  text: string | null;
  textParts?: string[];
  images: KPImage[];
  privateMessages?: Array<{ userId: number; text: string }>;
  /** 消息已排队等待合并处理 */
  queued?: boolean;
}

interface PendingChannelMessage {
  userId: number;
  displayName: string;
  text: string;
  channelId: string;
}

interface ManifestEntry {
  id: string;
  /** 原始文件的绝对路径 */
  sourcePath?: string;
  /** 原始文件的相对路径（含文件名） */
  sourceRelativePath: string;
  /** 提取出的纯文本路径 data/knowledge/raw/{id}.txt */
  textPath: string;
  fileType?: string;
  /** 该文件关联的图片 ID 列表（由 import-pdfs.ts 提取） */
  imageIds?: string[];
}

interface PausedSessionRow {
  id: string;
  campaign_id: string;
  kp_template_id: string;
}

export interface CampaignHandlerOptions {
  db: Database;
  aiClient: DashScopeClient;
  store: CharacterStore;
  modeResolver: ModeResolver;
  /** 每个群的 KP 模板 ID，默认 'classic' */
  defaultTemplateId?: string;
}

/** 每个群对应一个活跃 Session */
interface GroupSession {
  sessionId: string;
  campaignId: string;
  state: SessionState;
  pipeline: KPPipeline;
  roomId: string | null;
  effectiveCycle: number;
  idleCycleStreak: number;
}

export class CampaignHandler {
  private readonly db: Database;
  private readonly aiClient: DashScopeClient;
  private readonly store: CharacterStore;
  private readonly modeResolver: ModeResolver;
  private readonly defaultTemplateId: string;
  private readonly knowledge = new KnowledgeService();
  private readonly imageLibrary = new ImageLibrary();
  private readonly openingDirector: OpeningDirector;
  private readonly sessionDirector = new SessionDirector();

  /** groupId → 活跃 session */
  private readonly sessions = new Map<number, GroupSession>();

  /** per-group 并发锁 + 消息缓冲 */
  private readonly groupLocks = new Map<number, {
    processing: boolean;
    pendingByChannel: Map<string, PendingChannelMessage[]>;
  }>();

  constructor(options: CampaignHandlerOptions) {
    this.db = options.db;
    this.aiClient = options.aiClient;
    this.store = options.store;
    this.modeResolver = options.modeResolver;
    this.defaultTemplateId = options.defaultTemplateId ?? 'classic';
    this.openingDirector = new OpeningDirector(this.aiClient);
  }

  // ─── 开 / 暂停 / 继续 / 结团 ────────────────────────────────────────────────

  /**
   * 开启 Campaign 模式。
   * 若该群已有暂停中的 session，提示先 resume 或 stop。
   * @returns 多段开场白，逐条发到群聊
   */
  async startSession(groupId: number, templateId?: string, roomId?: string): Promise<CampaignOutput> {
    if (this.sessions.has(groupId)) {
      return campaignOutputFromParts(['当前已有进行中的跑团，请先使用 .room pause 或 .room stop 结束。']);
    }

    // 检查是否有暂停中的 session
    const paused = this.findPausedSession(groupId);
    if (paused) {
      return campaignOutputFromParts([
        '⚠️ 该群有暂停中的跑团记录。\n' +
        '• 使用 .room resume 继续上次跑团\n' +
        '• 使用 .room stop 彻底结束后再开新团',
      ]);
    }

    // 从房间读取 KP 配置（模板 + 自定义提示词）
    let tid = templateId ?? this.defaultTemplateId;
    let customPrompts = '';
    if (roomId) {
      const roomKp = this.db.query<{ kp_template_id: string; kp_custom_prompts: string }, string>(
        'SELECT kp_template_id, kp_custom_prompts FROM campaign_rooms WHERE id = ?',
      ).get(roomId);
      if (roomKp) {
        tid = roomKp.kp_template_id || tid;
        customPrompts = roomKp.kp_custom_prompts || '';
      }
    }

    const sessionId = `session-${groupId}-${Date.now()}`;
    const campaignId = `campaign-${groupId}`;

    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO kp_sessions
         (id, campaign_id, group_id, kp_template_id, status, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      [sessionId, campaignId, groupId, tid, now, now, now],
    );

    const state = new SessionState(this.db, sessionId, campaignId, groupId);
    const pipeline = new KPPipeline(this.aiClient, state, this.store, this.knowledge, { templateId: tid, customPrompts, db: this.db });

    this.sessions.set(groupId, {
      sessionId,
      campaignId,
      state,
      pipeline,
      roomId: roomId ?? null,
      effectiveCycle: 0,
      idleCycleStreak: 0,
    });
    this.modeResolver.setGroupMode(groupId, 'campaign', campaignId);

    // 关联 room ↔ session + 自动加载模组
    if (roomId) {
      this.db.run(
        'UPDATE campaign_rooms SET kp_session_id = ?, updated_at = ? WHERE id = ?',
        [sessionId, new Date().toISOString(), roomId],
      );

      const loadErr = this.autoLoadRoomModule(roomId, state);
      if (loadErr) {
        // 模组加载失败，回滚 session
        this.sessions.delete(groupId);
        this.modeResolver.setGroupMode(groupId, 'dice');
        this.db.run("UPDATE kp_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?", [now, now, sessionId]);
        this.db.run('UPDATE campaign_rooms SET kp_session_id = NULL, updated_at = ? WHERE id = ?', [now, roomId]);
        throw new Error(loadErr);
      }
    }

    console.log(`[Campaign] 开团: group=${groupId} session=${sessionId} template=${tid} room=${roomId ?? 'none'}`);

    // 获取 PC：优先从房间成员取，回退到群激活的 PC
    const characters = roomId
      ? this.store.getRoomCharacters(roomId)
      : this.store.getGroupActiveCharacters(groupId);

    return this.createOpeningOutput(state, tid, characters, roomId ?? null);
  }

  /**
   * 暂停跑团（保存所有状态，可通过 resume 继续）。
   */
  pauseSession(groupId: number): string {
    const session = this.sessions.get(groupId);
    if (!session) return '当前没有进行中的跑团。';

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE kp_sessions SET status = 'paused', updated_at = ? WHERE id = ?`,
      [now, session.sessionId],
    );
    // 同步房间状态
    this.db.run(
      "UPDATE campaign_rooms SET status = 'paused', updated_at = ? WHERE kp_session_id = ?",
      [now, session.sessionId],
    );

    this.sessions.delete(groupId);
    this.modeResolver.setGroupMode(groupId, 'dice');

    console.log(`[Campaign] 暂停: group=${groupId} session=${session.sessionId}`);
    return '⏸️ 跑团已暂停，所有进度已保存。\n下次使用 .room resume 继续，所有对话和线索都在。';
  }

  /**
   * 继续最近一次暂停的跑团，生成回顾摘要。
   */
  async resumeSession(groupId: number): Promise<CampaignOutput> {
    if (this.sessions.has(groupId)) {
      return campaignOutputFromParts(['当前已有进行中的跑团。']);
    }

    const row = this.findPausedSession(groupId);
    if (!row) {
      return campaignOutputFromParts(['没有找到可以继续的跑团记录。使用 .room start 开始新的跑团。']);
    }

    // 恢复状态
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE kp_sessions SET status = 'running', updated_at = ? WHERE id = ?`,
      [now, row.id],
    );
    // 同步房间状态
    this.db.run(
      "UPDATE campaign_rooms SET status = 'running', updated_at = ? WHERE kp_session_id = ?",
      [now, row.id],
    );

    // 从关联房间读取最新的 KP 设定（暂停期间可能修改过）
    let tid = row.kp_template_id;
    let customPrompts = '';
    const linkedRoom = this.db.query<{ kp_template_id: string; kp_custom_prompts: string }, string>(
      'SELECT kp_template_id, kp_custom_prompts FROM campaign_rooms WHERE kp_session_id = ?',
    ).get(row.id);
    if (linkedRoom) {
      tid = linkedRoom.kp_template_id || tid;
      customPrompts = linkedRoom.kp_custom_prompts || '';
    }

    const state = new SessionState(this.db, row.id, row.campaign_id, groupId);
    const pipeline = new KPPipeline(
      this.aiClient, state, this.store, this.knowledge,
      { templateId: tid, customPrompts, db: this.db },
    );

    this.sessions.set(groupId, {
      sessionId: row.id,
      campaignId: row.campaign_id,
      state,
      pipeline,
      roomId: this.getRoomIdBySession(row.id),
      effectiveCycle: this.getInitialEffectiveCycle(state),
      idleCycleStreak: 0,
    });
    this.modeResolver.setGroupMode(groupId, 'campaign', row.campaign_id);

    console.log(`[Campaign] 继续: group=${groupId} session=${row.id}`);

    return campaignOutputFromParts(await this.generateSessionRecap(state));
  }

  /**
   * 彻底结束跑团。
   */
  stopSession(groupId: number): string {
    const now = new Date().toISOString();

    // 先尝试结束内存中的 session
    const session = this.sessions.get(groupId);
    if (session) {
      this.db.run(
        `UPDATE kp_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, session.sessionId],
      );
      this.db.run(
        "UPDATE campaign_rooms SET status = 'ended', updated_at = ? WHERE kp_session_id = ?",
        [now, session.sessionId],
      );
      this.sessions.delete(groupId);
      this.modeResolver.setGroupMode(groupId, 'dice');
      console.log(`[Campaign] 结团: group=${groupId} session=${session.sessionId}`);
      return '📖 跑团已结束。感谢各位调查员的参与！';
    }

    // 也结束暂停中的 session
    const paused = this.findPausedSession(groupId);
    if (paused) {
      this.db.run(
        `UPDATE kp_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, paused.id],
      );
      this.db.run(
        "UPDATE campaign_rooms SET status = 'ended', updated_at = ? WHERE kp_session_id = ?",
        [now, paused.id],
      );
      console.log(`[Campaign] 结束暂停团: group=${groupId} session=${paused.id}`);
      return '📖 已结束暂停中的跑团记录。';
    }

    return '当前没有进行中或暂停中的跑团。';
  }

  /**
   * 加载模组文件到当前会话。
   */
  loadScenario(groupId: number, filename: string): string {
    const session = this.sessions.get(groupId);
    if (!session) {
      return '当前没有进行中的跑团，请先使用 .room start 开团。';
    }

    if (!existsSync(MANIFEST_PATH)) {
      return '知识库索引文件不存在，请先运行 bun run build-indexes 构建索引。';
    }

    let manifestFiles: ManifestEntry[];
    try {
      const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as { files?: ManifestEntry[] } | ManifestEntry[];
      manifestFiles = Array.isArray(raw) ? raw : (raw.files ?? []);
    } catch {
      return '知识库索引文件损坏，请重新构建索引。';
    }

    const keyword = filename.toLowerCase();
    const entry = manifestFiles.find(
      (e) =>
        e.sourceRelativePath.toLowerCase().includes(keyword) ||
        e.id.toLowerCase().includes(keyword),
    );

    if (!entry) {
      const available = manifestFiles
        .map((e) => e.sourceRelativePath.split(/[\\/]/).pop() ?? e.sourceRelativePath)
        .slice(0, 10)
        .join('、');
      return `未找到匹配的模组文件"${filename}"。\n可用文件：${available || '（无）'}`;
    }

    const rawPath = resolve(entry.textPath);
    const label = entry.sourceRelativePath.split(/[\\/]/).pop() ?? entry.sourceRelativePath;
    const ok = session.state.setScenario(rawPath, label);
    if (!ok) {
      return `模组文件不存在：${entry.textPath}，请重新导入 PDF。`;
    }

    console.log(`[Campaign] 加载模组: group=${groupId} file=${label} path=${rawPath}`);

    // 加载该文件关联的图片到 SessionState
    this.loadScenarioImages(session.state, entry.id ?? '');

    // 后台分段（不阻塞命令响应）
    this.segmentModuleAsync(session.state).catch((err) => {
      console.error('[Campaign] 模组分段失败:', err);
    });

    const imgCount = session.state.getScenarioImages().length;
    const imgHint = imgCount > 0 ? `\n📷 已加载 ${imgCount} 张模组图片` : '';
    return `📖 模组已加载：${label}${imgHint}\n守秘人正在阅读模组，场景分析在后台进行，稍后即可开团。`;
  }

  /**
   * 开团时自动加载房间关联的模组文件。
   * @returns 错误信息（失败时），null 表示成功
   */
  private autoLoadRoomModule(roomId: string, state: SessionState): string | null {
    const room = this.db.query<{ module_id: string | null }, string>(
      'SELECT module_id FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room?.module_id) {
      return '⚠️ 该房间未关联模组，无法开团。请先在房间设置中选择模组。';
    }

    // 找到该模组的 document 类文件
    const moduleFile = this.db.query<{ filename: string }, string>(
      "SELECT filename FROM scenario_module_files WHERE module_id = ? AND file_type = 'document' AND import_status = 'done' ORDER BY created_at LIMIT 1",
    ).get(room.module_id);
    if (!moduleFile) {
      return '⚠️ 模组文件未导入或导入失败，请在管理端检查模组文件状态。';
    }

    // 通过 filename 在 manifest 中查找
    if (!existsSync(MANIFEST_PATH)) {
      return '⚠️ 知识库索引不存在，请先运行 bun run build-indexes 构建索引。';
    }

    try {
      const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as { files?: ManifestEntry[] } | ManifestEntry[];
      const manifestFiles = Array.isArray(raw) ? raw : (raw.files ?? []);
      // 优先用绝对路径精确匹配，回退到文件名匹配
      const moduleAbsPath = resolve(moduleFile.filename);
      const moduleBaseName = moduleFile.filename.replace(/\\/g, '/').split('/').pop() ?? moduleFile.filename;
      const entry = manifestFiles.find((e) => {
        // 精确匹配：sourcePath（绝对路径）
        if (e.sourcePath && resolve(e.sourcePath) === moduleAbsPath) return true;
        // 回退：文件名匹配
        const entryBase = e.sourceRelativePath.replace(/\\/g, '/').split('/').pop() ?? e.sourceRelativePath;
        return entryBase === moduleBaseName;
      });
      if (!entry) {
        return `⚠️ 在知识库中找不到模组文件「${moduleFile.filename}」，请重新导入模组。`;
      }

      const rawPath = resolve(entry.textPath);
      const label = entry.sourceRelativePath.split(/[\\/]/).pop() ?? entry.sourceRelativePath;
      const ok = state.setScenario(rawPath, label);
      if (!ok) {
        return `⚠️ 模组文件不存在：${entry.textPath}，请重新导入模组。`;
      }

      console.log(`[Campaign] 自动加载房间模组: room=${roomId} file=${label}`);
      this.loadScenarioImages(state, entry.id ?? '');
      this.segmentModuleAsync(state).catch((err) => {
        console.error('[Campaign] 模组分段失败:', err);
      });
      return null;
    } catch {
      return '⚠️ 知识库索引文件损坏，请重新构建索引。';
    }
  }

  // ─── 消息处理 ───────────────────────────────────────────────────────────────

  /**
   * 通过 session → room → member → character 解析玩家的 PC 名
   */
  private resolvePcName(sessionId: string, userId: number, fallback: string): string {
    const row = this.db.query<{ name: string }, [string, number]>(
      `SELECT c.name FROM campaign_room_members m
         JOIN campaign_rooms r ON r.id = m.room_id
         JOIN characters c ON c.id = m.character_id
       WHERE r.kp_session_id = ? AND m.qq_id = ?
       LIMIT 1`,
    ).get(sessionId, userId);
    return row?.name ?? fallback;
  }

  /**
   * 检查 userId 是否为当前 session 关联房间的成员。
   * 无关联房间（独立 session）时返回 true（不限制）。
   */
  private isSessionMember(sessionId: string, userId: number): boolean {
    const room = this.db.query<{ id: string }, string>(
      'SELECT id FROM campaign_rooms WHERE kp_session_id = ?',
    ).get(sessionId);
    if (!room) return true; // 无关联房间，不限制

    const member = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(room.id, userId);
    return !!member;
  }

  async handlePlayerMessage(
    groupId: number,
    userId: number,
    displayName: string,
    text: string,
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    const session = this.sessions.get(groupId);
    if (!session) return { text: null, images: [] };

    // 非房间成员完全忽略
    if (!this.isSessionMember(session.sessionId, userId)) {
      return { text: null, images: [] };
    }

    session.state.trackPlayer(userId);
    const pcName = this.resolvePcName(session.sessionId, userId, displayName);
    const channelId = session.state.getPlayerChannel(userId);
    const focusChannelId = session.state.getFocusChannel();

    // 并发锁：如果正在处理中，将消息排队
    let lock = this.groupLocks.get(groupId);
    if (!lock) {
      lock = { processing: false, pendingByChannel: new Map() };
      this.groupLocks.set(groupId, lock);
    }

    if (channelId !== focusChannelId) {
      this.enqueuePending(lock, { userId, displayName: pcName, text, channelId });
      const urgentReason = this.detectUrgentSceneEvent(text);
      if (urgentReason) {
        session.state.markChannelInterrupt(channelId, urgentReason, userId);
        return {
          text: `⚠️ [${channelId}] 频道发生紧急事件，建议使用 .scene focus ${channelId}`,
          images: [],
          queued: true,
        };
      }
      return { text: null, images: [], queued: true };
    }

    if (session.state.hasBlockingInterrupt(channelId)) {
      return {
        text: `⚠️ 其他场景频道存在未处理的紧急事件，请先使用 .scene list 查看并切换焦点处理。`,
        images: [],
      };
    }

    if (lock.processing) {
      this.enqueuePending(lock, { userId, displayName: pcName, text, channelId });
      return { text: null, images: [], queued: true };
    }

    lock.processing = true;

    try {
      session.state.clearChannelInterrupt(channelId, userId);

      // 处理当前消息
      let result = await this.processPlayerInput(session, userId, pcName, text, channelId, onThinking);

      result = await this.drainFocusedQueue(groupId, session, lock, result);

      return result;
    } finally {
      lock.processing = false;
    }
  }

  /** 内部：实际调用 pipeline 处理单条输入 */
  private async processPlayerInput(
    session: GroupSession,
    userId: number,
    displayName: string,
    text: string,
    channelId: string,
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    const output = await this.runPipelineInput(session, {
      kind: 'player_message',
      userId,
      displayName,
      content: text,
      channelId,
    }, onThinking);

    if (output.debug) {
      console.log(
        `[Campaign] user=${userId} ` +
        `intervention=${output.debug.interventionReason} ` +
        `respond=${output.shouldRespond}`,
      );
    }

    const reply = output.shouldRespond ? output.text : null;
    if (reply) session.state.advanceSegmentIfTitleMatches(reply);
    return { text: reply, images: output.images ?? [], privateMessages: output.privateMessages ?? [] };
  }

  async handleForceKP(
    groupId: number,
    userId: number,
    displayName: string,
    text: string,
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    const session = this.sessions.get(groupId);
    if (!session) return { text: '当前没有进行中的跑团。', images: [] };

    // 非房间成员完全忽略
    if (!this.isSessionMember(session.sessionId, userId)) {
      return { text: null, images: [] };
    }

    const pcName = this.resolvePcName(session.sessionId, userId, displayName);
    const channelId = session.state.getPlayerChannel(userId);

    const input: KPInput = {
      kind: 'force_kp',
      userId,
      displayName: pcName,
      content: text || '（玩家请求 KP 继续推进剧情）',
      channelId,
    };

    console.log(`[Campaign] group=${groupId} user=${userId} force_kp text="${text.slice(0, 30)}"`);
    const output = await this.runPipelineInput(session, input, onThinking);
    const reply = output.shouldRespond ? output.text : null;
    if (reply) session.state.advanceSegmentIfTitleMatches(reply);
    return { text: reply, images: output.images ?? [], privateMessages: output.privateMessages ?? [] };
  }

  async handleDiceResult(
    groupId: number,
    rollerId: number,
    rollerName: string,
    resultText: string,
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    const session = this.sessions.get(groupId);
    if (!session) return { text: null, images: [] };

    // 非房间成员完全忽略
    if (!this.isSessionMember(session.sessionId, rollerId)) {
      return { text: null, images: [] };
    }

    const pcName = this.resolvePcName(session.sessionId, rollerId, rollerName);
    const channelId = session.state.getPlayerChannel(rollerId);

    const input: KPInput = {
      kind: 'dice_result',
      userId: rollerId,
      displayName: pcName,
      content: resultText,
      diceRollerId: rollerId,
      channelId,
    };

    const output = await this.runPipelineInput(session, input, onThinking);
    const reply = output.shouldRespond ? output.text : null;
    if (reply) session.state.advanceSegmentIfTitleMatches(reply);
    return { text: reply, images: output.images ?? [], privateMessages: output.privateMessages ?? [] };
  }

  // ─── 查询 ────────────────────────────────────────────────────────────────────

  isActive(groupId: number): boolean {
    return this.sessions.has(groupId);
  }

  getSession(groupId: number): GroupSession | undefined {
    return this.sessions.get(groupId);
  }

  async handleSceneCommand(
    groupId: number,
    userId: number,
    displayName: string,
    args: string[],
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    const session = this.sessions.get(groupId);
    if (!session) return { text: '当前没有进行中的跑团。', images: [] };
    if (!this.isSessionMember(session.sessionId, userId)) {
      return { text: null, images: [] };
    }

    const subCommand = (args[0] ?? 'list').toLowerCase();

    if (subCommand === 'list' || subCommand === 'status') {
      return { text: this.buildSceneStatusText(session), images: [] };
    }

    if (subCommand === 'focus') {
      const channelId = (args[1] ?? '').trim();
      if (!channelId) {
        return { text: '用法：.scene focus <频道名>', images: [] };
      }
      session.state.setFocusChannel(channelId, userId);
      const focusText = `已切换到频道【${channelId}】。`;
      const queuedResult = await this.processQueuedChannelNow(groupId, session, channelId, onThinking);
      if (queuedResult.text) {
        return {
          text: `${focusText}\n\n${queuedResult.text}`,
          images: queuedResult.images,
          privateMessages: queuedResult.privateMessages,
        };
      }
      return { text: focusText, images: [] };
    }

    if (subCommand === 'join' || subCommand === 'goto') {
      const channelId = (args[1] ?? '').trim();
      if (!channelId) {
        return { text: '用法：.scene join <频道名>', images: [] };
      }
      session.state.assignPlayerToChannel(userId, channelId, userId);
      return { text: `已将你切换到频道【${channelId}】。`, images: [] };
    }

    if (subCommand === 'move') {
      const targetUserId = Number(args[1]);
      const channelId = (args[2] ?? '').trim();
      if (!Number.isFinite(targetUserId) || !channelId) {
        return { text: '用法：.scene move <QQ号> <频道名>', images: [] };
      }
      session.state.assignPlayerToChannel(targetUserId, channelId, userId);
      return { text: `已将玩家 ${targetUserId} 切换到频道【${channelId}】。`, images: [] };
    }

    if (subCommand === 'merge') {
      const fromChannel = (args[1] ?? '').trim();
      const toChannel = (args[2] ?? 'main').trim();
      if (!fromChannel) {
        return { text: '用法：.scene merge <来源频道> [目标频道]', images: [] };
      }
      const fromState = session.state.getChannelState(fromChannel);
      for (const playerId of fromState.playerIds) {
        session.state.assignPlayerToChannel(playerId, toChannel, userId);
      }
      session.state.recordChannelMerge(fromChannel, toChannel, fromState.playerIds, userId);
      const mergeSeedIds = session.state.getUnresolvedDirectorSeeds()
        .filter((seed) => seed.kind === 'merge_goal')
        .map((seed) => seed.id);
      if (mergeSeedIds.length > 0) {
        session.state.resolveDirectorSeeds(
          mergeSeedIds,
          `频道 ${fromChannel} 并入 ${toChannel}，自然汇合目标已进入执行阶段`,
          { channelId: toChannel, actorId: userId },
        );
      }
      if (session.state.getFocusChannel() === fromChannel) {
        session.state.setFocusChannel(toChannel, userId);
      }
      return { text: `已将频道【${fromChannel}】并入【${toChannel}】。`, images: [] };
    }

    if (subCommand === 'clear') {
      const channelId = (args[1] ?? session.state.getFocusChannel()).trim();
      session.state.clearChannelInterrupt(channelId, userId);
      return { text: `已清除频道【${channelId}】的紧急标记。`, images: [] };
    }

    return {
      text:
        '用法：\n' +
        '.scene list\n' +
        '.scene focus <频道名>\n' +
        '.scene join <频道名>\n' +
        '.scene move <QQ号> <频道名>\n' +
        '.scene merge <来源频道> [目标频道]\n' +
        '.scene clear [频道名]',
      images: [],
    };
  }

  private enqueuePending(
    lock: { processing: boolean; pendingByChannel: Map<string, PendingChannelMessage[]> },
    message: PendingChannelMessage,
  ): void {
    const queue = lock.pendingByChannel.get(message.channelId) ?? [];
    queue.push(message);
    lock.pendingByChannel.set(message.channelId, queue);
  }

  private async drainFocusedQueue(
    groupId: number,
    session: GroupSession,
    lock: { processing: boolean; pendingByChannel: Map<string, PendingChannelMessage[]> },
    current: CampaignOutput,
  ): Promise<CampaignOutput> {
    let result = current;
    while (true) {
      const focusChannelId = session.state.getFocusChannel();
      const batch = lock.pendingByChannel.get(focusChannelId);
      if (!batch || batch.length === 0) break;
      lock.pendingByChannel.delete(focusChannelId);
      const merged = batch.map((item) => `${item.displayName}：${item.text}`).join('\n');
      session.state.clearChannelInterrupt(focusChannelId, batch[0]?.userId);
      const next = await this.processPlayerInput(
        session,
        batch[0].userId,
        batch[0].displayName,
        merged,
        focusChannelId,
        undefined,
      );
      result = this.mergeCampaignOutputs(result, next);
    }
    return result;
  }

  private async processQueuedChannelNow(
    groupId: number,
    session: GroupSession,
    channelId: string,
    onThinking?: () => void,
  ): Promise<CampaignOutput> {
    let lock = this.groupLocks.get(groupId);
    if (!lock) {
      lock = { processing: false, pendingByChannel: new Map() };
      this.groupLocks.set(groupId, lock);
    }

    if (lock.processing) {
      return { text: null, images: [] };
    }

    const queue = lock.pendingByChannel.get(channelId);
    if (!queue || queue.length === 0) {
      return { text: null, images: [] };
    }

    lock.processing = true;
    try {
      lock.pendingByChannel.delete(channelId);
      const merged = queue.map((item) => `${item.displayName}：${item.text}`).join('\n');
      session.state.clearChannelInterrupt(channelId, queue[0]?.userId);
      const result = await this.processPlayerInput(
        session,
        queue[0].userId,
        queue[0].displayName,
        merged,
        channelId,
        onThinking,
      );
      return this.drainFocusedQueue(groupId, session, lock, result);
    } finally {
      lock.processing = false;
    }
  }

  private mergeCampaignOutputs(base: CampaignOutput, next: CampaignOutput): CampaignOutput {
    return {
      text: next.text ?? base.text,
      images: next.images.length > 0 ? next.images : base.images,
      privateMessages: [...(base.privateMessages ?? []), ...(next.privateMessages ?? [])],
      queued: base.queued || next.queued,
    };
  }

  private async runPipelineInput(
    session: GroupSession,
    input: KPInput,
    onThinking?: () => void,
  ) {
    const cycleEligible = input.kind === 'player_message' || input.kind === 'force_kp' || input.kind === 'dice_result';
    const beforeSeq = session.state.getLatestEventSeq();
    const pendingCue = cycleEligible
      ? this.sessionDirector.maybeCreateCue({
        snapshot: session.state.snapshot(input.channelId ?? session.state.getFocusChannel(), { includeKpOnly: true }),
        upcomingCycle: session.effectiveCycle + 1,
        idleCycleStreak: session.idleCycleStreak,
      })
      : null;

    const output = await session.pipeline.process(
      { ...input, directorCue: pendingCue ?? undefined },
      onThinking,
    );

    if (!cycleEligible || !output.shouldRespond) {
      return output;
    }

    session.effectiveCycle += 1;
    const eventDelta = session.state.getEventsSince(beforeSeq);
    const progressed = this.hasMeaningfulProgress(eventDelta);
    session.idleCycleStreak = progressed ? 0 : session.idleCycleStreak + 1;

    if (pendingCue) {
      session.state.addDirectorCue({ ...pendingCue, issuedAtCycle: session.effectiveCycle }, { channelId: pendingCue.channelId });
      if (progressed && pendingCue.relatedSeedIds.length > 0) {
        session.state.resolveDirectorSeeds(
          pendingCue.relatedSeedIds,
          `导演提示 ${pendingCue.type} 已在本轮形成有效推进`,
          { channelId: pendingCue.channelId },
        );
      }
    }

    return output;
  }

  private hasMeaningfulProgress(events: Array<{ type: string; payload: any }>): boolean {
    return events.some((event) => {
      switch (event.type) {
        case 'clue_discovered':
        case 'scene_change':
        case 'check_request':
        case 'check_result':
        case 'channel_merge':
          return true;
        case 'time_advance': {
          const deltaMinutes = Number(event.payload.deltaMinutes ?? 0);
          return Number.isFinite(deltaMinutes) && Math.abs(deltaMinutes) >= 10;
        }
        default:
          return false;
      }
    });
  }

  private getInitialEffectiveCycle(state: SessionState): number {
    return state.getRecentDirectorCues(20).reduce((max, cue) => Math.max(max, cue.issuedAtCycle), 0);
  }

  private buildSceneStatusText(session: GroupSession): string {
    const focusChannelId = session.state.getFocusChannel();
    const channels = session.state.getActiveChannels().filter((channelId) => {
      if (channelId === 'main') return true;
      const state = session.state.getChannelState(channelId);
      return state.playerIds.length > 0 || state.pendingRolls.length > 0 || state.interruptPending;
    });
    const visibleChannels = channels.length > 0 ? channels : ['main'];
    const lines = [
      `当前处理频道：${focusChannelId}`,
      `活跃频道：${visibleChannels.join('、')}`,
      '',
    ];

    for (const channelId of visibleChannels) {
      const state = session.state.getChannelState(channelId);
      const players = state.playerIds.map((playerId) =>
        this.resolvePcName(session.sessionId, playerId, String(playerId)),
      );
      lines.push(
        `${channelId === focusChannelId ? '▶' : '•'} ${channelId}` +
        `${state.interruptPending ? ' [紧急]' : ''}` +
        `：${players.length > 0 ? players.join('、') : '暂无调查员'}`,
      );
      if (state.currentScene?.name) {
        lines.push(`  场景：${state.currentScene.name}`);
      }
      if (state.pendingRolls.length > 0) {
        lines.push(`  待结算检定：${state.pendingRolls.map((roll) => `${roll.characterName}/${roll.skillName}`).join('、')}`);
      }
    }

    return lines.join('\n');
  }

  private detectUrgentSceneEvent(text: string): string | null {
    const trimmed = text.trim();
    const urgentPatterns: Array<[RegExp, string]> = [
      [/\b(sc|ti)\b/i, '理智冲击'],
      [/(开枪|射击|斗殴|攻击|追逐|追杀|陷阱|流血|爆炸|怪物|尖叫|濒死|受伤)/, '即时危险'],
    ];

    for (const [pattern, reason] of urgentPatterns) {
      if (pattern.test(trimmed)) return reason;
    }
    return null;
  }

  private getRoomIdBySession(sessionId: string): string | null {
    const row = this.db.query<{ id: string }, [string]>(
      'SELECT id FROM campaign_rooms WHERE kp_session_id = ? LIMIT 1',
    ).get(sessionId);
    return row?.id ?? null;
  }

  private async createOpeningOutput(
    state: SessionState,
    templateId: string,
    characters: Character[],
    roomId: string | null,
  ): Promise<CampaignOutput> {
    const directorPrefs = createDefaultRoomDirectorPrefs();
    const roomRelationships = roomId ? listRoomRelationships(this.db, roomId) : [];
    const moduleId = state.getModuleId();
    const approvedEntities = moduleId ? listModuleEntities(this.db, moduleId, ['approved']) : [];
    const approvedItems = moduleId ? listModuleItems(this.db, moduleId, ['approved']) : [];
    const moduleRulePack = moduleId ? getModuleRulePack(this.db, moduleId, ['approved']) : null;

    let plan: OpeningDirectorPlan;
    try {
      plan = await this.openingDirector.createPlan({
        characters,
        roomRelationships,
        directorPrefs,
        scenarioText: state.getScenarioText(),
        scenarioLabel: state.getScenarioLabel(),
        approvedEntities,
        approvedItems,
        moduleRulePack,
      });
    } catch (err) {
      console.error('[Campaign] OpeningDirector failed unexpectedly, fallback to deterministic opening plan:', err);
      plan = this.openingDirector.createFallbackPlan({
        characters,
        roomRelationships,
        directorPrefs,
        scenarioText: state.getScenarioText(),
        scenarioLabel: state.getScenarioLabel(),
        approvedEntities,
        approvedItems,
        moduleRulePack,
      });
    }

    return this.applyOpeningPlan(state, plan, characters, moduleRulePack?.playPrivacyMode ?? 'public');
  }

  private applyOpeningPlan(
    state: SessionState,
    plan: OpeningDirectorPlan,
    characters: Character[],
    playPrivacyMode: 'public' | 'secret',
  ): CampaignOutput {
    const textParts: string[] = [];
    const privateMessages: Array<{ userId: number; text: string }> = [];
    const deliveredPrivate = new Set<string>();
    const secretMode = playPrivacyMode === 'secret';
    const openingChannelId = secretMode ? (plan.beats[0]?.channelId ?? 'main') : 'main';

    state.recordOpeningPlan(plan, { channelId: openingChannelId });
    state.setIngameTime(plan.startTime, '开场导演设定时间', 'ai', undefined, { channelId: openingChannelId });

    const targetToUserId = new Map<string, number>();
    for (const character of characters) {
      targetToUserId.set(normalizeOpeningTarget(character.name), character.playerId);
      targetToUserId.set(normalizeOpeningTarget(String(character.playerId)), character.playerId);
      state.trackPlayer(character.playerId, { channelId: 'main', actorId: character.playerId });
      if (!secretMode) {
        state.assignPlayerToChannel(character.playerId, 'main', character.playerId);
      }
    }

    if (secretMode) {
      for (const assignment of plan.initialAssignments) {
        const userId = targetToUserId.get(normalizeOpeningTarget(assignment.target));
        if (userId !== undefined) {
          state.assignPlayerToChannel(userId, assignment.channelId);
        }
      }
      if (plan.beats[0]?.channelId) {
        state.setFocusChannel(plan.beats[0].channelId);
      }
    } else {
      state.setFocusChannel('main');
    }

    for (const beat of plan.beats) {
      const eventChannelId = secretMode ? beat.channelId : 'main';
      state.addDirectorMarker(`开场段落：${beat.sceneName}`, {
        channelId: eventChannelId,
        beatId: beat.id,
        participants: beat.participants,
      });

      if (beat.sceneName || beat.sceneState.description || beat.sceneState.activeNpcs.length > 0) {
        state.setScene({
          name: beat.sceneName || '开场段落',
          description: beat.sceneState.description,
          activeNpcs: beat.sceneState.activeNpcs,
        }, { channelId: eventChannelId });
      }

      const beatText = plan.beatTexts[beat.id];
      if (!beatText) continue;

      const publicExtras = !secretMode
        ? beatText.privateTexts
            .map((privateText) => privateText.text.trim() ? `只有${privateText.target}注意到：${privateText.text.trim()}` : '')
            .filter(Boolean)
        : [];
      const publicText = [beatText.publicText.trim(), ...publicExtras].filter(Boolean).join('\n\n');

      if (publicText) {
        textParts.push(publicText);
        state.addMessage({
          id: `opening-${beat.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'kp',
          content: publicText,
          timestamp: new Date(),
          channelId: eventChannelId,
        });
      }

      if (secretMode) {
        for (const privateText of beatText.privateTexts) {
          const userId = targetToUserId.get(normalizeOpeningTarget(privateText.target));
          const text = privateText.text.trim();
          if (userId === undefined || !text) continue;
          const dedupeKey = `${userId}:${text}`;
          if (deliveredPrivate.has(dedupeKey)) continue;
          deliveredPrivate.add(dedupeKey);
          privateMessages.push({ userId, text });
          state.addMessage({
            id: `opening-${beat.id}-priv-${userId}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'kp',
            content: text,
            timestamp: new Date(),
            channelId: eventChannelId,
            visibility: `private:${userId}`,
          });
        }
      }

      if (beat.advanceMinutes > 0) {
        state.advanceIngameTime(beat.advanceMinutes, `开场 ${beat.sceneName} 推进`, 'ai', undefined, { channelId: eventChannelId });
      }
    }

    return {
      text: textParts[0] ?? null,
      textParts,
      images: [],
      privateMessages,
    };
  }

  // ─── 私有：AI 生成 ─────────────────────────────────────────────────────────

  /**
   * 生成多段富有沉浸感的开场白。
   *
   * 3 段结构，用 `===` 分隔：
   *   第 1 段：时代背景与场景导入
   *   第 2 段：各调查员登场（若有 PC 信息）
   *   第 3 段：事件导火索 / 悬念钩子
   */
  private async generateRichOpening(
    state: SessionState,
    templateId: string,
    characters: Character[],
  ): Promise<string[]> {
    const scenarioText = state.getScenarioText();
    const scenarioLabel = state.getScenarioLabel();

    const pcBlock = characters.length > 0
      ? characters.map((c) =>
          `- ${c.name}${c.occupation ? `（${c.occupation}）` : ''}` +
          `${c.age ? `，${c.age}岁` : ''}` +
          `，SAN=${c.derived.san} HP=${c.derived.hp}`
        ).join('\n')
      : '（调查员尚未登记角色卡）';

    const moduleHint =
      `\n\n【重要】你必须严格按照以下模组内容来构建开场，不要编造模组中不存在的设定、地点或事件。\n` +
      `模组文件：${scenarioLabel ?? '未知'}\n开篇内容（前3000字）：\n${(scenarioText ?? '').slice(0, 3000)}`;

    const systemPrompt =
      `你是一位经验丰富的克苏鲁的呼唤（CoC 7th）守秘人（KP）。` +
      `你的风格是洛夫克拉夫特式恐怖，沉浸、克制、充满氛围。\n\n` +
      `【核心要求】开场叙述必须严格基于所提供的模组内容，包括时代、地点、事件。禁止编造模组中不存在的场景或设定。\n\n` +
      `请为本次跑团撰写一段分三部分的开场叙述，各部分之间用 === 分隔（只写三个等号的独立行，不要其他文字）：\n\n` +
      `【第一部分】时代背景与场景导入（100-150字）\n` +
      `  根据模组内容中描述的时代和地点，用第二人称把玩家带入具体场景，描述时间、地点、氛围、当下状态。\n\n` +
      `【第二部分】调查员登场（每人 50-80字）\n` +
      `  根据以下角色卡，为每位调查员写一段简短的登场描写，融入场景中，以第三人称描述。\n` +
      `  若没有角色卡，写「调查员们陆续抵达，各怀心思……」之类的占位描写。\n\n` +
      `【第三部分】事件导火索（80-120字）\n` +
      `  根据模组内容，引出让调查员聚集在一起的事件/委托/谜题，留下悬念，以「……」结尾，暗示未知正在等待。\n\n` +
      `绝对不要暴露任何 [KP ONLY] 守密信息。\n\n` +
      `【时间标记】请在第一部分的末尾附加一个时间标记来设定故事开始的游戏内时间，` +
      `格式为 [SET_TIME:YYYY-MM-DDTHH:MM]，例如 [SET_TIME:1925-03-14T09:00]。` +
      `根据模组内容决定具体的年代和时间点。`;

    const userContent =
      `本次跑团调查员：\n${pcBlock}` +
      moduleHint;

    const raw = await this.streamToString(KP_MODEL, systemPrompt, userContent);
    if (!raw) {
      return [`⚔️ 跑团模式已开启（模板：${templateId}）\n守秘人已就位，请各位调查员就位。`];
    }

    // 提取并应用时间标记
    const setTimeRe = /\[SET_TIME:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]/g;
    let cleaned = raw;
    let timeSet = false;
    for (const m of raw.matchAll(setTimeRe)) {
      if (!timeSet) {
        state.setIngameTime(m[1], '开场设定时间', 'ai');
        timeSet = true;
      }
      cleaned = cleaned.replace(m[0], '');
    }
    if (!timeSet) {
      // AI 未输出时间标记，使用默认值
      state.setIngameTime('1925-03-15T10:00', '默认开场时间', 'system');
    }

    // 按 === 分割，过滤空白段
    const parts = cleaned.split(/^===$/m).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [cleaned.trim()];
  }

  /**
   * 生成回顾摘要（用于 resume）。
   *
   * 2 段结构：
   *   第 1 段：上次进度回顾（基于摘要 + 最近消息）
   *   第 2 段：当前场景状态，引导继续
   */
  private async generateSessionRecap(state: SessionState): Promise<string[]> {
    const snapshot = state.snapshot();

    console.log(`[Campaign] recap context: ${snapshot.summaries.length} summaries, ${snapshot.recentMessages.length} msgs, ${snapshot.discoveredClues.length} clues`);

    const summaryText = snapshot.summaries.length > 0
      ? snapshot.summaries.map((s, i) => `摘要${i + 1}：${s}`).join('\n\n')
      : '（暂无历史摘要）';

    // 取最近 15 条消息作为参考（增加上下文量）
    const recentText = snapshot.recentMessages.slice(-15)
      .map((m) => {
        const who = m.role === 'kp' ? 'KP' : (m.displayName ?? `玩家${m.userId}`);
        return `${who}：${m.content}`;
      })
      .join('\n');

    const clueText = snapshot.discoveredClues.length > 0
      ? snapshot.discoveredClues.map((c) => `- ${c.title}：${c.playerDescription}`).join('\n')
      : '（暂无已发现线索）';

    const sceneText = snapshot.currentScene
      ? `当前场景：${snapshot.currentScene.name}\n${snapshot.currentScene.description}`
      : '（场景未设置）';

    const systemPrompt =
      `你是一位克苏鲁的呼唤守秘人，玩家们因现实原因中断了跑团，现在重新回来继续。\n` +
      `你必须撰写一段详细的「回顾与继续」叙述，总字数不少于200字。\n` +
      `分两部分，用 === 分隔（必须在独立行写三个等号）：\n\n` +
      `【第一部分】上次回顾（150-250字）\n` +
      `  以旁白口吻，用沉浸式语言总结调查员们上次的冒险进展：` +
      `去了哪里、发现了什么线索、经历了什么危险、目前面临的谜题。` +
      `语气应带有一丝悬念和紧迫感。即使信息较少也要基于已知内容展开描写。\n\n` +
      `【第二部分】重返场景（80-120字）\n` +
      `  以第二人称描述调查员们重新聚焦于当前场景，` +
      `唤起紧张氛围，以「……你们准备好了吗？」或类似句子结尾，邀请玩家继续行动。\n\n` +
      `注意：不要只写一句话就结束，必须写出完整的两部分内容。`;

    const timeText = snapshot.ingameTime
      ? `== 当前游戏内时间 ==\n${snapshot.ingameTime}`
      : '';

    const userContent =
      `== 历史摘要 ==\n${summaryText}\n\n` +
      `== 最近对话 ==\n${recentText || '（无）'}\n\n` +
      `== 已发现线索 ==\n${clueText}\n\n` +
      `== 当前场景 ==\n${sceneText}` +
      (timeText ? `\n\n${timeText}` : '');

    const raw = await this.streamToString(KP_MODEL, systemPrompt, userContent);

    console.log(`[Campaign] recap AI response: ${raw.length} chars`);

    // 构建最近对话附录（无论 AI 结果如何都附上）
    const messages = snapshot.recentMessages;
    let tailText = '';
    if (messages.length > 0) {
      const tail = messages.slice(-5).map((m) => {
        const who = m.role === 'kp' ? '🎭 KP' : `🧑 ${m.displayName ?? `玩家${m.userId}`}`;
        return `${who}：${m.content}`;
      });
      tailText = '📜 上次最后的对话：\n\n' + tail.join('\n\n');
    }

    const fallback = [
      '欢迎回来，调查员们。让我们继续上次未竟的调查……',
      sceneText !== '（场景未设置）' ? sceneText : '守秘人已就位，请继续行动。',
    ];
    if (tailText) fallback.push(tailText);

    if (!raw || raw.length < 80) return fallback;

    const parts = raw.split(/^===$/m).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return fallback;

    // 始终附上最近对话
    if (tailText) parts.push(tailText);

    return parts;
  }

  // ─── 私有：工具 ────────────────────────────────────────────────────────────

  /**
   * 将模组全文按场景/章节分段，并为每段异步生成摘要。
   * 在 loadScenario 后台调用，不阻塞主流程。
   */
  private async segmentModuleAsync(state: SessionState): Promise<void> {
    const text = state.getScenarioText();
    if (!text) return;

    // ── 1. 用正则识别章节/场景标题 ──────────────────────────────────────────
    const HEADING_RE = /^(第[零一二三四五六七八九十百千\d]+[章节幕场回][\s　]*[：:：]?.{0,20}|场景[\s　]*[零一二三四五六七八九十百千\d]+[\s　]*[：:：]?.{0,15}|Chapter\s+\d+.*|Scene\s+\d+.*|\[{1,2}[^\]]{2,20}\]{1,2}|={3,}[\s　]*(.{1,20})[\s　]*={3,})/m;

    const lines = text.split('\n');
    const headingPositions: Array<{ pos: number; title: string }> = [];
    let charPos = 0;

    for (const line of lines) {
      const m = line.match(HEADING_RE);
      if (m) {
        headingPositions.push({ pos: charPos, title: line.trim().slice(0, 40) });
      }
      charPos += line.length + 1;
    }

    // ── 2. 如果检测到合理数量的标题则按标题分割 ────────────────────────────
    let rawSegments: Array<{ title: string; fullText: string }>;

    if (headingPositions.length >= 3 && headingPositions.length <= 20) {
      rawSegments = headingPositions.map((h, i) => {
        const end = headingPositions[i + 1]?.pos ?? text.length;
        return { title: h.title, fullText: text.slice(h.pos, end).trim() };
      });
    } else {
      // 回退：按 5000 字切段，在段落边界处断开
      const CHUNK_SIZE = 5000;
      rawSegments = [];
      let start = 0;
      let idx = 1;
      while (start < text.length) {
        let end = Math.min(start + CHUNK_SIZE, text.length);
        // 尝试在段落边界断开
        const nl = text.lastIndexOf('\n\n', end);
        if (nl > start + 2000) end = nl;
        const chunk = text.slice(start, end).trim();
        // 用前两行作为标题
        const firstLine = chunk.split('\n')[0].slice(0, 30) || `片段 ${idx}`;
        rawSegments.push({ title: `第${idx}段：${firstLine}`, fullText: chunk });
        start = end;
        idx++;
      }
    }

    // 过滤掉太短的片段（<200字），合并到上一片
    const merged: Array<{ title: string; fullText: string }> = [];
    for (const seg of rawSegments) {
      if (seg.fullText.length < 200 && merged.length > 0) {
        merged[merged.length - 1].fullText += '\n\n' + seg.fullText;
      } else {
        merged.push(seg);
      }
    }

    // ── 3. 保存到 DB ────────────────────────────────────────────────────────
    state.saveSegments(merged);
    console.log(`[Campaign] 模组分段完成: ${merged.length} 个片段`);

    // ── 4. 异步为每段生成摘要（后台，不阻塞）──────────────────────────────
    const segments = state.getSegments();
    for (const seg of segments) {
      // 当前片段不需要摘要（直接用全文），跳过第一片
      if (seg.seq === 0) continue;

      const summary = await this.streamToString(
        'qwen-plus',
        `你是一个克苏鲁跑团模组编辑。请将以下模组片段压缩为简洁摘要（150字以内），` +
        `保留：场景名称、关键NPC及其态度、可获得的线索、可能触发的遭遇或检定。` +
        `不要添加任何评论，直接输出摘要文字。`,
        seg.fullText.slice(0, 4000),
      ).catch(() => '');

      if (summary) {
        state.updateSegmentSummary(seg.id, summary);
      }
    }

    console.log(`[Campaign] 全部片段摘要生成完毕`);
  }

  private streamToString(model: string, system: string, user: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let buf = '';
      this.aiClient.streamChat(
        model,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          onToken: (t) => { buf += t; },
          onDone: () => resolve(buf.trim()),
          onError: (err) => {
            console.error('[CampaignHandler] AI 生成失败:', err);
            resolve('');
          },
        },
      );
    });
  }

  /**
   * 从 ImageLibrary 加载与模组文件关联的图片，注入 SessionState。
   */
  private loadScenarioImages(state: SessionState, fileId: string): void {
    if (!fileId) return;
    const entries = this.imageLibrary.getBySourceFile(fileId);
    const images: ScenarioImage[] = entries.map((e) => ({
      id: e.id,
      absPath: ImageLibrary.absPath(e.relativePath),
      caption: e.caption,
      playerVisible: e.playerVisible,
    }));
    state.setScenarioImages(images);
    if (images.length > 0) {
      console.log(`[Campaign] 加载模组图片: fileId=${fileId} count=${images.length}`);
    }
  }

  private findPausedSession(groupId: number): PausedSessionRow | null {
    // 查找 paused 或 running（服务重启后 running 的 session 也需要恢复）
    return this.db
      .query<PausedSessionRow, [number]>(
        `SELECT id, campaign_id, kp_template_id FROM kp_sessions
          WHERE group_id = ? AND status IN ('paused', 'running')
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(groupId) ?? null;
  }
}

function campaignOutputFromParts(parts: string[]): CampaignOutput {
  const textParts = parts.map((part) => part.trim()).filter(Boolean);
  return {
    text: textParts.length === 1 ? textParts[0] : null,
    textParts: textParts.length > 0 ? textParts : undefined,
    images: [],
    privateMessages: [],
  };
}

function normalizeOpeningTarget(value: string): string {
  return value.toLowerCase().replace(/[\s【】（）()：:，,、]/g, '').trim();
}
