/**
 * AI KP 会话状态
 *
 * 管理一场跑团期间的所有动态状态：
 *  - 当前场景 / 场景频道
 *  - 已发现线索（区分 KP 知道 vs 玩家知道）
 *  - 等待骰子状态（谁在等什么检定结果）
 *  - 对话消息历史（含玩家 RP、KP 回复、骰子结果）
 *  - 摘要历史（旧消息压缩后的文本）
 *
 * v1.2 开始引入双写事件流：
 *  - 旧散表继续保留并写入，作为回滚窗口
 *  - kp_events 作为 canonical runtime history
 *  - SessionState 优先从事件流回放重建缓存
 */

import { existsSync, readFileSync } from 'fs';
import type { Database } from 'bun:sqlite';
import type {
  ModuleRulePack,
  ScenarioEntity,
  ScenarioItem,
  SessionEntityOverlay,
  SessionItemOverlay,
} from '@shared/types/ScenarioAssets';
import type {
  DirectorCue,
  DirectorSeed,
  OpeningAssignment,
  OpeningDirectorPlanSkeleton,
} from '@shared/types/StoryDirector';
import {
  getModuleRulePack,
  listModuleEntities,
  listModuleItems,
} from '../storage/ModuleAssetStore';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL_ID = 'main';
const DEFAULT_VISIBILITY = 'public';
const KP_EVENT_SHADOW_COMPARE =
  process.env.KP_EVENT_SHADOW_COMPARE === undefined ||
  process.env.KP_EVENT_SHADOW_COMPARE === '1' ||
  process.env.KP_EVENT_SHADOW_COMPARE?.toLowerCase() === 'true';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

/** 消息角色 */
export type MessageRole = 'player' | 'kp' | 'dice' | 'system';

/** 会话可见性 */
export type SessionVisibility = 'public' | 'kp_only' | `private:${string}`;

/** 事件类型 */
export type SessionEventType =
  | 'message'
  | 'scene_change'
  | 'check_request'
  | 'check_result'
  | 'clue_discovered'
  | 'time_advance'
  | 'player_joined'
  | 'channel_focus'
  | 'channel_assignment'
  | 'channel_merge'
  | 'channel_interrupt'
  | 'register_entity'
  | 'register_item'
  | 'item_change'
  | 'opening_plan'
  | 'director_marker'
  | 'director_seed_resolved'
  | 'director_cue';

/** 查看上下文的视角 */
export interface ViewerScope {
  userId?: number;
  includeKpOnly?: boolean;
}

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
  /** 场景频道 ID */
  channelId: string;
  /** 该消息的可见性 */
  visibility: SessionVisibility;
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
  /** 所属场景频道，默认 main */
  channelId?: string;
  /** 是否为紧急状态（非焦点频道下可能形成时间屏障） */
  interruptNeeded?: boolean;
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

/** 模组内嵌图片（加载到 session 后的运行时表示） */
export interface ScenarioImage {
  /** 图片 ID，如 "img-001"（manifest 中定义） */
  id: string;
  /** 本机绝对路径 */
  absPath: string;
  /** 说明文字（KP 设置，供 AI KP 参考及展示给玩家） */
  caption: string;
  /** KP 是否允许 AI KP 自动展示给玩家 */
  playerVisible: boolean;
}

/** 时间轴事件 */
export interface TimelineEvent {
  id: string;
  sessionId: string;
  /** 此事件后的游戏内时间，如 "1925-03-14T15:00" */
  ingameTime: string;
  /** 推进的分钟数（SET_TIME 时为 null） */
  deltaMinutes: number | null;
  description: string;
  trigger: 'ai' | 'system' | 'admin';
  messageId?: string;
  createdAt: Date;
}

/** 场景频道状态 */
export interface SceneChannelState {
  id: string;
  currentScene: SceneInfo | null;
  playerIds: number[];
  pendingRolls: PendingRoll[];
  recentMessages: SessionMessage[];
  interruptPending: boolean;
}

/** 会话事件 */
export interface SessionEvent<TPayload = Record<string, unknown>> {
  seq: number;
  id: string;
  sessionId: string;
  type: SessionEventType;
  channelId: string;
  actorId?: number;
  visibility: SessionVisibility;
  payload: TPayload;
  ingameTime: string | null;
  createdAt: Date;
}

/** 会话状态快照（供 ContextBuilder 读取） */
export interface SessionSnapshot {
  sessionId: string;
  campaignId: string;
  groupId: number;
  moduleId: string | null;
  currentScene: SceneInfo | null;
  discoveredClues: Clue[];
  pendingRolls: PendingRoll[];
  /** 未被摘要压缩的近期消息（原文） */
  recentMessages: SessionMessage[];
  /** 已压缩的摘要文本列表（从旧到新） */
  summaries: string[];
  /** 当前游戏内时间 */
  ingameTime: string | null;
  /** 当前焦点频道 */
  focusChannelId: string;
  /** 当前快照所属频道 */
  channelId: string;
  /** 活跃频道 */
  activeChannels: string[];
  /** 存在未处理紧急事件的频道 */
  interruptChannels: string[];
  /** 当前频道可见的场景实体摘要 */
  activeEntities: ScenarioEntity[];
  /** 当前频道需要重点注入的关键实体详情 */
  entityDetails: ScenarioEntity[];
  /** 当前频道可互动的关键物品 */
  sceneItems: ScenarioItem[];
  /** 当前模组规则包（仅 approved） */
  moduleRulePack: ModuleRulePack | null;
  /** 尚未完成的导演 seeds */
  unresolvedDirectorSeeds: DirectorSeed[];
  /** 最近的导演 cues */
  recentDirectorCues: DirectorCue[];
  /** 开场阶段为玩家分配的频道 */
  openingAssignments: OpeningAssignment[];
  /** 当前开场的汇合目标 */
  openingMergeGoal: string | null;
}

// ─── 事件 payload ─────────────────────────────────────────────────────────────

interface MessageEventPayload {
  id: string;
  role: MessageRole;
  userId?: number;
  displayName?: string;
  content: string;
  timestamp: string;
  isSummarized?: boolean;
}

interface SceneChangeEventPayload {
  scene: SceneInfo | null;
}

interface CheckRequestEventPayload {
  roll: SerializedPendingRoll;
}

interface CheckResultEventPayload {
  playerId?: number;
  clearAll?: boolean;
  resultText?: string;
}

interface ClueDiscoveredEventPayload {
  clue: SerializedClue;
  byUserId?: number;
}

interface TimeAdvanceEventPayload {
  mode: 'set' | 'advance';
  description: string;
  trigger: 'ai' | 'system' | 'admin';
  messageId?: string;
  deltaMinutes: number | null;
  ingameTime: string;
}

interface PlayerJoinedEventPayload {
  userId: number;
}

interface ChannelFocusEventPayload {
  channelId: string;
}

interface ChannelAssignmentEventPayload {
  userId: number;
  channelId: string;
}

interface ChannelMergeEventPayload {
  fromChannel: string;
  toChannel: string;
  playerIds: number[];
}

interface ChannelInterruptEventPayload {
  channelId: string;
  reason: string;
  active: boolean;
}

interface RegisterEntityEventPayload {
  entity: SessionEntityOverlay;
}

interface RegisterItemEventPayload {
  item: SessionItemOverlay;
}

interface ItemChangeEventPayload {
  itemName: string;
  owner?: string;
  location?: string;
  stateNotes?: string;
  usage?: string;
}

interface OpeningPlanEventPayload {
  plan: OpeningDirectorPlanSkeleton;
}

interface DirectorMarkerEventPayload {
  label: string;
  beatId?: string;
  participants?: string[];
}

interface DirectorSeedResolvedEventPayload {
  seedIds: string[];
  reason: string;
}

interface DirectorCueEventPayload {
  cue: DirectorCue;
}

type KnownEventPayload =
  | MessageEventPayload
  | SceneChangeEventPayload
  | CheckRequestEventPayload
  | CheckResultEventPayload
  | ClueDiscoveredEventPayload
  | TimeAdvanceEventPayload
  | PlayerJoinedEventPayload
  | ChannelFocusEventPayload
  | ChannelAssignmentEventPayload
  | ChannelMergeEventPayload
  | ChannelInterruptEventPayload
  | RegisterEntityEventPayload
  | RegisterItemEventPayload
  | ItemChangeEventPayload
  | OpeningPlanEventPayload
  | DirectorMarkerEventPayload
  | DirectorSeedResolvedEventPayload
  | DirectorCueEventPayload;

interface AppendEventOptions {
  channelId?: string;
  actorId?: number;
  visibility?: SessionVisibility;
  ingameTime?: string | null;
  createdAt?: Date;
}

interface LegacySnapshot {
  currentScene: SceneInfo | null;
  discoveredClues: Clue[];
  pendingRolls: PendingRoll[];
  playerIds: number[];
  recentMessages: SessionMessage[];
  ingameTime: string | null;
}

interface ReplayedState {
  focusChannelId: string;
  channelScenes: Map<string, SceneInfo | null>;
  playerChannels: Map<number, string>;
  playerIds: number[];
  discoveredClues: Clue[];
  pendingRolls: PendingRoll[];
  recentMessages: SessionMessage[];
  ingameTime: string | null;
  activeChannels: Set<string>;
  interruptChannels: Set<string>;
  openingPlan: OpeningDirectorPlanSkeleton | null;
  directorSeeds: DirectorSeed[];
  directorCues: DirectorCue[];
  openingAssignments: OpeningAssignment[];
  openingMergeGoal: string | null;
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

export class SessionState {
  private readonly db: Database;
  readonly sessionId: string;
  readonly campaignId: string;
  readonly groupId: number;

  private readonly enableLegacyWrites = true;
  private readonly readFromEvents = true;
  private readonly enableShadowCompare = KP_EVENT_SHADOW_COMPARE;

  // 内存缓存
  private _currentScene: SceneInfo | null = null;
  private _pendingRolls: PendingRoll[] = [];
  private _playerIds: number[] = [];
  private _events: SessionEvent<KnownEventPayload>[] = [];
  private _focusChannelId = DEFAULT_CHANNEL_ID;
  private _channelScenes = new Map<string, SceneInfo | null>([[DEFAULT_CHANNEL_ID, null]]);
  private _playerChannels = new Map<number, string>();
  private _activeChannels = new Set<string>([DEFAULT_CHANNEL_ID]);
  private _interruptChannels = new Set<string>();
  private _derivedSummaryCache = new Map<string, { maxSeq: number; summaries: string[] }>();
  private _recentMessagesCache: SessionMessage[] = [];
  private _discoveredCluesCache: Clue[] = [];
  private _openingPlanCache: OpeningDirectorPlanSkeleton | null = null;
  private _directorSeedsCache: DirectorSeed[] = [];
  private _directorCuesCache: DirectorCue[] = [];
  private _openingAssignmentsCache: OpeningAssignment[] = [];
  private _openingMergeGoal: string | null = null;
  /** 已加载的模组全文（来自 data/knowledge/raw/）*/
  private _scenarioText: string | null = null;
  /** 当前游戏内时间 */
  private _ingameTime: string | null = null;
  /** 当前会话加载的模组图片（内存，从 manifest 读取后注入） */
  private _scenarioImages: ScenarioImage[] = [];

  constructor(db: Database, sessionId: string, campaignId: string, groupId: number) {
    this.db = db;
    this.sessionId = sessionId;
    this.campaignId = campaignId;
    this.groupId = groupId;
    this._loadScenarioText();
    this._loadState();
  }

  // ─── 场景管理 ───────────────────────────────────────────────────────────────

  get currentScene(): SceneInfo | null {
    return this._channelScenes.get(this._focusChannelId) ?? this._currentScene;
  }

  setScene(scene: SceneInfo, options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {}): void {
    const channelId = options.channelId ?? this._focusChannelId;
    const now = new Date();
    let event: SessionEvent<SceneChangeEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'scene_change',
        { scene },
        {
          channelId,
          actorId: options.actorId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
          createdAt: now,
        },
      );

      if (this.enableLegacyWrites) {
        this.db.run(
          `INSERT OR REPLACE INTO kp_scenes
             (session_id, name, description, active_npcs_json, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            this.sessionId,
            scene.name,
            scene.description,
            JSON.stringify(scene.activeNpcs),
            now.toISOString(),
          ],
        );
      }
    })();
    if (event) this.commitEventRecord(event);

    this._shadowCompare('setScene');
  }

  getFocusChannel(): string {
    return this._focusChannelId;
  }

  setFocusChannel(channelId: string, actorId?: number): void {
    const normalized = normalizeChannelId(channelId);
    if (normalized === this._focusChannelId) return;
    this.appendEvent(
      'channel_focus',
      { channelId: normalized },
      { channelId: normalized, actorId, visibility: DEFAULT_VISIBILITY },
    );
  }

  getPlayerChannel(userId: number): string {
    return this._playerChannels.get(userId) ?? DEFAULT_CHANNEL_ID;
  }

  assignPlayerToChannel(userId: number, channelId: string, actorId?: number): void {
    const normalized = normalizeChannelId(channelId);
    if (this.getPlayerChannel(userId) === normalized) return;
    this.appendEvent(
      'channel_assignment',
      { userId, channelId: normalized },
      { channelId: normalized, actorId, visibility: DEFAULT_VISIBILITY },
    );
  }

  getActiveChannels(): string[] {
    return Array.from(this._activeChannels).sort((a, b) => {
      if (a === DEFAULT_CHANNEL_ID) return -1;
      if (b === DEFAULT_CHANNEL_ID) return 1;
      return a.localeCompare(b);
    });
  }

  getChannelState(channelId: string, viewerScope: ViewerScope = {}): SceneChannelState {
    const normalized = normalizeChannelId(channelId);
    const playerIds = this._playerIds.filter((userId) => this.getPlayerChannel(userId) === normalized);
    return {
      id: normalized,
      currentScene: this._channelScenes.get(normalized) ?? null,
      playerIds,
      pendingRolls: this.getPendingRollsForChannel(normalized),
      recentMessages: this.getRecentMessages(40, { channelId: normalized, viewerScope }),
      interruptPending: this._interruptChannels.has(normalized),
    };
  }

  markChannelInterrupt(channelId: string, reason: string, actorId?: number): void {
    const normalized = normalizeChannelId(channelId);
    if (this._interruptChannels.has(normalized)) return;
    this.appendEvent(
      'channel_interrupt',
      { channelId: normalized, reason, active: true },
      { channelId: normalized, actorId, visibility: DEFAULT_VISIBILITY },
    );
  }

  clearChannelInterrupt(channelId: string, actorId?: number): void {
    const normalized = normalizeChannelId(channelId);
    if (!this._interruptChannels.has(normalized)) return;
    this.appendEvent(
      'channel_interrupt',
      { channelId: normalized, reason: 'clear', active: false },
      { channelId: normalized, actorId, visibility: DEFAULT_VISIBILITY },
    );
  }

  registerEntity(
    entity: SessionEntityOverlay,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    this.appendEvent(
      'register_entity',
      { entity: normalizeSessionEntityOverlay(entity, options.channelId) },
      {
        channelId: options.channelId ?? entity.channelId ?? this._focusChannelId,
        actorId: options.actorId,
        visibility: options.visibility ?? normalizeVisibility(entity.visibility),
      },
    );
  }

  registerItem(
    item: SessionItemOverlay,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    this.appendEvent(
      'register_item',
      { item: normalizeSessionItemOverlay(item, options.channelId) },
      {
        channelId: options.channelId ?? item.channelId ?? this._focusChannelId,
        actorId: options.actorId,
        visibility: options.visibility ?? normalizeVisibility(item.visibility),
      },
    );
  }

  applyItemChange(
    change: ItemChangeEventPayload,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    if (!change.itemName.trim()) return;
    this.appendEvent(
      'item_change',
      {
        itemName: change.itemName.trim(),
        owner: change.owner?.trim(),
        location: change.location?.trim(),
        stateNotes: change.stateNotes?.trim(),
        usage: change.usage?.trim(),
      },
      {
        channelId: options.channelId ?? this._focusChannelId,
        actorId: options.actorId,
        visibility: options.visibility ?? DEFAULT_VISIBILITY,
      },
    );
  }

  recordChannelMerge(
    fromChannel: string,
    toChannel: string,
    playerIds: number[],
    actorId?: number,
  ): void {
    const normalizedFrom = normalizeChannelId(fromChannel);
    const normalizedTo = normalizeChannelId(toChannel);
    this.appendEvent(
      'channel_merge',
      {
        fromChannel: normalizedFrom,
        toChannel: normalizedTo,
        playerIds: Array.from(new Set(playerIds)),
      },
      {
        channelId: normalizedTo,
        actorId,
        visibility: DEFAULT_VISIBILITY,
      },
    );
  }

  recordOpeningPlan(
    plan: OpeningDirectorPlanSkeleton,
    options: { channelId?: string; actorId?: number } = {},
  ): void {
    this.appendEvent(
      'opening_plan',
      { plan },
        {
          channelId: options.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: 'kp_only',
          ingameTime: plan.startTime,
        },
      );
  }

  addDirectorMarker(
    label: string,
    options: { channelId?: string; actorId?: number; beatId?: string; participants?: string[] } = {},
  ): void {
    if (!label.trim()) return;
    this.appendEvent(
      'director_marker',
      {
        label: label.trim(),
        beatId: options.beatId?.trim(),
        participants: options.participants?.map((item) => item.trim()).filter(Boolean),
      },
        {
          channelId: options.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: 'kp_only',
        },
      );
  }

  resolveDirectorSeeds(
    seedIds: string[],
    reason: string,
    options: { channelId?: string; actorId?: number } = {},
  ): void {
    const normalizedSeedIds = Array.from(new Set(seedIds.map((id) => id.trim()).filter(Boolean)));
    if (normalizedSeedIds.length === 0) return;
    this.appendEvent(
      'director_seed_resolved',
      { seedIds: normalizedSeedIds, reason: reason.trim() || 'resolved' },
        {
          channelId: options.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: 'kp_only',
        },
      );
  }

  addDirectorCue(
    cue: DirectorCue,
    options: { channelId?: string; actorId?: number } = {},
  ): void {
    this.appendEvent(
      'director_cue',
      { cue },
        {
          channelId: options.channelId ?? cue.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: 'kp_only',
        },
      );
  }

  hasBlockingInterrupt(exceptChannelId?: string): boolean {
    const except = exceptChannelId ? normalizeChannelId(exceptChannelId) : null;
    for (const channelId of this._interruptChannels) {
      if (!except || channelId !== except) return true;
    }
    return false;
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

  discoverClue(clueId: string, byUserId: number, options: { channelId?: string; visibility?: SessionVisibility } = {}): boolean {
    const now = new Date();
    let discovered = false;
    let event: SessionEvent<ClueDiscoveredEventPayload> | undefined;

    this.db.transaction(() => {
      const result = this.db.run(
        `UPDATE kp_clues
            SET is_discovered = 1, discovered_at = ?, discovered_by = ?
          WHERE id = ? AND session_id = ? AND is_discovered = 0`,
        [now.toISOString(), byUserId, clueId, this.sessionId],
      );
      if (result.changes <= 0) return;

      const clueRow = this.db
        .query<DbClueRow, [string, string]>(
          `SELECT * FROM kp_clues WHERE session_id = ? AND id = ? LIMIT 1`,
        )
        .get(this.sessionId, clueId);
      if (!clueRow) return;

      event = this.writeEventRecord(
        'clue_discovered',
        {
          clue: clueToSerialized(rowToClue(clueRow)),
          byUserId,
        },
        {
          channelId: options.channelId ?? this.getPlayerChannel(byUserId),
          actorId: byUserId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
          createdAt: now,
        },
      );
      discovered = true;
    })();

    if (event) this.commitEventRecord(event);
    if (discovered) {
      this._shadowCompare('discoverClue');
      return true;
    }
    return false;
  }

  getDiscoveredClues(): Clue[] {
    if (this.readFromEvents && this._events.length > 0) {
      return [...this._discoveredCluesCache];
    }
    return this._readLegacyDiscoveredClues();
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

  addPendingRoll(
    roll: PendingRoll,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    const normalized: PendingRoll = {
      ...roll,
      channelId: normalizeChannelId(options.channelId ?? roll.channelId ?? this.getPlayerChannel(roll.playerId)),
    };
    const nextPendingRolls = [
      ...this._pendingRolls.filter((r) => r.playerId !== normalized.playerId),
      normalized,
    ];
    let event: SessionEvent<CheckRequestEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'check_request',
        { roll: pendingRollToSerialized(normalized) },
        {
          channelId: normalized.channelId,
          actorId: options.actorId ?? roll.playerId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
          createdAt: normalized.requestedAt,
        },
      );
      this._savePendingRollsValue(nextPendingRolls);
    })();
    if (event) this.commitEventRecord(event);
    this._pendingRolls = nextPendingRolls;
    this._shadowCompare('addPendingRoll');
  }

  clearPendingRoll(
    playerId: number,
    options: { channelId?: string; actorId?: number; resultText?: string; visibility?: SessionVisibility } = {},
  ): void {
    const channelId = normalizeChannelId(options.channelId ?? this.getPlayerChannel(playerId));
    const nextPendingRolls = this._pendingRolls.filter((r) => r.playerId !== playerId);
    let event: SessionEvent<CheckResultEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'check_result',
        { playerId, resultText: options.resultText },
        {
          channelId,
          actorId: options.actorId ?? playerId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
        },
      );
      this._savePendingRollsValue(nextPendingRolls);
    })();
    if (event) this.commitEventRecord(event);
    this._pendingRolls = nextPendingRolls;
    this._shadowCompare('clearPendingRoll');
  }

  clearAllPendingRolls(
    options: { actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    const nextPendingRolls: PendingRoll[] = [];
    let event: SessionEvent<CheckResultEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'check_result',
        { clearAll: true },
        {
          channelId: this._focusChannelId,
          actorId: options.actorId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
        },
      );
      this._savePendingRollsValue(nextPendingRolls);
    })();
    if (event) this.commitEventRecord(event);
    this._pendingRolls = nextPendingRolls;
    this._shadowCompare('clearAllPendingRolls');
  }

  getPendingRollsForChannel(channelId: string): PendingRoll[] {
    const normalized = normalizeChannelId(channelId);
    return this._pendingRolls.filter((roll) => normalizeChannelId(roll.channelId) === normalized);
  }

  // ─── 消息历史 ───────────────────────────────────────────────────────────────

  addMessage(
    msg: Omit<SessionMessage, 'sessionId' | 'isSummarized' | 'channelId' | 'visibility'> & {
      channelId?: string;
      visibility?: SessionVisibility;
    },
  ): SessionMessage {
    const channelId = normalizeChannelId(msg.channelId ?? this.getPlayerChannel(msg.userId ?? 0) ?? this._focusChannelId);
    const visibility = msg.visibility ?? DEFAULT_VISIBILITY;
    const full: SessionMessage = {
      ...msg,
      sessionId: this.sessionId,
      isSummarized: false,
      channelId,
      visibility,
    };
    let event: SessionEvent<MessageEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'message',
        {
          id: full.id,
          role: full.role,
          userId: full.userId,
          displayName: full.displayName,
          content: full.content,
          timestamp: full.timestamp.toISOString(),
          isSummarized: false,
        },
        {
          channelId,
          actorId: full.userId,
          visibility,
          ingameTime: this._ingameTime,
          createdAt: full.timestamp,
        },
      );

      if (this.enableLegacyWrites) {
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
      }
    })();
    if (event) this.commitEventRecord(event);

    this._shadowCompare('addMessage');
    return full;
  }

  /**
   * 返回未被摘要压缩的消息，按时间正序。
   * limit 默认 40 条，防止单次拉取过多。
   */
  getRecentMessages(
    limit = 40,
    options: { channelId?: string; viewerScope?: ViewerScope } = {},
  ): SessionMessage[] {
    if (!this.readFromEvents || this._events.length === 0) {
      return this.db
        .query<DbMessageRow, [string, number]>(
          `SELECT * FROM kp_messages
            WHERE session_id = ? AND is_summarized = 0
            ORDER BY timestamp ASC
            LIMIT ?`,
        )
        .all(this.sessionId, limit)
        .map(rowToMessage)
        .map((msg) => ({ ...msg, channelId: DEFAULT_CHANNEL_ID, visibility: DEFAULT_VISIBILITY }));
    }

    const channelId = normalizeChannelId(options.channelId ?? this._focusChannelId);
    const visible = this._recentMessagesCache
      .filter((msg) => msg.channelId === channelId)
      .filter((msg) => isVisibleToViewer(msg.visibility, options.viewerScope ?? {}));
    return visible.slice(-Math.max(0, limit));
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

  getVisibleEvents(
    viewerScope: ViewerScope = {},
    channelId = this._focusChannelId,
    limit = 50,
  ): Array<SessionEvent<KnownEventPayload>> {
    const normalized = normalizeChannelId(channelId);
    const visible = this._events.filter((evt) => evt.channelId === normalized)
      .filter((evt) => isVisibleToViewer(evt.visibility, viewerScope));
    return visible.slice(-Math.max(0, limit));
  }

  getDerivedSummaries(
    channelId = this._focusChannelId,
    viewerScope: ViewerScope = {},
    maxRecentRaw = 24,
  ): string[] {
    if (!this.readFromEvents || this._events.length === 0) {
      return this.getSummaries();
    }

    const normalized = normalizeChannelId(channelId);
    const visible = this.getVisibleEvents(viewerScope, normalized, Number.MAX_SAFE_INTEGER);
    if (visible.length <= maxRecentRaw) {
      return [];
    }

    const maxSeq = visible[visible.length - 1]?.seq ?? 0;
    const cacheKey = buildSummaryCacheKey(normalized, viewerScope);
    const cached = this._derivedSummaryCache.get(cacheKey);
    if (cached && cached.maxSeq === maxSeq) {
      return [...cached.summaries];
    }

    const olderEvents = visible.slice(0, Math.max(0, visible.length - maxRecentRaw));
    const blockSize = 12;
    const summaries: string[] = [];
    for (let start = 0; start < olderEvents.length; start += blockSize) {
      const block = olderEvents.slice(start, start + blockSize);
      const lines = block
        .map((event) => summarizeEventForContext(event))
        .filter((line): line is string => Boolean(line));
      if (lines.length === 0) continue;

      const span = formatEventSpan(block[0], block[block.length - 1]);
      const body = compact(lines.join('；'), 260);
      summaries.push(span ? `${span}：${body}` : body);
    }

    this._derivedSummaryCache.set(cacheKey, { maxSeq, summaries });
    return [...summaries];
  }

  // ─── 玩家跟踪 ───────────────────────────────────────────────────────────────

  /** 记录参与本 session 的玩家 userId（首次发言时自动注册） */
  trackPlayer(
    userId: number,
    options: { channelId?: string; actorId?: number } = {},
  ): void {
    const channelId = normalizeChannelId(options.channelId ?? this.getPlayerChannel(userId));
    const exists = this._playerIds.includes(userId);
    const shouldAssignChannel = !exists || this.getPlayerChannel(userId) !== channelId;
    let joinedEvent: SessionEvent<PlayerJoinedEventPayload> | undefined;
    let assignmentEvent: SessionEvent<ChannelAssignmentEventPayload> | undefined;
    this.db.transaction(() => {
      if (!exists) {
        joinedEvent = this.writeEventRecord(
          'player_joined',
          { userId },
          { channelId, actorId: options.actorId ?? userId, visibility: DEFAULT_VISIBILITY },
        );
      }

      if (shouldAssignChannel) {
        assignmentEvent = this.writeEventRecord(
          'channel_assignment',
          { userId, channelId },
          { channelId, actorId: options.actorId ?? userId, visibility: DEFAULT_VISIBILITY },
        );
      }

      if (this.enableLegacyWrites) {
        this.db.run(
          'INSERT OR IGNORE INTO kp_session_players (session_id, user_id, joined_at) VALUES (?, ?, ?)',
          [this.sessionId, userId, new Date().toISOString()],
        );
      }
    })();
    if (joinedEvent) this.commitEventRecord(joinedEvent);
    if (assignmentEvent) this.commitEventRecord(assignmentEvent);

    this._shadowCompare('trackPlayer');
  }

  getPlayerIds(): number[] {
    if (this.readFromEvents && this._events.length > 0) {
      return [...this._playerIds];
    }
    return this.db
      .query<{ user_id: number }, [string]>(
        'SELECT user_id FROM kp_session_players WHERE session_id = ? ORDER BY joined_at ASC',
      )
      .all(this.sessionId)
      .map((r) => r.user_id);
  }

  getLatestEventSeq(): number {
    return this._events[this._events.length - 1]?.seq ?? 0;
  }

  getEventsSince(seqExclusive: number): Array<SessionEvent<KnownEventPayload>> {
    return this._events.filter((event) => event.seq > seqExclusive);
  }

  getOpeningPlan(): OpeningDirectorPlanSkeleton | null {
    return this._openingPlanCache ? cloneOpeningPlanSkeleton(this._openingPlanCache) : null;
  }

  getUnresolvedDirectorSeeds(): DirectorSeed[] {
    return this._directorSeedsCache
      .filter((seed) => !seed.resolved)
      .map((seed) => ({ ...seed, targets: [...seed.targets] }));
  }

  getRecentDirectorCues(limit = 6): DirectorCue[] {
    return this._directorCuesCache
      .slice(-Math.max(0, limit))
      .map((cue) => ({
        ...cue,
        relatedSeedIds: [...cue.relatedSeedIds],
      }));
  }

  getOpeningAssignments(): OpeningAssignment[] {
    return this._openingAssignmentsCache.map((assignment) => ({ ...assignment }));
  }

  getOpeningMergeGoal(): string | null {
    return this._openingMergeGoal;
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

  // ─── 游戏内时间 ───────────────────────────────────────────────────────────

  get ingameTime(): string | null {
    return this._ingameTime;
  }

  /** 设置绝对游戏时间（开场 / SET_TIME 标记 / 管理员手动） */
  setIngameTime(
    time: string,
    description: string,
    trigger: 'ai' | 'system' | 'admin',
    messageId?: string,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    let targetTime = time;
    const baseTime = this._ingameTime;
    if (baseTime && this._interruptChannels.size > 0) {
      const deltaMinutes = diffMinutesBetweenTimes(baseTime, targetTime);
      if (deltaMinutes !== null && Math.abs(deltaMinutes) > 30) {
        console.warn(`[TimeBarrier] 存在未处理的频道中断 ${[...this._interruptChannels].join(',')}, 大幅时间推进被限制`);
        targetTime = addMinutesToTime(baseTime, Math.sign(deltaMinutes) * 30);
      }
    }

    const now = new Date();
    let event: SessionEvent<TimeAdvanceEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'time_advance',
        {
          mode: 'set',
          description,
          trigger,
          messageId,
          deltaMinutes: null,
          ingameTime: targetTime,
        },
        {
          channelId: options.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
          ingameTime: targetTime,
          createdAt: now,
        },
      );

      if (this.enableLegacyWrites) {
        this.db.run('UPDATE kp_sessions SET ingame_time = ?, updated_at = ? WHERE id = ?',
          [targetTime, now.toISOString(), this.sessionId]);
        this._insertTimelineEvent(targetTime, null, description, trigger, messageId, now);
      }
    })();

    if (event) this.commitEventRecord(event);
    this._ingameTime = targetTime;

    this._shadowCompare('setIngameTime');
  }

  /** 按分钟数推进游戏时间（TIME_ADVANCE 标记 / 管理员手动） */
  advanceIngameTime(
    deltaMinutes: number,
    description: string,
    trigger: 'ai' | 'system' | 'admin',
    messageId?: string,
    options: { channelId?: string; actorId?: number; visibility?: SessionVisibility } = {},
  ): void {
    const baseTime = this._ingameTime;
    if (!baseTime) return;
    let limitedDeltaMinutes = deltaMinutes;
    if (this._interruptChannels.size > 0 && Math.abs(limitedDeltaMinutes) > 30) {
      console.warn(`[TimeBarrier] 存在未处理的频道中断 ${[...this._interruptChannels].join(',')}, 大幅时间推进被限制`);
      limitedDeltaMinutes = Math.sign(limitedDeltaMinutes) * 30;
    }
    const newTime = addMinutesToTime(baseTime, limitedDeltaMinutes);
    const now = new Date();
    let event: SessionEvent<TimeAdvanceEventPayload> | undefined;
    this.db.transaction(() => {
      event = this.writeEventRecord(
        'time_advance',
        {
          mode: 'advance',
          description,
          trigger,
          messageId,
          deltaMinutes: limitedDeltaMinutes,
          ingameTime: newTime,
        },
        {
          channelId: options.channelId ?? this._focusChannelId,
          actorId: options.actorId,
          visibility: options.visibility ?? DEFAULT_VISIBILITY,
          ingameTime: newTime,
          createdAt: now,
        },
      );

      if (this.enableLegacyWrites) {
        this.db.run('UPDATE kp_sessions SET ingame_time = ?, updated_at = ? WHERE id = ?',
          [newTime, now.toISOString(), this.sessionId]);
        this._insertTimelineEvent(newTime, limitedDeltaMinutes, description, trigger, messageId, now);
      }
    })();

    if (event) this.commitEventRecord(event);
    this._ingameTime = newTime;

    this._shadowCompare('advanceIngameTime');
  }

  /** 查询时间轴事件 */
  getTimelineEvents(limit = 50): TimelineEvent[] {
    return this.db
      .query<DbTimelineRow, [string, number]>(
        `SELECT * FROM kp_timeline_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(this.sessionId, limit)
      .map(rowToTimelineEvent);
  }

  // ─── 快照 ─────────────────────────────────────────────────────────────────

  snapshot(channelId = this._focusChannelId, viewerScope: ViewerScope = {}): SessionSnapshot {
    if (this.readFromEvents && this._events.length > 0) {
      return this.snapshotFromEvents(channelId, viewerScope);
    }
    return this.snapshotFromLegacy(channelId);
  }

  snapshotFromEvents(channelId = this._focusChannelId, viewerScope: ViewerScope = {}): SessionSnapshot {
    const normalized = normalizeChannelId(channelId);
    const assetContext = this.buildModuleAssetContext(normalized, viewerScope);
    return {
      sessionId: this.sessionId,
      campaignId: this.campaignId,
      groupId: this.groupId,
      moduleId: assetContext.moduleId,
      currentScene: this._channelScenes.get(normalized) ?? null,
      discoveredClues: [...this._discoveredCluesCache],
      pendingRolls: this.getPendingRollsForChannel(normalized),
      recentMessages: this.getRecentMessages(40, { channelId: normalized, viewerScope }),
      summaries: this.getDerivedSummaries(normalized, viewerScope),
      ingameTime: this._ingameTime,
      focusChannelId: this._focusChannelId,
      channelId: normalized,
      activeChannels: this.getActiveChannels(),
      interruptChannels: Array.from(this._interruptChannels),
      activeEntities: assetContext.activeEntities,
      entityDetails: assetContext.entityDetails,
      sceneItems: assetContext.sceneItems,
      moduleRulePack: assetContext.moduleRulePack,
      unresolvedDirectorSeeds: this.getUnresolvedDirectorSeeds(),
      recentDirectorCues: this.getRecentDirectorCues(),
      openingAssignments: this.getOpeningAssignments(),
      openingMergeGoal: this._openingMergeGoal,
    };
  }

  // ─── 模组图片 / 模组全文 ────────────────────────────────────────────────────

  setScenarioImages(images: ScenarioImage[]): void {
    this._scenarioImages = images;
  }

  getScenarioImages(): ScenarioImage[] {
    return this._scenarioImages;
  }

  /** 按 ID 解析图片（供 KPPipeline 使用） */
  resolveImage(imgId: string): ScenarioImage | undefined {
    return this._scenarioImages.find((img) => img.id === imgId);
  }

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

  getModuleId(): string | null {
    const row = this.db
      .query<{ module_id: string | null }, [string]>(
        'SELECT module_id FROM campaign_rooms WHERE kp_session_id = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(this.sessionId);
    return row?.module_id ?? null;
  }

  private buildModuleAssetContext(channelId: string, viewerScope: ViewerScope): {
    moduleId: string | null;
    activeEntities: ScenarioEntity[];
    entityDetails: ScenarioEntity[];
    sceneItems: ScenarioItem[];
    moduleRulePack: ModuleRulePack | null;
  } {
    const moduleId = this.getModuleId();
    const scene = this._channelScenes.get(normalizeChannelId(channelId)) ?? this._currentScene;
    const approvedEntities = moduleId ? listModuleEntities(this.db, moduleId, ['approved']) : [];
    const approvedItems = moduleId ? listModuleItems(this.db, moduleId, ['approved']) : [];
    const moduleRulePack = moduleId ? getModuleRulePack(this.db, moduleId, ['approved']) : null;
    const visibleEvents = this._events.filter((event) => isVisibleToViewer(event.visibility, viewerScope));
    const overlayEntities = new Map<string, SessionEntityOverlay>();
    const overlayItems = new Map<string, SessionItemOverlay>();
    const itemChanges = new Map<string, ItemChangeEventPayload>();

    for (const event of visibleEvents) {
      switch (event.type) {
        case 'register_entity': {
          const payload = event.payload as RegisterEntityEventPayload;
          const entity = normalizeSessionEntityOverlay(payload.entity, event.channelId, event.visibility);
          overlayEntities.set(normalizeAssetKey(entity.id || entity.name), entity);
          break;
        }
        case 'register_item': {
          const payload = event.payload as RegisterItemEventPayload;
          const item = normalizeSessionItemOverlay(payload.item, event.channelId, event.visibility);
          overlayItems.set(normalizeAssetKey(item.id || item.name), item);
          break;
        }
        case 'item_change': {
          const payload = event.payload as ItemChangeEventPayload;
          itemChanges.set(normalizeAssetKey(payload.itemName), payload);
          break;
        }
        default:
          break;
      }
    }

    const entitiesByKey = new Map<string, ScenarioEntity>();
    for (const entity of approvedEntities) {
      entitiesByKey.set(normalizeAssetKey(entity.id || entity.name), entity);
      entitiesByKey.set(normalizeAssetKey(entity.name), entity);
    }
    for (const entity of overlayEntities.values()) {
      entitiesByKey.set(normalizeAssetKey(entity.id || entity.name), entity);
      entitiesByKey.set(normalizeAssetKey(entity.name), entity);
    }

    const itemsByKey = new Map<string, ScenarioItem>();
    for (const item of approvedItems) {
      const currentState = itemChanges.get(normalizeAssetKey(item.name));
      itemsByKey.set(normalizeAssetKey(item.id || item.name), applyItemChangeToItem(item, currentState));
      itemsByKey.set(normalizeAssetKey(item.name), applyItemChangeToItem(item, currentState));
    }
    for (const item of overlayItems.values()) {
      const currentState = itemChanges.get(normalizeAssetKey(item.name));
      const nextItem = applyItemChangeToItem(item, currentState);
      itemsByKey.set(normalizeAssetKey(item.id || item.name), nextItem);
      itemsByKey.set(normalizeAssetKey(item.name), nextItem);
    }

    const activeNpcNames = new Set((scene?.activeNpcs ?? []).map(normalizeAssetKey));
    const sceneName = scene?.name ? normalizeAssetKey(scene.name) : '';
    const allEntities = Array.from(new Map(Array.from(entitiesByKey.values()).map((entity) => [entity.id, entity])).values());
    const activeEntities = scene
      ? allEntities.filter((entity) =>
          activeNpcNames.has(normalizeAssetKey(entity.name)) ||
          normalizeAssetKey(entity.defaultLocation) === sceneName,
        )
      : [];
    const entityDetails = activeEntities.filter((entity) => entity.isKey);

    const allItems = Array.from(new Map(Array.from(itemsByKey.values()).map((item) => [item.id, item])).values());
    const sceneItems = scene
      ? allItems.filter((item) => {
          if (!item.isKey) return false;
          const ownerKey = normalizeAssetKey(item.currentOwner || item.defaultOwner);
          const locationKey = normalizeAssetKey(item.currentLocation || item.defaultLocation);
          return locationKey === sceneName || activeNpcNames.has(ownerKey);
        })
      : allItems.filter((item) => item.isKey && !item.currentLocation && !item.defaultLocation);

    return {
      moduleId,
      activeEntities,
      entityDetails,
      sceneItems,
      moduleRulePack,
    };
  }

  // ─── 私有 ─────────────────────────────────────────────────────────────────

  private appendEvent<TPayload extends KnownEventPayload>(
    type: SessionEventType,
    payload: TPayload,
    options: AppendEventOptions = {},
  ): SessionEvent<TPayload> {
    const event = this.writeEventRecord(type, payload, options);
    return this.commitEventRecord(event);
  }

  private writeEventRecord<TPayload extends KnownEventPayload>(
    type: SessionEventType,
    payload: TPayload,
    options: AppendEventOptions = {},
  ): SessionEvent<TPayload> {
    const channelId = normalizeChannelId(options.channelId ?? DEFAULT_CHANNEL_ID);
    const createdAt = options.createdAt ?? new Date();
    const visibility = options.visibility ?? DEFAULT_VISIBILITY;
    const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.run(
      `INSERT INTO kp_events
         (id, session_id, type, channel_id, actor_id, visibility, payload_json, ingame_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.sessionId,
        type,
        channelId,
        options.actorId ?? null,
        visibility,
        JSON.stringify(payload),
        options.ingameTime ?? this._ingameTime,
        createdAt.toISOString(),
      ],
    );
    const row = this.db
      .query<DbEventRow, [string]>(
        `SELECT seq, id, session_id, type, channel_id, actor_id, visibility, payload_json, ingame_time, created_at
         FROM kp_events WHERE id = ? LIMIT 1`,
      )
      .get(id);
    if (!row) {
      throw new Error(`Failed to read back kp_events row: ${id}`);
    }
    return rowToEvent(row) as SessionEvent<TPayload>;
  }

  private commitEventRecord<TPayload extends KnownEventPayload>(event: SessionEvent<TPayload>): SessionEvent<TPayload> {
    this._events.push(event as SessionEvent<KnownEventPayload>);
    this._applyEvent(event as SessionEvent<KnownEventPayload>);
    return event;
  }

  private _loadState(): void {
    this._events = this._readEvents();
    if (this.readFromEvents && this._events.length > 0) {
      this._rebuildFromEvents();
      return;
    }

    // 兼容旧数据：无事件时回退 legacy 散表
    const legacy = this._readLegacySnapshot();
    this._currentScene = legacy.currentScene;
    this._channelScenes.set(DEFAULT_CHANNEL_ID, legacy.currentScene);
    this._pendingRolls = legacy.pendingRolls;
    this._playerIds = legacy.playerIds;
    this._playerChannels = new Map(legacy.playerIds.map((userId) => [userId, DEFAULT_CHANNEL_ID]));
    this._recentMessagesCache = legacy.recentMessages;
    this._discoveredCluesCache = legacy.discoveredClues;
    this._ingameTime = legacy.ingameTime;
  }

  private _readEvents(): Array<SessionEvent<KnownEventPayload>> {
    return this.db
      .query<DbEventRow, [string]>(
        `SELECT seq, id, session_id, type, channel_id, actor_id, visibility, payload_json, ingame_time, created_at
         FROM kp_events
         WHERE session_id = ?
         ORDER BY seq ASC`,
      )
      .all(this.sessionId)
      .map((row) => rowToEvent(row) as SessionEvent<KnownEventPayload>);
  }

  private _rebuildFromEvents(): void {
    const legacyScene = this._readLegacyScene();
    const legacyIngameTime = this._readLegacyIngameTime();
    const legacyPlayerIds = this._readLegacyPlayerIds();
    const state: ReplayedState = {
      focusChannelId: DEFAULT_CHANNEL_ID,
      channelScenes: new Map<string, SceneInfo | null>([[DEFAULT_CHANNEL_ID, legacyScene]]),
      playerChannels: new Map<number, string>(legacyPlayerIds.map((userId) => [userId, DEFAULT_CHANNEL_ID])),
      playerIds: [...legacyPlayerIds],
      discoveredClues: [],
      pendingRolls: [],
      recentMessages: [],
      ingameTime: legacyIngameTime,
      activeChannels: new Set<string>([DEFAULT_CHANNEL_ID]),
      interruptChannels: new Set<string>(),
      openingPlan: null,
      directorSeeds: [],
      directorCues: [],
      openingAssignments: [],
      openingMergeGoal: null,
    };

    const seenPlayers = new Set<number>(legacyPlayerIds);
    const pendingByPlayer = new Map<number, PendingRoll>();
    const discoveredById = new Map<string, Clue>();

    for (const event of this._events) {
      state.activeChannels.add(event.channelId);

      switch (event.type) {
        case 'message': {
          const payload = event.payload as MessageEventPayload;
          state.recentMessages.push({
            id: payload.id,
            sessionId: this.sessionId,
            role: payload.role,
            userId: payload.userId,
            displayName: payload.displayName,
            content: payload.content,
            timestamp: new Date(payload.timestamp),
            isSummarized: payload.isSummarized === true,
            channelId: event.channelId,
            visibility: event.visibility,
          });
          break;
        }
        case 'scene_change': {
          const payload = event.payload as SceneChangeEventPayload;
          state.channelScenes.set(event.channelId, payload.scene ?? null);
          break;
        }
        case 'check_request': {
          const payload = event.payload as CheckRequestEventPayload;
          const roll = serializedToPendingRoll(payload.roll);
          pendingByPlayer.set(roll.playerId, roll);
          state.activeChannels.add(normalizeChannelId(roll.channelId));
          break;
        }
        case 'check_result': {
          const payload = event.payload as CheckResultEventPayload;
          if (payload.clearAll) {
            pendingByPlayer.clear();
          } else if (payload.playerId !== undefined) {
            pendingByPlayer.delete(payload.playerId);
          }
          break;
        }
        case 'clue_discovered': {
          const payload = event.payload as ClueDiscoveredEventPayload;
          discoveredById.set(payload.clue.id, serializedToClue(payload.clue));
          break;
        }
        case 'time_advance': {
          const payload = event.payload as TimeAdvanceEventPayload;
          state.ingameTime = payload.ingameTime;
          break;
        }
        case 'player_joined': {
          const payload = event.payload as PlayerJoinedEventPayload;
          if (!seenPlayers.has(payload.userId)) {
            seenPlayers.add(payload.userId);
            state.playerIds.push(payload.userId);
          }
          if (!state.playerChannels.has(payload.userId)) {
            state.playerChannels.set(payload.userId, event.channelId);
          }
          break;
        }
        case 'channel_focus': {
          const payload = event.payload as ChannelFocusEventPayload;
          state.focusChannelId = normalizeChannelId(payload.channelId);
          state.activeChannels.add(state.focusChannelId);
          break;
        }
        case 'channel_assignment': {
          const payload = event.payload as ChannelAssignmentEventPayload;
          const normalized = normalizeChannelId(payload.channelId);
          state.playerChannels.set(payload.userId, normalized);
          state.activeChannels.add(normalized);
          if (!seenPlayers.has(payload.userId)) {
            seenPlayers.add(payload.userId);
            state.playerIds.push(payload.userId);
          }
          break;
        }
        case 'channel_merge': {
          const payload = event.payload as ChannelMergeEventPayload;
          state.activeChannels.add(normalizeChannelId(payload.fromChannel));
          state.activeChannels.add(normalizeChannelId(payload.toChannel));
          break;
        }
        case 'channel_interrupt': {
          const payload = event.payload as ChannelInterruptEventPayload;
          const normalized = normalizeChannelId(payload.channelId);
          if (payload.active) state.interruptChannels.add(normalized);
          else state.interruptChannels.delete(normalized);
          break;
        }
        case 'opening_plan': {
          const payload = event.payload as OpeningPlanEventPayload;
          state.openingPlan = cloneOpeningPlanSkeleton(payload.plan);
          state.directorSeeds = payload.plan.directorSeeds.map((seed) => ({ ...seed, targets: [...seed.targets] }));
          state.openingAssignments = payload.plan.initialAssignments.map((assignment) => ({ ...assignment }));
          state.openingMergeGoal = payload.plan.mergeGoal;
          for (const assignment of payload.plan.initialAssignments) {
            const normalized = normalizeChannelId(assignment.channelId);
            state.activeChannels.add(normalized);
          }
          break;
        }
        case 'director_seed_resolved': {
          const payload = event.payload as DirectorSeedResolvedEventPayload;
          const resolvedIds = new Set(payload.seedIds);
          state.directorSeeds = state.directorSeeds.map((seed) =>
            resolvedIds.has(seed.id) ? { ...seed, resolved: true } : seed,
          );
          break;
        }
        case 'director_cue': {
          const payload = event.payload as DirectorCueEventPayload;
          state.directorCues.push({
            ...payload.cue,
            relatedSeedIds: [...payload.cue.relatedSeedIds],
          });
          break;
        }
        default:
          break;
      }
    }

    state.pendingRolls = Array.from(pendingByPlayer.values());
    state.discoveredClues = Array.from(discoveredById.values())
      .sort((a, b) => (a.discoveredAt?.getTime() ?? 0) - (b.discoveredAt?.getTime() ?? 0));

    this._focusChannelId = state.focusChannelId;
    this._channelScenes = state.channelScenes;
    this._currentScene = state.channelScenes.get(state.focusChannelId) ?? null;
    this._playerChannels = state.playerChannels;
    this._playerIds = state.playerIds;
    this._pendingRolls = state.pendingRolls;
    this._recentMessagesCache = state.recentMessages;
    this._discoveredCluesCache = state.discoveredClues;
    this._ingameTime = state.ingameTime;
    this._activeChannels = state.activeChannels;
    this._interruptChannels = state.interruptChannels;
    this._openingPlanCache = state.openingPlan;
    this._directorSeedsCache = state.directorSeeds;
    this._directorCuesCache = state.directorCues;
    this._openingAssignmentsCache = state.openingAssignments;
    this._openingMergeGoal = state.openingMergeGoal;
  }

  private _applyEvent(_event: SessionEvent<KnownEventPayload>): void {
    // 简单起见，统一回放保证状态机只有一份逻辑
    this._rebuildFromEvents();
  }

  private _readLegacySnapshot(): LegacySnapshot {
    return {
      currentScene: this._readLegacyScene(),
      discoveredClues: this._readLegacyDiscoveredClues(),
      pendingRolls: this._readLegacyPendingRolls(),
      playerIds: this._readLegacyPlayerIds(),
      recentMessages: this._readLegacyRecentMessages(40),
      ingameTime: this._readLegacyIngameTime(),
    };
  }

  private snapshotFromLegacy(channelId = DEFAULT_CHANNEL_ID): SessionSnapshot {
    const legacy = this._readLegacySnapshot();
    const assetContext = this.buildModuleAssetContext(channelId, {});
    return {
      sessionId: this.sessionId,
      campaignId: this.campaignId,
      groupId: this.groupId,
      moduleId: assetContext.moduleId,
      currentScene: legacy.currentScene,
      discoveredClues: legacy.discoveredClues,
      pendingRolls: legacy.pendingRolls,
      recentMessages: legacy.recentMessages.filter((msg) => msg.channelId === channelId),
      summaries: this.getSummaries(),
      ingameTime: legacy.ingameTime,
      focusChannelId: DEFAULT_CHANNEL_ID,
      channelId,
      activeChannels: [DEFAULT_CHANNEL_ID],
      interruptChannels: [],
      activeEntities: assetContext.activeEntities,
      entityDetails: assetContext.entityDetails,
      sceneItems: assetContext.sceneItems,
      moduleRulePack: assetContext.moduleRulePack,
      unresolvedDirectorSeeds: [],
      recentDirectorCues: [],
      openingAssignments: [],
      openingMergeGoal: null,
    };
  }

  private _readLegacyScene(): SceneInfo | null {
    const row = this.db
      .query<DbSceneRow, [string]>(
        `SELECT * FROM kp_scenes WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.sessionId);

    if (!row) return null;
    return {
      name: row.name,
      description: row.description,
      activeNpcs: JSON.parse(row.active_npcs_json) as string[],
    };
  }

  private _readLegacyDiscoveredClues(): Clue[] {
    return this.db
      .query<DbClueRow, [string]>(
        `SELECT * FROM kp_clues WHERE session_id = ? AND is_discovered = 1
         ORDER BY discovered_at ASC`,
      )
      .all(this.sessionId)
      .map(rowToClue);
  }

  private _readLegacyPendingRolls(): PendingRoll[] {
    const row = this.db
      .query<{ rolls_json: string }, [string]>(
        `SELECT rolls_json FROM kp_pending_rolls WHERE session_id = ? LIMIT 1`,
      )
      .get(this.sessionId);
    if (!row) return [];
    const parsed = JSON.parse(row.rolls_json) as Array<PendingRoll & { requestedAt: string }>;
    return parsed.map((roll) => ({
      ...roll,
      requestedAt: new Date(roll.requestedAt),
      channelId: normalizeChannelId(roll.channelId),
    }));
  }

  private _readLegacyPlayerIds(): number[] {
    return this.db
      .query<{ user_id: number }, [string]>(
        'SELECT user_id FROM kp_session_players WHERE session_id = ? ORDER BY joined_at ASC',
      )
      .all(this.sessionId)
      .map((row) => row.user_id);
  }

  private _readLegacyRecentMessages(limit = 40): SessionMessage[] {
    return this.db
      .query<DbMessageRow, [string, number]>(
        `SELECT * FROM kp_messages
          WHERE session_id = ? AND is_summarized = 0
          ORDER BY timestamp ASC
          LIMIT ?`,
      )
      .all(this.sessionId, limit)
      .map(rowToMessage)
      .map((msg) => ({
        ...msg,
        channelId: DEFAULT_CHANNEL_ID,
        visibility: DEFAULT_VISIBILITY,
      }));
  }

  private _readLegacyIngameTime(): string | null {
    const row = this.db.query<{ ingame_time: string | null }, [string]>(
      'SELECT ingame_time FROM kp_sessions WHERE id = ?',
    ).get(this.sessionId);
    return row?.ingame_time ?? null;
  }

  private _savePendingRolls(): void {
    this._savePendingRollsValue(this._pendingRolls);
  }

  private _savePendingRollsValue(rolls: PendingRoll[]): void {
    if (!this.enableLegacyWrites) return;
    this.db.run(
      `INSERT OR REPLACE INTO kp_pending_rolls (session_id, rolls_json, updated_at)
       VALUES (?, ?, ?)`,
      [this.sessionId, JSON.stringify(rolls), new Date().toISOString()],
    );
  }

  private _insertTimelineEvent(
    ingameTime: string,
    deltaMinutes: number | null,
    description: string,
    trigger: string,
    messageId?: string,
    createdAt = new Date(),
  ): void {
    const id = `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.db.run(
      `INSERT INTO kp_timeline_events (id, session_id, ingame_time, delta_minutes, description, trigger, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.sessionId, ingameTime, deltaMinutes, description, trigger, messageId ?? null, createdAt.toISOString()],
    );
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

  private getSummarizedMessageIds(): Set<string> {
    const rows = this.db
      .query<{ message_ids_json: string }, [string]>(
        `SELECT message_ids_json FROM kp_summaries WHERE session_id = ?`,
      )
      .all(this.sessionId);
    const ids = new Set<string>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.message_ids_json) as unknown;
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string') ids.add(id);
          }
        }
      } catch {
        // ignore bad cache rows
      }
    }
    return ids;
  }

  private _shadowCompare(reason: string): void {
    if (!this.enableShadowCompare || !this.readFromEvents || this._events.length === 0) return;
    if (this._activeChannels.size > 1 || this._focusChannelId !== DEFAULT_CHANNEL_ID) return;

    try {
      const legacy = this._readLegacySnapshot();
      const replay = this.snapshotFromEvents(DEFAULT_CHANNEL_ID, {});
      const mismatches: string[] = [];

      if (!sceneEquals(legacy.currentScene, replay.currentScene)) mismatches.push('currentScene');
      if (!clueListEquals(legacy.discoveredClues, replay.discoveredClues)) mismatches.push('discoveredClues');
      if (!pendingRollListEquals(legacy.pendingRolls, replay.pendingRolls)) mismatches.push('pendingRolls');
      if (!numberListEquals(legacy.playerIds, this._playerIds)) mismatches.push('playerIds');
      if (!messageListEquals(legacy.recentMessages, replay.recentMessages)) mismatches.push('recentMessages');
      if ((legacy.ingameTime ?? null) !== (replay.ingameTime ?? null)) mismatches.push('ingameTime');

      if (mismatches.length > 0) {
        console.warn(`[SessionState] shadow compare mismatch after ${reason}: ${mismatches.join(', ')}`);
      }
    } catch (err) {
      console.warn('[SessionState] shadow compare failed:', err);
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

interface DbTimelineRow {
  id: string;
  session_id: string;
  ingame_time: string;
  delta_minutes: number | null;
  description: string;
  trigger: string;
  message_id: string | null;
  created_at: string;
}

interface DbEventRow {
  seq: number;
  id: string;
  session_id: string;
  type: string;
  channel_id: string | null;
  actor_id: number | null;
  visibility: string | null;
  payload_json: string;
  ingame_time: string | null;
  created_at: string;
}

interface SerializedPendingRoll extends Omit<PendingRoll, 'requestedAt' | 'channelId'> {
  requestedAt: string;
  channelId?: string;
}

interface SerializedClue extends Omit<Clue, 'discoveredAt'> {
  discoveredAt?: string;
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
    channelId: DEFAULT_CHANNEL_ID,
    visibility: DEFAULT_VISIBILITY,
  };
}

function rowToTimelineEvent(row: DbTimelineRow): TimelineEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    ingameTime: row.ingame_time,
    deltaMinutes: row.delta_minutes,
    description: row.description,
    trigger: row.trigger as TimelineEvent['trigger'],
    messageId: row.message_id ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

function rowToEvent(row: DbEventRow): SessionEvent<KnownEventPayload> {
  return {
    seq: row.seq,
    id: row.id,
    sessionId: row.session_id,
    type: row.type as SessionEventType,
    channelId: normalizeChannelId(row.channel_id),
    actorId: row.actor_id ?? undefined,
    visibility: normalizeVisibility(row.visibility),
    payload: JSON.parse(row.payload_json) as KnownEventPayload,
    ingameTime: row.ingame_time ?? null,
    createdAt: new Date(row.created_at),
  };
}

function pendingRollToSerialized(roll: PendingRoll): SerializedPendingRoll {
  return {
    ...roll,
    requestedAt: roll.requestedAt.toISOString(),
    channelId: normalizeChannelId(roll.channelId),
  };
}

function serializedToPendingRoll(roll: SerializedPendingRoll): PendingRoll {
  return {
    ...roll,
    requestedAt: new Date(roll.requestedAt),
    channelId: normalizeChannelId(roll.channelId),
  };
}

function clueToSerialized(clue: Clue): SerializedClue {
  return {
    ...clue,
    discoveredAt: clue.discoveredAt?.toISOString(),
  };
}

function serializedToClue(clue: SerializedClue): Clue {
  return {
    ...clue,
    discoveredAt: clue.discoveredAt ? new Date(clue.discoveredAt) : undefined,
  };
}

function normalizeChannelId(channelId?: string | null): string {
  return channelId?.trim() || DEFAULT_CHANNEL_ID;
}

function normalizeVisibility(value?: string | null): SessionVisibility {
  if (!value) return DEFAULT_VISIBILITY;
  if (value === 'public' || value === 'kp_only' || value.startsWith('private:')) {
    return value as SessionVisibility;
  }
  return DEFAULT_VISIBILITY;
}

function normalizeSessionEntityOverlay(
  entity: SessionEntityOverlay,
  channelId?: string | null,
  visibility?: string | null,
): SessionEntityOverlay {
  return {
    ...entity,
    moduleId: entity.moduleId ?? null,
    source: 'session',
    channelId: normalizeChannelId(channelId ?? entity.channelId),
    visibility: normalizeVisibility(visibility ?? entity.visibility),
    reviewStatus: 'approved',
  };
}

function normalizeSessionItemOverlay(
  item: SessionItemOverlay,
  channelId?: string | null,
  visibility?: string | null,
): SessionItemOverlay {
  return {
    ...item,
    moduleId: item.moduleId ?? null,
    source: 'session',
    channelId: normalizeChannelId(channelId ?? item.channelId),
    visibility: normalizeVisibility(visibility ?? item.visibility),
    reviewStatus: 'approved',
    currentOwner: item.currentOwner ?? item.defaultOwner ?? '',
    currentLocation: item.currentLocation ?? item.defaultLocation ?? '',
  };
}

function applyItemChangeToItem(item: ScenarioItem, change?: ItemChangeEventPayload): ScenarioItem {
  if (!change) return item;
  return {
    ...item,
    currentOwner: change.owner?.trim() || item.currentOwner || item.defaultOwner || '',
    currentLocation: change.location?.trim() || item.currentLocation || item.defaultLocation || '',
    stateNotes: change.stateNotes?.trim() || item.stateNotes || '',
    usage: change.usage?.trim() || item.usage,
  };
}

function normalizeAssetKey(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/[\s【】（）()：:，,、]/g, '').trim();
}

export function buildPrivateVisibility(userIds: number | number[]): SessionVisibility {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const normalized = Array.from(new Set(ids.map((id) => Math.trunc(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (normalized.length === 0) return DEFAULT_VISIBILITY;
  return `private:${normalized.join(',')}`;
}

export function parsePrivateVisibility(visibility: SessionVisibility): number[] {
  if (!visibility.startsWith('private:')) return [];
  return visibility.slice('private:'.length)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function isVisibleToViewer(visibility: SessionVisibility, viewerScope: ViewerScope): boolean {
  if (visibility === 'public') return true;
  if (visibility === 'kp_only') return viewerScope.includeKpOnly === true;
  if (!visibility.startsWith('private:')) return false;
  if (viewerScope.includeKpOnly) return true;
  if (!viewerScope.userId) return false;
  return parsePrivateVisibility(visibility).includes(viewerScope.userId);
}

function buildSummaryCacheKey(channelId: string, viewerScope: ViewerScope): string {
  const viewer = viewerScope.includeKpOnly
    ? `kp:${viewerScope.userId ?? 'all'}`
    : viewerScope.userId
      ? `user:${viewerScope.userId}`
      : 'public';
  return `${channelId}::${viewer}`;
}

function cloneOpeningPlanSkeleton(plan: OpeningDirectorPlanSkeleton): OpeningDirectorPlanSkeleton {
  return {
    ...plan,
    assumedLinks: plan.assumedLinks.map((link) => ({
      ...link,
      participants: [...link.participants],
    })),
    initialAssignments: plan.initialAssignments.map((assignment) => ({ ...assignment })),
    beats: plan.beats.map((beat) => ({
      ...beat,
      participants: [...beat.participants],
      sceneState: {
        ...beat.sceneState,
        activeNpcs: [...beat.sceneState.activeNpcs],
      },
      privateTargets: [...beat.privateTargets],
    })),
    directorSeeds: plan.directorSeeds.map((seed) => ({
      ...seed,
      targets: [...seed.targets],
    })),
  };
}

function summarizeEventForContext(event: SessionEvent<KnownEventPayload>): string | null {
  switch (event.type) {
    case 'message': {
      const payload = event.payload as MessageEventPayload;
      const speaker = payload.role === 'kp'
        ? 'KP'
        : payload.displayName || (payload.userId ? `玩家${payload.userId}` : '系统');
      return `${speaker}：${compact(payload.content, 80)}`;
    }
    case 'scene_change': {
      const payload = event.payload as SceneChangeEventPayload;
      if (!payload.scene) return '场景被清空';
      return `场景转到${payload.scene.name}${payload.scene.description ? `（${compact(payload.scene.description, 48)}）` : ''}`;
    }
    case 'check_request': {
      const payload = event.payload as CheckRequestEventPayload;
      return `${payload.roll.characterName}需要进行${payload.roll.skillName}检定`;
    }
    case 'check_result': {
      const payload = event.payload as CheckResultEventPayload;
      if (payload.clearAll) return '等待中的检定请求已被清空';
      if (payload.playerId !== undefined) {
        return `玩家${payload.playerId}的检定结果已结算${payload.resultText ? `（${compact(payload.resultText, 48)}）` : ''}`;
      }
      return null;
    }
    case 'clue_discovered': {
      const payload = event.payload as ClueDiscoveredEventPayload;
      return `发现线索：${payload.clue.title}（${compact(payload.clue.playerDescription, 60)}）`;
    }
    case 'time_advance': {
      const payload = event.payload as TimeAdvanceEventPayload;
      if (payload.mode === 'set') {
        return `时间设为${payload.ingameTime}`;
      }
      return `时间推进${payload.deltaMinutes ?? 0}分钟，到${payload.ingameTime}`;
    }
    case 'player_joined': {
      const payload = event.payload as PlayerJoinedEventPayload;
      return `玩家${payload.userId}加入跑团`;
    }
    case 'channel_focus': {
      const payload = event.payload as ChannelFocusEventPayload;
      return `切换到频道 ${payload.channelId}`;
    }
    case 'channel_assignment': {
      const payload = event.payload as ChannelAssignmentEventPayload;
      return `玩家${payload.userId}进入频道 ${payload.channelId}`;
    }
    case 'channel_merge': {
      const payload = event.payload as ChannelMergeEventPayload;
      return `频道 ${payload.fromChannel} 并入 ${payload.toChannel}`;
    }
    case 'channel_interrupt': {
      const payload = event.payload as ChannelInterruptEventPayload;
      return payload.active
        ? `频道 ${payload.channelId} 出现紧急事件：${compact(payload.reason, 48)}`
        : `频道 ${payload.channelId} 的紧急状态已解除`;
    }
    case 'register_entity': {
      const payload = event.payload as RegisterEntityEventPayload;
      return `临时实体加入：${payload.entity.name}${payload.entity.identity ? `（${compact(payload.entity.identity, 24)}）` : ''}`;
    }
    case 'register_item': {
      const payload = event.payload as RegisterItemEventPayload;
      return `临时物品加入：${payload.item.name}${payload.item.publicDescription ? `（${compact(payload.item.publicDescription, 36)}）` : ''}`;
    }
    case 'item_change': {
      const payload = event.payload as ItemChangeEventPayload;
      return `物品状态更新：${payload.itemName}${payload.owner ? ` → ${payload.owner}` : ''}${payload.location ? ` @ ${payload.location}` : ''}`;
    }
    case 'opening_plan': {
      const payload = event.payload as OpeningPlanEventPayload;
      return `开场计划已设定：${payload.plan.beats.length} 个段落，汇合目标为 ${compact(payload.plan.mergeGoal, 48)}`;
    }
    case 'director_marker': {
      const payload = event.payload as DirectorMarkerEventPayload;
      return `导演标记：${payload.label}`;
    }
    case 'director_seed_resolved': {
      const payload = event.payload as DirectorSeedResolvedEventPayload;
      return `导演种子已解决：${payload.seedIds.join('、')}`;
    }
    case 'director_cue': {
      const payload = event.payload as DirectorCueEventPayload;
      return `导演提示：${payload.cue.type}（${compact(payload.cue.reason, 48)}）`;
    }
    default:
      return null;
  }
}

function formatEventSpan(first: SessionEvent<KnownEventPayload>, last: SessionEvent<KnownEventPayload>): string {
  const firstLabel = first.ingameTime ?? first.createdAt.toISOString();
  const lastLabel = last.ingameTime ?? last.createdAt.toISOString();
  if (firstLabel === lastLabel) return firstLabel;
  return `${firstLabel} 至 ${lastLabel}`;
}

function numberListEquals(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sceneEquals(a: SceneInfo | null, b: SceneInfo | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.name === b.name &&
    a.description === b.description &&
    a.activeNpcs.join('|') === b.activeNpcs.join('|');
}

function clueListEquals(a: Clue[], b: Clue[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return left.id === right.id &&
      left.title === right.title &&
      left.playerDescription === right.playerDescription &&
      left.keeperContent === right.keeperContent &&
      (left.discoveredBy ?? null) === (right.discoveredBy ?? null);
  });
}

function pendingRollListEquals(a: PendingRoll[], b: PendingRoll[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return left.playerId === right.playerId &&
      left.characterName === right.characterName &&
      left.skillName === right.skillName &&
      left.difficulty === right.difficulty &&
      left.reason === right.reason &&
      normalizeChannelId(left.channelId) === normalizeChannelId(right.channelId);
  });
}

function messageListEquals(a: SessionMessage[], b: SessionMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return left.id === right.id &&
      left.role === right.role &&
      left.userId === right.userId &&
      left.displayName === right.displayName &&
      left.content === right.content;
  });
}

function compact(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * 游戏内时间算术：将 "YYYY-MM-DDTHH:MM" 加上指定分钟数
 * JS Date 对 1925 等历史日期的基本算术是正确的
 */
export function addMinutesToTime(isoTime: string, minutes: number): string {
  const [datePart, timePart] = isoTime.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const base = new Date(y, mo - 1, d, h, mi);
  base.setMinutes(base.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
}

function diffMinutesBetweenTimes(fromIsoTime: string, toIsoTime: string): number | null {
  const from = parseIsoTime(fromIsoTime);
  const to = parseIsoTime(toIsoTime);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 60000);
}

function parseIsoTime(isoTime: string): Date | null {
  const match = isoTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}
