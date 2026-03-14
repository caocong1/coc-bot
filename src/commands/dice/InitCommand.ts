/**
 * 先攻掷骰 & 列表管理
 *
 *   .ri              掷 D20 先攻（使用发言者名字）
 *   .ri +5           带加值
 *   .ri -1 独眼怪    指定角色名
 *   .ri 80 怪物甲    直接给固定值（第一个参数是纯整数时视为固定先攻值）
 *   .init            查看先攻列表
 *   .init clr        清空先攻列表
 *
 * 先攻列表是内存级别（群维度），重启清零。
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';

interface InitEntry {
  name: string;
  value: number;
}

// 全局先攻列表，key = groupId（私聊时用 0）
const LISTS = new Map<number, InitEntry[]>();

function formatList(list: InitEntry[]): string {
  return list.map((e, i) => `${i + 1}. ${e.name} — ${e.value}`).join('\n');
}

export class InitCommand implements CommandHandler {
  name = 'ri';
  aliases = ['init'];
  description = '先攻：.ri [+加值] [角色名] / .init / .init clr';

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const groupId = ctx.groupId ?? 0;

    // ── .init 子命令 ──────────────────────────────────────────────────────────
    if (cmd.name === 'init') {
      const sub = (cmd.args[0] ?? '').toLowerCase();
      if (sub === 'clr' || sub === 'clear' || sub === 'cls') {
        LISTS.delete(groupId);
        return { text: '✅ 先攻列表已清空。' };
      }
      const list = LISTS.get(groupId) ?? [];
      if (list.length === 0) return { text: '先攻列表为空。使用 .ri 参与。' };
      return { text: `📋 先攻顺序：\n${formatList(list)}` };
    }

    // ── .ri 掷骰 ─────────────────────────────────────────────────────────────
    const raw = (cmd.rawArgs ?? '').trim();

    let value: number;
    let charName = ctx.senderName ?? String(ctx.userId);
    let detail = '';

    // 匹配：可选的 +/-数字（或纯整数） + 可选空格 + 可选角色名
    const bonusRe = /^([+-]\d+|\d+)\s*(.*)/;
    const m = raw.match(bonusRe);

    if (m) {
      const numPart = parseInt(m[1]);
      const namePart = m[2].trim();

      if (m[1].startsWith('+') || m[1].startsWith('-')) {
        // 带符号 → 当作加值，掷 D20
        const dice = Math.floor(Math.random() * 20) + 1;
        value = dice + numPart;
        charName = namePart || charName;
        const sign = numPart >= 0 ? `+${numPart}` : `${numPart}`;
        detail = `D20(${dice})${sign} = ${value}`;
      } else if (!namePart) {
        // 纯整数且没有后续名字 → 固定先攻值（用于 KP 直接给怪物先攻）
        value = numPart;
        detail = `固定 ${value}`;
      } else {
        // 纯整数 + 角色名 → 固定先攻值
        value = numPart;
        charName = namePart;
        detail = `固定 ${value}`;
      }
    } else if (raw) {
      // 纯文字 → 名字，掷 D20
      charName = raw;
      const dice = Math.floor(Math.random() * 20) + 1;
      value = dice;
      detail = `D20 = ${value}`;
    } else {
      // 无参数，用发言者名字掷 D20
      const dice = Math.floor(Math.random() * 20) + 1;
      value = dice;
      detail = `D20 = ${value}`;
    }

    // 更新列表（同名覆盖）
    if (!LISTS.has(groupId)) LISTS.set(groupId, []);
    const list = LISTS.get(groupId)!;
    const idx = list.findIndex((e) => e.name === charName);
    if (idx !== -1) list.splice(idx, 1);
    list.push({ name: charName, value });
    list.sort((a, b) => b.value - a.value);

    return { text: `🎲 ${charName} 先攻：${detail}\n📋 当前顺序：\n${formatList(list)}` };
  }
}
