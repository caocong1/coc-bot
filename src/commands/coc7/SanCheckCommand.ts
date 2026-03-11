/**
 * CoC7 理智检定命令：.sc
 *
 * 支持格式：
 *  .sc 1/1d6              成功损失/失败损失
 *  .sc 0/1d4+1            成功不损失
 *  .sc 1d10               简写（成功损失 0）
 *  .sc 1/1d6 70           指定当前 SAN
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { SanityResolver } from '../../rules/coc7/SanityResolver';
import type { CharacterStore } from '../sheet/CharacterStore';

export class SanCheckCommand implements CommandHandler {
  name = 'sc';
  description = '理智检定：.sc 成功损失/失败损失 [当前SAN]';

  private sanityResolver: SanityResolver;
  private characterStore: CharacterStore;

  constructor(sanityResolver: SanityResolver, characterStore: CharacterStore) {
    this.sanityResolver = sanityResolver;
    this.characterStore = characterStore;
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    if (cmd.args.length === 0) {
      return { text: '格式：.sc 成功损失/失败损失 [当前SAN值]' };
    }

    const lossArg = cmd.args[0];
    let successLoss: string;
    let failureLoss: string;

    if (lossArg.includes('/')) {
      const parts = lossArg.split('/');
      successLoss = parts[0];
      failureLoss = parts[1];
    } else {
      successLoss = '0';
      failureLoss = lossArg;
    }

    // 获取当前 SAN
    let currentSan: number | undefined;
    if (cmd.args.length >= 2 && !isNaN(parseInt(cmd.args[1]))) {
      currentSan = parseInt(cmd.args[1]);
    } else {
      const character = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
      currentSan = character?.derived.san;
    }

    if (currentSan === undefined) {
      return { text: '请指定当前 SAN 值，或先用 .st 录入角色卡。用法：.sc 1/1d6 70' };
    }

    const result = this.sanityResolver.sanCheck({
      currentSan,
      successLoss,
      failureLoss,
    });

    // 自动更新角色卡 SAN
    const character = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
    if (character) {
      this.characterStore.updateDerived(character.id, { san: result.newSan });
    }

    return { text: result.detail };
  }
}
