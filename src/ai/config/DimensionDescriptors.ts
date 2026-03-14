/**
 * KP 维度行为描述表
 *
 * 每个维度 5 个档位（1-2 / 3-4 / 5-6 / 7-8 / 9-10），
 * 每档包含中文标签 + 具体行为指令，供 ContextBuilder 注入系统提示。
 *
 * 各维度的职责边界：
 *   tone = 措辞和氛围
 *   flexibility = 裁定宽严
 *   guidance = 信息显著性
 *   lethality = 后果烈度
 *   pacing = 切镜与概括速度
 */

export interface DimensionTier {
  label: string;
  instructions: string;
}

export interface DimensionDescriptor {
  name: string;       // 中文维度名
  lowLabel: string;   // 低端标签
  highLabel: string;  // 高端标签
  tiers: DimensionTier[];  // 5 个档位，index 0 = 1-2, index 4 = 9-10
}

function getTier(value: number): number {
  if (value <= 2) return 0;
  if (value <= 4) return 1;
  if (value <= 6) return 2;
  if (value <= 8) return 3;
  return 4;
}

/**
 * 根据维度值获取对应的档位描述
 */
export function getDimensionTier(dimension: DimensionDescriptor, value: number): DimensionTier {
  return dimension.tiers[getTier(value)];
}

// ─── 基调 (tone) ────────────────────────────────────────────────────────────────

export const TONE: DimensionDescriptor = {
  name: '基调',
  lowLabel: '轻松调剂',
  highLabel: '极致恐怖',
  tiers: [
    {
      label: '轻松调剂',
      instructions:
        '允许轻微幽默缓冲压力，但不把核心恐怖场景写成段子，不用出戏玩梗。',
    },
    {
      label: '略轻松',
      instructions:
        '非关键场景可偶尔轻松，进入危险或异常时迅速收紧语气。',
    },
    {
      label: '均衡',
      instructions:
        '日常调查自然平实，异常显现时明显升高压迫感。',
    },
    {
      label: '严肃悬疑',
      instructions:
        '整体克制严肃，以细节、留白和不确定感制造压力。',
    },
    {
      label: '极致恐怖',
      instructions:
        '持续维持压抑和不可名状感，绝不使用幽默消解氛围。',
    },
  ],
};

// ─── 灵活度 (flexibility) ───────────────────────────────────────────────────────

export const FLEXIBILITY: DimensionDescriptor = {
  name: '灵活度',
  lowLabel: '规则严格',
  highLabel: '高弹性',
  tiers: [
    {
      label: '规则严格',
      instructions:
        '严格按 CoC 7th 常规流程裁定，少做额外通融。',
    },
    {
      label: '偏严格',
      instructions:
        '以规则为主，少量根据叙事合理性给出小幅修正。',
    },
    {
      label: '均衡',
      instructions:
        '规则流程不变；优秀准备、合理 RP 或环境优势可带来难度调整或更温和的失败代价。',
    },
    {
      label: '叙事优先',
      instructions:
        '不跳过关键检定与后果，但更倾向用补救机会、代价型失败保持故事流动。',
    },
    {
      label: '高弹性',
      instructions:
        '把规则当作裁定骨架，仍保留检定接口和成败边界；' +
        '优先用代价、延迟、风险、资源消耗替代生硬卡关。',
    },
  ],
};

// ─── 引导度 (guidance) ──────────────────────────────────────────────────────────

export const GUIDANCE: DimensionDescriptor = {
  name: '引导度',
  lowLabel: '自行摸索',
  highLabel: '强引导',
  tiers: [
    {
      label: '自行摸索',
      instructions:
        '只回答玩家直接触发的信息，不主动强调潜在线索。',
    },
    {
      label: '少量提示',
      instructions:
        '可轻微强调关键物件或异常之处，但不额外总结。',
    },
    {
      label: '适度引导',
      instructions:
        '卡住时，可回顾已知事实、未解问题或让 NPC 对被问内容说得更清楚。',
    },
    {
      label: '积极引导',
      instructions:
        '若 2 轮推进不足，可用线索回顾、环境聚焦、NPC 被动补充指出可深挖方向，但不替玩家决定行动。',
    },
    {
      label: '强引导',
      instructions:
        '主动显化场景中已存在的可交互点、风险与机会；' +
        '只展示世界里有什么，不写成行动菜单或最优解。',
    },
  ],
};

// ─── 致命度 (lethality) ─────────────────────────────────────────────────────────

export const LETHALITY: DimensionDescriptor = {
  name: '致命度',
  lowLabel: '低致命',
  highLabel: '极高致命',
  tiers: [
    {
      label: '低致命',
      instructions:
        '尽量避免无预警死亡；危险主要体现为伤势、失散、资源损耗和长期后果。',
    },
    {
      label: '偏低',
      instructions:
        '重大失误才会逼近死亡，通常先给明显预兆与撤退窗口。',
    },
    {
      label: '均衡',
      instructions:
        '鲁莽会遭受重创，谨慎、准备和协作能显著提高生存率。',
    },
    {
      label: '高致命',
      instructions:
        '敌意环境和战斗都很危险；错误判断或逞强可能迅速付出惨重代价。',
    },
    {
      label: '极高致命',
      instructions:
        '世界不为 PC 留情，但仍遵守因果和预兆；' +
        '死亡来自清晰风险与后果，而非任意处决。',
    },
  ],
};

// ─── 节奏 (pacing) ──────────────────────────────────────────────────────────────

export const PACING: DimensionDescriptor = {
  name: '节奏',
  lowLabel: '慢热沉浸',
  highLabel: '紧迫推进',
  tiers: [
    {
      label: '慢热沉浸',
      instructions:
        '允许充分摸索细节与日常互动，耐心停留在气氛和调查过程。',
    },
    {
      label: '偏慢',
      instructions:
        '重要场景展开充分，低价值往返和重复询问适度概括。',
    },
    {
      label: '适中',
      instructions:
        '在沉浸、线索推进和危险升级之间动态平衡。',
    },
    {
      label: '偏快',
      instructions:
        '对重复试探、琐碎移动和无新信息环节做简洁概括，把篇幅留给冲突与发现。',
    },
    {
      label: '紧迫推进',
      instructions:
        '持续让时间、威胁或外界事件推动局势，' +
        '但仍保留必要的确认、检定和玩家决策空间。',
    },
  ],
};

/** 所有维度描述器，按顺序 */
export const ALL_DIMENSIONS = [TONE, FLEXIBILITY, GUIDANCE, LETHALITY, PACING] as const;

/** 维度 key 到描述器的映射 */
export const DIMENSION_MAP: Record<string, DimensionDescriptor> = {
  tone: TONE,
  flexibility: FLEXIBILITY,
  guidance: GUIDANCE,
  lethality: LETHALITY,
  pacing: PACING,
};
