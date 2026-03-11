/**
 * Session 状态
 */
export type SessionStatus = 
  | 'starting'
  | 'running'
  | 'paused'
  | 'ending'
  | 'ended';

/**
 * 跑团 Session
 */
export interface Session {
  id: string;
  campaignId: string;
  status: SessionStatus;
  title?: string;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
