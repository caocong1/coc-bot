/**
 * 命令注册表
 *
 * 管理所有可用命令的注册和查找
 */

import type { ParsedCommand } from './CommandParser';

/**
 * 命令执行上下文
 */
export interface CommandContext {
  userId: number;
  groupId?: number;
  messageType: 'group' | 'private';
  senderName?: string;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  text: string;
  /** 是否私聊回复（暗骰） */
  private?: boolean;
  /** 群内附带的公开提示（暗骰时） */
  publicHint?: string;
  /** 命令执行失败（格式错误等），不应触发 AI 介入 */
  error?: boolean;
}

/**
 * 命令处理器接口
 */
export interface CommandHandler {
  name: string;
  aliases?: string[];
  description: string;
  handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult>;
}

/**
 * 命令注册表
 */
export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map();

  register(handler: CommandHandler): void {
    this.handlers.set(handler.name, handler);
    if (handler.aliases) {
      for (const alias of handler.aliases) {
        this.handlers.set(alias, handler);
      }
    }
  }

  find(commandName: string): CommandHandler | undefined {
    return this.handlers.get(commandName);
  }

  getAllDescriptions(): Array<{ name: string; description: string }> {
    const seen = new Set<CommandHandler>();
    const result: Array<{ name: string; description: string }> = [];
    for (const h of this.handlers.values()) {
      if (seen.has(h)) continue;
      seen.add(h);
      result.push({ name: h.name, description: h.description });
    }
    return result;
  }
}
