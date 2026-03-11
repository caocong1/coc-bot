/**
 * 多角色卡管理命令：.pc
 *
 *  .pc new [名字]       新建角色卡
 *  .pc tag [名字]       切换绑定角色卡
 *  .pc list             列出所有角色卡
 *  .pc show [名字]      显示指定角色卡
 *  .pc del [名字]       删除角色卡
 *  .pc nn [新名字]      重命名当前卡
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { CharacterStore } from './CharacterStore';

export class PcCommand implements CommandHandler {
  name = 'pc';
  description = '角色卡管理：.pc new/list/tag/show/del/nn';

  private store: CharacterStore;
  constructor(store: CharacterStore) { this.store = store; }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const sub = cmd.args[0]?.toLowerCase();
    const arg = cmd.args.slice(1).join(' ');

    switch (sub) {
      case 'new': return this.newCard(ctx, arg);
      case 'tag': return this.tagCard(ctx, arg);
      case 'list': return this.listCards(ctx);
      case 'show': return this.showCard(ctx, arg);
      case 'del': case 'delete': return this.deleteCard(ctx, arg);
      case 'nn': return this.renameCard(ctx, arg);
      default:
        return { text: '用法：.pc new/list/tag/show/del/nn [参数]' };
    }
  }

  private newCard(ctx: CommandContext, name: string): CommandResult {
    const cardName = name || `调查员${Date.now() % 10000}`;
    const existing = this.store.listByPlayer(ctx.userId);
    if (existing.length >= 16) {
      return { text: '角色卡数量已达上限（16张）' };
    }
    const c = this.store.create(ctx.userId, cardName);
    return { text: `已创建角色卡: ${c.name}` };
  }

  private tagCard(ctx: CommandContext, name: string): CommandResult {
    if (!name) {
      // 解绑
      return { text: '已解除当前群的角色卡绑定' };
    }
    const cards = this.store.listByPlayer(ctx.userId);
    const target = cards.find(c => c.name === name);
    if (!target) {
      return { text: `未找到角色卡: ${name}` };
    }
    this.store.setActive(ctx.userId, target.id, ctx.groupId);
    return { text: `已切换角色卡: ${target.name}` };
  }

  private listCards(ctx: CommandContext): CommandResult {
    const cards = this.store.listByPlayer(ctx.userId);
    if (cards.length === 0) {
      return { text: '你还没有角色卡。使用 .pc new [名字] 创建。' };
    }
    const active = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    const lines = cards.map(c =>
      `${c.id === active?.id ? '▸ ' : '  '}${c.name}${c.occupation ? ` (${c.occupation})` : ''}`
    );
    return { text: `角色卡列表:\n${lines.join('\n')}` };
  }

  private showCard(ctx: CommandContext, name: string): CommandResult {
    const cards = this.store.listByPlayer(ctx.userId);
    const target = name
      ? cards.find(c => c.name === name)
      : this.store.getActiveCharacter(ctx.userId, ctx.groupId);

    if (!target) {
      return { text: name ? `未找到角色卡: ${name}` : '当前没有绑定角色卡' };
    }

    return { text: this.store.exportSt(target.id) };
  }

  private deleteCard(ctx: CommandContext, name: string): CommandResult {
    if (!name) return { text: '请指定要删除的角色卡名' };
    const cards = this.store.listByPlayer(ctx.userId);
    const target = cards.find(c => c.name === name);
    if (!target) return { text: `未找到角色卡: ${name}` };
    this.store.delete(target.id);
    return { text: `已删除角色卡: ${name}` };
  }

  private renameCard(ctx: CommandContext, newName: string): CommandResult {
    if (!newName) return { text: '请指定新名字' };
    const c = this.store.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!c) return { text: '当前没有绑定角色卡' };
    const old = c.name;
    this.store.renameCharacter(c.id, newName);
    return { text: `角色卡已重命名: ${old} → ${newName}` };
  }
}
