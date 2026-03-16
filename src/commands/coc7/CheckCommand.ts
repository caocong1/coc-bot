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
import type { Character } from '../../shared/types/Character';

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
    const { skillName, targetValue, errorReason } = this.parseSkillAndValue(ctx, cmd);

    if (!skillName || targetValue === undefined) {
      if (errorReason === 'no_character') {
        return { text: '未找到角色卡，请先用 .st 或 .pc new 创建角色', error: true };
      }
      if (errorReason === 'skill_not_found' && skillName) {
        return { text: `角色卡中未找到「${skillName}」，请用 .st ${skillName}=数值 设置，或直接 .ra ${skillName} 数值`, error: true };
      }
      return { text: '格式错误。用法：.ra 技能名 [技能值]', error: true };
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
  ): { skillName?: string; targetValue?: number; errorReason?: 'no_args' | 'no_character' | 'skill_not_found' } {
    const args = [...cmd.args];
    if (args.length === 0) return { errorReason: 'no_args' };

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
      const mathSkillName = withMathMatch[1];
      const modifier = withMathMatch[2];
      const mathChar = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
      if (mathChar) {
        const baseValue = this.lookupSkillFromCharacter(mathChar, mathSkillName);
        if (baseValue !== undefined) {
          const finalValue = eval(`${baseValue}${modifier}`) as number;
          return { skillName: mathSkillName + modifier, targetValue: Math.max(1, Math.min(finalValue, 999)) };
        }
      }
    }

    // 从角色卡查找
    const skillName = args.join('');
    const character = this.characterStore.getActiveCharacter(ctx.userId, ctx.groupId);
    if (character) {
      const fromCard = this.lookupSkillFromCharacter(character, skillName);
      if (fromCard !== undefined) {
        return { skillName, targetValue: fromCard };
      }
    }

    // 如果只有一个纯数字参数
    if (args.length === 1 && !isNaN(parseInt(args[0]))) {
      return { skillName: '检定', targetValue: parseInt(args[0]) };
    }

    return {
      skillName,
      targetValue: undefined,
      errorReason: character ? 'skill_not_found' : 'no_character',
    };
  }

  private static readonly ATTR_MAP: Record<string, string> = {
    '力量': 'str', 'str': 'str', 'STR': 'str',
    '体质': 'con', 'con': 'con', 'CON': 'con',
    '体型': 'siz', 'siz': 'siz', 'SIZ': 'siz',
    '敏捷': 'dex', 'dex': 'dex', 'DEX': 'dex',
    '外貌': 'app', 'app': 'app', 'APP': 'app',
    '智力': 'int', 'int': 'int', 'INT': 'int',
    '意志': 'pow', 'pow': 'pow', 'POW': 'pow',
    '教育': 'edu', 'edu': 'edu', 'EDU': 'edu',
  };

  private static readonly DERIVED_MAP: Record<string, string> = {
    'hp': 'hp', 'HP': 'hp', '生命值': 'hp',
    'mp': 'mp', 'MP': 'mp', '魔法值': 'mp',
    'san': 'san', 'SAN': 'san', '理智': 'san',
    '幸运': 'luck', 'luck': 'luck', 'LUCK': 'luck',
  };

  private lookupSkillFromCharacter(character: Character, skillName: string): number | undefined {
    // 1. 基础属性（力量、体质等）
    const attrKey = CheckCommand.ATTR_MAP[skillName];
    if (attrKey) return (character.attributes as Record<string, number>)[attrKey];

    // 2. 派生属性（hp、mp、san、幸运）
    const derivedKey = CheckCommand.DERIVED_MAP[skillName];
    if (derivedKey) return (character.derived as Record<string, number>)[derivedKey];

    // 3. 技能
    return character.skills[skillName];
  }
}
