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

import { DashScopeClient } from '../client/DashScopeClient';
import { ContextBuilder } from '../context/ContextBuilder';
import { KPTemplateRegistry } from '../config/KPTemplateRegistry';
import { KnowledgeService, type KnowledgeCategory } from '../../knowledge/retrieval/KnowledgeService';
import { SessionState, type PendingRoll } from '../../runtime/SessionState';
import { CharacterStore } from '../../commands/sheet/CharacterStore';
import type { Character } from '@shared/types/Character';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

/** 进入流水线的输入 */
export interface KPInput {
  /** 消息来源类型 */
  kind: 'player_message' | 'dice_result' | 'system_event';
  userId: number;
  /** 显示名（玩家昵称或角色名） */
  displayName: string;
  content: string;
  /** 骰子结果时附带：发起检定的玩家 userId */
  diceRollerId?: number;
}

/** 流水线输出 */
export interface KPOutput {
  /** 是否需要发送回复（false = KP 选择沉默） */
  shouldRespond: boolean;
  /** 最终发送到群聊的文本 */
  text: string;
  /** 调试信息 */
  debug?: {
    interventionReason: string;
    layerStats: Record<string, number>;
    draftLength: number;
    filteredLength: number;
  };
}

export interface KPPipelineOptions {
  /** KP 人格模板 ID，默认 'serious' */
  templateId?: string;
  /** 沉默阈值：连续几条玩家互 RP 消息后，KP 最多插一句氛围 */
  silenceThreshold?: number;
  /** 是否启用守密人输出过滤（默认 true） */
  enableGuardrail?: boolean;
  /** 触发摘要压缩的消息条数阈值（默认 40） */
  summaryTriggerCount?: number;
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

const KP_MODEL = 'qwen3.5-plus';
const GUARDRAIL_MODEL = 'qwen-plus'; // 过滤用轻量模型即可

export class KPPipeline {
  private readonly client: DashScopeClient;
  private readonly contextBuilder = new ContextBuilder();
  private readonly templateRegistry = new KPTemplateRegistry();
  private readonly knowledge: KnowledgeService;
  private readonly state: SessionState;
  private readonly store: CharacterStore;

  private readonly templateId: string;
  private readonly silenceThreshold: number;
  private readonly enableGuardrail: boolean;
  private readonly summaryTriggerCount: number;

  /** 连续未介入的消息计数（用于沉默阈值判断） */
  private silentCount = 0;

  constructor(
    client: DashScopeClient,
    state: SessionState,
    store: CharacterStore,
    knowledge: KnowledgeService,
    options: KPPipelineOptions = {},
  ) {
    this.client = client;
    this.state = state;
    this.store = store;
    this.knowledge = knowledge;
    this.templateId = options.templateId ?? 'serious';
    this.silenceThreshold = options.silenceThreshold ?? 5;
    this.enableGuardrail = options.enableGuardrail ?? true;
    this.summaryTriggerCount = options.summaryTriggerCount ?? 40;
  }

  async process(input: KPInput): Promise<KPOutput> {
    // 1. 将输入消息写入历史
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.state.addMessage({
      id: msgId,
      role: input.kind === 'dice_result' ? 'dice' : 'player',
      userId: input.userId,
      displayName: input.displayName,
      content: input.content,
      timestamp: new Date(),
    });

    // 骰子结果：清除对应玩家的等待投骰状态
    if (input.kind === 'dice_result' && input.diceRollerId !== undefined) {
      this.state.clearPendingRoll(input.diceRollerId);
    }

    // 2. 判断是否介入
    const intervention = this.decideIntervention(input);
    if (!intervention.shouldIntervene) {
      this.silentCount += 1;
      return { shouldRespond: false, text: '', debug: { interventionReason: intervention.reason, layerStats: {}, draftLength: 0, filteredLength: 0 } };
    }
    this.silentCount = 0;

    // 3. 并行 RAG 检索
    const query = input.content.slice(0, 200); // 检索用前200字够了
    const [ruleChunks, scenarioChunks] = await Promise.all([
      this.knowledge.retrieve(query, ['rules'], { limitPerCategory: 4 })
        .catch(() => []),
      this.knowledge.retrieve(query, ['scenario', 'keeper_secret'], { limitPerCategory: 4 })
        .catch(() => []),
    ]);

    // 4. 获取玩家角色卡
    const snapshot = this.state.snapshot();
    const characters = this.getSessionCharacters(snapshot.groupId);

    // 5. 组装上下文
    const template = this.templateRegistry.get(this.templateId)
      ?? this.templateRegistry.get('serious')!;

    // 模组全文（优先）/ RAG 降级
    const scenarioFullText = this.state.getScenarioText() ?? undefined;
    const scenarioLabel = this.state.getScenarioLabel() ?? undefined;
    const sceneSegments = this.state.getSegments();
    const currentSegmentId = this.state.getCurrentSegmentId() ?? undefined;

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
      },
    );

    // 6. 生成草稿
    const draft = await this.generateDraft(systemPrompt, messages, intervention.reason);
    if (!draft) {
      return { shouldRespond: false, text: '', debug: { interventionReason: intervention.reason, layerStats, draftLength: 0, filteredLength: 0 } };
    }

    // 7. 守密人过滤
    const finalText = this.enableGuardrail
      ? await this.applyGuardrail(draft, snapshot.discoveredClues.map((c) => c.title))
      : draft;

    // 8. 写入 KP 回复到历史
    const kpMsgId = `kp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.state.addMessage({
      id: kpMsgId,
      role: 'kp',
      content: finalText,
      timestamp: new Date(),
    });

    // 9. 检查是否需要触发摘要压缩
    this.maybeTriggerSummary();

    return {
      shouldRespond: true,
      text: finalText,
      debug: {
        interventionReason: intervention.reason,
        layerStats,
        draftLength: draft.length,
        filteredLength: finalText.length,
      },
    };
  }

  // ─── 介入判断 ───────────────────────────────────────────────────────────────

  private decideIntervention(
    input: KPInput,
  ): { shouldIntervene: boolean; reason: string } {
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

    // 有等待骰子 且 当前消息看起来是投骰后行动（只是保险，实际骰子结果走 dice_result）
    if (this.state.pendingRolls.length > 0 &&
        /^[\d]+$/.test(text.replace(/\s/g, ''))) {
      return { shouldIntervene: true, reason: 'pending_roll_response' };
    }

    // 包含明确行动动词 → 可能需要检定
    const actionKeywords = [
      '我想', '我要', '我试', '我尝试', '我去', '我检查', '我搜', '我查',
      '我攻击', '我射击', '我躲', '我跑', '我撬', '我问', '我说', '我对',
    ];
    if (actionKeywords.some((kw) => text.includes(kw))) {
      return { shouldIntervene: true, reason: 'player_action' };
    }

    // 玩家在对 NPC 说话（用引号/书名号包裹对话，或直接说"对XXX说"）
    if (/对.{1,10}说/.test(text) || /"[^"]{1,50}"/.test(text) || /「[^」]{1,50}」/.test(text)) {
      return { shouldIntervene: true, reason: 'npc_dialogue' };
    }

    // 超过沉默阈值 → 插入氛围描写
    if (this.silentCount >= this.silenceThreshold) {
      return { shouldIntervene: true, reason: 'atmosphere_nudge' };
    }

    // 纯玩家互 RP → 沉默观察
    return { shouldIntervene: false, reason: 'player_rp_watching' };
  }

  // ─── 草稿生成 ───────────────────────────────────────────────────────────────

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

    return new Promise<string>((resolve, reject) => {
      let buffer = '';
      this.client.streamChat(
        KP_MODEL,
        [{ role: 'system', content: systemPrompt }, ...finalMessages],
        {
          onToken: (token) => { buffer += token; },
          onDone: () => resolve(buffer.trim()),
          onError: (err) => {
            console.error('[KPPipeline] 草稿生成失败:', err);
            resolve(''); // 失败静默，不让整个流水线崩
          },
        },
      );
    });
  }

  // ─── 守密人过滤 ─────────────────────────────────────────────────────────────

  private async applyGuardrail(draft: string, discoveredClueTitles: string[]): Promise<string> {
    if (!draft) return draft;

    const systemPrompt = `你是一个对话内容安全检查器，专门用于桌游守秘人（KP）输出过滤。

你的任务：检查以下 KP 回复草稿，判断是否包含玩家目前不应知晓的守密人专属信息。

守密人专属信息的特征：
- 幕后黑手或真正的凶手身份
- 尚未被玩家找到的隐藏地点或物品
- 剧情真相、最终 Boss 的真实形态
- 标记为 [KP ONLY] 的内容

玩家已知线索：${discoveredClueTitles.length > 0 ? discoveredClueTitles.join('、') : '（暂无）'}

处理规则：
1. 如果草稿没有泄露守密信息，原文返回
2. 如果有泄露，改写为合理的引导性描述，保留叙事节奏但不直接说出真相
3. 只返回最终文本，不要添加任何解释`;

    return new Promise<string>((resolve) => {
      let result = '';
      this.client.streamChat(
        GUARDRAIL_MODEL,
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
        GUARDRAIL_MODEL,
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

  // ─── 工具 ────────────────────────────────────────────────────────────────────

  private getSessionCharacters(groupId: number): Character[] {
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
}
