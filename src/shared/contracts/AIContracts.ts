/**
 * KP 模板参数（5 维度）
 */
export interface KPTemplateParams {
  name: string;
  description: string;
  tone: number;              // 基调 1-10（轻松搞笑 ↔ 严肃恐怖）
  flexibility: number;       // 灵活度 1-10（规则严守 ↔ 叙事/RP优先）
  guidance: number;          // 引导度 1-10（自行摸索 ↔ 手把手）
  lethality: number;         // 致命度 1-10（温和安全 ↔ 致命陷阱）
  pacing: number;            // 节奏 1-10（慢热沉浸 ↔ 快节奏紧张）
  defaultPromptBlock: string;
  customPrompts?: string;    // 模板级自定义设定语
}

/**
 * Prompt 层级
 */
export interface PromptLayer {
  type: 'base' | 'template' | 'campaign' | 'scenario' | 'session' | 'override';
  content: string;
  priority: number; // 优先级，数字越大越优先
  enabled: boolean;
}

/**
 * Prompt 执行快照
 */
export interface PromptExecutionSnapshot {
  timestamp: Date;
  layers: PromptLayer[];
  finalPrompt: string;
  campaignId?: string;
  sessionId?: string;
}
