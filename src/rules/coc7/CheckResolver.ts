/**
 * CoC7 检定解算器
 *
 * 实现 CoC7 版的技能/属性检定，包括：
 * - 成功等级判定（大成功、极限、困难、常规、失败、大失败）
 * - 6 种内置房规
 * - 奖励骰/惩罚骰检定
 * - 对抗检定
 */

import { rollD100, rollBonus, rollPenalty } from '../dice/DiceEngine';

/* ─── 类型 ─── */

export type SuccessLevel =
  | 'fumble'      // 大失败
  | 'failure'     // 失败
  | 'regular'     // 常规成功
  | 'hard'        // 困难成功
  | 'extreme'     // 极限成功
  | 'critical';   // 大成功

export interface CheckResult {
  roll: number;
  targetValue: number;
  hardValue: number;
  extremeValue: number;
  successLevel: SuccessLevel;
  isCritical: boolean;
  isFumble: boolean;
  detail: string;
}

export interface OpposedResult {
  attacker: CheckResult;
  defender: CheckResult;
  winner: 'attacker' | 'defender' | 'tie';
}

/* ─── 房规 ─── */

/**
 * 房规编号说明：
 * 0 - 规则书默认
 * 1 - 常用变体
 * 2 - 出 1-5 且 ≤ 成功率为大成功，出 96-100 且 > 成功率为大失败
 * 3 - 出 1-5 大成功，出 96-100 大失败
 * 4 - 变体
 * 5 - 变体
 */
export type HouseRule = 0 | 1 | 2 | 3 | 4 | 5;

/* ─── 检定 ─── */

export class CheckResolver {
  private houseRule: HouseRule = 0;

  setHouseRule(rule: HouseRule): void {
    this.houseRule = rule;
  }

  getHouseRule(): HouseRule {
    return this.houseRule;
  }

  /**
   * 执行一次检定
   */
  check(targetValue: number, bonus?: number, penalty?: number): CheckResult {
    let rollValue: number;

    if (bonus && bonus > 0) {
      const r = rollBonus(bonus);
      rollValue = r.total;
    } else if (penalty && penalty > 0) {
      const r = rollPenalty(penalty);
      rollValue = r.total;
    } else {
      rollValue = rollD100();
    }

    return this.resolve(rollValue, targetValue);
  }

  /**
   * 给定掷骰值和目标值，判定结果
   */
  resolve(rollValue: number, targetValue: number): CheckResult {
    const hard = Math.floor(targetValue / 2);
    const extreme = Math.floor(targetValue / 5);

    const isCritical = this.isCriticalSuccess(rollValue, targetValue);
    const isFumble = this.isFumbleFailure(rollValue, targetValue);

    let successLevel: SuccessLevel;

    if (isCritical) {
      successLevel = 'critical';
    } else if (isFumble) {
      successLevel = 'fumble';
    } else if (rollValue <= extreme) {
      successLevel = 'extreme';
    } else if (rollValue <= hard) {
      successLevel = 'hard';
    } else if (rollValue <= targetValue) {
      successLevel = 'regular';
    } else {
      successLevel = 'failure';
    }

    const levelNames: Record<SuccessLevel, string> = {
      critical: '大成功',
      extreme: '极限成功',
      hard: '困难成功',
      regular: '成功',
      failure: '失败',
      fumble: '大失败',
    };

    const detail = `D100=${rollValue}/${targetValue} ${levelNames[successLevel]}`;

    return {
      roll: rollValue,
      targetValue,
      hardValue: hard,
      extremeValue: extreme,
      successLevel,
      isCritical,
      isFumble,
      detail,
    };
  }

  /**
   * 对抗检定
   */
  opposed(
    attackerTarget: number,
    defenderTarget: number,
    attackerBonus?: number,
    attackerPenalty?: number,
    defenderBonus?: number,
    defenderPenalty?: number,
  ): OpposedResult {
    const attacker = this.check(attackerTarget, attackerBonus, attackerPenalty);
    const defender = this.check(defenderTarget, defenderBonus, defenderPenalty);

    const levels: SuccessLevel[] = ['fumble', 'failure', 'regular', 'hard', 'extreme', 'critical'];
    const aRank = levels.indexOf(attacker.successLevel);
    const dRank = levels.indexOf(defender.successLevel);

    let winner: 'attacker' | 'defender' | 'tie';
    if (aRank > dRank) {
      winner = 'attacker';
    } else if (dRank > aRank) {
      winner = 'defender';
    } else {
      // 同等级比目标值高的胜出
      winner = attackerTarget >= defenderTarget ? 'attacker' : 'defender';
    }

    return { attacker, defender, winner };
  }

  /* ─── 房规判定 ─── */

  private isCriticalSuccess(roll: number, target: number): boolean {
    switch (this.houseRule) {
      case 0: return roll === 1;
      case 1: return target < 50 ? roll === 1 : roll >= 1 && roll <= 5;
      case 2: return roll >= 1 && roll <= 5 && roll <= target;
      case 3: return roll >= 1 && roll <= 5;
      case 4: return roll >= 1 && roll <= 5 && roll <= Math.floor(target / 10);
      case 5: return roll >= 1 && roll <= 2 && roll <= Math.floor(target / 5);
      default: return roll === 1;
    }
  }

  private isFumbleFailure(roll: number, target: number): boolean {
    switch (this.houseRule) {
      case 0: return target < 50 ? roll >= 96 : roll === 100;
      case 1: return target < 50 ? roll >= 96 : roll === 100;
      case 2: return roll >= 96 && roll > target;
      case 3: return roll >= 96;
      case 4: return target < 50
        ? roll >= 96 + Math.floor(target / 10)
        : roll === 100;
      case 5: return target < 50 ? roll >= 96 : roll >= 99;
      default: return target < 50 ? roll >= 96 : roll === 100;
    }
  }
}
