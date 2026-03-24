/**
 * 叙事掷骰命令：.rd
 *
 * 支持格式：
 *  .rd 偷吃零食          使用默认骰（1d100），附带描述
 *  .rd 2d6 偷吃零食      指定骰子表达式 + 描述
 *  .rd                   无描述，使用默认骰
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { UserSettingsStore } from '../../storage/UserSettingsStore';
import { roll } from '../../rules/dice/DiceEngine';

export class RdCommand implements CommandHandler {
  name = 'rd';
  aliases = [];
  description = '叙事掷骰：.rd 偷吃零食 / .rd 2d6 潜入仓库';

  constructor(private readonly settings?: UserSettingsStore) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const defaultFaces = this.settings?.getDefaultDice(ctx.userId) ?? 100;
    const defaultExpr = `1d${defaultFaces}`;

    const diceExpr = this.extractDiceExpr(cmd.args) || defaultExpr;
    const reason = this.extractReason(cmd.args);

    const r = roll(diceExpr);
    const name = ctx.senderName ?? String(ctx.userId);

    if (reason) {
      return { text: `🎲 ${name}「${reason}」掷出了 ${r.detail} = ${r.total}` };
    }
    return { text: `🎲 ${name} 掷出了 ${r.detail} = ${r.total}` };
  }

  private extractDiceExpr(args: string[]): string {
    for (const arg of args) {
      if (/^\d*d\d/i.test(arg) || /^\d+[+\-*/]\d+/.test(arg)) return arg;
    }
    return '';
  }

  private extractReason(args: string[]): string {
    const reasons = args.filter(a => !/^\d*d\d/i.test(a) && !/^\d+[+\-*/]\d+/.test(a));
    return reasons.join(' ');
  }
}
