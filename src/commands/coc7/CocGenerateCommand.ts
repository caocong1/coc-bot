/**
 * CoC7 人物作成命令：.coc
 *
 *  .coc       生成 1 组属性
 *  .coc 5     生成 5 组属性
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { roll } from '../../rules/dice/DiceEngine';

export class CocGenerateCommand implements CommandHandler {
  name = 'coc';
  aliases = ['coc7'];
  description = 'CoC7 人物作成：.coc [数量]';

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const count = Math.min(Math.max(parseInt(cmd.args[0]) || 1, 1), 10);

    const results: string[] = [];

    for (let i = 0; i < count; i++) {
      const str = roll('3d6').total * 5;
      const con = roll('3d6').total * 5;
      const siz = roll('2d6+6').total * 5;
      const dex = roll('3d6').total * 5;
      const app = roll('3d6').total * 5;
      const int = roll('2d6+6').total * 5;
      const pow = roll('3d6').total * 5;
      const edu = roll('2d6+6').total * 5;
      const luck = roll('3d6').total * 5;

      const hp = Math.floor((con + siz) / 10);
      const total8 = str + con + siz + dex + app + int + pow + edu;
      const totalWithLuck = total8 + luck;

      results.push(
        `力量:${str} 体质:${con} 体型:${siz} 敏捷:${dex} ` +
        `外貌:${app} 智力:${int} 意志:${pow} 教育:${edu} ` +
        `HP:${hp} 幸运:${luck} [${total8}/${totalWithLuck}]`
      );
    }

    const header = count > 1 ? `七版COC人物作成 ×${count}:` : '七版COC人物作成:';
    return { text: `${header}\n${results.join('\n')}` };
  }
}
