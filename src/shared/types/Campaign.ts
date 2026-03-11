/**
 * 跑团活动状态
 */
export type CampaignStatus = 
  | 'planning'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

/**
 * 跑团活动
 */
export interface Campaign {
  id: string;
  title: string;
  status: CampaignStatus;
  groupId: number;
  scenarioId?: string;
  createdAt: Date;
  updatedAt: Date;
}
