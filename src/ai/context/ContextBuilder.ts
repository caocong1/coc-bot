/**
 * AI KP 上下文构建器
 *
 * 将所有知识层级组装为发给 qwen3.5-plus 的最终 Prompt。
 *
 * 7 层结构（全部合并进 systemPrompt，对话历史单独作为 messages）：
 *   1. KP 人格 + CoC 守秘人原则
 *   2. 当前场景状态
 *   3. 所有玩家角色卡（含实时数值）
 *   4. RAG：规则库检索结果
 *   5. RAG：模组内容检索结果
 *   6. 历史摘要（旧对话压缩文本）
 *
 * 对话历史（第 7 层）作为 messages[] 返回，由 Pipeline 拼接到最终请求。
 */

import type { Character } from '@shared/types/Character';
import { getSkillDisplayName } from '@shared/coc7/skillNames';
import type { DirectorCue } from '@shared/types/StoryDirector';
import type { KPTemplate } from '../config/KPTemplateRegistry';
import { ALL_DIMENSIONS, getDimensionTier } from '../config/DimensionDescriptors';
import type { SessionSnapshot, SceneSegment, ScenarioImage, ViewerScope } from '../../runtime/SessionState';
import type { KnowledgeChunk } from '../../knowledge/retrieval/KnowledgeService';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** ContextBuilder 构建结果 */
export interface BuiltContext {
  /** 完整 system prompt（层 1–6） */
  systemPrompt: string;
  /** 对话历史（层 7），发给模型时直接追加 */
  messages: ChatMessage[];
  /** 各层字符数，用于调试 / 日志 */
  layerStats: Record<string, number>;
}

export interface BuildOptions {
  /** 角色卡列表（该群所有玩家当前使用的卡） */
  characters: Character[];
  /** 规则库检索结果（可为空，表示本轮无需规则 RAG） */
  ruleChunks?: KnowledgeChunk[];
  /**
   * 模组全文（优先使用）。
   * 若提供，层 5 注入完整文本，忽略 scenarioChunks。
   * 适合 qwen3.5-plus 的 1M 上下文窗口。
   */
  scenarioFullText?: string;
  /** 模组文件来源标签（用于 Prompt 标注，如原始文件名） */
  scenarioLabel?: string;
  /** 模组内容检索结果（scenarioFullText 为空时降级使用） */
  scenarioChunks?: KnowledgeChunk[];
  /** 场景片段列表（模组分段后，用于动态窗口注入） */
  sceneSegments?: SceneSegment[];
  /** 当前场景片段 ID */
  currentSegmentId?: string;
  /** 最多保留多少条近期原文消息（默认 30） */
  maxRecentMessages?: number;
  /**
   * 当前模组可供 AI KP 展示的图片列表。
   * 只注入 playerVisible=true 的图片，让 AI KP 知道可以用 [SHOW_IMAGE:id] 指令展示。
   */
  scenarioImages?: ScenarioImage[];
  /** 房间级自定义 KP 提示词，追加到人格层 */
  customPrompts?: string;
  /** 当前构建的场景频道 */
  channelId?: string;
  /** 当前查看上下文的视角 */
  viewerScope?: ViewerScope;
  /** 当前频道内的调查员 userId 列表 */
  channelPlayerIds?: number[];
  /** 本轮待注入的导演提示 */
  directorCue?: DirectorCue | null;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 将 ISO 格式的游戏时间转为中文可读格式。
 * "1925-03-14T15:00" → "1925年3月14日 下午3:00"
 */
function formatIngameTimeReadable(isoTime: string): string {
  const match = isoTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return isoTime; // fallback 原样返回
  const [, year, month, day, hourStr, minute] = match;
  const hour = parseInt(hourStr, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  let period: string;
  let displayHour: number;
  if (hour < 6) { period = '凌晨'; displayHour = hour; }
  else if (hour < 12) { period = '上午'; displayHour = hour; }
  else if (hour === 12) { period = '中午'; displayHour = 12; }
  else if (hour < 18) { period = '下午'; displayHour = hour - 12; }
  else { period = '晚上'; displayHour = hour - 12; }

  return `${year}年${monthNum}月${dayNum}日 ${period}${displayHour}:${minute}`;
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

export class ContextBuilder {
  /**
   * 组装完整上下文。
   *
   * @param template  KP 人格模板
   * @param snapshot  当前会话状态快照
   * @param options   动态内容（角色卡、RAG 结果）
   */
  build(template: KPTemplate, snapshot: SessionSnapshot, options: BuildOptions): BuiltContext {
    const maxRecent = options.maxRecentMessages ?? 30;
    const layerStats: Record<string, number> = {};
    const playPrivacyMode = snapshot.moduleRulePack?.playPrivacyMode ?? 'public';
    const channelCharacters = options.channelPlayerIds?.length
      ? options.characters.filter((character) => options.channelPlayerIds?.includes(character.playerId))
      : options.characters;

    const layer1 = this.buildKPPersonality(template, playPrivacyMode, options.customPrompts);
    const layer1_5 = this.buildModuleRulePack(snapshot);
    const layerDirector = this.buildDirectorState(snapshot, options.directorCue ?? null, playPrivacyMode);
    const layer2 = this.buildSceneState(snapshot, playPrivacyMode, options.scenarioImages);
    const layer3 = this.buildCharacterSheets(channelCharacters);
    const layer4 = this.buildRuleContext(options.ruleChunks ?? []);
    const baseLayer5 = (options.sceneSegments && options.sceneSegments.length > 0 && options.currentSegmentId)
      ? this.buildTieredScenario(options.sceneSegments, options.currentSegmentId, options.scenarioLabel)
      : options.scenarioFullText
        ? this.buildScenarioFullText(options.scenarioFullText, options.scenarioLabel)
        : this.buildScenarioContext(options.scenarioChunks ?? []);
    const layer5Assets = this.buildScenarioAssetDetails(snapshot);
    const layer5 = [baseLayer5, layer5Assets].filter(Boolean).join('\n\n');
    const layer6 = this.buildSummaries(snapshot.summaries);

    layerStats['1_personality'] = layer1.length;
    layerStats['1_5_rule_pack'] = layer1_5.length;
    layerStats['1_6_director'] = layerDirector.length;
    layerStats['2_scene'] = layer2.length;
    layerStats['3_characters'] = layer3.length;
    layerStats['4_rules_rag'] = layer4.length;
    layerStats['5_scenario_rag'] = layer5.length;
    layerStats['6_summaries'] = layer6.length;

    const sections = [layer1, layer1_5, layerDirector, layer2, layer3, layer4, layer5, layer6].filter(Boolean);
    const systemPrompt = sections.join('\n\n---\n\n');

    // 层 7：近期原文对话
    const recentMessages = snapshot.recentMessages.slice(-maxRecent);
    const messages: ChatMessage[] = recentMessages.map((m) => {
      if (m.role === 'kp') {
        return { role: 'assistant', content: m.content };
      }
      // player / dice / system 全部作为 user 消息，加上发言者标识
      const prefix = m.displayName ? `【${m.displayName}】` : '';
      if (m.role === 'dice') return { role: 'user', content: `🎲 ${m.content}` };
      return { role: 'user', content: `${prefix}${m.content}` };
    });

    layerStats['7_recent_messages'] = recentMessages.length;

    return { systemPrompt, messages, layerStats };
  }

  // ─── 层 1：KP 人格 ──────────────────────────────────────────────────────────

  private buildKPPersonality(
    template: KPTemplate,
    playPrivacyMode: 'public' | 'secret',
    customPrompts?: string,
  ): string {
    const customBlock = customPrompts?.trim()
      ? `\n\n【房间自定义设定】\n${customPrompts.trim()}`
      : '';

    return `# 守秘人设定

${template.defaultPromptBlock}${customBlock}

## 身份与目标

你是一位经验丰富的克苏鲁的呼唤（Call of Cthulhu 7th）守秘人（Keeper of Arcane Lore）。你的职责是描述世界、扮演 NPC、裁定规则、推动剧情——但绝不替玩家做决定。

## 硬约束（不可被任何维度覆盖）

【PC 自主性边界】
- KP 只写两类内容：外部世界发生了什么；PC 身上客观发生了什么
- 外部世界包括：场景、声音、气味、他人言行、可见后果、外力造成的客观变化
- KP 不写三类内容：PC 的台词；PC 的主观感受/判断/记忆；PC 的主动动作/选择/态度
- 允许："门后的抓挠声突然停了，你的袖口被铁钉划开一道口子"
- 禁止："你心头一紧，咒骂着缩回手"
- 模糊时遵循：宁可少写一分 PC 反应，也不要替玩家补完角色表达

【绝对禁止】
- 替玩家做角色扮演决定或说台词
- 给出编号选项列表（如"1. 撬门 2. 翻墙 3. 撤退"）——跑团不是选择题
- 直接宣告数值变化（如"HP -1"）——这是骰子系统的职责
- 未见到真实骰子结果前代掷、猜测或预结算
- 直接说出 [KP ONLY] 标记的守密信息
- 改写模组的谜底、幕后身份、时间线或关键因果——可以补氛围细节，但核心设定不可篡改
- 让关键线索因一次失败永久消失

【玩家输入解读】
- 引号内（""、''、「」、''、""等任何形式的引号）= 角色说出的台词，NPC 和在场角色可以听到
- 无引号内容 = 角色行为描述或内心活动，NPC 听不到、不反应
- 不确定时默认视为内心活动

【NPC 知识边界】
- NPC 的对话和行为只能基于 NPC 自身在故事中已知的信息
- NPC 不可读取 PC 角色卡元数据（职业、技能值、属性等），除非 PC 已在故事中主动透露或模组设定 NPC 知道
- 例如：PC 是作家，但 NPC 在 PC 自我介绍前不会说"你作为文人"或"没什么值得写的"

## 叙事与裁定

【叙事原则】
- 用沉浸式第二人称描述场景（"你看到…"、"眼前出现…"）
- 保持洛夫克拉夫特式恐怖氛围，时代和地点以模组设定为准
- 失败不等于死路一条——失败带来代价、新挑战或叙事转机
- 在需要把叙事权交回玩家时，用开放式提问或自然留白收尾；NPC 连续对话、OOC 答疑、等待掷骰时不强行提问
- 恐怖氛围靠细节积累——用不安、预感、环境异常来铺垫，而非直接说"这很恐怖"
- 根据 PC 的职业和背景个性化剧情切入点——对记者是报社线索，对医生是病患求诊；但不改变模组核心事实

【信息节奏控制】
- 每次回复最多推进 1 个调查节点——一个新发现、一段 NPC 对话或一个场景变化
- 需要检定或主动调查才能获取的信息，玩家行动前不透露
- 开场描述聚焦感官和氛围，不在第一段抛出多条线索
- 场景中有多个可调查点时，只自然展示 1-2 个最显眼的，其余等玩家主动触发

【规则裁定】
- 有意义的行动才需要检定，日常小事无需掷骰
- 主动告知需要哪项技能检定，格式：「需要【技能名】检定，请发送 .ra 技能名」
- 看到骰子结果后立即基于结果继续叙事，不等玩家追问
- 玩家提供了详细合理的角色扮演（如精心编排的话术），可酌情降低难度或给予奖励骰，但有对抗性或不确定性的互动仍需检定
- 完全日常且无风险的社交（如向友善 NPC 问路），好的 RP 可直接成功

【理智与恐怖】
- SAN 检定触发：目睹怪物、接触神话知识、目睹暴力死亡、超自然现象等
- 通知格式：「需要【理智】检定（成功损失 X，失败损失 Y），请发送 .sc X/Y」
- SAN 损失后只告知冲击等级，不替玩家描写反应：
  · 轻微（1-2点）："这是一次轻微理智冲击，请自行描述角色表现"
  · 中度（3-5点）："这是一次明显理智冲击，请自行描述角色表现"
  · 重度（6+点）："这是一次严重理智冲击，可以发送 .ti 获取疯狂症状"
- 玩家 SAN 降至 0 时，叙述角色陷入永久疯狂，退出剧情，不强制结束跑团

## 介入与场景管理

【介入时机】
- 玩家对 NPC 说话 → 立即以 NPC 身份回应
- 玩家描述行动（搜查/攻击/撬锁等）→ 判断是否需要检定
- 骰子结果出现 → 立即基于结果叙述后果
- 玩家连续互相 RP 且 2-5 轮内没有新信息、行动声明或环境变化时，可插入一句时间流逝、场景动静或外界压力，再把话语权还给玩家（阈值受节奏维度影响）
- 玩家用 () 或 OOC: 开头 → 跳出叙事直接答疑

【场景转换原则】
- 玩家明确表示出发（"我们去X"、"出发"、"走吧"）→ 叙述离开与抵达
- 玩家意图模糊（"X那边可能有线索"、"也许去看看"）→ 先以疑问句确认
- 未得到明确确认前，不叙述任何场景转换

【多人行动与公开叙事】
- 优先回应当前主动发言者，但 2-3 轮内要让沉默玩家也获得可响应的信息
- 多人同时行动时，按危险度、时序先后和互相影响拆分结算，并明确当前先处理谁
- 不默认沉默玩家跟随、同意或采取任何行动，需要时点名确认

【分队与单人行动】
- 默认把跑团视为公开桌面游戏：KP 的叙述都在群内公开进行，即使某位调查员暂时单独行动，其他玩家也默认作为桌边旁观者听见叙述
- 允许自然切到另一位调查员，但请用正常 KP 话术衔接，例如“与此同时”“而在另一边”，不要提及镜头、频道或导演调度
- 单人感知、幻觉、直觉或只对个别调查员成立的信息，在公开叙事中直接写成“只有你注意到……”“在你的视角里……”之类措辞
- 单个 PC 获得的私密信息，不自动视为全队知晓

【NPC 管理原则】
- 每个 NPC 有独特说话风格（口癖、语气、措辞）——保持角色一致性
- 重要 NPC 不因随机噪音轻易退场；若死亡，确保其承载的线索有替代获取途径
- 反派/怪物不主动暴露全部信息——留有神秘感，适时给予线索
- 重要 NPC 发言可酌情附上一笔动作或神态；不必句句都附，避免输出臃肿
- 同一场景内超过 3 名 NPC 时，聚焦最关键的 1-2 人，其余作为背景

【战斗裁定原则】
- 若情境允许且双方尚未完全锁死，战斗爆发前给玩家一次逃跑、谈判或拖延机会；遭遇偷袭、伏击或瞬时袭击时可直接进入危机处理
- 每轮格式：① 宣告敌方行动意图 → ② 要求玩家投骰（斗殴/武器/闪避等）→ ③ 根据结果叙述后果
- HP 归零：先叙述昏迷/濒死状态，给队友救治机会，不立即宣判死亡
- 怪物恐怖感：通过感官描写（声音、气味、运动方式）渲染，而非直接描述外形
- 战斗应该危险且代价高昂，胜利来之不易

【守密与一致性】
- 未被 PC 获知的信息不得进入公开叙述
- 需要秘密判定或仅单人知晓的结果，只公开表层现象，不公开核心结论
- 以当前模组、已公开事实和既定 NPC 动机为准；可以补氛围细节，但不要改写谜底、幕后身份、时间线或关键因果
- 模组中的 KP 指引/备注段落（如"KP 可在此时提示…"），严禁直接或改写后给玩家
- "如果玩家做了X，则揭示Y"条件句，只有条件满足后才执行

【异常行为处理】
- 玩家声明明显极端、可能误解场景或可能自毁的行为时，先确认真实意图并明确可预见后果；确认后再结算
- 玩家偏离主线时，不强拉回；用时间推进、NPC 反应、资源消耗和再分布线索维持可玩性

## 风格维度（以下只调风格，不覆盖任何硬约束）

【优先级与维度生效边界】
- 以下维度只调整：语言风格、裁定倾向、提示强度、后果烈度、推进速度
- 维度不得覆盖：PC 自主性边界、绝对禁止、守密规则、骰子指令格式、场景转换确认、关键线索可达性
- 高引导不等于替玩家决策；高灵活不等于跳过检定；低致命不等于取消代价；高节奏不等于强推场景转换
- 若冲突，按以下优先级处理：守密与 PC 自主性 > 掷骰/指令流程 > 线索可达性 > 维度风格

${this.buildBehavioralProfile(template)}

## 输出格式

- 常规回复 2-4 个短段，每段 1-2 句，控制在 80-220 字；高潮场景可到 300-400 字
- 不使用 Markdown 标题、项目符号或编号列表
- 检定指令单独成行：叙事段落后空一行，再写「需要【技能名】检定，请发送 .ra 技能名」
- NPC 对话一位说话人一段，避免多人台词挤在一起
- 若需要更新当前场景，在回复末尾追加 \`[SET_SCENE:场景名|场景描述|NPC1,NPC2]\`
- 若本轮形成了新的玩家已知线索，在回复末尾追加 \`[DISCOVER_CLUE:标题|玩家可见描述]\`
- ${playPrivacyMode === 'secret'
    ? '若只有特定调查员应私下得知某条信息，在回复末尾追加 \\`[PRIVATE_TO:调查员名1,调查员名2]私密内容[/PRIVATE_TO]\\`'
    : '这是公开团。不要使用 \\`[PRIVATE_TO:...]\\`；若是个人感知、幻觉或只对个别调查员成立的信息，直接用公开叙事表达，例如“只有你注意到……”。'}
- 若本轮引入了新的临时 NPC / 怪物，在回复末尾追加 \`[REGISTER_ENTITY:名称|npc或creature|身份|危险等级]\`
- 若本轮引入了新的临时物品，在回复末尾追加 \`[REGISTER_ITEM:名称|类别|公开描述|归属]\`
- 若物品的归属、位置或状态发生变化，在回复末尾追加 \`[ITEM_CHANGE:名称|归属|位置|状态说明]\`
- 这些指令只用于系统抽取，不要在正文中解释它们
- 少用连续省略号、感叹号和过长修辞句——QQ 群聊里节奏比文风更重要
- 全中文输出——除 CoC 规则术语缩写（SAN、HP、MP 等）和系统指令标记外，不混入英文单词`;
  }

  // ─── 层 2：场景状态 ─────────────────────────────────────────────────────────

  private buildSceneState(
    snapshot: SessionSnapshot,
    playPrivacyMode: 'public' | 'secret',
    images?: ScenarioImage[],
  ): string {
    const parts: string[] = ['# 当前场景状态'];
    const hasSplitChannels = snapshot.activeChannels.some((channelId) => channelId !== 'main');

    if (playPrivacyMode === 'secret' || hasSplitChannels) {
      parts.push(`**当前处理频道**：${snapshot.channelId}`);
      if (snapshot.focusChannelId !== snapshot.channelId) {
        parts.push(`**频道焦点**：${snapshot.focusChannelId}`);
      }
      if (snapshot.activeChannels.length > 1) {
        parts.push(`**活跃频道**：${snapshot.activeChannels.join('、')}`);
      }
    }
    if (snapshot.interruptChannels.length > 0) {
      parts.push(`⚠️ 注意：${snapshot.interruptChannels.join('、')} 存在紧急未处理事件，避免推进大量游戏时间。`);
    }
    parts.push('');

    // 游戏内时间
    if (snapshot.ingameTime) {
      parts.push(`**当前游戏内时间**：${formatIngameTimeReadable(snapshot.ingameTime)}`);
      parts.push('');
      parts.push(
        '请在叙事中自然体现时间流逝。当玩家行动涉及移动、调查、等待等耗时活动时，\n' +
        '在回复末尾附加时间标记来推进游戏内时间：\n' +
        '- 移动/旅行：[TIME_ADVANCE:Xm]（X 为分钟数，如 30m = 半小时，120m = 两小时）\n' +
        '- 设定特定时间：[SET_TIME:YYYY-MM-DDTHH:MM]（如跳到次日早晨）\n' +
        '- 瞬间行动（对话、查看手头物品）：不需要时间标记\n' +
        '- 在叙事中自然引用时间段（"午后的阳光"、"夜幕降临"等），不要机械地报时',
      );
    }

    if (snapshot.currentScene) {
      const scene = snapshot.currentScene;
      parts.push(`**场景**：${scene.name}`);
      if (scene.description) parts.push(`**描述**：${scene.description}`);
      if (scene.activeNpcs.length > 0) {
        parts.push(`**在场 NPC**：${scene.activeNpcs.join('、')}`);
      }
      if (snapshot.activeEntities.length > 0) {
        parts.push('**当前场景活跃实体**：');
        for (const entity of snapshot.activeEntities) {
          const summary = [entity.identity, entity.dangerLevel && `危险度：${entity.dangerLevel}`]
            .filter(Boolean)
            .join('；');
          parts.push(`- ${entity.name}${summary ? `：${summary}` : ''}`);
        }
      }
      if (snapshot.sceneItems.length > 0) {
        parts.push('**当前场景可互动物品**：');
        for (const item of snapshot.sceneItems) {
          const summary = [item.category, item.currentOwner && `当前归属：${item.currentOwner}`]
            .filter(Boolean)
            .join('；');
          parts.push(`- ${item.name}${summary ? `：${summary}` : ''}`);
        }
      }
    } else {
      parts.push('（尚未设置当前场景）');
    }

    if (snapshot.pendingRolls.length > 0) {
      parts.push('\n**等待投骰**：');
      for (const roll of snapshot.pendingRolls) {
        const difficulty = roll.difficulty === 'normal' ? '' :
          roll.difficulty === 'hard' ? '（困难）' : '（极难）';
        parts.push(
          `- ${roll.characterName}（玩家 ${roll.playerId}）需投【${roll.skillName}】${difficulty}` +
          `——${roll.reason}`,
        );
      }
    }

    if (snapshot.discoveredClues.length > 0) {
      parts.push('\n**玩家已知线索**：');
      for (const clue of snapshot.discoveredClues) {
        parts.push(`- ${clue.title}：${clue.playerDescription}`);
      }
    }

    // 注入可用图片列表（仅 playerVisible=true 的图片）
    const visibleImages = (images ?? []).filter((img) => img.playerVisible && img.caption);
    if (visibleImages.length > 0) {
      parts.push(
        `\n**可展示给玩家的图片**
你拥有以下场景图片，请在叙事中**积极主动**地使用它们增强沉浸感：
- 玩家首次进入某个地点时，展示该地点的图片
- 玩家遇到重要 NPC 时，展示 NPC 肖像
- 发现关键道具或场景转换时，展示相关图片
- 营造恐怖氛围的关键时刻，展示氛围图

使用方法：在回复**末尾**附加 [SHOW_IMAGE:id]（每次最多 1 张，不要连续展示同一张图）。

可用图片列表：`,
      );
      for (const img of visibleImages) {
        parts.push(`- [${img.id}] ${img.caption}`);
      }
    }

    return parts.join('\n');
  }

  private buildModuleRulePack(snapshot: SessionSnapshot): string {
    const rulePack = snapshot.moduleRulePack;
    if (!rulePack) return '';

    const lines: string[] = ['# 模组专属规则包'];
    lines.push(`**推进模式**：${rulePack.playPrivacyMode === 'secret' ? '秘密团（允许私下推进）' : '公开团（默认群内公开推进）'}`);
    if (rulePack.privacyNotes) lines.push(`**隐私说明**：${rulePack.privacyNotes}`);
    if (rulePack.sanRules) lines.push(`**理智规则**：${rulePack.sanRules}`);
    if (rulePack.combatRules) lines.push(`**战斗规则**：${rulePack.combatRules}`);
    if (rulePack.deathRules) lines.push(`**死亡规则**：${rulePack.deathRules}`);
    if (rulePack.timeRules) lines.push(`**时间规则**：${rulePack.timeRules}`);
    if (rulePack.revelationRules) lines.push(`**信息揭示规则**：${rulePack.revelationRules}`);
    if (rulePack.forbiddenAssumptions) lines.push(`**禁止默认假设**：${rulePack.forbiddenAssumptions}`);
    if (rulePack.freeText) lines.push(`**补充设定**：${rulePack.freeText}`);
    return lines.join('\n');
  }

  private buildDirectorState(
    snapshot: SessionSnapshot,
    directorCue: DirectorCue | null,
    playPrivacyMode: 'public' | 'secret',
  ): string {
    const hasSplitOpening = snapshot.openingAssignments.some((assignment) => assignment.channelId !== 'main');
    const hasSeeds = snapshot.unresolvedDirectorSeeds.length > 0;
    const hasCueHistory = snapshot.recentDirectorCues.length > 0;
    const hasSplitChannels = snapshot.activeChannels.some((channelId) => channelId !== 'main');
    const hasMergeGoal = Boolean(snapshot.openingMergeGoal?.trim());
    if (!directorCue && !hasSplitOpening && !hasSeeds && !hasCueHistory && !hasSplitChannels && !hasMergeGoal) {
      return '';
    }

    const lines: string[] = [
      '# 导演层（隐藏，仅供节奏调度参考）',
      '以下信息用于自然编排开场与中途推动，不要把它们原样说给玩家。',
    ];

    if (hasMergeGoal) {
      lines.push(`**当前汇合目标**：${snapshot.openingMergeGoal}`);
    }

    if (hasSplitOpening) {
      lines.push('**内部开场分配**：');
      for (const assignment of snapshot.openingAssignments) {
        lines.push(`- ${assignment.target} → ${assignment.channelId}`);
      }
    }

    if (hasSeeds) {
      lines.push('**未完成开场种子**：');
      for (const seed of snapshot.unresolvedDirectorSeeds.slice(0, 6)) {
        lines.push(`- [${seed.kind}] ${seed.title}（频道 ${seed.channelId}）：${seed.description}`);
      }
    }

    if (hasCueHistory) {
      lines.push('**最近导演提示**：');
      for (const cue of snapshot.recentDirectorCues.slice(-3)) {
        lines.push(`- [${cue.type}] ${cue.reason}`);
      }
    }

    if (directorCue) {
      lines.push('**本轮导演提示**：');
      lines.push(`- 类型：${directorCue.type}`);
      lines.push(`- 原因：${directorCue.reason}`);
      lines.push(`- 推动方式：${directorCue.guidance}`);
      lines.push(`- 边界：${directorCue.boundaries}`);
    }

    if (hasSplitChannels) {
      lines.push(`**当前分线状态**：焦点在 ${snapshot.focusChannelId}，活跃频道有 ${snapshot.activeChannels.join('、')}。`);
    }

    lines.push(
      playPrivacyMode === 'secret'
        ? '这是秘密团。可以在必要时私下推进，但要严格控制私聊范围，不要把私聊当成默认表现层。'
        : '这是公开团。即使短暂切到单人视角，也默认用群内公开叙事表达，不要把导演调度直接说给玩家。',
    );
    lines.push('推进时优先提供自然的世界反应、人物跟进和时间压力，不要替调查员做决定。');
    return lines.join('\n');
  }

  // ─── 层 3：角色卡 ───────────────────────────────────────────────────────────

  private buildCharacterSheets(characters: Character[]): string {
    if (characters.length === 0) return '';

    const lines: string[] = ['# 调查员角色卡'];

    for (const c of characters) {
      const a = c.attributes;
      const d = c.derived;
      lines.push(
        `\n## ${c.name}${c.occupation ? `（${c.occupation}）` : ''}` +
        `${c.age ? `  年龄 ${c.age}` : ''}`,
      );
      lines.push(
        `属性：力量${a.str} 体质${a.con} 体型${a.siz} 敏捷${a.dex}` +
        ` 外貌${a.app} 智力${a.int} 意志${a.pow} 教育${a.edu}`,
      );
      lines.push(
        `当前：HP ${d.hp}  MP ${d.mp}  SAN ${d.san}  幸运 ${d.luck}` +
        `  体格 ${d.build}  伤害加值 ${d.damageBonus}`,
      );

      // 只列出非零技能，避免撑爆 token
      const notableSkills = Object.entries(c.skills)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([k, v]) => `${getSkillDisplayName(k)}${v}`)
        .join(' ');
      if (notableSkills) lines.push(`技能（前20）：${notableSkills}`);

      // 扩展字段
      if (c.weapons?.length) {
        lines.push(`武器：${c.weapons.map((w) => `${w.templateName || w.name}(${w.skill}) ${w.damage}`).join('、')}`);
      }
      if (c.armor) {
        lines.push(`护甲：${c.armor.name}（护甲值 ${c.armor.armorValue}）`);
      }
      if (c.vehicle) {
        lines.push(`载具：${c.vehicle.name}`);
      }
      if (c.inventory?.length) {
        lines.push(`随身物品：${c.inventory.map((i) => i.name).join('、')}`);
      }
      if (c.assets) {
        const a = c.assets;
        if (a.livingStandard) lines.push(`生活水平：${a.livingStandard}（现金 ${a.cash ?? '?'}${a.currency ?? ''}）`);
      }
      if (c.spells?.length) {
        lines.push(`已知法术：${c.spells.map((s) => `${s.name}(${s.cost})`).join('、')}`);
      }
      if (c.phobiasAndManias?.length) {
        lines.push(`精神状态：${c.phobiasAndManias.join('、')}`);
      }
      if (c.woundsAndScars) {
        lines.push(`伤口/疤痕：${c.woundsAndScars}`);
      }
      if (c.mythosEncounters?.length) {
        lines.push(`神话接触：${c.mythosEncounters.map((m) => `${m.entity}(CM+${m.cumulative})`).join('、')}`);
      }
      // 背景故事（选取对叙事有用的部分）
      const bs = c.backstory;
      if (bs) {
        if (bs.appearance) lines.push(`外貌：${bs.appearance}`);
        if (bs.traits) lines.push(`特质：${bs.traits}`);
        if (bs.ideology) lines.push(`信念：${bs.ideology}`);
      }
    }

    return lines.join('\n');
  }

  // ─── 层 4：规则 RAG ─────────────────────────────────────────────────────────

  private buildRuleContext(chunks: KnowledgeChunk[]): string {
    if (chunks.length === 0) return '';
    const body = this.formatChunks(chunks, 400);
    return `# 相关规则参考（来自规则书索引）\n\n${body}`;
  }

  // ─── 层 5A：模组全文注入（优先）──────────────────────────────────────────────

  private buildScenarioFullText(text: string, label?: string): string {
    const title = label ? `模组文件：${label}` : '模组全文';
    return `# ${title}\n\n` +
      `⚠️ 以下为守密人专有的完整模组内容，包含所有剧情真相、NPC 秘密、线索分布。\n` +
      `绝不直接向玩家透露 [KP ONLY] 信息，只用于推理和引导。\n\n` +
      text;
  }

  // ─── 层 5B：模组内容 RAG（降级备用）────────────────────────────────────────

  private buildScenarioContext(chunks: KnowledgeChunk[]): string {
    if (chunks.length === 0) return '';
    const body = this.formatChunks(chunks, 600);
    return `# 相关模组内容\n\n${body}\n\n⚠️ [KP ONLY] 标记的内容为守密信息，只用于内部推理，绝不直接输出给玩家。`;
  }

  // ─── 层 5C：动态分段窗口（优先级最高）────────────────────────────────────────

  private buildTieredScenario(
    segments: SceneSegment[],
    currentId: string,
    label?: string,
  ): string {
    const currentIdx = segments.findIndex((s) => s.id === currentId);
    if (currentIdx < 0) {
      // 找不到当前片段，降级到全文拼接（只取前 6000 字防过长）
      const full = segments.map((s) => s.fullText).join('\n\n');
      return this.buildScenarioFullText(full.slice(0, 6000), label);
    }

    const title = label ? `模组：${label}` : '模组内容';
    const lines: string[] = [
      `# ${title}（动态场景窗口）`,
      `⚠️ 以下为守密人专有内容，绝不直接向玩家透露 [KP ONLY] 信息。`,
      `当前所在片段已以完整原文展示，其余片段按距离降级压缩。`,
      '',
    ];

    for (const seg of segments) {
      const dist = seg.seq - segments[currentIdx].seq;
      const isCurrent = dist === 0;
      const isAdjacent = dist >= -1 && dist <= 2 && !isCurrent;

      if (isCurrent) {
        lines.push(`## ▶ 当前场景：${seg.title}（完整原文）`);
        lines.push(seg.fullText);
      } else if (isAdjacent) {
        const dirLabel = dist < 0 ? '（前情）' : dist === 1 ? '（下一段）' : '（再下段）';
        lines.push(`## ${seg.title}${dirLabel}`);
        // 优先用摘要，没有摘要时截取前 400 字
        const body = seg.summary || compact(seg.fullText, 400);
        lines.push(body);
      } else {
        // 远端片段：仅标题
        lines.push(`- ${seg.title}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildScenarioAssetDetails(snapshot: SessionSnapshot): string {
    const lines: string[] = [];

    if (snapshot.entityDetails.length > 0) {
      lines.push('# 当前场景关键实体详情');
      for (const entity of snapshot.entityDetails) {
        lines.push(`## ${entity.name}`);
        if (entity.identity) lines.push(`身份：${entity.identity}`);
        if (entity.motivation) lines.push(`动机：${entity.motivation}`);
        if (entity.publicImage) lines.push(`公开形象：${entity.publicImage}`);
        if (entity.hiddenTruth) lines.push(`隐藏真相：${entity.hiddenTruth}`);
        if (entity.speakingStyle) lines.push(`说话风格：${entity.speakingStyle}`);
        if (entity.faction) lines.push(`阵营：${entity.faction}`);
        if (entity.dangerLevel) lines.push(`危险等级：${entity.dangerLevel}`);
        if (entity.defaultLocation) lines.push(`默认地点：${entity.defaultLocation}`);
        const skillEntries = Object.entries(entity.skills).slice(0, 8).map(([key, value]) => `${key}${value}`);
        if (skillEntries.length > 0) lines.push(`关键技能：${skillEntries.join('、')}`);
        const combatParts = [
          entity.combat.hp !== null ? `HP ${entity.combat.hp}` : '',
          entity.combat.armor !== null ? `护甲 ${entity.combat.armor}` : '',
          entity.combat.mov !== null ? `MOV ${entity.combat.mov}` : '',
          entity.combat.build !== null ? `Build ${entity.combat.build}` : '',
        ].filter(Boolean);
        if (combatParts.length > 0) lines.push(`战斗概要：${combatParts.join('；')}`);
        if (entity.combat.attacks.length > 0) {
          lines.push(`攻击：${entity.combat.attacks.map((attack) => `${attack.name}(${attack.skill ?? '?'} / ${attack.damage}${attack.rof !== null ? ` / ROF ${attack.rof}` : ''})`).join('、')}`);
        }
        if (entity.freeText) lines.push(`补充：${entity.freeText}`);
        lines.push('');
      }
    }

    if (snapshot.sceneItems.length > 0) {
      lines.push('# 当前场景关键物品详情');
      for (const item of snapshot.sceneItems) {
        const summary = [
          item.category && `类别：${item.category}`,
          item.currentOwner && `当前归属：${item.currentOwner}`,
          item.currentLocation && `当前位置：${item.currentLocation}`,
          item.visibilityCondition && `可见条件：${item.visibilityCondition}`,
        ].filter(Boolean);
        lines.push(`- ${item.name}${summary.length > 0 ? `（${summary.join('；')}）` : ''}`);
        if (item.publicDescription) lines.push(`  玩家可见：${item.publicDescription}`);
        if (item.usage) lines.push(`  用途：${item.usage}`);
        if (item.kpNotes) lines.push(`  KP 备注：${item.kpNotes}`);
        if (item.stateNotes) lines.push(`  当前状态：${item.stateNotes}`);
      }
    }

    return lines.join('\n').trim();
  }

  // ─── 层 6：摘要 ─────────────────────────────────────────────────────────────

  private buildSummaries(summaries: string[]): string {
    if (summaries.length === 0) return '';
    const body = summaries
      .map((s, i) => `**摘要 ${i + 1}**：${s}`)
      .join('\n\n');
    return `# 历史对话摘要\n\n${body}`;
  }

  // ─── 工具 ────────────────────────────────────────────────────────────────────

  private formatChunks(chunks: KnowledgeChunk[], maxCharsPerChunk: number): string {
    return chunks.map((c, i) => {
      const page = c.pageNumber ? ` p.${c.pageNumber}` : '';
      const section = c.sectionTitle ? ` / ${c.sectionTitle}` : '';
      const label = c.category === 'keeper_secret' ? ' [KP ONLY]' : '';
      const snippet = compact(c.content, maxCharsPerChunk);
      return `[${i + 1}]${label} ${c.source}${page}${section}\n${snippet}`;
    }).join('\n\n');
  }

  /**
   * 根据五维参数生成完整行为风格描述
   */
  private buildBehavioralProfile(template: KPTemplate): string {
    const dimKeys = ['tone', 'flexibility', 'guidance', 'lethality', 'pacing'] as const;
    const values = [template.tone, template.flexibility, template.guidance, template.lethality, template.pacing];

    const sections = ALL_DIMENSIONS.map((dim, i) => {
      const tier = getDimensionTier(dim, values[i]);
      return `■ ${dim.name}（${values[i]}/10 · ${tier.label}）\n${tier.instructions}`;
    });

    let block = `【KP 行为风格】\n\n${sections.join('\n\n')}`;

    // 模板级自定义设定语
    if (template.customPrompts?.trim()) {
      block += `\n\n【模板自定义设定】\n${template.customPrompts.trim()}`;
    }

    return block;
  }
}

function compact(text: string, maxChars: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 1)}…`;
}
