/**
 * CoC7 战斗解算器
 *
 * 实现 CoC7 的战斗相关规则：
 * - 先攻掷骰与排序
 * - 攻击/闪避/反击检定
 * - 伤害计算与重伤判定
 * - 濒死状态
 */

import { roll, type RollResult } from '../dice/DiceEngine';
import { CheckResolver, type CheckResult } from './CheckResolver';

/* ─── 类型 ─── */

export interface InitiativeEntry {
  characterId: string;
  name: string;
  dex: number;
  rollResult: number;
  total: number; // dex + rollResult 或纯 dex 排序
}

export interface DamageResult {
  expression: string;
  rollResult: RollResult;
  total: number;
  isMajorWound: boolean; // 重伤：单次 ≥ 最大HP/2
}

export interface CombatantState {
  characterId: string;
  name: string;
  hp: number;
  maxHp: number;
  majorWound: boolean;
  unconscious: boolean;
  dying: boolean;
}

/* ─── 先攻 ─── */

export class InitiativeTracker {
  private entries: InitiativeEntry[] = [];

  add(characterId: string, name: string, dex: number, modifier: number = 0): InitiativeEntry {
    const entry: InitiativeEntry = {
      characterId,
      name,
      dex,
      rollResult: modifier,
      total: dex + modifier,
    };
    this.entries.push(entry);
    this.sort();
    return entry;
  }

  sort(): void {
    this.entries.sort((a, b) => b.total - a.total);
  }

  list(): InitiativeEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  format(): string {
    if (this.entries.length === 0) return '先攻列表为空';
    return this.entries
      .map((e, i) => `${i + 1}. ${e.name} (${e.total})`)
      .join('\n');
  }
}

/* ─── 伤害 ─── */

export class CombatResolver {
  private checkResolver: CheckResolver;

  constructor(checkResolver: CheckResolver) {
    this.checkResolver = checkResolver;
  }

  /**
   * 计算伤害
   */
  rollDamage(expression: string, maxHp: number): DamageResult {
    const rollResult = roll(expression);
    const isMajorWound = rollResult.total >= Math.floor(maxHp / 2);

    return {
      expression,
      rollResult,
      total: rollResult.total,
      isMajorWound,
    };
  }

  /**
   * 应用伤害到角色状态
   */
  applyDamage(state: CombatantState, damage: number): CombatantState {
    const newHp = Math.max(0, state.hp - damage);
    const isMajorWound = damage >= Math.floor(state.maxHp / 2);

    const updated: CombatantState = {
      ...state,
      hp: newHp,
      majorWound: state.majorWound || isMajorWound,
    };

    if (newHp <= 0) {
      if (updated.majorWound) {
        updated.dying = true;
      } else {
        updated.unconscious = true;
      }
    }

    return updated;
  }

  /**
   * 急救：回复 1 点 HP
   */
  applyFirstAid(state: CombatantState): { state: CombatantState; check: CheckResult } {
    const check = this.checkResolver.check(0); // 需要传入急救技能值
    const healed = check.successLevel !== 'failure' && check.successLevel !== 'fumble';

    const newState: CombatantState = {
      ...state,
      hp: healed ? Math.min(state.maxHp, state.hp + 1) : state.hp,
    };

    if (healed && state.dying) {
      newState.dying = false;
      newState.unconscious = true; // 脱离濒死进入昏迷
    }

    return { state: newState, check };
  }

  /**
   * 格式化战斗状态
   */
  formatState(state: CombatantState): string {
    const flags: string[] = [];
    if (state.majorWound) flags.push('重伤');
    if (state.unconscious) flags.push('昏迷');
    if (state.dying) flags.push('濒死');

    return `${state.name}: HP ${state.hp}/${state.maxHp}${flags.length ? ' [' + flags.join(',') + ']' : ''}`;
  }
}
