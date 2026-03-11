/**
 * 摘要服务
 * 
 * 负责生成和管理多层级摘要
 */

/**
 * 摘要类型
 */
export type SummaryType = 
  | 'scene'
  | 'session'
  | 'campaign'
  | 'character'
  | 'keeper';

/**
 * 摘要
 */
export interface Summary {
  id: string;
  type: SummaryType;
  targetId: string; // sceneId, sessionId, campaignId, characterId
  content: string;
  createdAt: Date;
  updatedAt: Date;
  eventIds: string[]; // 引用的原始事件 ID
}

/**
 * 摘要服务
 */
export class SummaryService {
  private summaries: Map<string, Summary> = new Map();
  
  /**
   * 创建摘要
   */
  async createSummary(
    type: SummaryType,
    targetId: string,
    content: string,
    eventIds: string[]
  ): Promise<Summary> {
    const summary: Summary = {
      id: this.generateId(),
      type,
      targetId,
      content,
      createdAt: new Date(),
      updatedAt: new Date(),
      eventIds,
    };
    
    this.summaries.set(summary.id, summary);
    
    // TODO: 持久化到数据库
    
    return summary;
  }
  
  /**
   * 获取摘要
   */
  getSummary(type: SummaryType, targetId: string): Summary | undefined {
    return Array.from(this.summaries.values()).find(
      s => s.type === type && s.targetId === targetId
    );
  }
  
  /**
   * 更新摘要
   */
  async updateSummary(
    summaryId: string,
    content: string,
    eventIds: string[]
  ): Promise<void> {
    const summary = this.summaries.get(summaryId);
    if (!summary) {
      throw new Error(`Summary not found: ${summaryId}`);
    }
    
    summary.content = content;
    summary.eventIds = eventIds;
    summary.updatedAt = new Date();
    
    // TODO: 持久化到数据库
  }
  
  /**
   * 生成 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
