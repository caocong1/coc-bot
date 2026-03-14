/**
 * 设置骰子对你的称呼：.nn [昵称]
 *
 *   .nn kp          在当前群（或私聊全局）设置称呼为 "kp"
 *   .nn             查看当前称呼
 *   .nn del         删除当前窗口的称呼
 *   .nn clr         删除所有群/全局的称呼
 *
 * 优先级：群专属 > 全局 > QQ昵称/群名片
 * 群内设置的称呼只在该群生效；私聊设置的视为全局。
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { UserSettingsStore } from '../../storage/UserSettingsStore';

export class NnCommand implements CommandHandler {
  name = 'nn';
  aliases = [];
  description = '设置骰子对你的称呼：.nn <名字> / .nn del / .nn clr';

  constructor(private readonly settings: UserSettingsStore) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const scope = ctx.groupId ? String(ctx.groupId) : 'global';
    const arg = cmd.args.join(' ').trim();

    // 查看当前称呼
    if (!arg) {
      const nn = this.settings.getNickname(ctx.userId, ctx.groupId);
      return { text: nn ? `当前称呼：${nn}` : '未设置称呼。使用 .nn <名字> 设置，.nn del 删除。' };
    }

    // 删除当前窗口的称呼
    if (arg.toLowerCase() === 'del') {
      this.settings.delete(ctx.userId, scope, 'nn');
      return { text: '✅ 已删除当前窗口的称呼。' };
    }

    // 清除所有称呼
    if (arg.toLowerCase() === 'clr') {
      this.settings.deleteAll(ctx.userId, 'nn');
      return { text: '✅ 已清除所有称呼记录。' };
    }

    // 设置称呼
    if (arg.length > 32) {
      return { text: '❌ 称呼过长（最多32字符）。' };
    }

    this.settings.set(ctx.userId, scope, 'nn', arg);
    const hint = ctx.groupId ? '（仅本群生效）' : '（全局生效）';
    return { text: `✅ 称呼已设为：${arg}${hint}` };
  }
}
