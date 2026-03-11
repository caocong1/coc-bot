/**
 * 消息类型
 */
export type MessageType = 'group' | 'private';

/**
 * 运行模式
 */
export type RuntimeMode = 'dice' | 'campaign';

/**
 * 可见性范围
 */
export type VisibilityScope = 
  | 'public'
  | 'party'
  | 'pc'
  | 'keeper'
  | 'system';

/**
 * 消息上下文
 */
export interface MessageContext {
  platform: 'onebot';
  messageType: MessageType;
  groupId?: number;
  userId: number;
  messageId: string;
  rawMessage: string;
  plainText: string;
  isAtBot: boolean;
  isReplyToBot: boolean;
  isCommand: boolean;
  commandName?: string;
  mentionedUsers: number[];
  timestamp: Date;
}

/**
 * 可见性封装
 */
export interface VisibilityEnvelope {
  visibility: VisibilityScope;
  campaignId?: string;
  targetGroupId?: number;
  targetUserId?: number;
  reason: 
    | 'normal_reply'
    | 'secret_check'
    | 'vision'
    | 'admin_result'
    | 'audit_notice';
}
