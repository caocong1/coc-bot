/**
 * 属性录入命令：.st
 *
 * 支持格式：
 *  .st 力量:50 体质:55 体型:65       批量录入
 *  .st hp-1                         增减
 *  .st san+1d6                      掷骰增减
 *  .st show                         显示所有
 *  .st show 侦查                   显示指定
 *  .st del 侦查                    删除属性
 *  .st clr                          清空
 *  .st export                       导出
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { CharacterStore } from './CharacterStore';
import { roll } from '../../rules/dice/DiceEngine';

export class StCommand implements CommandHandler {
  name = 'st';
  description = '属性管理：.st 力量:50 / .st hp-1 / .st show / .st export';

  private store: CharacterStore;
  constructor(store: CharacterStore) { this.store = store; }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const sub = cmd.args[0]?.toLowerCase();

    // show
    if (sub === 'show') {
      return this.showAttributes(ctx, cmd.args.slice(1).join(''));
    }
    // del
    if (sub === 'del') {
      return this.deleteAttribute(ctx, cmd.args.slice(1).join(''));
    }
    // clr
    if (sub === 'clr') {
      return this.clearAttributes(ctx);
    }
    // export
    if (sub === 'export') {
      return this.exportAttributes(ctx);
    }

    // 录入或增减
    return this.setAttributes(ctx, cmd.rawArgs);
  }

  private ensureCharacter(ctx: CommandContext) {
    let c = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!c) {
      c = this.store.create(ctx.userId, ctx.senderName ?? `调查员${ctx.userId}`);
    }
    return c;
  }

  private showAttributes(ctx: CommandContext, skillName: string): CommandResult {
    const c = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!c) return { text: '未找到角色卡。使用 .st 录入属性或 .pc new 创建角色卡。' };

    if (skillName) {
      const val = c.skills[skillName] ??
        (c.attributes as Record<string, number>)[skillName] ??
        (c.derived as Record<string, unknown>)[skillName];
      return { text: val !== undefined ? `${c.name} 的 ${skillName}: ${val}` : `未找到属性: ${skillName}` };
    }

    const attrs = Object.entries({
      力量: c.attributes.str, 体质: c.attributes.con, 体型: c.attributes.siz,
      敏捷: c.attributes.dex, 外貌: c.attributes.app, 智力: c.attributes.int,
      意志: c.attributes.pow, 教育: c.attributes.edu,
    }).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(' ');

    const derived = `HP:${c.derived.hp} MP:${c.derived.mp} SAN:${c.derived.san} 幸运:${c.derived.luck}`;

    const nonDefault = Object.entries(c.skills)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');

    return { text: `${c.name} 的属性:\n${attrs}\n${derived}\n${nonDefault}` };
  }

  private deleteAttribute(ctx: CommandContext, name: string): CommandResult {
    const c = this.ensureCharacter(ctx);
    if (this.store.deleteSkill(c.id, name)) {
      return { text: `已删除: ${name}` };
    }
    return { text: `未找到属性: ${name}` };
  }

  private clearAttributes(ctx: CommandContext): CommandResult {
    const c = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    if (c) {
      this.store.delete(c.id);
    }
    return { text: '角色卡已清空。' };
  }

  private exportAttributes(ctx: CommandContext): CommandResult {
    const c = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!c) return { text: '未找到角色卡。' };
    return { text: this.store.exportSt(c.id) };
  }

  private setAttributes(ctx: CommandContext, raw: string): CommandResult {
    const c = this.ensureCharacter(ctx);
    const entries = this.parseStEntries(raw);

    if (entries.length === 0) {
      return { text: '格式：.st 力量:50 体质:55 或 .st hp-1' };
    }

    const changes: string[] = [];

    for (const entry of entries) {
      if (entry.delta !== undefined) {
        let delta = entry.delta;
        if (entry.diceExpr) {
          delta = roll(entry.diceExpr).total * (entry.delta < 0 ? -1 : 1);
        }
        const oldVal = c.skills[entry.name] ??
          (c.derived as Record<string, number>)[entry.name] ?? 0;
        const newVal = this.store.modifySkill(c.id, entry.name, delta);
        changes.push(`${entry.name}: ${oldVal} → ${newVal} (${delta >= 0 ? '+' : ''}${delta})`);
      } else if (entry.value !== undefined) {
        changes.push(`${entry.name}:${entry.value}`);
      }
    }

    // 批量设置（非增减的）
    const setEntries = entries
      .filter(e => e.value !== undefined && e.delta === undefined)
      .map(e => ({ name: e.name, value: e.value! }));
    if (setEntries.length > 0) {
      this.store.batchSet(c.id, setEntries);
    }

    return { text: `${c.name} 属性录入完成，本次录入了 ${changes.length} 条数据\n${changes.join('\n')}` };
  }

  private parseStEntries(raw: string): Array<{
    name: string;
    value?: number;
    delta?: number;
    diceExpr?: string;
  }> {
    const results: Array<{
      name: string; value?: number; delta?: number; diceExpr?: string;
    }> = [];

    // 匹配：属性名:数值 或 属性名+数值 或 属性名-数值 或 属性名+1d6
    const pattern = /([^\s:+\-]+)\s*[:：]\s*(\d+)|([^\s:+\-]+)\s*([+\-])\s*(\d+[dD]\d+|\d+)/g;
    let match;

    while ((match = pattern.exec(raw)) !== null) {
      if (match[1] !== undefined && match[2] !== undefined) {
        results.push({ name: match[1], value: parseInt(match[2]) });
      } else if (match[3] !== undefined && match[4] !== undefined && match[5] !== undefined) {
        const isDice = /[dD]/.test(match[5]);
        const sign = match[4] === '+' ? 1 : -1;
        if (isDice) {
          results.push({ name: match[3], delta: sign, diceExpr: match[5] });
        } else {
          results.push({ name: match[3], delta: sign * parseInt(match[5]) });
        }
      }
    }

    return results;
  }
}
