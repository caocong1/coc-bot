/**
 * 消息路由器
 * 
 * 根据运行模式将消息路由到相应的处理器
 */

import type { MessageContext, VisibilityEnvelope } from '@shared/contracts/RuntimeContracts';
import { ModeResolver } from './ModeResolver';

/**
 * 消息处理器接口
 */
export interface MessageHandler {
  handle(ctx: MessageContext): Promise<VisibilityEnvelope[]>;
}

/**
 * 消息路由器
 */
export class MessageRouter {
  private diceHandler?: MessageHandler;
  private campaignHandler?: MessageHandler;
  private modeResolver: ModeResolver;
  
  constructor(modeResolver: ModeResolver) {
    this.modeResolver = modeResolver;
  }
  
  /**
   * 设置 Dice Mode 处理器
   */
  setDiceHandler(handler: MessageHandler): void {
    this.diceHandler = handler;
  }
  
  /**
   * 设置 Campaign Mode 处理器
   */
  setCampaignHandler(handler: MessageHandler): void {
    this.campaignHandler = handler;
  }
  
  /**
   * 路由消息
   */
  async route(ctx: MessageContext): Promise<VisibilityEnvelope[]> {
    const mode = this.modeResolver.resolveMode(ctx);
    
    // 系统命令优先
    if (ctx.isCommand && ctx.commandName === 'help') {
      // TODO: 实现帮助命令
      return [];
    }
    
    // 根据模式选择处理器
    if (mode === 'campaign' && this.campaignHandler) {
      return await this.campaignHandler.handle(ctx);
    }
    
    if (mode === 'dice' && this.diceHandler) {
      return await this.diceHandler.handle(ctx);
    }
    
    // 默认：忽略非命令消息
    if (!ctx.isCommand) {
      return [];
    }
    
    // 未知命令
    return [];
  }
}
