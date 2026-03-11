/**
 * AI KP 会话状态
 *
 * 管理一场跑团期间的所有动态状态：
 *  - 当前场景 / 章节
 *  - 已发现线索（区分 KP 知道 vs 玩家知道）
 *  - 等待骰子状态（谁在等什么检定结果）
 *  - 对话消息历史（含玩家 RP、KP 回复、骰子结果）
 *  - 摘要历史（旧消息压缩后的文本）
 *
 * 全部状态持久化到 SQLite，进程重启后可恢复。
 */

import { existsSync, readFileSync } from 'fs';
import type { Database } from 'bun:sqlite';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

/** 消息角色 */
export type MessageRole = 'player' | 'kp' | 'dice' | 'system';

/** 对话消息 */
export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  /** 发消息的 QQ 用户 ID（玩家消息才有） */
  userId?: number;
  /** 显示名（玩家昵称或角色名） */
  displayName?: string;
  content: string;
  timestamp: Date;
  /** 是否已被摘要压缩（压缩后不再放入原文上下文） */
  isSummarized: boolean;
}

/** 线索 */
export interface Clue {
  id: string;
  sessionId: string;
  /** 线索标题（KP 内部标识用） */
  title: string;
  /** KP 知道的完整内容（不直接输出给玩家） */
  keeperContent: string;
  /** 玩家发现时看到的描述（经 KP 加工过） */
  playerDescription: string;
  isDiscovered: boolean;
  discoveredAt?: Date;
  /** 发现该线索的玩家 userId */
  discoveredBy?: number;
}

/** 模组场景片段（用于动态上下文窗口） */
export interface SceneSegment {
  id: string;
  sessionId: string;
  seq: number;
  title: string;
  fullText: string;
  summary: string;
  charCount: number;
}

/** 等待玩家投骰的请求 */
export interface PendingRoll {
  /** 等待的玩家 userId */
  playerId: number;
  /** 角色名 */
  characterName: string;
  /** 技能名，如 "侦查"、"图书馆使用" */
  skillName: string;
  /** 要求检定的难度（普通/困难/极难） */
  difficulty: 'normal' | 'hard' | 'extreme';
  /** KP 请求投骰时的说明文本 */
  reason: string;
  requestedAt: Date;
}

/** 当前场景信息 */
export interface SceneInfo {
  /** 场景/章节名 */
  name: string;
  /** 场景简短描述（供上下文用） */
  description: string;
  /** 场上活跃 NPC 名称列表 */
  activeNpcs: string[];
}

/** 会话状态快照（供 ContextBuilder 读取） */
export interface SessionSnapshot {
  sessionId: string;
  campaignId: string;
  groupId: number;
  currentScene: SceneInfo | null;
  discoveredClues: Clue[];
  pendingRolls: PendingRoll[];
  /** 未被摘要的近期消息（原文） */
  recentMessages: SessionMessage[];
  /** 已压缩的摘要文本列表（从旧到新） */
  summaries: string[];
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

export class SessionState {
  private readonly db: Database;
  readonly sessionId: string;
  readonly campaignId: string;
  readonly groupId: number;

  // 内存缓存
  private _currentScene: SceneInfo | null = null;
  private _pendingRolls: PendingRoll[] = [];
  /** 已加载的模组全文（来自 data/knowledge/raw/）*/
  private _scenarioText: string | null = null;

  constructor(db: Database, sessionId: string, campaignId: string, groupId: number) {
    this.db = db;
    this.sessionId = sessionId;
    this.campaignId = campaignId;
    this.groupId = groupId;
    this._loadScene();
    this._loadPendingRolls();
    this._loadScenarioText();
  }

  // ─── 场景管理 ───────────────────────────────────────────────────────────────

  get currentScene(): SceneInfo | null {
    return this._currentScene;
  }

  setScene(scene: SceneInfo): void {
    this._currentScene = scene;
    this.db.run(
      `INSERT OR REPLACE INTO kp_scenes
         (session_id, name, description, active_npcs_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        this.sessionId,
        scene.name,
        scene.description,
        JSON.stringify(scene.activeNpcs),
        new Date().toISOString(),
      ],
    );
  }

  // ─── 线索管理 ───────────────────────────────────────────────────────────────

  addClue(clue: Omit<Clue, 'sessionId' | 'isDiscovered' | 'discoveredAt' | 'discoveredBy'>): void {
    this.db.run(
      `INSERT OR IGNORE INTO kp_clues
         (id, session_id, title, keeper_content, player_description,
          is_discovered, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [
        clue.id,
        this.sessionId,
        clue.title,
        clue.keeperContent,
        clue.playerDescription,
        new Date().toISOString(),
      ],
    );
  }

  discoverClue(clueId: string, byUserId: number): boolean {
    const result = this.db.run(
      `UPDATE kp_clues
          SET is_discovered = 1, discovered_at = ?, discovered_by = ?
        WHERE id = ? AND session_id = ? AND is_discovered = 0`,
      [new Date().toISOString(), byUserId, clueId, this.sessionId],
    );
    return result.changes > 0;
  }

  getDiscoveredClues(): Clue[] {
    return this.db
      .query<DbClueRow, [string]>(
        `SELECT * FROM kp_clues WHERE session_id = ? AND is_discovered = 1
         ORDER BY discovered_at ASC`,
      )
      .all(this.sessionId)
      .map(rowToClue);
  }

  getAllClues(): Clue[] {
    return this.db
      .query<DbClueRow, [string]>(`SELECT * FROM kp_clues WHERE session_id = ? ORDER BY created_at ASC`)
      .all(this.sessionId)
      .map(rowToClue);
  }

  // ─── 等待骰子 ───────────────────────────────────────────────────────────────

  get pendingRolls(): PendingRoll[] {
    return [...this._pendingRolls];
  }

  addPendingRoll(roll: PendingRoll): void {
    // 同一玩家的旧请求覆盖
    this._pendingRolls = this._pendingRolls.filter((r) => r.playerId !== roll.playerId);
    this._pendingRolls.push(roll);
    this._savePendingRolls();
  }

  clearPendingRoll(playerId: number): void {
    this._pendingRolls = this._pendingRolls.filter((r) => r.playerId !== playerId);
    this._savePendingRolls();
  }

  clearAllPendingRolls(): void {
    this._pendingRolls = [];
    this._savePendingRolls();
  }

  // ─── 消息历史 ───────────────────────────────────────────────────────────────

  addMessage(msg: Omit<SessionMessage, 'sessionId' | 'isSummarized'>): SessionMessage {
    const full: SessionMessage = {
      ...msg,
      sessionId: this.sessionId,
      isSummarized: false,
    };

    this.db.run(
      `INSERT INTO kp_messages
         (id, session_id, role, user_id, display_name, content, timestamp, is_summarized)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        full.id,
        full.sessionId,
        full.role,
        full.userId ?? null,
        full.displayName ?? null,
        full.content,
        full.timestamp.toISOString(),
      ],
    );

    return full;
  }

  /**
   * 返回未被摘要压缩的消息，按时间正序。
   * limit 默认 40 条，防止单次拉取过多。
   */
  getRecentMessages(limit = 40): SessionMessage[] {
    return this.db
      .query<DbMessageRow, [string, number]>(
        `SELECT * FROM kp_messages
          WHERE session_id = ? AND is_summarized = 0
          ORDER BY timestamp ASC
          LIMIT ?`,
      )
      .all(this.sessionId, limit)
      .map(rowToMessage);
  }

  /** 将一批消息标记为已摘要（不再出现在 recentMessages 里） */
  markSummarized(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const placeholders = messageIds.map(() => '?').join(',');
    this.db.run(
      `UPDATE kp_messages SET is_summarized = 1
        WHERE session_id = ? AND id IN (${placeholders})`,
      [this.sessionId, ...messageIds],
    );
  }

  // ─── 玩家跟踪 ───────────────────────────────────────────────────────────────

  /** 记录参与本 session 的玩家 userId（首次发言时自动注册） */
  trackPlayer(userId: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO kp_session_players (session_id, user_id, joined_at) VALUES (?, ?, ?)',
      [this.sessionId, userId, new Date().toISOString()],
    );
  }

  getPlayerIds(): number[] {
    return this.db
      .query<{ user_id: number }, [string]>(
        'SELECT user_id FROM kp_session_players WHERE session_id = ? ORDER BY joined_at ASC',
      )
      .all(this.sessionId)
      .map((r) => r.user_id);
  }

  // ─── 摘要 ────────────────────────────────────────────────────────────────────

  addSummary(content: string, sourceMessageIds: string[]): void {
    const id = `sum-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.db.run(
      `INSERT INTO kp_summaries (id, session_id, content, message_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, this.sessionId, content, JSON.stringify(sourceMessageIds), new Date().toISOString()],
    );
    this.markSummarized(sourceMessageIds);
  }

  getSummaries(): string[] {
    return this.db
      .query<{ content: string }, [string]>(
        `SELECT content FROM kp_summaries
          WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(this.sessionId)
      .map((r) => r.content);
  }

  // ─── 场景片段（动态上下文窗口）────────────────────────────────────────────

  /**
   * 保存分段结果（幂等，重复调用会先清空再写入）。
   */
  saveSegments(segments: Array<{ title: string; fullText: string }>): void {
    this.db.run(`DELETE FROM kp_scene_segments WHERE session_id = ?`, [this.sessionId]);
    const now = new Date().toISOString();
    for (let i = 0; i < segments.length; i++) {
      const id = `seg-${this.sessionId}-${i}`;
      this.db.run(
        `INSERT INTO kp_scene_segments (id, session_id, seq, title, full_text, summary, char_count, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        [id, this.sessionId, i, segments[i].title, segments[i].fullText, segments[i].fullText.length, now],
      );
    }
    // 初始化指针到第一片
    if (segments.length > 0) {
      const firstId = `seg-${this.sessionId}-0`;
      this.db.run(`UPDATE kp_sessions SET current_segment_id = ?, updated_at = ? WHERE id = ?`,
        [firstId, now, this.sessionId]);
    }
  }

  getSegments(): SceneSegment[] {
    return this.db
      .query<{
        id: string; session_id: string; seq: number; title: string;
        full_text: string; summary: string; char_count: number;
      }, [string]>(
        `SELECT * FROM kp_scene_segments WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(this.sessionId)
      .map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        seq: r.seq,
        title: r.title,
        fullText: r.full_text,
        summary: r.summary,
        charCount: r.char_count,
      }));
  }

  updateSegmentSummary(segmentId: string, summary: string): void {
    this.db.run(`UPDATE kp_scene_segments SET summary = ? WHERE id = ?`, [summary, segmentId]);
  }

  getCurrentSegmentId(): string | null {
    const row = this.db
      .query<{ current_segment_id: string | null }, [string]>(
        `SELECT current_segment_id FROM kp_sessions WHERE id = ?`,
      )
      .get(this.sessionId);
    return row?.current_segment_id ?? null;
  }

  setCurrentSegmentId(segmentId: string): void {
    this.db.run(`UPDATE kp_sessions SET current_segment_id = ?, updated_at = ? WHERE id = ?`,
      [segmentId, new Date().toISOString(), this.sessionId]);
  }

  /**
   * 检测 KP 回复文本中是否出现下一片段的标题，若是则自动推进指针。
   * @returns 是否发生了推进
   */
  advanceSegmentIfTitleMatches(responseText: string): boolean {
    const currentId = this.getCurrentSegmentId();
    if (!currentId) return false;

    const segments = this.getSegments();
    const currentIdx = segments.findIndex((s) => s.id === currentId);
    if (currentIdx < 0) return false;

    // 检查接下来的片段（最多往前看 3 片）
    for (let offset = 1; offset <= 3; offset++) {
      const next = segments[currentIdx + offset];
      if (!next) break;
      // 标题关键词（去掉章节前缀，只取核心词）
      const keyword = next.title.replace(/^(第.{1,4}[章节幕场]|场景.{1,3}|Chapter\s*\d+|Scene\s*\d+)[\s：:：]*/i, '').trim();
      if (keyword.length >= 2 && responseText.includes(keyword)) {
        this.setCurrentSegmentId(next.id);
        console.log(`[SessionState] 场景推进: "${next.title}" (seq=${next.seq})`);
        return true;
      }
    }
    return false;
  }

  // ─── 快照 ─────────────────────────────────────────────────────────────────

  snapshot(): SessionSnapshot {
    return {
      sessionId: this.sessionId,
      campaignId: this.campaignId,
      groupId: this.groupId,
      currentScene: this._currentScene,
      discoveredClues: this.getDiscoveredClues(),
      pendingRolls: this.pendingRolls,
      recentMessages: this.getRecentMessages(40),
      summaries: this.getSummaries(),
    };
  }

  // ─── 私有 ─────────────────────────────────────────────────────────────────

  private _loadScene(): void {
    const row = this.db
      .query<DbSceneRow, [string]>(
        `SELECT * FROM kp_scenes WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.sessionId);

    if (row) {
      this._currentScene = {
        name: row.name,
        description: row.description,
        activeNpcs: JSON.parse(row.active_npcs_json) as string[],
      };
    }
  }

  private _loadPendingRolls(): void {
    const row = this.db
      .query<{ rolls_json: string }, [string]>(
        `SELECT rolls_json FROM kp_pending_rolls WHERE session_id = ? LIMIT 1`,
      )
      .get(this.sessionId);

    if (row) {
      const parsed = JSON.parse(row.rolls_json) as PendingRoll[];
      this._pendingRolls = parsed.map((r) => ({
        ...r,
        requestedAt: new Date(r.requestedAt),
      }));
    }
  }

  private _savePendingRolls(): void {
    this.db.run(
      `INSERT OR REPLACE INTO kp_pending_rolls (session_id, rolls_json, updated_at)
       VALUES (?, ?, ?)`,
      [this.sessionId, JSON.stringify(this._pendingRolls), new Date().toISOString()],
    );
  }

  // ─── 模组全文 ────────────────────────────────────────────────────────────────

  /**
   * 从 data/knowledge/raw/ 加载模组原始文本，注入到 ContextBuilder 层 5。
   * @param rawTextPath  data/knowledge/raw/{id}.txt 的路径
   * @param label        在 Prompt 中显示的来源标签（如原始文件名）
   */
  setScenario(rawTextPath: string, label: string): boolean {
    if (!existsSync(rawTextPath)) return false;
    const text = readFileSync(rawTextPath, 'utf-8');
    this._scenarioText = text;

    this.db.run(
      `UPDATE kp_sessions SET scenario_file_path = ?, updated_at = ? WHERE id = ?`,
      [`${label}||${rawTextPath}`, new Date().toISOString(), this.sessionId],
    );
    return true;
  }

  /** 获取已加载的模组全文，未加载则返回 null */
  getScenarioText(): string | null {
    return this._scenarioText;
  }

  /** 已加载的模组标签（原始文件名），未加载返回 null */
  getScenarioLabel(): string | null {
    const row = this.db
      .query<{ scenario_file_path: string | null }, [string]>(
        'SELECT scenario_file_path FROM kp_sessions WHERE id = ?',
      )
      .get(this.sessionId);
    if (!row?.scenario_file_path) return null;
    return row.scenario_file_path.split('||')[0] ?? null;
  }

  private _loadScenarioText(): void {
    const row = this.db
      .query<{ scenario_file_path: string | null }, [string]>(
        'SELECT scenario_file_path FROM kp_sessions WHERE id = ?',
      )
      .get(this.sessionId);

    if (!row?.scenario_file_path) return;
    const parts = row.scenario_file_path.split('||');
    const filePath = parts[1];
    if (filePath && existsSync(filePath)) {
      this._scenarioText = readFileSync(filePath, 'utf-8');
    }
  }
}

// ─── 数据库行类型 ──────────────────────────────────────────────────────────────

interface DbSceneRow {
  session_id: string;
  name: string;
  description: string;
  active_npcs_json: string;
  updated_at: string;
}

interface DbClueRow {
  id: string;
  session_id: string;
  title: string;
  keeper_content: string;
  player_description: string;
  is_discovered: number;
  discovered_at: string | null;
  discovered_by: number | null;
}

interface DbMessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  user_id: number | null;
  display_name: string | null;
  content: string;
  timestamp: string;
  is_summarized: number;
}

function rowToClue(row: DbClueRow): Clue {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    keeperContent: row.keeper_content,
    playerDescription: row.player_description,
    isDiscovered: row.is_discovered === 1,
    discoveredAt: row.discovered_at ? new Date(row.discovered_at) : undefined,
    discoveredBy: row.discovered_by ?? undefined,
  };
}

function rowToMessage(row: DbMessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    userId: row.user_id ?? undefined,
    displayName: row.display_name ?? undefined,
    content: row.content,
    timestamp: new Date(row.timestamp),
    isSummarized: row.is_summarized === 1,
  };
}
