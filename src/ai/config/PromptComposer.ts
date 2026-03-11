/**
 * Prompt 组合器
 * 
 * 将多个 Prompt 层级组合成最终的系统提示词
 */

import type { PromptLayer, PromptExecutionSnapshot } from '@shared/contracts/AIContracts';
import type { KPTemplate } from './KPTemplateRegistry';

/**
 * Prompt 组合器
 */
export class PromptComposer {
  /**
   * 组合 Prompt 层级
   */
  compose(layers: PromptLayer[]): string {
    // 按优先级排序
    const sorted = layers
      .filter(l => l.enabled)
      .sort((a, b) => b.priority - a.priority);
    
    // 组合内容
    return sorted.map(l => l.content).join('\n\n');
  }
  
  /**
   * 从模板创建 Prompt 层级
   */
  createTemplateLayer(template: KPTemplate): PromptLayer {
    return {
      type: 'template',
      content: template.defaultPromptBlock,
      priority: 20,
      enabled: true,
    };
  }
  
  /**
   * 创建基础系统 Prompt 层级
   */
  createBaseLayer(): PromptLayer {
    return {
      type: 'base',
      content: `你是一位经验丰富的克苏鲁的呼唤（Call of Cthulhu）守秘人（Keeper of Arcane Lore）。

你的职责是：
1. 描述场景、NPC 和世界
2. 公平裁定规则
3. 推进剧情和调查
4. 维护恐怖氛围和未知感

重要原则：
- 不要替玩家做决定
- 不要泄露 keeper_only 的信息
- 不要让关键线索因一次失败永久消失
- 失败应带来代价或新挑战，而不是"什么都没发生"
- 保持 CoC 的恐怖和无力感`,
      priority: 10,
      enabled: true,
    };
  }
  
  /**
   * 创建执行快照
   */
  createSnapshot(
    layers: PromptLayer[],
    campaignId?: string,
    sessionId?: string
  ): PromptExecutionSnapshot {
    return {
      timestamp: new Date(),
      layers: [...layers],
      finalPrompt: this.compose(layers),
      campaignId,
      sessionId,
    };
  }
}
