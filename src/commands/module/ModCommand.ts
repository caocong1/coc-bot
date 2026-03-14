/**
 * .mod 指令
 *
 * .mod list [页码]  — 列出可用模组（每页 5 个，显示序号）
 * .mod info <序号>  — 查看模组详情
 */

import type { Database } from 'bun:sqlite';
import type { CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';

const PAGE_SIZE = 5;

interface ModuleRow {
  id: string;
  name: string;
  description: string | null;
  era: string | null;
  allowed_occupations: string;
  min_stats: string;
}

export class ModCommand {
  readonly name = 'mod';
  readonly aliases: string[] = ['module'];
  readonly description = '查看可用模组列表';

  constructor(private readonly db: Database) {}

  async handle(_ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const sub = (cmd.args[0] ?? 'list').toLowerCase();
    if (sub === 'info') return this.info(cmd);
    return this.list(cmd);
  }

  /**
   * 按 created_at DESC 返回所有模组（用于序号查找）。
   */
  private allModules(): ModuleRow[] {
    return this.db.query<ModuleRow, []>(
      'SELECT id, name, description, era, allowed_occupations, min_stats FROM scenario_modules ORDER BY created_at DESC',
    ).all();
  }

  /**
   * 通过序号（1-based）查找模组。
   */
  getModuleByIndex(index: number): ModuleRow | null {
    const all = this.allModules();
    return all[index - 1] ?? null;
  }

  private list(cmd: ParsedCommand): CommandResult {
    const pageArg = parseInt(cmd.args.find((a) => /^\d+$/.test(a)) ?? '1', 10);
    const page = Math.max(1, isNaN(pageArg) ? 1 : pageArg);

    const all = this.allModules();
    if (all.length === 0) {
      return { text: '暂无可用模组。管理员可通过后台「模组管理」上传模组。' };
    }

    const totalPages = Math.ceil(all.length / PAGE_SIZE);
    const offset = (page - 1) * PAGE_SIZE;
    const rows = all.slice(offset, offset + PAGE_SIZE);

    const lines = rows.map((m, i) => {
      const idx = offset + i + 1;
      const meta = [m.era].filter(Boolean).join(' · ');
      return `${idx}. ${m.name}${meta ? `（${meta}）` : ''}\n   ${m.description?.slice(0, 60) ?? '（无简介）'}`;
    });

    return {
      text:
        `📚 可用模组（第 ${page}/${totalPages} 页）：\n\n` +
        lines.join('\n\n') +
        (totalPages > 1 ? `\n\n发送 .mod list ${page + 1} 查看更多` : '') +
        '\n\n创建房间：.room create <名称> <序号>',
    };
  }

  private info(cmd: ParsedCommand): CommandResult {
    const arg = cmd.args[1]?.trim();
    if (!arg) return { text: '用法：.mod info <序号>' };

    const index = parseInt(arg, 10);
    if (isNaN(index) || index < 1) return { text: '请输入有效的模组序号（数字），可通过 .mod list 查看' };

    const m = this.getModuleByIndex(index);
    if (!m) return { text: `序号 ${index} 超出范围，请通过 .mod list 查看可用模组` };

    const occs = (JSON.parse(m.allowed_occupations) as string[]).join('、');
    const stats = Object.entries(JSON.parse(m.min_stats) as Record<string, number>)
      .map(([k, v]) => `${k}≥${v}`).join(' ');

    return {
      text:
        `📖 ${m.name}\n` +
        (m.era ? `时代：${m.era}\n` : '') +
        (occs ? `职业限制：${occs}\n` : '') +
        (stats ? `最低属性：${stats}\n` : '') +
        `\n${m.description ?? '（无简介）'}\n\n` +
        `创建房间：.room create <名称> ${index}`,
    };
  }
}
