/**
 * 疯狂症状命令：.ti / .li
 *
 *  .ti   临时疯狂症状（即时症状）
 *  .li   总结疯狂症状
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { SanityResolver } from '../../rules/coc7/SanityResolver';

export class InsanityCommand implements CommandHandler {
  name = 'ti';
  aliases = ['li'];
  description = '疯狂症状：.ti 即时症状 / .li 总结症状';

  private sanityResolver: SanityResolver;

  constructor(sanityResolver: SanityResolver) {
    this.sanityResolver = sanityResolver;
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    if (cmd.name === 'li') {
      const r = this.sanityResolver.rollSummaryInsanity();
      return {
        text: `总结疯狂症状 (${r.index}/10):\n${r.symptom}\n持续时间: ${r.duration}`,
      };
    }

    const r = this.sanityResolver.rollTemporaryInsanity();
    return {
      text: `临时疯狂症状 (${r.index}/10):\n${r.symptom}\n持续时间: ${r.duration}`,
    };
  }
}
