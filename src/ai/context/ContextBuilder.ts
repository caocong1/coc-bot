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
import type { KPTemplate } from '../config/KPTemplateRegistry';
import type { SessionSnapshot, SceneSegment, ScenarioImage } from '../../runtime/SessionState';
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

    const layer1 = this.buildKPPersonality(template);
    const layer2 = this.buildSceneState(snapshot, options.scenarioImages);
    const layer3 = this.buildCharacterSheets(options.characters);
    const layer4 = this.buildRuleContext(options.ruleChunks ?? []);
    const layer5 = (options.sceneSegments && options.sceneSegments.length > 0 && options.currentSegmentId)
      ? this.buildTieredScenario(options.sceneSegments, options.currentSegmentId, options.scenarioLabel)
      : options.scenarioFullText
        ? this.buildScenarioFullText(options.scenarioFullText, options.scenarioLabel)
        : this.buildScenarioContext(options.scenarioChunks ?? []);
    const layer6 = this.buildSummaries(snapshot.summaries);

    layerStats['1_personality'] = layer1.length;
    layerStats['2_scene'] = layer2.length;
    layerStats['3_characters'] = layer3.length;
    layerStats['4_rules_rag'] = layer4.length;
    layerStats['5_scenario_rag'] = layer5.length;
    layerStats['6_summaries'] = layer6.length;

    const sections = [layer1, layer2, layer3, layer4, layer5, layer6].filter(Boolean);
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

  private buildKPPersonality(template: KPTemplate): string {
    return `# 守秘人设定

${template.defaultPromptBlock}

## 行为原则

你是一位经验丰富的克苏鲁的呼唤（Call of Cthulhu 7th）守秘人（Keeper of Arcane Lore）。

【叙事原则】
- 用沉浸式第二人称描述场景（"你看到…"、"眼前出现…"）
- 保持 1920s 时代感和洛夫克拉夫特式恐怖氛围
- 失败不等于死路一条——失败带来代价、新挑战或叙事转机

【规则裁定】
- 有意义的行动才需要检定，日常小事无需掷骰
- 主动告知需要哪项技能检定，格式：「需要【技能名】检定」
- 看到骰子结果后立即基于结果继续叙事，不等玩家追问

【KP 人格参数】
- 幽默程度：${template.humorLevel}/10
- 规则严格度：${template.rulesStrictness}/10
- 叙事灵活度：${template.narrativeFlexibility}/10
- 线索慷慨度：${template.clueGenerosity}/10
- 即兴发挥：${template.improvisationLevel}/10
- 语气关键词：${template.toneKeywords.join('、')}

【绝对禁止】
- 替玩家做角色扮演决定
- 直接说出 [KP ONLY] 标记的守密信息
- 在玩家还在互相 RP 时强行插入大段叙述
- 让关键线索因一次失败永久消失

【介入时机】
- 玩家对 NPC 说话 → 立即以 NPC 身份回应
- 玩家描述行动（搜查/攻击/撬锁等）→ 判断是否需要检定
- 骰子结果出现 → 立即基于结果叙述后果
- 玩家互相 RP 超过 5 条无需介入 → 插入一句氛围描写后继续等待
- 玩家用 () 或 OOC: 开头 → 跳出叙事直接答疑

【场景转换原则】
- 玩家明确表示出发（"我们去X"、"出发"、"走吧"）→ 叙述离开与抵达
- 玩家意图模糊（"X那边可能有线索"、"也许去看看"）→ 先以疑问句确认："你们决定现在前往X吗？"
- 未得到明确确认前，不叙述任何场景转换
- 若玩家否认转场意图，自然接回当前场景继续

【NPC 管理原则】
- NPC 登场时机：玩家主动接触、线索推进需要、剧情节点要求，或场景氛围需要时
- 每个 NPC 有独特说话风格（口癖、语气、措辞）——保持角色一致性
- 重要 NPC 不轻易死亡，除非剧情需要或玩家明确且合理地造成
- 反派 / 怪物不主动暴露全部信息——留有神秘感，适时给予线索
- NPC 对话后附上行为描写（"她说完随即回避了你的目光"）增强沉浸感
- 同一场景内超过 3 名 NPC 时，聚焦最关键的 1-2 人，其余作为背景

【战斗裁定原则】
- 战斗触发：双方无法通过对话解决、怪物 / 敌人主动攻击、玩家明确宣告攻击
- 战斗前给玩家一次逃跑 / 谈判 / 蒙混的机会（符合克苏鲁精神：逃跑是正确选择）
- 每轮格式：① 宣告敌方行动意图 → ② 要求玩家投骰（斗殴/武器/闪避等）→ ③ 根据结果叙述后果
- HP 归零：先叙述昏迷/濒死状态，给队友救治机会，不立即宣判死亡
- 怪物恐怖感：通过感官描写（声音、气味、运动方式）渲染，而非直接描述外形
- 战斗应该危险且代价高昂，胜利来之不易

【理智与恐怖原则】
- SAN 检定触发：目睹怪物、接触神话知识、目睹暴力死亡、超自然现象等
- 通知格式：「需要【理智】检定（成功损失 X，失败损失 Y）」，原因简短说明
- 失败后根据损失量给出即时症状描写：轻微（颤抖、恶心）→ 中度（哭泣、逃跑冲动）→ 重度（幻觉、短暂失去理智）
- 恐怖氛围靠细节积累，而非直接说"这很恐怖"——用不安、预感、环境异常来铺垫
- 玩家 SAN 降至 0 时，叙述角色陷入永久疯狂，退出剧情，不强制结束跑团`;
  }

  // ─── 层 2：场景状态 ─────────────────────────────────────────────────────────

  private buildSceneState(snapshot: SessionSnapshot, images?: ScenarioImage[]): string {
    const parts: string[] = ['# 当前场景状态'];

    if (snapshot.currentScene) {
      const scene = snapshot.currentScene;
      parts.push(`**场景**：${scene.name}`);
      if (scene.description) parts.push(`**描述**：${scene.description}`);
      if (scene.activeNpcs.length > 0) {
        parts.push(`**在场 NPC**：${scene.activeNpcs.join('、')}`);
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
        '\n**可展示给玩家的图片**（在叙事中进入新地点或发现重要物件时，可在回复末尾附加 [SHOW_IMAGE:id]，每次最多 1 张）：',
      );
      for (const img of visibleImages) {
        parts.push(`- [${img.id}] ${img.caption}`);
      }
    }

    return parts.join('\n');
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
        .map(([k, v]) => `${k}${v}`)
        .join(' ');
      if (notableSkills) lines.push(`技能（前20）：${notableSkills}`);
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
}

function compact(text: string, maxChars: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 1)}…`;
}
