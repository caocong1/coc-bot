/**
 * 事件日志
 * 
 * 记录所有系统事件，支持回放和审计
 */

/**
 * 事件类型
 */
export type EventType = 
  | 'chat_message'
  | 'keeper_response'
  | 'dice_roll'
  | 'skill_check'
  | 'scene_started'
  | 'scene_ended'
  | 'clue_revealed'
  | 'character_state_changed'
  | 'campaign_mode_changed'
  | 'manual_override';

/**
 * 事件
 */
export interface Event {
  id: string;
  type: EventType;
  timestamp: Date;
  campaignId?: string;
  sessionId?: string;
  userId?: number;
  characterId?: string;
  payload: Record<string, unknown>;
  visibility: string[];
}

/**
 * 事件日志
 */
export class EventLog {
  private events: Event[] = [];
  
  /**
   * 记录事件
   */
  log(event: Omit<Event, 'id' | 'timestamp'>): void {
    const fullEvent: Event = {
      ...event,
      id: this.generateId(),
      timestamp: new Date(),
    };
    
    this.events.push(fullEvent);
    
    // TODO: 持久化到数据库
  }
  
  /**
   * 查询事件
   */
  query(filters: {
    type?: EventType;
    campaignId?: string;
    sessionId?: string;
    startTime?: Date;
    endTime?: Date;
  }): Event[] {
    return this.events.filter(event => {
      if (filters.type && event.type !== filters.type) return false;
      if (filters.campaignId && event.campaignId !== filters.campaignId) return false;
      if (filters.sessionId && event.sessionId !== filters.sessionId) return false;
      if (filters.startTime && event.timestamp < filters.startTime) return false;
      if (filters.endTime && event.timestamp > filters.endTime) return false;
      return true;
    });
  }
  
  /**
   * 生成事件 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
