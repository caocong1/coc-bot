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
  kind: 'player_message' | 'dice_result' | 'system_event' | 'force_kp';
  userId: number;
  /** 显示名（玩家昵称或角色名） */
  displayName: string;
  content: string;
  /** 骰子结果时附带：发起检定的玩家 userId */
  diceRollerId?: number;
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
  /** 数据库实例（用于加载自定义模板） */
  db?: import('bun:sqlite').Database;
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

const KP_MODEL = 'qwen3.5-plus';
const GUARDRAIL_MODEL = 'qwen3.5-flash'; // 过滤用轻量模型即可

export class KPPipeline {
  private readonly client: DashScopeClient;
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
    this.templateRegistry = new KPTemplateRegistry(options.db);
    this.templateId = options.templateId ?? 'classic';
    this.customPrompts = options.customPrompts ?? '';
    this.silenceThreshold = options.silenceThreshold ?? 5;
    this.enableGuardrail = options.enableGuardrail ?? true;
    this.summaryTriggerCount = options.summaryTriggerCount ?? 40;
  }

  async process(input: KPInput, onThinking?: () => void): Promise<KPOutput> {
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
    const snapshot = this.state.snapshot();
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
      },
    );

    // 6. 生成草稿
    const t0 = Date.now();
    console.log(`[KPPipeline] 调用 AI 草稿生成 (model=${KP_MODEL}, reason=${intervention.reason})...`);
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

    // 7.5 提取 [TIME_ADVANCE:Xm] 和 [SET_TIME:...] 标记
    const { cleanText: draftClean, timeMarkers } = extractTimeMarkers(draftNoImg);

    // 8. 守密人过滤（仅过滤文字部分）
    const t1 = Date.now();
    if (this.enableGuardrail) console.log(`[KPPipeline] 调用守密人过滤 (model=${GUARDRAIL_MODEL})...`);
    const filteredText = this.enableGuardrail
      ? await this.applyGuardrail(draftClean, snapshot.discoveredClues.map((c) => c.title))
      : draftClean;
    if (this.enableGuardrail) console.log(`[KPPipeline] 过滤完成: ${filteredText.length}字, 耗时${Date.now() - t1}ms`);

    // 9. 解析图片 ID → 实际路径（仅 playerVisible=true 的图片）
    const images: KPImage[] = [];
    for (const imgId of imageIds) {
      const img = this.state.resolveImage(imgId);
      if (img && img.playerVisible) {
        images.push({ id: img.id, absPath: img.absPath, caption: img.caption });
      }
    }

    const finalText = this.enhanceCheckRequests(filteredText, characters);

    // 10. 写入 KP 回复到历史
    const kpMsgId = `kp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.state.addMessage({
      id: kpMsgId,
      role: 'kp',
      content: finalText,
      timestamp: new Date(),
    });

    // 10.5 应用时间标记到会话状态
    for (const marker of timeMarkers) {
      if (marker.type === 'advance') {
        const mins = parseInt(marker.value, 10);
        if (mins > 0 && mins <= 1440) {
          this.state.advanceIngameTime(mins, `推进 ${mins} 分钟`, 'ai', kpMsgId);
        }
      } else if (marker.type === 'set') {
        this.state.setIngameTime(marker.value, '设定时间', 'ai', kpMsgId);
      }
    }

    // 11. 检查是否需要触发摘要压缩
    this.maybeTriggerSummary();

    return {
      shouldRespond: true,
      text: finalText,
      images: images.length > 0 ? images : undefined,
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
    if (this.state.pendingRolls.length > 0 &&
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
      console.error('[KPPipeline] AI 意图分类失败，降级为介入:', err);
      // 分类失败 → 保守策略：介入（宁可多回复也别漏）
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
      'qwen3.5-flash',
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
          KP_MODEL,
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

    // 精确匹配 skills
    if (char.skills?.[skillName] !== undefined) return char.skills[skillName];

    // 模糊匹配 skills（如"侦查" vs "spot_hidden"对应的中文名可能不同）
    for (const [k, v] of Object.entries(char.skills ?? {})) {
      if (k.includes(skillName) || skillName.includes(k)) return v;
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
  const cleanText = text.replace(/\[SHOW_IMAGE:([^\]]+)\]/g, (_, id: string) => {
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
  let clean = text.replace(/\[TIME_ADVANCE:(\d+)m\]/g, (_, mins: string) => {
    markers.push({ type: 'advance', value: mins });
    return '';
  });
  clean = clean.replace(/\[SET_TIME:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]/g, (_, time: string) => {
    markers.push({ type: 'set', value: time });
    return '';
  });
  return { cleanText: clean.trim(), timeMarkers: markers };
}
