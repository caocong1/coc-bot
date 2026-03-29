/**
 * AI KP 流水线
 *
 * 处理一条输入消息，决定是否回应，生成 KP 回复并写回状态。
 *
 * 流程：
 *   输入消息
 *     → 判断是否需要介入（InterventionDecider）
 *     → 并行检索规则 + 模组 RAG
 *     → ContextBuilder 组装完整 Prompt
 *     → qwen3.5-plus 生成草稿（流式）
 *     → 守密人过滤（第二次 AI 调用，非流式）
 *     → 写入 SessionState（消息历史、状态更新）
 *     → 返回最终文本供发送到 QQ
 */

import type { AIClient } from '../client/AIClient';
import { DashScopeApiError } from '../client/DashScopeClient';
import { ContextBuilder } from '../context/ContextBuilder';
import { KPTemplateRegistry } from '../config/KPTemplateRegistry';
import { KnowledgeService, type KnowledgeCategory } from '../../knowledge/retrieval/KnowledgeService';
import { SessionState, buildPrivateVisibility, type PendingRoll, type SceneInfo, type SessionVisibility, type ViewerScope } from '../../runtime/SessionState';
import { CharacterStore } from '../../commands/sheet/CharacterStore';
import type { Character } from '@shared/types/Character';
import { getSkillDisplayName, resolveSkillKey } from '@shared/coc7/skillNames';
import type { SessionEntityOverlay, SessionItemOverlay } from '@shared/types/ScenarioAssets';
import type { DirectorCue } from '@shared/types/StoryDirector';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

/** 进入流水线的输入 */
export interface KPInput {
  /** 消息来源类型 */
  kind: 'player_message' | 'dice_result' | 'system_event' | 'force_kp';
  userId: number;
  /** 显示名（玩家昵称或角色名） */
  displayName: string;
  content: string;
  /** 骰子结果时附带：发起检定的玩家 userId */
  diceRollerId?: number;
  /** 场景频道 ID */
  channelId?: string;
  /** 本轮输入可见性 */
  visibility?: SessionVisibility;
  /** 当前上下文查看视角 */
  viewerScope?: ViewerScope;
  /** 本轮待注入的导演提示 */
  directorCue?: DirectorCue | null;
}

/** 检定结果的结构化上下文（从 PendingRoll + 骰子文本中捕获） */
export interface DiceContext {
  skillName: string;
  difficulty: 'normal' | 'hard' | 'extreme';
  reason: string;
  outcome: string;      // 大成功|极限成功|困难成功|成功|失败|大失败|未知
  sourceText: string;    // input.content 原文
}

/** 需要展示给玩家的图片 */
export interface KPImage {
  id: string;
  absPath: string;
  caption: string;
}

/** 流水线输出 */
export interface KPOutput {
  /** 是否需要发送回复（false = KP 选择沉默） */
  shouldRespond: boolean;
  /** 最终发送到群聊的文本（已去除 [SHOW_IMAGE:] 标记） */
  text: string;
  /** AI 调用失败时为 true，text 包含错误提示 */
  error?: boolean;
  /**
   * AI KP 决定展示的图片列表（从文本中提取的 [SHOW_IMAGE:id] 标记解析而来）。
   * 调用方负责按顺序发送，800ms 间隔。
   */
  images?: KPImage[];
  /** 需要通过私聊投递给特定玩家的附加信息 */
  privateMessages?: Array<{ userId: number; text: string }>;
  /** 调试信息 */
  debug?: {
    interventionReason: string;
    layerStats: Record<string, number>;
    draftLength: number;
    filteredLength: number;
  };
}

export interface KPPipelineOptions {
  /** KP 人格模板 ID，默认 'classic' */
  templateId?: string;
  /** 房间级自定义 KP 提示词，追加到人格层 */
  customPrompts?: string;
  /** 沉默阈值：连续几条玩家互 RP 消息后，KP 最多插一句氛围 */
  silenceThreshold?: number;
  /** 是否启用守密人输出过滤（默认 true） */
  enableGuardrail?: boolean;
  /** 触发摘要压缩的消息条数阈值（默认 40） */
  summaryTriggerCount?: number;
  /** 关联房间 ID，用于读取房间绑定的角色卡 */
  roomId?: string;
  /** 数据库实例（用于加载自定义模板） */
  db?: import('bun:sqlite').Database;
  /** KP 主模型，默认 'qwen3.5-plus' */
  chatModel?: string;
  /** 守密人过滤模型，默认 'qwen3.5-flash' */
  guardrailModel?: string;
}

interface PrivateDirective {
  targets: string[];
  content: string;
}

interface SceneDirective {
  scene: SceneInfo;
}

interface ClueDirective {
  title: string;
  playerDescription: string;
}

interface PendingRollDirective {
  skillName: string;
  difficulty: 'normal' | 'hard' | 'extreme';
  reason: string;
}

interface EntityDirective {
  name: string;
  type: 'npc' | 'creature';
  identity: string;
  dangerLevel: string;
}

interface ItemDirective {
  name: string;
  category: string;
  description: string;
  owner: string;
}

interface ItemChangeDirective {
  itemName: string;
  owner: string;
  location: string;
  stateNotes: string;
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

export class KPPipeline {
  private readonly client: AIClient;
  private readonly contextBuilder = new ContextBuilder();
  private readonly templateRegistry: KPTemplateRegistry;
  private readonly knowledge: KnowledgeService;
  private readonly state: SessionState;
  private readonly store: CharacterStore;

  private readonly templateId: string;
  private readonly customPrompts: string;
  private readonly silenceThreshold: number;
  private readonly enableGuardrail: boolean;
  private readonly summaryTriggerCount: number;
  private readonly chatModel: string;
  private readonly guardrailModel: string;

  private readonly roomId?: string;

  /** 连续未介入的消息计数（用于沉默阈值判断） */
  private silentCount = 0;

  constructor(
    client: AIClient,
    state: SessionState,
    store: CharacterStore,
    knowledge: KnowledgeService,
    options: KPPipelineOptions = {},
  ) {
    this.client = client;
    this.state = state;
    this.store = store;
    this.knowledge = knowledge;
    this.templateRegistry = new KPTemplateRegistry(options.db);
    this.templateId = options.templateId ?? 'classic';
    this.customPrompts = options.customPrompts ?? '';
    this.silenceThreshold = options.silenceThreshold ?? 5;
    this.enableGuardrail = options.enableGuardrail ?? true;
    this.summaryTriggerCount = options.summaryTriggerCount ?? 40;
    this.roomId = options.roomId;
    this.chatModel = options.chatModel ?? 'qwen3.5-plus';
    this.guardrailModel = options.guardrailModel ?? 'qwen3.5-flash';
  }

  async process(input: KPInput, onThinking?: () => void): Promise<KPOutput> {
    const channelId = input.channelId ?? this.state.getPlayerChannel(input.userId);
    const viewerScope = input.viewerScope ?? {};

    // 1. 将输入消息写入历史
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.state.addMessage({
      id: msgId,
      role: input.kind === 'dice_result' ? 'dice' : 'player',
      userId: input.userId,
      displayName: input.displayName,
      content: input.content,
      timestamp: new Date(),
      channelId,
      visibility: input.visibility,
    });

    // 骰子结果：先捕获检定上下文，再清除等待投骰状态
    let diceContext: DiceContext | undefined;
    if (input.kind === 'dice_result' && input.diceRollerId !== undefined) {
      const pending = this.state.getPendingRollsForChannel(channelId)
        .find((r) => r.playerId === input.diceRollerId);
      const outcomeMatch = input.content.match(/(大成功|极限成功|困难成功|成功|失败|大失败)/);
      diceContext = {
        skillName: pending?.skillName ?? '未知',
        difficulty: pending?.difficulty ?? 'normal',
        reason: pending?.reason ?? '',
        outcome: outcomeMatch?.[1] ?? '未知',
        sourceText: input.content,
      };
      this.state.clearPendingRoll(input.diceRollerId, { channelId, actorId: input.userId });
    }

    // 2. 判断是否介入
    const intervention = await this.decideIntervention(input);
    if (!intervention.shouldIntervene) {
      this.silentCount += 1;
      return { shouldRespond: false, text: '', debug: { interventionReason: intervention.reason, layerStats: {}, draftLength: 0, filteredLength: 0 } };
    }
    this.silentCount = 0;

    // 通知调用方：KP 决定介入，AI 即将开始生成
    console.log(`[KPPipeline] 介入决策: reason=${intervention.reason}, 开始 AI 生成...`);
    onThinking?.();

    // 3. 并行 RAG 检索
    const query = input.content.slice(0, 200); // 检索用前200字够了
    const [ruleChunks, scenarioChunks] = await Promise.all([
      this.knowledge.retrieve(query, ['rules'], { limitPerCategory: 4 })
        .catch(() => []),
      this.knowledge.retrieve(query, ['scenario', 'keeper_secret'], { limitPerCategory: 4 })
        .catch(() => []),
    ]);

    // 4. 获取玩家角色卡
    const snapshot = this.state.snapshot(channelId, viewerScope);
    const playPrivacyMode = snapshot.moduleRulePack?.playPrivacyMode ?? 'public';
    const channelState = this.state.getChannelState(channelId, viewerScope);
    const characters = this.getSessionCharacters(snapshot.groupId);

    // 5. 组装上下文
    const template = this.templateRegistry.get(this.templateId)
      ?? this.templateRegistry.get('classic')!;

    // 模组全文（优先）/ RAG 降级
    const scenarioFullText = this.state.getScenarioText() ?? undefined;
    const scenarioLabel = this.state.getScenarioLabel() ?? undefined;
    const sceneSegments = this.state.getSegments();
    const currentSegmentId = this.state.getCurrentSegmentId() ?? undefined;

    const scenarioImages = this.state.getScenarioImages();

    const { systemPrompt, messages, layerStats } = this.contextBuilder.build(
      template,
      snapshot,
      {
        characters,
        ruleChunks,
        scenarioFullText,
        scenarioLabel,
        scenarioChunks: scenarioFullText ? undefined : scenarioChunks,
        sceneSegments: sceneSegments.length > 0 ? sceneSegments : undefined,
        currentSegmentId,
        maxRecentMessages: 30,
        scenarioImages: scenarioImages.length > 0 ? scenarioImages : undefined,
        customPrompts: this.customPrompts || undefined,
        channelId,
        viewerScope,
        channelPlayerIds: channelState.playerIds,
        directorCue: input.directorCue ?? null,
      },
    );

    // 6. 生成草稿
    const t0 = Date.now();
    console.log(`[KPPipeline] 调用 AI 草稿生成 (model=${this.chatModel}, reason=${intervention.reason})...`);
    const draft = await this.generateDraft(systemPrompt, messages, intervention.reason);
    console.log(`[KPPipeline] 草稿生成完成: ${draft.length}字, 耗时${Date.now() - t0}ms`);
    if (!draft) {
      return { shouldRespond: false, text: '', debug: { interventionReason: intervention.reason, layerStats, draftLength: 0, filteredLength: 0 } };
    }
    if (draft === KPPipeline.DRAFT_ERROR) {
      return { shouldRespond: true, text: '⚠️ KP 暂时无法回应，请稍后再试', error: true, debug: { interventionReason: intervention.reason, layerStats, draftLength: 0, filteredLength: 0 } };
    }

    // 7. 提取 [SHOW_IMAGE:xxx] 标记（在 guardrail 之前，防止被过滤模型删除）
    const { cleanText: draftNoImg, imageIds } = extractShowImageMarkers(draft);

    // 7.5 提取结构化指令（在 guardrail 之前剥离）
    const { cleanText: withoutPrivate, directives: privateDirectives } = extractPrivateDirectives(draftNoImg);
    const { cleanText: withoutScene, directives: sceneDirectives } = extractSceneDirectives(withoutPrivate);
    const { cleanText: withoutClue, directives: clueDirectives } = extractClueDirectives(withoutScene);
    const { cleanText: withoutEntity, directives: entityDirectives } = extractEntityDirectives(withoutClue);
    const { cleanText: withoutItem, directives: itemDirectives } = extractItemDirectives(withoutEntity);
    const { cleanText: withoutItemChange, directives: itemChangeDirectives } = extractItemChangeDirectives(withoutItem);
    const { cleanText: draftClean, timeMarkers } = extractTimeMarkers(withoutItemChange);
    const downgradedPrivateTexts = playPrivacyMode === 'public'
      ? this.downgradePrivateDirectivesToPublic(privateDirectives, characters, input)
      : [];
    const guardrailInput = [draftClean, ...downgradedPrivateTexts].filter(Boolean).join('\n\n');

    // 8. 守密人过滤（仅过滤文字部分）
    const recentExchangeSummary = snapshot.recentMessages
      .filter((m) => m.role === 'player' || m.role === 'kp')
      .slice(-3)
      .map((m) => `[${m.role === 'player' ? m.displayName : 'KP'}] ${m.content.slice(0, 80)}`)
      .join('\n') || '（无近期互动）';
    const t1 = Date.now();
    if (this.enableGuardrail) console.log(`[KPPipeline] 调用守密人过滤 (model=${this.guardrailModel})...`);
    const filteredText = this.enableGuardrail
      ? await this.applyGuardrail(guardrailInput, snapshot.discoveredClues.map((c) => c.title), {
        interventionReason: intervention.reason,
        inputKind: input.kind,
        playerMessage: input.content,
        recentExchangeSummary,
        diceContext,
      })
      : guardrailInput;
    if (this.enableGuardrail) console.log(`[KPPipeline] 过滤完成: ${filteredText.length}字, 耗时${Date.now() - t1}ms`);

    // 9. 解析图片 ID → 实际路径（仅 playerVisible=true 的图片）
    const images: KPImage[] = [];
    for (const imgId of imageIds) {
      const img = this.state.resolveImage(imgId);
      if (img && img.playerVisible) {
        images.push({ id: img.id, absPath: img.absPath, caption: img.caption });
      }
    }

    if (playPrivacyMode === 'public' && privateDirectives.length > 0) {
      console.warn(`[KPPipeline] PRIVATE_TO downgraded to public text for public module mode (${privateDirectives.length})`);
    }
    const compliance = this.applyComplianceCheck(this.enhanceCheckRequests(filteredText, characters));
    if (compliance.warnings.length > 0) {
      console.warn(`[KPPipeline] compliance warnings: ${compliance.warnings.join(', ')}`);
    }
    const finalText = compliance.text;
    const privateMessages = playPrivacyMode === 'secret'
      ? this.resolvePrivateMessages(privateDirectives, characters, input)
      : [];

    // 10. 写入 KP 回复到历史
    const kpMsgId = `kp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (finalText.trim()) {
      this.state.addMessage({
        id: kpMsgId,
        role: 'kp',
        content: finalText,
        timestamp: new Date(),
        channelId,
      });
    }

    for (let index = 0; index < privateMessages.length; index++) {
      const privateMessage = privateMessages[index];
      this.state.addMessage({
        id: `${kpMsgId}-priv-${index}`,
        role: 'kp',
        content: privateMessage.text,
        timestamp: new Date(),
        channelId,
        visibility: buildPrivateVisibility(privateMessage.userId),
      });
    }

    // 10.5 应用时间标记到会话状态
    for (const marker of timeMarkers) {
      if (marker.type === 'advance') {
        const mins = parseInt(marker.value, 10);
        if (mins > 0 && mins <= 1440) {
          this.state.advanceIngameTime(mins, `推进 ${mins} 分钟`, 'ai', kpMsgId, { channelId });
        }
      } else if (marker.type === 'set') {
        this.state.setIngameTime(marker.value, '设定时间', 'ai', kpMsgId, { channelId });
      }
    }

    this.applySceneDirectives(sceneDirectives, channelId);
    const validatedClueDirectives = this.validateClueDirectives(clueDirectives, {
      interventionReason: intervention.reason,
      inputKind: input.kind,
      diceContext,
    });
    this.applyClueDirectives(validatedClueDirectives, input.userId, channelId);
    this.applyEntityDirectives(entityDirectives, channelId, input.userId);
    this.applyItemDirectives(itemDirectives, channelId, input.userId);
    this.applyItemChangeDirectives(itemChangeDirectives, channelId, input.userId);
    this.applyPendingRollDirectives(finalText, input, characters, channelId);
    for (const privateMessage of privateMessages) {
      this.applyPendingRollDirectives(privateMessage.text, {
        ...input,
        userId: privateMessage.userId,
        displayName: this.getCharacterDisplayName(privateMessage.userId, characters, input.displayName),
      }, characters, channelId, buildPrivateVisibility(privateMessage.userId));
    }

    // 11. 检查是否需要触发摘要压缩
    this.maybeTriggerSummary();

    return {
      shouldRespond: finalText.trim().length > 0 || privateMessages.length > 0 || images.length > 0,
      text: finalText,
      images: images.length > 0 ? images : undefined,
      privateMessages: privateMessages.length > 0 ? privateMessages : undefined,
      debug: {
        interventionReason: intervention.reason,
        layerStats,
        draftLength: draft.length,
        filteredLength: finalText.length,
      },
    };
  }

  // ─── 介入判断 ───────────────────────────────────────────────────────────────

  private async decideIntervention(
    input: KPInput,
  ): Promise<{ shouldIntervene: boolean; reason: string }> {
    // 强制 KP 介入（.kp 命令）
    if (input.kind === 'force_kp') {
      return { shouldIntervene: true, reason: 'force_kp' };
    }

    // 骰子结果 → 必须接话
    if (input.kind === 'dice_result') {
      return { shouldIntervene: true, reason: 'dice_result' };
    }

    // 系统事件 → 必须处理
    if (input.kind === 'system_event') {
      return { shouldIntervene: true, reason: 'system_event' };
    }

    const text = input.content.trim();

    // OOC 消息 → 直接回应
    if (text.startsWith('(') || text.startsWith('（') ||
        /^ooc[：:]/i.test(text) || /^OOC[：:]/.test(text)) {
      return { shouldIntervene: true, reason: 'ooc_query' };
    }

    // 直接问 KP（"kp"、"守秘人"、"KP" 开头或包含）
    if (/^kp[,，\s]/i.test(text) || /^守秘人[,，\s]/.test(text)) {
      return { shouldIntervene: true, reason: 'direct_kp_query' };
    }

    // 有等待骰子 且 当前消息看起来是投骰后行动
    if (this.state.getPendingRollsForChannel(input.channelId ?? this.state.getPlayerChannel(input.userId)).length > 0 &&
        /^[\d]+$/.test(text.replace(/\s/g, ''))) {
      return { shouldIntervene: true, reason: 'pending_roll_response' };
    }

    // 超过沉默阈值 → 插入氛围描写
    if (this.silentCount >= this.silenceThreshold) {
      return { shouldIntervene: true, reason: 'atmosphere_nudge' };
    }

    // ── AI 意图分类（替代关键词匹配）──
    try {
      const result = await this.classifyIntent(text);
      console.log(`[KPPipeline] AI 意图分类: text="${text.slice(0, 30)}" → ${result.intent} (${result.shouldIntervene ? '介入' : '观望'})`);
      return { shouldIntervene: result.shouldIntervene, reason: result.intent };
    } catch (err) {
      // 分类失败 → 保守策略：介入（宁可多回复也别漏），但按错误类型记录日志
      if (err instanceof DashScopeApiError) {
        if (err.isQuotaError) {
          console.error(`[KPPipeline] ⚠️ 意图分类失败：API 配额已用尽 (${err.errorCode})，降级为直接介入`);
        } else if (err.isTransient) {
          console.warn(`[KPPipeline] 意图分类暂时不可用 (HTTP ${err.statusCode})，降级为介入`);
        } else {
          console.error(`[KPPipeline] 意图分类 API 错误 (${err.statusCode}, ${err.errorCode})，降级为介入`);
        }
      } else {
        console.error('[KPPipeline] AI 意图分类失败（未知错误），降级为介入:', err);
      }
      return { shouldIntervene: true, reason: 'classify_fallback' };
    }
  }

  // ─── AI 意图分类（快速模型）────────────────────────────────────────────────

  private async classifyIntent(text: string): Promise<{ shouldIntervene: boolean; intent: string }> {
    const prompt = `你是一个 TRPG（跑团）游戏中的意图分类器。判断玩家在群聊中发送的这条消息是否需要 KP（守秘人）回应。

需要 KP 回应的情况：
- 玩家执行动作（打开门、检查房间、走过去、拿起物品等）
- 玩家对 NPC 说话或提问
- 玩家描述自己角色的行为
- 玩家询问环境/场景信息
- 任何推进剧情的言行

不需要 KP 回应的情况：
- 玩家之间的闲聊（跟剧情无关）
- 纯表情/emoji
- 玩家之间讨论策略但没有实际行动
- 与游戏无关的杂谈

只回答一个 JSON：{"act":true} 或 {"act":false}
不要输出任何其他内容。`;

    const t0 = Date.now();
    const response = await this.client.chat(
      this.guardrailModel,
      [
        { role: 'system', content: prompt },
        { role: 'user', content: text },
      ],
    );
    console.log(`[KPPipeline] 意图分类耗时: ${Date.now() - t0}ms`);

    // 解析 AI 回复
    const cleaned = response
      .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
      .trim();
    const match = cleaned.match(/\{\s*"act"\s*:\s*(true|false)\s*\}/);
    if (match) {
      const shouldAct = match[1] === 'true';
      return { shouldIntervene: shouldAct, intent: shouldAct ? 'ai_action' : 'ai_watching' };
    }

    // 无法解析 → 保守介入
    console.warn(`[KPPipeline] 意图分类返回无法解析: "${cleaned}"`);
    return { shouldIntervene: true, intent: 'ai_parse_fallback' };
  }

  // ─── 草稿生成 ───────────────────────────────────────────────────────────────

  /** 错误标记：两次重试均失败 */
  static readonly DRAFT_ERROR = '__DRAFT_ERROR__';

  private async generateDraft(
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    interventionReason: string,
  ): Promise<string> {
    // 为"氛围描写"模式加入额外指令
    const finalMessages = [...messages];
    if (interventionReason === 'atmosphere_nudge') {
      finalMessages.push({
        role: 'user',
        content: '[系统提示：玩家间 RP 已持续一段时间，请插入一句简短的环境/氛围描写（不超过两行），然后停止，不要强行推进剧情]',
      });
    }

    const attempt = (): Promise<string> =>
      new Promise<string>((resolve) => {
        let buffer = '';
        this.client.streamChat(
          this.chatModel,
          [{ role: 'system', content: systemPrompt }, ...finalMessages],
          {
            onToken: (token) => { buffer += token; },
            onDone: () => resolve(buffer.trim()),
            onError: (err) => {
              console.error('[KPPipeline] 草稿生成失败:', err);
              resolve('');
            },
          },
        );
      });

    // 第一次尝试
    const first = await attempt();
    if (first) return first;

    // 自动重试一次
    console.log('[KPPipeline] 草稿生成失败，自动重试...');
    const second = await attempt();
    if (second) return second;

    // 两次都失败 → 返回错误标记
    console.error('[KPPipeline] 草稿生成两次均失败');
    return KPPipeline.DRAFT_ERROR;
  }

  // ─── 守密人过滤 ─────────────────────────────────────────────────────────────

  private async applyGuardrail(
    draft: string,
    discoveredClueTitles: string[],
    context: {
      interventionReason: string;
      inputKind: KPInput['kind'];
      playerMessage: string;
      recentExchangeSummary: string;
      diceContext?: DiceContext;
    },
  ): Promise<string> {
    if (!draft) return draft;

    const diceBlock = context.diceContext
      ? `\n检定信息：技能=${context.diceContext.skillName}，难度=${context.diceContext.difficulty}，结果=${context.diceContext.outcome}，原因=${context.diceContext.reason}\n注意：如果检定失败，KP 不应在此回复中交付该检定原本要获取的实质线索。失败可以带来错误判断、片面理解、暴露意图或局势变化，但不应给出有用的关键信息。`
      : '';

    const systemPrompt = `你是一个对话内容安全检查器，专门用于桌游守秘人（KP）输出过滤。

你的任务：检查以下 KP 回复草稿，判断是否包含玩家目前不应知晓的守密人专属信息，或存在信息过度给予。

守密人专属信息的特征：
- 幕后黑手或真正的凶手身份
- 尚未被玩家找到的隐藏地点或物品
- 剧情真相、最终 Boss 的真实形态
- 标记为 [KP ONLY] 的内容

信息过度给予的特征（同样需要修正）：
- KP 叙述中玩家"注意到"、"发现"、"意识到"关键线索，但该轮玩家并未执行对应的调查行动或检定
- NPC 在没有社交检定或充分角色扮演的情况下主动透露关键剧情信息
- 环境描写中嵌入了实质线索（超出氛围和公开可见事实的范围）
- NPC 的言行与其设定的精神状态明显不符（如疯狂 NPC 清晰解释剧情）
- 使用"你好像觉得…""你隐约感到…"等软包装偷渡实质信息
- 玩家只是随口问了一句或装傻，NPC 却热情地倾倒了大量有用信息

玩家已知线索：${discoveredClueTitles.length > 0 ? discoveredClueTitles.join('、') : '（暂无）'}

处理规则：
1. 如果草稿没有泄露守密信息且无信息过度给予，原文返回
2. 如果有泄露，改写为合理的引导性描述，保留叙事节奏但不直接说出真相
3. 如果有信息过度给予，将主动揭示改写为被动的氛围/公开事实描述，或让 NPC 表现出合理的抵抗（拒答、敷衍、回避、谈条件）
4. 只返回最终文本，不要添加任何解释

--- 本轮上下文 ---
触发原因：${context.interventionReason}
输入类型：${context.inputKind}
玩家原始输入：${context.playerMessage}
近期互动：
${context.recentExchangeSummary}${diceBlock}`;

    return new Promise<string>((resolve) => {
      let result = '';
      this.client.streamChat(
        this.guardrailModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `草稿：\n${draft}` },
        ],
        {
          onToken: (t) => { result += t; },
          onDone: () => resolve(result.trim() || draft),
          onError: () => resolve(draft), // 过滤失败时回退原文
        },
      );
    });
  }

  // ─── 摘要触发 ───────────────────────────────────────────────────────────────

  private maybeTriggerSummary(): void {
    const recent = this.state.getRecentMessages(this.summaryTriggerCount + 10);
    if (recent.length < this.summaryTriggerCount) return;

    // 取最旧的 20 条压缩，保留较新的部分原文
    const toCompress = recent.slice(0, 20);
    const ids = toCompress.map((m) => m.id);

    const conversationText = toCompress
      .map((m) => {
        const who = m.role === 'kp' ? 'KP' : (m.displayName ?? `玩家${m.userId}`);
        return `${who}：${m.content}`;
      })
      .join('\n');

    // 异步生成摘要，不阻塞当前回复
    this.generateSummary(conversationText, ids).catch((err) => {
      console.error('[KPPipeline] 摘要生成失败:', err);
    });
  }

  private async generateSummary(conversationText: string, messageIds: string[]): Promise<void> {
    const systemPrompt = `你是一个跑团记录员。请将以下对话压缩为简洁的叙事摘要（200字以内），
保留：重要事件、发现的线索、角色状态变化、剧情推进节点。
不需要保留闲聊和氛围描写细节。只输出摘要文本，不要加标题或前缀。`;

    await new Promise<void>((resolve) => {
      let summary = '';
      this.client.streamChat(
        this.guardrailModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: conversationText },
        ],
        {
          onToken: (t) => { summary += t; },
          onDone: () => {
            if (summary.trim()) {
              this.state.addSummary(summary.trim(), messageIds);
            }
            resolve();
          },
          onError: () => resolve(),
        },
      );
    });
  }

  private resolvePrivateMessages(
    directives: PrivateDirective[],
    characters: Character[],
    input: KPInput,
  ): Array<{ userId: number; text: string }> {
    const deliveries: Array<{ userId: number; text: string }> = [];
    const seen = new Set<string>();

    for (const directive of directives) {
      const text = directive.content.trim();
      if (!text) continue;
      const targets = this.resolveDirectiveTargets(directive.targets, characters, input);
      for (const userId of targets) {
        const key = `${userId}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deliveries.push({ userId, text });
      }
    }

    if (deliveries.length === 0 && directives.length > 0) {
      deliveries.push({ userId: input.userId, text: directives.map((item) => item.content.trim()).filter(Boolean).join('\n\n') });
    }

    return deliveries.filter((item) => item.text.trim().length > 0).map((item) => ({ ...item, text: item.text.trim() }));
  }

  private downgradePrivateDirectivesToPublic(
    directives: PrivateDirective[],
    characters: Character[],
    input: KPInput,
  ): string[] {
    const outputs: string[] = [];
    const seen = new Set<string>();

    for (const directive of directives) {
      const text = directive.content.trim();
      if (!text) continue;
      const labels = this.resolveDirectiveTargetLabels(directive.targets, characters, input);
      const prefix = labels.length > 0
        ? `只有${labels.join('、')}注意到：`
        : '只有相关调查员注意到：';
      const merged = `${prefix}${text}`.trim();
      if (!merged || seen.has(merged)) continue;
      seen.add(merged);
      outputs.push(merged);
    }

    return outputs;
  }

  private resolveDirectiveTargets(targets: string[], characters: Character[], input: KPInput): number[] {
    const resolved = new Set<number>();
    const normalizedTargets = targets.map((item) => normalizeTargetToken(item)).filter(Boolean);
    for (const token of normalizedTargets) {
      if (/^\d+$/.test(token)) {
        resolved.add(Number(token));
        continue;
      }

      for (const character of characters) {
        if (normalizeTargetToken(character.name) === token) {
          resolved.add(character.playerId);
        }
      }

      if (normalizeTargetToken(input.displayName) === token) {
        resolved.add(input.userId);
      }
    }

    if (resolved.size === 0) {
      resolved.add(input.userId);
    }

    return Array.from(resolved);
  }

  private resolveDirectiveTargetLabels(targets: string[], characters: Character[], input: KPInput): string[] {
    const labels = new Set<string>();
    const normalizedTargets = targets.map((item) => normalizeTargetToken(item)).filter(Boolean);

    for (const token of normalizedTargets) {
      if (/^\d+$/.test(token)) {
        const userId = Number(token);
        labels.add(this.getCharacterDisplayName(userId, characters, String(userId)));
        continue;
      }

      for (const character of characters) {
        if (normalizeTargetToken(character.name) === token) {
          labels.add(character.name);
        }
      }

      if (normalizeTargetToken(input.displayName) === token) {
        labels.add(input.displayName);
      }
    }

    if (labels.size === 0) {
      labels.add(this.getCharacterDisplayName(input.userId, characters, input.displayName));
    }

    return Array.from(labels);
  }

  private getCharacterDisplayName(userId: number, characters: Character[], fallback: string): string {
    return characters.find((character) => character.playerId === userId)?.name ?? fallback;
  }

  private applySceneDirectives(directives: SceneDirective[], channelId: string): void {
    const directive = directives[directives.length - 1];
    if (!directive) return;
    this.state.setScene(directive.scene, { channelId });
  }

  private validateClueDirectives(
    directives: ClueDirective[],
    context: { interventionReason: string; inputKind: KPInput['kind']; diceContext?: DiceContext },
  ): ClueDirective[] {
    if (directives.length === 0) return directives;

    // 检定失败时，不应触发线索发现
    if (context.diceContext) {
      const failOutcomes = ['失败', '大失败'];
      if (failOutcomes.includes(context.diceContext.outcome)) {
        console.log(`[KPPipeline] 检定失败(${context.diceContext.outcome})，拦截 ${directives.length} 条线索指令`);
        return [];
      }
    }

    // 没有成功检定上下文时，最多允许 1 条线索指令，防止 AI 在无检定时批量灌线索
    const hasSuccessfulCheck = context.diceContext
      && !['失败', '大失败'].includes(context.diceContext.outcome);
    if (!hasSuccessfulCheck && context.inputKind !== 'force_kp') {
      if (directives.length > 1) {
        console.log(`[KPPipeline] 无成功检定上下文，线索指令从 ${directives.length} 条限制为 1 条`);
        return directives.slice(0, 1);
      }
    }

    return directives;
  }

  private applyClueDirectives(directives: ClueDirective[], userId: number, channelId: string): void {
    if (directives.length === 0) return;
    const existingClues = this.state.getAllClues();
    for (const directive of directives) {
      const title = directive.title.trim();
      const playerDescription = directive.playerDescription.trim();
      if (!title || !playerDescription) continue;

      let clue = existingClues.find((item) => item.title === title);
      if (!clue) {
        const clueId = `clue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.state.addClue({
          id: clueId,
          title,
          keeperContent: playerDescription,
          playerDescription,
        });
        clue = this.state.getAllClues().find((item) => item.id === clueId);
      }

      if (clue && !clue.isDiscovered) {
        this.state.discoverClue(clue.id, userId, { channelId });
      }
    }
  }

  private applyEntityDirectives(directives: EntityDirective[], channelId: string, actorId: number): void {
    const directive = directives[0];
    if (!directive) return;
    const entity: SessionEntityOverlay = {
      id: `overlay-entity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      moduleId: null,
      source: 'session',
      type: directive.type,
      name: directive.name,
      identity: directive.identity,
      motivation: '',
      publicImage: directive.identity,
      hiddenTruth: '',
      speakingStyle: '',
      faction: '',
      dangerLevel: directive.dangerLevel,
      defaultLocation: this.state.currentScene?.name ?? '',
      attributes: {},
      skills: {},
      combat: { hp: null, armor: null, mov: null, build: null, attacks: [] },
      freeText: '',
      relationships: [],
      isKey: true,
      reviewStatus: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      channelId,
      visibility: 'public',
    };
    this.state.registerEntity(entity, { channelId, actorId });
  }

  private applyItemDirectives(directives: ItemDirective[], channelId: string, actorId: number): void {
    const directive = directives[0];
    if (!directive) return;
    const item: SessionItemOverlay = {
      id: `overlay-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      moduleId: null,
      source: 'session',
      name: directive.name,
      category: directive.category,
      publicDescription: directive.description,
      kpNotes: '',
      defaultOwner: directive.owner,
      defaultLocation: this.state.currentScene?.name ?? '',
      visibilityCondition: '',
      usage: '',
      isKey: true,
      reviewStatus: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentOwner: directive.owner,
      currentLocation: this.state.currentScene?.name ?? '',
      stateNotes: '',
      channelId,
      visibility: 'public',
    };
    this.state.registerItem(item, { channelId, actorId });
  }

  private applyItemChangeDirectives(directives: ItemChangeDirective[], channelId: string, actorId: number): void {
    for (const directive of directives) {
      this.state.applyItemChange(
        {
          itemName: directive.itemName,
          owner: directive.owner,
          location: directive.location,
          stateNotes: directive.stateNotes,
        },
        { channelId, actorId },
      );
    }
  }

  private applyPendingRollDirectives(
    text: string,
    input: Pick<KPInput, 'userId' | 'displayName'>,
    characters: Character[],
    channelId: string,
    visibility: SessionVisibility = 'public',
  ): void {
    const directives = extractPendingRollDirectives(text);
    if (directives.length === 0) return;
    const characterName = this.getCharacterDisplayName(input.userId, characters, input.displayName);
    const existing = this.state.getPendingRollsForChannel(channelId);

    for (const directive of directives) {
      const duplicate = existing.find((roll) =>
        roll.playerId === input.userId &&
        roll.skillName === directive.skillName &&
        roll.reason === directive.reason,
      );
      if (duplicate) continue;

      this.state.addPendingRoll(
        {
          playerId: input.userId,
          characterName,
          skillName: directive.skillName,
          difficulty: directive.difficulty,
          reason: directive.reason,
          requestedAt: new Date(),
          channelId,
        },
        { channelId, actorId: input.userId, visibility },
      );
    }
  }

  private applyComplianceCheck(text: string): { text: string; warnings: string[] } {
    let nextText = text;
    const warnings: string[] = [];

    const menuLineCount = countNumberedMenuLines(nextText);
    if (menuLineCount >= 3) {
      warnings.push('menu_stripped');
      nextText = stripNumberedMenuPrefixes(nextText);
    }

    if (hasDirectNumericBroadcast(nextText)) {
      warnings.push('numeric_broadcast');
    }

    if (hasPlayerAgencyOverstep(nextText)) {
      warnings.push('player_agency_overstep');
    }

    return {
      text: normalizeComplianceText(nextText),
      warnings,
    };
  }

  // ─── 工具 ────────────────────────────────────────────────────────────────────

  private getSessionCharacters(groupId: number): Character[] {
    // 优先使用房间绑定的角色卡
    if (this.roomId) {
      const roomChars = this.store.getRoomCharacters(this.roomId);
      if (roomChars.length > 0) return roomChars;
    }

    // fallback: 无房间时按群/全局活跃卡
    const playerIds = this.state.getPlayerIds();
    const result: Character[] = [];
    const seen = new Set<string>();

    for (const userId of playerIds) {
      const char = this.store.getActiveCharacter(userId, groupId);
      if (char && !seen.has(char.id)) {
        seen.add(char.id);
        result.push(char);
      }
    }

    return result;
  }

  // ─── 检定请求增强：自动附带 PC 技能/属性值 ─────────────────────────────────

  private enhanceCheckRequests(text: string, characters: Character[]): string {
    if (characters.length === 0) return text;

    const ATTR_MAP: Record<string, string> = {
      '力量': 'str', '体质': 'con', '体型': 'siz', '敏捷': 'dex',
      '外貌': 'app', '智力': 'int', '意志': 'pow', '教育': 'edu',
    };

    // 收集所有需要查值的技能/属性名
    const skillNames = new Set<string>();

    // 匹配：需要【xxx】检定
    for (const m of text.matchAll(/需要【(.+?)】检定/g)) {
      skillNames.add(m[1]);
    }
    // 匹配：.ra xxx
    for (const m of text.matchAll(/\.ra\s+(?:困难|极难)?\s*(\S+)/g)) {
      skillNames.add(m[1]);
    }
    // 匹配：.sc（SAN 检定）
    if (/\.sc\s+/.test(text)) {
      skillNames.add('理智');
    }

    if (skillNames.size === 0) return text;

    // 为每个技能构建 PC 值列表
    const appendLines: string[] = [];
    for (const skillName of skillNames) {
      const values: string[] = [];
      for (const c of characters) {
        const v = this.findCharValue(c, skillName);
        if (v !== null) {
          values.push(`${c.name} ${v}`);
        }
      }
      if (values.length > 0) {
        appendLines.push(`📊 ${skillName}：${values.join(' | ')}`);
      }
    }

    if (appendLines.length === 0) return text;
    return text + '\n\n' + appendLines.join('\n');
  }

  private findCharValue(char: Character, skillName: string): number | null {
    // 属性匹配
    const ATTR_MAP: Record<string, string> = {
      '力量': 'str', '体质': 'con', '体型': 'siz', '敏捷': 'dex',
      '外貌': 'app', '智力': 'int', '意志': 'pow', '教育': 'edu',
      '理智': '_san',
    };
    const attrKey = ATTR_MAP[skillName];
    if (attrKey === '_san') return char.derived?.san ?? null;
    if (attrKey && char.attributes?.[attrKey] !== undefined) return char.attributes[attrKey];

    const resolvedSkillKey = resolveSkillKey(skillName, Object.keys(char.skills ?? {}));
    if (resolvedSkillKey && char.skills?.[resolvedSkillKey] !== undefined) {
      return char.skills[resolvedSkillKey];
    }

    // 精确匹配 skills
    if (char.skills?.[skillName] !== undefined) return char.skills[skillName];

    // 模糊匹配 skills（如"侦查" vs "spot_hidden"对应的中文名可能不同）
    for (const [k, v] of Object.entries(char.skills ?? {})) {
      const displayName = getSkillDisplayName(k);
      if (k.includes(skillName) || skillName.includes(k) || displayName.includes(skillName) || skillName.includes(displayName)) {
        return v;
      }
    }
    return null;
  }
}

// ─── 模块级工具函数 ───────────────────────────────────────────────────────────

/**
 * 从 AI 草稿中提取 [SHOW_IMAGE:id] 标记。
 * 返回干净文本（已去除标记）和图片 ID 列表。
 */
function extractShowImageMarkers(text: string): { cleanText: string; imageIds: string[] } {
  const imageIds: string[] = [];
  const cleanText = text.replace(/\[SHOW_IMAGE:\s*([^\]]+?)\s*\]/g, (_, id: string) => {
    imageIds.push(id.trim());
    return '';
  }).trim();
  return { cleanText, imageIds };
}

/** 时间标记类型 */
interface TimeMarker {
  type: 'advance' | 'set';
  value: string; // 分钟数（advance）或 ISO 时间（set）
}

/** 从 AI 回复中提取 [TIME_ADVANCE:Xm] 和 [SET_TIME:...] 标记 */
function extractTimeMarkers(text: string): { cleanText: string; timeMarkers: TimeMarker[] } {
  const markers: TimeMarker[] = [];
  let clean = text.replace(/\[TIME_ADVANCE:\s*(\d+)m\]/g, (_, mins: string) => {
    markers.push({ type: 'advance', value: mins });
    return '';
  });
  clean = clean.replace(/\[SET_TIME:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]/g, (_, time: string) => {
    markers.push({ type: 'set', value: time });
    return '';
  });
  return { cleanText: clean.trim(), timeMarkers: markers };
}

function extractPrivateDirectives(text: string): { cleanText: string; directives: PrivateDirective[] } {
  const directives: PrivateDirective[] = [];
  const cleanText = text.replace(/\[PRIVATE_TO:\s*([^\]]+)\]([\s\S]*?)\[\/PRIVATE_TO\]/g, (_, rawTargets: string, rawContent: string) => {
    directives.push({
      targets: rawTargets.split(',').map((item) => item.trim()).filter(Boolean),
      content: rawContent.trim(),
    });
    return '';
  }).trim();
  return { cleanText, directives };
}

function extractSceneDirectives(text: string): { cleanText: string; directives: SceneDirective[] } {
  const directives: SceneDirective[] = [];
  const cleanText = text.replace(/\[SET_SCENE:\s*([^|\]]+)\|([^|\]]*)\|([^\]]*)\]/g, (_, name: string, description: string, rawNpcs: string) => {
    directives.push({
      scene: {
        name: name.trim(),
        description: description.trim(),
        activeNpcs: rawNpcs.split(',').map((item) => item.trim()).filter(Boolean),
      },
    });
    return '';
  }).trim();
  return { cleanText, directives };
}

function extractClueDirectives(text: string): { cleanText: string; directives: ClueDirective[] } {
  const directives: ClueDirective[] = [];
  const cleanText = text.replace(/\[DISCOVER_CLUE:\s*([^|\]]+)\|([^\]]+)\]/g, (_, title: string, description: string) => {
    directives.push({
      title: title.trim(),
      playerDescription: description.trim(),
    });
    return '';
  }).trim();
  return { cleanText, directives };
}

function extractEntityDirectives(text: string): { cleanText: string; directives: EntityDirective[] } {
  const directives: EntityDirective[] = [];
  const cleanText = text.replace(/\[REGISTER_ENTITY:\s*([^|\]]+)\|([^|\]]+)\|([^|\]]*)\|([^\]]*)\]/g, (_, name: string, type: string, identity: string, dangerLevel: string) => {
    directives.push({
      name: name.trim(),
      type: type.trim().toLowerCase() === 'creature' ? 'creature' : 'npc',
      identity: identity.trim(),
      dangerLevel: dangerLevel.trim(),
    });
    return '';
  }).trim();
  return { cleanText, directives: directives.slice(0, 1) };
}

function extractItemDirectives(text: string): { cleanText: string; directives: ItemDirective[] } {
  const directives: ItemDirective[] = [];
  const cleanText = text.replace(/\[REGISTER_ITEM:\s*([^|\]]+)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]/g, (_, name: string, category: string, description: string, owner: string) => {
    directives.push({
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      owner: owner.trim(),
    });
    return '';
  }).trim();
  return { cleanText, directives: directives.slice(0, 1) };
}

function extractItemChangeDirectives(text: string): { cleanText: string; directives: ItemChangeDirective[] } {
  const directives: ItemChangeDirective[] = [];
  const cleanText = text.replace(/\[ITEM_CHANGE:\s*([^|\]]+)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]/g, (_, itemName: string, owner: string, location: string, stateNotes: string) => {
    directives.push({
      itemName: itemName.trim(),
      owner: owner.trim(),
      location: location.trim(),
      stateNotes: stateNotes.trim(),
    });
    return '';
  }).trim();
  return { cleanText, directives };
}

function extractPendingRollDirectives(text: string): PendingRollDirective[] {
  const directives: PendingRollDirective[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/需要【(.+?)】检定/);
    if (!match) continue;
    const skillName = match[1].trim();
    const difficulty = line.includes('极难') ? 'extreme' : line.includes('困难') ? 'hard' : 'normal';
    const directive: PendingRollDirective = {
      skillName,
      difficulty,
      reason: compactInline(line, 120),
    };
    const key = `${directive.skillName}:${directive.difficulty}:${directive.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    directives.push(directive);
  }

  return directives;
}

function normalizeComplianceText(text: string): string {
  const normalizedLines = text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)、]\s*/g, '').trimEnd())
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''));

  return normalizedLines
    .join('\n')
    .replace(/\b(HP|MP|SAN)\s*[+\-－]\s*\d+\b/gi, '相关数值变化待结算')
    .replace(/理智\s*[+\-－]\s*\d+/g, '相关数值变化待结算')
    .trim();
}

function countNumberedMenuLines(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\s*(?:[1-4][.、)）]\s*\*?\*?|\d+\.\s+\*\*)/.test(line))
    .length;
}

function stripNumberedMenuPrefixes(text: string): string {
  return text.replace(/^\s*(?:[1-4][.、)）]\s*\*?\*?|\d+\.\s+\*\*)/gm, '');
}

function hasDirectNumericBroadcast(text: string): boolean {
  const numericPattern = /\b(?:HP|MP|SAN)\s*[+\-－]\s*\d+\b|当前\s*(?:HP|MP|SAN)\s*\d+/i;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      if (!numericPattern.test(line)) return false;
      if (/请发送\s+\.(?:ra|sc)\b/i.test(line)) return false;
      if (/需要【.+?】检定/.test(line)) return false;
      return true;
    });
}

function hasPlayerAgencyOverstep(text: string): boolean {
  return /(你决定|你选择了|你毫不犹豫|你鼓起勇气)/.test(text);
}

function normalizeTargetToken(value: string): string {
  return value.toLowerCase().replace(/[\s【】（）()：:，,]/g, '').trim();
}

function compactInline(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}
