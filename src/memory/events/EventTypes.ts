/**
 * 事件类型定义
 * 
 * 定义所有系统事件的类型和结构
 */

import type { EventType } from './EventLog';

/**
 * 聊天消息事件
 */
export interface ChatMessageEvent {
  type: 'chat_message';
  userId: number;
  messageType: 'group' | 'private';
  groupId?: number;
  content: string;
  messageId: string;
}

/**
 * KP 回复事件
 */
export interface KeeperResponseEvent {
  type: 'keeper_response';
  content: string;
  visibility: string[];
  campaignId?: string;
  sessionId?: string;
}

/**
 * 掷骰事件
 */
export interface DiceRollEvent {
  type: 'dice_roll';
  expression: string;
  result: number;
  userId: number;
  characterId?: string;
}

/**
 * 技能检定事件
 */
export interface SkillCheckEvent {
  type: 'skill_check';
  skillName: string;
  targetValue: number;
  rollResult: number;
  success: boolean;
  successLevel?: 'regular' | 'hard' | 'extreme' | 'critical';
  userId: number;
  characterId?: string;
}

/**
 * 场景开始事件
 */
export interface SceneStartedEvent {
  type: 'scene_started';
  sceneId: string;
  title: string;
  campaignId: string;
  sessionId: string;
}

/**
 * 场景结束事件
 */
export interface SceneEndedEvent {
  type: 'scene_ended';
  sceneId: string;
  campaignId: string;
  sessionId: string;
}

/**
 * 线索揭示事件
 */
export interface ClueRevealedEvent {
  type: 'clue_revealed';
  clueId: string;
  characterId?: string;
  userId: number;
  campaignId: string;
  sessionId: string;
}

/**
 * 角色状态变更事件
 */
export interface CharacterStateChangedEvent {
  type: 'character_state_changed';
  characterId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  campaignId?: string;
}

/**
 * 跑团模式变更事件
 */
export interface CampaignModeChangedEvent {
  type: 'campaign_mode_changed';
  groupId: number;
  fromMode: 'dice' | 'campaign';
  toMode: 'dice' | 'campaign';
  campaignId?: string;
}

/**
 * 手动覆盖事件
 */
export interface ManualOverrideEvent {
  type: 'manual_override';
  overrideType: string;
  targetId: string;
  oldValue: unknown;
  newValue: unknown;
  operatorId: number;
  reason?: string;
}

/**
 * 所有事件类型的联合
 */
export type EventPayload = 
  | ChatMessageEvent
  | KeeperResponseEvent
  | DiceRollEvent
  | SkillCheckEvent
  | SceneStartedEvent
  | SceneEndedEvent
  | ClueRevealedEvent
  | CharacterStateChangedEvent
  | CampaignModeChangedEvent
  | ManualOverrideEvent;
