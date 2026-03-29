/**
 * 掷骰命令：.r
 *
 * 支持格式：
 *  .r              默认骰（用户 .set 设置，默认 1d100）
 *  .r 3d6+2        表达式
 *  .r 3#1d6        多轮
 *  .rb2            奖励骰
 *  .rp             惩罚骰
 *  .rh             暗骰（结果私聊）
 *  .r 3d6k2        取最高
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { UserSettingsStore } from '../../storage/UserSettingsStore';
import { roll, rollBonus, rollPenalty, rollMultiple } from '../../rules/dice/DiceEngine';

export class DiceCommand implements CommandHandler {
  name = 'r';
  aliases = ['roll', 'dice', 'rb', 'rp', 'rh'];
  description = '掷骰：.r 1d100 / .r3d6+2 / .r 3#1d6 / .rb2 / .rp / .rh';

  constructor(private readonly settings?: UserSettingsStore) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const isHidden = cmd.name === 'rh';
    const defaultFaces = this.settings?.getDefaultDice(ctx.userId) ?? 100;
    const defaultExpr = `1d${defaultFaces}`;

    const reason = this.extractReason(cmd.args);
    const diceExpr = this.extractDiceExpr(cmd.args) || defaultExpr;

    let text: string;

    // 奖励骰
    if (cmd.bonus) {
      const r = rollBonus(cmd.bonus);
      text = `🎲 ${reason ? reason + ' ' : ''}奖励骰×${cmd.bonus}: ${r.detail} = ${r.total}`;
    }
    // 惩罚骰
    else if (cmd.penalty) {
      const r = rollPenalty(cmd.penalty);
      text = `🎲 ${reason ? reason + ' ' : ''}惩罚骰×${cmd.penalty}: ${r.detail} = ${r.total}`;
    }
    // 多轮
    else if (cmd.repeat && cmd.repeat > 1) {
      const results = rollMultiple(diceExpr, Math.min(cmd.repeat, 10));
      const lines = results.map((r, i) => `  #${i + 1}: ${r.detail} = ${r.total}`);
      text = `🎲 ${reason ? reason + ' ' : ''}${diceExpr} ×${cmd.repeat}:\n${lines.join('\n')}`;
    }
    // 普通
    else {
      const r = roll(diceExpr);
      text = `🎲 ${reason ? reason + ' ' : ''}${r.input} = ${r.detail} = ${r.total}`;
    }

    if (isHidden) {
      return {
        text,
        private: true,
        publicHint: `${ctx.senderName ?? ctx.userId} 进行了一次暗骰。`,
      };
    }

    return { text };
  }

  private extractDiceExpr(args: string[]): string {
    for (const arg of args) {
      if (/[\dd+\-*/kKbBpP]/.test(arg)) return arg;
    }
    return '';
  }

  private extractReason(args: string[]): string {
    const reasons = args.filter(a => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(a));
    return reasons.join(' ');
  }
}
