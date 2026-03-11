/**
 * CoC7 检定命令：.ra / .rc
 *
 * 支持格式：
 *  .ra 侦查              使用角色卡中的技能值
 *  .ra 侦查 60            指定技能值
 *  .ra 困难侦查            困难检定
 *  .ra 极难侦查            极难检定
 *  .ra 3# 侦查            多轮检定
 *  .ra b2 侦查            奖励骰
 *  .rah 心理学             暗中检定
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { CheckResolver, type HouseRule } from '../../rules/coc7/CheckResolver';
import type { CharacterStore } from '../sheet/CharacterStore';

export class CheckCommand implements CommandHandler {
  name = 'ra';
  aliases = ['rc', 'rah', 'rch'];
  description = '检定：.ra 侦查 / .rc 侦查 60 / .ra 困难侦查 / .rah 心理学';

  private checkResolver: CheckResolver;
  private characterStore: CharacterStore;

  constructor(checkResolver: CheckResolver, characterStore: CharacterStore) {
    this.checkResolver = checkResolver;
    this.characterStore = characterStore;
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const isHidden = cmd.name === 'rah' || cmd.name === 'rch';

    // 解析技能名和目标值
    const { skillName, targetValue } = this.parseSkillAndValue(ctx, cmd);

    if (!skillName || targetValue === undefined) {
      return { text: '格式错误。用法：.ra 技能名 [技能值]' };
    }

    // 应用困难等级修正
    let effectiveTarget = targetValue;
    let difficultyLabel = '';
    if (cmd.difficulty === 'hard') {
      effectiveTarget = Math.floor(targetValue / 2);
      difficultyLabel = '困难';
    } else if (cmd.difficulty === 'extreme') {
      effectiveTarget = Math.floor(targetValue / 5);
      difficultyLabel = '极难';
    }

    // 多轮检定
    if (cmd.repeat && cmd.repeat > 1) {
      const results = [];
      for (let i = 0; i < Math.min(cmd.repeat, 10); i++) {
        results.push(this.checkResolver.check(effectiveTarget, cmd.bonus, cmd.penalty));
      }
      const lines = results.map((r, i) => `  #${i + 1}: ${r.detail}`);
      const text = `${difficultyLabel}${skillName} 检定×${cmd.repeat}:\n${lines.join('\n')}`;
      return isHidden
        ? { text, private: true, publicHint: `${ctx.senderName ?? ctx.userId} 进行了暗中检定。` }
        : { text };
    }

    // 单次检定
    const result = this.checkResolver.check(effectiveTarget, cmd.bonus, cmd.penalty);
    const text = `${difficultyLabel}${skillName} ${result.detail}`;

    if (isHidden) {
      return {
        text,
        private: true,
        publicHint: `${ctx.senderName ?? ctx.userId} 进行了一次暗中检定。`,
      };
    }

    return { text };
  }

  private parseSkillAndValue(
    ctx: CommandContext,
    cmd: ParsedCommand,
  ): { skillName?: string; targetValue?: number } {
    const args = [...cmd.args];
    if (args.length === 0) return {};

    // 尝试从最后一个参数提取数值
    const lastArg = args[args.length - 1];
    const numericLast = parseInt(lastArg);

    if (!isNaN(numericLast) && args.length >= 2) {
      const skillName = args.slice(0, -1).join('');
      return { skillName, targetValue: numericLast };
    }

    // 带运算的技能值: 侦查+10, 敏捷*5
    const withMathMatch = args.join('').match(/^(.+?)([+\-*/]\d+)$/);
    if (withMathMatch) {
      const skillName = withMathMatch[1];
      const modifier = withMathMatch[2];
      const baseValue = this.lookupSkill(ctx, skillName);
      if (baseValue !== undefined) {
        const finalValue = eval(`${baseValue}${modifier}`) as number;
        return { skillName: skillName + modifier, targetValue: Math.max(1, Math.min(finalValue, 999)) };
      }
    }

    // 从角色卡查找
    const skillName = args.join('');
    const fromCard = this.lookupSkill(ctx, skillName);
    if (fromCard !== undefined) {
      return { skillName, targetValue: fromCard };
    }

    // 如果只有一个纯数字参数
    if (args.length === 1 && !isNaN(parseInt(args[0]))) {
      return { skillName: '检定', targetValue: parseInt(args[0]) };
    }

    return { skillName, targetValue: undefined };
  }

  private lookupSkill(ctx: CommandContext, skillName: string): number | undefined {
    const character = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!character) return undefined;
    return character.skills[skillName];
  }
}
