/**
 * CoC7 技能成长命令：.en
 *
 * 支持格式：
 *  .en 侦查        使用角色卡中的技能值进行成长检定
 *  .en 侦查 49     指定技能值进行成长检定
 *
 * 规则（按 ROADMAP 约定）：
 * - 成功/大成功时，投 1d10 增长技能
 * - 失败/大失败不增长
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { CheckResolver } from '../../rules/coc7/CheckResolver';
import type { CharacterStore } from '../sheet/CharacterStore';
import { roll } from '../../rules/dice/DiceEngine';

interface ParsedGrowthInput {
  skillName?: string;
  targetValue?: number;
}

export class EnCommand implements CommandHandler {
  name = 'en';
  description = '技能成长：.en 技能名 [技能值]';

  private checkResolver: CheckResolver;
  private characterStore: CharacterStore;

  constructor(checkResolver: CheckResolver, characterStore: CharacterStore) {
    this.checkResolver = checkResolver;
    this.characterStore = characterStore;
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const character = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
    if (!character) {
      return { text: '未找到角色卡。使用 .pc new 创建角色卡并用 .st 录入技能。' };
    }

    const { skillName, targetValue } = this.parseSkillAndValue(character.skills, cmd.args);
    if (!skillName || targetValue === undefined) {
      return { text: '格式：.en 技能名 [技能值]，例如 .en 侦查 或 .en 侦查 49' };
    }

    const check = this.checkResolver.check(targetValue);
    const isSuccess = ['regular', 'hard', 'extreme', 'critical'].includes(check.successLevel);

    if (!isSuccess) {
      return {
        text: `${skillName} 成长检定：${check.detail}\n成长失败，技能保持 ${targetValue}。`,
      };
    }

    const growthRoll = roll('1d10').total;
    const oldValue = targetValue;
    const newValue = Math.min(99, oldValue + growthRoll);
    const actualGrowth = newValue - oldValue;

    this.characterStore.setSkill(character.id, skillName, newValue);

    const cappedSuffix = actualGrowth < growthRoll ? '（达到上限 99）' : '';
    return {
      text: `${skillName} 成长检定：${check.detail}\n成长骰：1d10=${growthRoll}\n${skillName}：${oldValue} → ${newValue}（+${actualGrowth}）${cappedSuffix}`,
    };
  }

  private parseSkillAndValue(
    skills: Record<string, number>,
    args: string[],
  ): ParsedGrowthInput {
    if (args.length === 0) return {};

    const last = args[args.length - 1];
    const numericLast = parseInt(last, 10);

    if (!isNaN(numericLast) && args.length >= 2) {
      const skillName = args.slice(0, -1).join('');
      return { skillName, targetValue: numericLast };
    }

    const skillName = args.join('');
    const targetValue = skills[skillName];
    return { skillName, targetValue };
  }
}

