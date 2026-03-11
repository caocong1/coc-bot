/**
 * 设置房规命令：.setcoc
 *
 *  .setcoc 0      规则书默认
 *  .setcoc 2      常用房规
 *  .setcoc show   查看当前房规
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { CheckResolver, type HouseRule } from '../../rules/coc7/CheckResolver';

const RULE_DESCRIPTIONS: Record<number, string> = {
  0: '规则书默认：出1大成功，不满50出96-100大失败，满50出100大失败',
  1: '不满50出1大成功，满50出1-5大成功；不满50出96-100大失败，满50出100大失败',
  2: '出1-5且≤成功率大成功；出96-100且>成功率大失败',
  3: '出1-5大成功；出96-100大失败',
  4: '出1-5且≤成功率/10大成功；不满50出≥96+成功率/10大失败，满50出100大失败',
  5: '出1-2且≤成功率/5大成功；不满50出96-100大失败，满50出99-100大失败',
};

export class SetCocCommand implements CommandHandler {
  name = 'setcoc';
  description = '设置房规：.setcoc 0-5 / .setcoc show';

  private resolvers: Map<number, CheckResolver> = new Map();
  private groupRules: Map<number, HouseRule> = new Map();
  private defaultResolver: CheckResolver;

  constructor(defaultResolver: CheckResolver) {
    this.defaultResolver = defaultResolver;
  }

  getResolver(groupId?: number): CheckResolver {
    if (groupId !== undefined) {
      const rule = this.groupRules.get(groupId);
      if (rule !== undefined) {
        let resolver = this.resolvers.get(rule);
        if (!resolver) {
          resolver = new CheckResolver();
          resolver.setHouseRule(rule);
          this.resolvers.set(rule, resolver);
        }
        return resolver;
      }
    }
    return this.defaultResolver;
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const arg = cmd.args[0]?.toLowerCase();

    if (!arg || arg === 'show') {
      const current = ctx.groupId ? this.groupRules.get(ctx.groupId) ?? 0 : 0;
      return { text: `当前房规: ${current}\n${RULE_DESCRIPTIONS[current]}` };
    }

    const ruleNum = parseInt(arg);
    if (isNaN(ruleNum) || ruleNum < 0 || ruleNum > 5) {
      return { text: '房规编号 0-5，使用 .setcoc show 查看当前设置' };
    }

    if (ctx.groupId) {
      this.groupRules.set(ctx.groupId, ruleNum as HouseRule);
    }
    this.defaultResolver.setHouseRule(ruleNum as HouseRule);

    return { text: `房规已设置为 ${ruleNum}\n${RULE_DESCRIPTIONS[ruleNum]}` };
  }
}
