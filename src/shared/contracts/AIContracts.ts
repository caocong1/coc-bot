/**
 * KP 模板参数
 */
export interface KPTemplateParams {
  name: string;
  description: string;
  humorLevel: number;           // 0-10
  rulesStrictness: number;       // 0-10
  narrativeFlexibility: number;   // 0-10
  clueGenerosity: number;         // 0-10
  improvisationLevel: number;      // 0-10
  toneKeywords: string[];
  forbiddenBehaviors: string[];
  defaultPromptBlock: string;
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
