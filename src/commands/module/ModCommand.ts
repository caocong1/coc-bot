/**
 * .mod 指令
 *
 * .mod list [页码]  — 列出可用模组（每页 5 个，显示序号）
 * .mod info <序号>  — 查看模组详情
 */

import type { Database } from 'bun:sqlite';
import type { CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { summarizeModuleDescriptionForPlayers } from '@shared/scenario/moduleDescription';

const PAGE_SIZE = 5;

interface ModuleRow {
  id: string;
  name: string;
  description: string | null;
  era: string | null;
  allowed_occupations: string;
  total_points: number | null;
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
   * 玩家侧只展示当前没有文档处于导入中的模组，避免把未就绪模组暴露给 .mod / .room 流程。
   */
  private allModules(): ModuleRow[] {
    return this.db.query<ModuleRow, []>(
      `SELECT m.id, m.name, m.description, m.era, m.allowed_occupations, m.total_points
       FROM scenario_modules m
       WHERE NOT EXISTS (
         SELECT 1
         FROM scenario_module_files f
         WHERE f.module_id = m.id
           AND f.file_type = 'document'
           AND f.import_status = 'pending'
       )
       ORDER BY m.created_at DESC`,
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
      const summary = summarizeModuleDescriptionForPlayers(m.description ?? '');
      return `${idx}. ${m.name}${meta ? `（${meta}）` : ''}\n   ${summary.slice(0, 60) || '（无简介）'}`;
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
    const totalPoints = typeof m.total_points === 'number' ? m.total_points : null;

    return {
      text:
        `📖 ${m.name}\n` +
        (m.era ? `时代：${m.era}\n` : '') +
        (occs ? `职业限制：${occs}\n` : '') +
        (totalPoints != null ? `总点要求：${totalPoints}\n` : '') +
        `\n${summarizeModuleDescriptionForPlayers(m.description) || '（无简介）'}\n\n` +
        `创建房间：.room create <名称> ${index}`,
    };
  }
}
