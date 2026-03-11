/**
 * 运行模式解析器
 * 
 * 负责判断当前群聊或私聊的运行模式
 */

import type { MessageContext, RuntimeMode } from '@shared/contracts/RuntimeContracts';

/**
 * 群组上下文
 */
export interface GroupContext {
  groupId: number;
  mode: RuntimeMode;
  enabled: boolean;
  activeCampaignId?: string;
}

/**
 * 模式解析器
 */
export class ModeResolver {
  private groupContexts: Map<number, GroupContext> = new Map();
  
  /**
   * 获取群组运行模式
   */
  getGroupMode(groupId: number): RuntimeMode {
    const context = this.groupContexts.get(groupId);
    return context?.mode ?? 'dice';
  }
  
  /**
   * 设置群组运行模式
   */
  setGroupMode(groupId: number, mode: RuntimeMode, campaignId?: string): void {
    const context: GroupContext = {
      groupId,
      mode,
      enabled: true,
      activeCampaignId: campaignId,
    };
    this.groupContexts.set(groupId, context);
  }
  
  /**
   * 解析消息的运行模式
   */
  resolveMode(ctx: MessageContext): RuntimeMode {
    if (ctx.messageType === 'private') {
      // 私聊模式：如果有绑定的 campaign，则为 campaign 模式，否则为 dice 模式
      // TODO: 实现私聊 campaign 绑定检查
      return 'dice';
    }
    
    if (ctx.groupId) {
      return this.getGroupMode(ctx.groupId);
    }
    
    return 'dice';
  }
  
  /**
   * 检查群组是否启用
   */
  isGroupEnabled(groupId: number): boolean {
    const context = this.groupContexts.get(groupId);
    return context?.enabled ?? false;
  }
}
