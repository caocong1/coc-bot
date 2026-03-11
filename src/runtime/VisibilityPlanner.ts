/**
 * 可见性规划器
 * 
 * 根据消息类型和内容决定输出的可见性范围
 */

import type { VisibilityEnvelope, MessageContext } from '@shared/contracts/RuntimeContracts';

/**
 * 可见性规划器
 */
export class VisibilityPlanner {
  /**
   * 规划普通回复的可见性
   */
  planNormalReply(ctx: MessageContext): VisibilityEnvelope {
    if (ctx.messageType === 'private') {
      return {
        visibility: 'pc',
        targetUserId: ctx.userId,
        reason: 'normal_reply',
      };
    }
    
    return {
      visibility: 'public',
      targetGroupId: ctx.groupId,
      reason: 'normal_reply',
    };
  }
  
  /**
   * 规划暗骰结果的可见性
   */
  planSecretCheck(ctx: MessageContext, campaignId: string): VisibilityEnvelope {
    return {
      visibility: 'pc',
      campaignId,
      targetUserId: ctx.userId,
      reason: 'secret_check',
    };
  }
  
  /**
   * 规划管理员操作的可见性
   */
  planAdminResult(ctx: MessageContext): VisibilityEnvelope {
    return {
      visibility: 'system',
      reason: 'admin_result',
    };
  }
}
