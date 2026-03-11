/**
 * 知识可见性模型
 * 
 * 管理不同可见性层级的知识和信息
 */

/**
 * 可见性层级
 */
export type VisibilityLevel = 
  | 'keeper_only'
  | 'player_visible'
  | 'character_known'
  | 'public_table';

/**
 * 知识项
 */
export interface KnowledgeItem {
  id: string;
  content: string;
  visibility: VisibilityLevel;
  campaignId?: string;
  characterId?: string;
  tags: string[];
}

/**
 * 知识可见性管理器
 */
export class KnowledgeVisibility {
  private knowledge: Map<string, KnowledgeItem> = new Map();
  
  /**
   * 添加知识项
   */
  add(item: KnowledgeItem): void {
    this.knowledge.set(item.id, item);
  }
  
  /**
   * 获取可见的知识项
   */
  getVisible(visibility: VisibilityLevel, characterId?: string): KnowledgeItem[] {
    return Array.from(this.knowledge.values()).filter(item => {
      return this.isVisible(item, visibility, characterId);
    });
  }
  
  /**
   * 检查知识项是否可见
   */
  private isVisible(
    item: KnowledgeItem,
    requestedVisibility: VisibilityLevel,
    characterId?: string
  ): boolean {
    // 可见性层级从高到低：keeper_only > player_visible > character_known > public_table
    const levels: VisibilityLevel[] = ['keeper_only', 'player_visible', 'character_known', 'public_table'];
    
    const itemLevel = levels.indexOf(item.visibility);
    const requestedLevel = levels.indexOf(requestedVisibility);
    
    // 请求的可见性层级必须 >= 知识项的可见性层级
    if (requestedLevel < itemLevel) {
      return false;
    }
    
    // character_known 需要检查 characterId
    if (item.visibility === 'character_known' && item.characterId) {
      return item.characterId === characterId;
    }
    
    return true;
  }
}
