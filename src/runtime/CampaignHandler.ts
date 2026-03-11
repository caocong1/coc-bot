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
 *   .campaign start [模板ID]   — 开团（生成 AI 多段开场白）
 *   .campaign pause            — 暂停（保存状态，不清历史）
 *   .campaign resume           — 继续（生成 AI 回顾摘要）
 *   .campaign stop             — 彻底结束
 *   .campaign load <文件名>    — 加载模组全文
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Database } from 'bun:sqlite';
import { DashScopeClient } from '../ai/client/DashScopeClient';
import { KPPipeline, type KPInput } from '../ai/pipeline/KPPipeline';
import { KnowledgeService } from '../knowledge/retrieval/KnowledgeService';
import { SessionState } from './SessionState';
import { ModeResolver } from './ModeResolver';
import { CharacterStore } from '../commands/sheet/CharacterStore';
import type { Character } from '@shared/types/Character';

const MANIFEST_PATH = 'data/knowledge/manifest.json';
const KP_MODEL = 'qwen3.5-plus';

interface ManifestEntry {
  id: string;
  /** 原始文件的相对路径（含文件名） */
  sourceRelativePath: string;
  /** 提取出的纯文本路径 data/knowledge/raw/{id}.txt */
  textPath: string;
  fileType?: string;
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
  /** 每个群的 KP 模板 ID，默认 'serious' */
  defaultTemplateId?: string;
}

/** 每个群对应一个活跃 Session */
interface GroupSession {
  sessionId: string;
  campaignId: string;
  state: SessionState;
  pipeline: KPPipeline;
}

export class CampaignHandler {
  private readonly db: Database;
  private readonly aiClient: DashScopeClient;
  private readonly store: CharacterStore;
  private readonly modeResolver: ModeResolver;
  private readonly defaultTemplateId: string;
  private readonly knowledge = new KnowledgeService();

  /** groupId → 活跃 session */
  private readonly sessions = new Map<number, GroupSession>();

  constructor(options: CampaignHandlerOptions) {
    this.db = options.db;
    this.aiClient = options.aiClient;
    this.store = options.store;
    this.modeResolver = options.modeResolver;
    this.defaultTemplateId = options.defaultTemplateId ?? 'serious';
  }

  // ─── 开 / 暂停 / 继续 / 结团 ────────────────────────────────────────────────

  /**
   * 开启 Campaign 模式。
   * 若该群已有暂停中的 session，提示先 resume 或 stop。
   * @returns 多段开场白，逐条发到群聊
   */
  async startSession(groupId: number, templateId?: string): Promise<string[]> {
    if (this.sessions.has(groupId)) {
      return ['当前已有进行中的跑团，请先使用 .campaign pause 或 .campaign stop 结束。'];
    }

    // 检查是否有暂停中的 session
    const paused = this.findPausedSession(groupId);
    if (paused) {
      return [
        '⚠️ 该群有暂停中的跑团记录。\n' +
        '• 使用 .campaign resume 继续上次跑团\n' +
        '• 使用 .campaign stop 彻底结束后再开新团',
      ];
    }

    const tid = templateId ?? this.defaultTemplateId;
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
    const pipeline = new KPPipeline(this.aiClient, state, this.store, this.knowledge, { templateId: tid });

    this.sessions.set(groupId, { sessionId, campaignId, state, pipeline });
    this.modeResolver.setGroupMode(groupId, 'campaign', campaignId);

    console.log(`[Campaign] 开团: group=${groupId} session=${sessionId} template=${tid}`);

    // 获取当前群所有激活的 PC
    const characters = this.store.getGroupActiveCharacters(groupId);

    // 生成多段开场白
    return this.generateRichOpening(state, tid, characters);
  }

  /**
   * 暂停跑团（保存所有状态，可通过 resume 继续）。
   */
  pauseSession(groupId: number): string {
    const session = this.sessions.get(groupId);
    if (!session) return '当前没有进行中的跑团。';

    this.db.run(
      `UPDATE kp_sessions SET status = 'paused', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), session.sessionId],
    );

    this.sessions.delete(groupId);
    this.modeResolver.setGroupMode(groupId, 'dice');

    console.log(`[Campaign] 暂停: group=${groupId} session=${session.sessionId}`);
    return '⏸️ 跑团已暂停，所有进度已保存。\n下次使用 .campaign resume 继续，所有对话和线索都在。';
  }

  /**
   * 继续最近一次暂停的跑团，生成回顾摘要。
   */
  async resumeSession(groupId: number): Promise<string[]> {
    if (this.sessions.has(groupId)) {
      return ['当前已有进行中的跑团。'];
    }

    const row = this.findPausedSession(groupId);
    if (!row) {
      return ['没有找到可以继续的跑团记录。使用 .campaign start 开始新的跑团。'];
    }

    // 恢复状态
    this.db.run(
      `UPDATE kp_sessions SET status = 'running', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), row.id],
    );

    const state = new SessionState(this.db, row.id, row.campaign_id, groupId);
    const pipeline = new KPPipeline(
      this.aiClient, state, this.store, this.knowledge,
      { templateId: row.kp_template_id },
    );

    this.sessions.set(groupId, {
      sessionId: row.id,
      campaignId: row.campaign_id,
      state,
      pipeline,
    });
    this.modeResolver.setGroupMode(groupId, 'campaign', row.campaign_id);

    console.log(`[Campaign] 继续: group=${groupId} session=${row.id}`);

    return this.generateSessionRecap(state);
  }

  /**
   * 彻底结束跑团。
   */
  stopSession(groupId: number): string {
    // 先尝试结束内存中的 session
    const session = this.sessions.get(groupId);
    if (session) {
      this.db.run(
        `UPDATE kp_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), new Date().toISOString(), session.sessionId],
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
        [new Date().toISOString(), new Date().toISOString(), paused.id],
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
      return '当前没有进行中的跑团，请先使用 .campaign start 开团。';
    }

    if (!existsSync(MANIFEST_PATH)) {
      return '知识库索引文件不存在，请先运行 bun run build-indexes 构建索引。';
    }

    let manifest: ManifestEntry[];
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestEntry[];
    } catch {
      return '知识库索引文件损坏，请重新构建索引。';
    }

    const keyword = filename.toLowerCase();
    const entry = manifest.find(
      (e) =>
        e.sourceRelativePath.toLowerCase().includes(keyword) ||
        e.id.toLowerCase().includes(keyword),
    );

    if (!entry) {
      const available = manifest
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

    // 后台分段（不阻塞命令响应）
    this.segmentModuleAsync(session.state).catch((err) => {
      console.error('[Campaign] 模组分段失败:', err);
    });

    return `📖 模组已加载：${label}\n守秘人正在阅读模组，场景分析在后台进行，稍后即可开团。`;
  }

  // ─── 消息处理 ───────────────────────────────────────────────────────────────

  async handlePlayerMessage(
    groupId: number,
    userId: number,
    displayName: string,
    text: string,
  ): Promise<string | null> {
    const session = this.sessions.get(groupId);
    if (!session) return null;

    session.state.trackPlayer(userId);

    const input: KPInput = {
      kind: 'player_message',
      userId,
      displayName,
      content: text,
    };

    const output = await session.pipeline.process(input);

    if (output.debug) {
      console.log(
        `[Campaign] group=${groupId} user=${userId} ` +
        `intervention=${output.debug.interventionReason} ` +
        `respond=${output.shouldRespond}`,
      );
    }

    const reply = output.shouldRespond ? output.text : null;
    if (reply) session.state.advanceSegmentIfTitleMatches(reply);
    return reply;
  }

  async handleDiceResult(
    groupId: number,
    rollerId: number,
    rollerName: string,
    resultText: string,
  ): Promise<string | null> {
    const session = this.sessions.get(groupId);
    if (!session) return null;

    const input: KPInput = {
      kind: 'dice_result',
      userId: rollerId,
      displayName: rollerName,
      content: resultText,
      diceRollerId: rollerId,
    };

    const output = await session.pipeline.process(input);
    const reply = output.shouldRespond ? output.text : null;
    if (reply) session.state.advanceSegmentIfTitleMatches(reply);
    return reply;
  }

  // ─── 查询 ────────────────────────────────────────────────────────────────────

  isActive(groupId: number): boolean {
    return this.sessions.has(groupId);
  }

  getSession(groupId: number): GroupSession | undefined {
    return this.sessions.get(groupId);
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

    const moduleHint = scenarioText
      ? `\n\n模组文件：${scenarioLabel ?? '未知'}\n开篇内容（前3000字）：\n${scenarioText.slice(0, 3000)}`
      : '';

    const systemPrompt =
      `你是一位经验丰富的克苏鲁的呼唤（CoC 7th）守秘人（KP）。` +
      `你的风格是洛夫克拉夫特式恐怖，沉浸、克制、充满氛围。\n\n` +
      `请为本次跑团撰写一段分三部分的开场叙述，各部分之间用 === 分隔（只写三个等号的独立行，不要其他文字）：\n\n` +
      `【第一部分】时代背景与场景导入（100-150字）\n` +
      `  用第二人称把玩家带入 1920 年代的具体场景，描述时间、地点、氛围、当下状态。\n\n` +
      `【第二部分】调查员登场（每人 50-80字）\n` +
      `  根据以下角色卡，为每位调查员写一段简短的登场描写，融入场景中，以第三人称描述。\n` +
      `  若没有角色卡，写「调查员们陆续抵达，各怀心思……」之类的占位描写。\n\n` +
      `【第三部分】事件导火索（80-120字）\n` +
      `  引出让调查员聚集在一起的事件/委托/谜题，留下悬念，以「……」结尾，暗示未知正在等待。\n\n` +
      `绝对不要暴露任何 [KP ONLY] 守密信息。`;

    const userContent =
      `本次跑团调查员：\n${pcBlock}` +
      moduleHint;

    const raw = await this.streamToString(KP_MODEL, systemPrompt, userContent);
    if (!raw) {
      return [`⚔️ 跑团模式已开启（模板：${templateId}）\n守秘人已就位，请各位调查员就位。`];
    }

    // 按 === 分割，过滤空白段
    const parts = raw.split(/^===$/m).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [raw];
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

    const summaryText = snapshot.summaries.length > 0
      ? snapshot.summaries.map((s, i) => `摘要${i + 1}：${s}`).join('\n\n')
      : '（暂无历史摘要）';

    // 取最近 10 条消息作为参考
    const recentText = snapshot.recentMessages.slice(-10)
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
      `请撰写一段「回顾与继续」叙述，分两部分，用 === 分隔（只写三个等号的独立行）：\n\n` +
      `【第一部分】上次回顾（150-250字）\n` +
      `  以旁白口吻，用沉浸式语言总结调查员们上次的冒险进展：` +
      `去了哪里、发现了什么线索、经历了什么危险、目前面临的谜题。` +
      `语气应带有一丝悬念和紧迫感。\n\n` +
      `【第二部分】重返场景（80-120字）\n` +
      `  以第二人称描述调查员们重新聚焦于当前场景，` +
      `唤起紧张氛围，以「……你们准备好了吗？」或类似句子结尾，邀请玩家继续行动。`;

    const userContent =
      `== 历史摘要 ==\n${summaryText}\n\n` +
      `== 最近对话 ==\n${recentText || '（无）'}\n\n` +
      `== 已发现线索 ==\n${clueText}\n\n` +
      `== 当前场景 ==\n${sceneText}`;

    const raw = await this.streamToString(KP_MODEL, systemPrompt, userContent);

    const fallback = [
      '欢迎回来，调查员们。让我们继续上次未竟的调查……',
      sceneText !== '（场景未设置）' ? sceneText : '守秘人已就位，请继续行动。',
    ];

    if (!raw) return fallback;

    const parts = raw.split(/^===$/m).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : fallback;
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

  private findPausedSession(groupId: number): PausedSessionRow | null {
    return this.db
      .query<PausedSessionRow, [number]>(
        `SELECT id, campaign_id, kp_template_id FROM kp_sessions
          WHERE group_id = ? AND status = 'paused'
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(groupId) ?? null;
  }
}
