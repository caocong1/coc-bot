/**
 * 设置默认骰子面数：.set [面数]
 *
 *   .set 20    将默认骰改为 D20
 *   .set       重置为 D100
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { UserSettingsStore } from '../../storage/UserSettingsStore';

export class SetCommand implements CommandHandler {
  name = 'set';
  aliases = [];
  description = '设置默认骰子面数：.set 20 / .set（重置为D100）';

  constructor(private readonly settings: UserSettingsStore) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const arg = cmd.args[0]?.trim();

    if (!arg) {
      this.settings.delete(ctx.userId, 'global', 'default_dice');
      return { text: '🎲 默认骰已重置为 D100。' };
    }

    const n = parseInt(arg);
    if (isNaN(n) || n < 1 || n > 1000) {
      return { text: '❌ 面数范围：1–1000。例：.set 20' };
    }

    this.settings.set(ctx.userId, 'global', 'default_dice', String(n));
    return { text: `🎲 默认骰已设为 D${n}。` };
  }
}
