/**
 * CoC7 理智检定解算器
 *
 * 实现 CoC7 的 SAN 检定流程：
 * - 理智检定
 * - 成功/失败损失计算
 * - 临时/不定性/永久性疯狂判定
 * - 疯狂发作症状表
 */

import { roll, rollD100 } from '../dice/DiceEngine';
import { CheckResolver, type CheckResult } from './CheckResolver';

/* ─── 类型 ─── */

export interface SanCheckInput {
  currentSan: number;
  successLoss: string;   // 如,"0" 或 "1" 或 "1d3"
  failureLoss: string;   // 如,"1d6" 或 "1d10"
}

export interface SanCheckResult {
  check: CheckResult;
  lossExpression: string;
  lossRoll: number;
  actualLoss: number;    // 经上限截断 / 减半后的实际损失
  newSan: number;
  temporaryInsanity: boolean;
  indefiniteInsanity: boolean;
  detail: string;
}

/* ─── 临时疯狂症状表 ─── */

const TEMPORARY_INSANITY: string[] = [
  '失忆：调查员回过神来，发现自己身处陌生环境，不记得发生过什么。',
  '假性残疾：调查员陷入心因性失明、失聪或肢体失灵。',
  '暴力倾向：调查员陷入狂暴，攻击周围的一切。',
  '偏执：调查员深信有人要害自己。',
  '重要之人：调查员产生与重要之人相关的幻觉。',
  '昏厥：调查员直接昏倒。',
  '逃跑：调查员会不顾一切地疯狂逃离。',
  '歇斯底里：调查员大笑、大哭或尖叫不止。',
  '恐惧症：调查员获得一个新的恐惧症。',
  '躁狂症：调查员获得一个新的躁狂症。',
];

const SUMMARY_INSANITY: string[] = [
  '失忆：调查员发现自己身处陌生环境，不记得这段时间发生过什么。',
  '被送进精神病院或被警察拘留。',
  '在噩梦与幻觉的折磨中醒来。',
  '遭遇暴力事件。',
  '特质/信念表现异常。',
  '与"重要之人"的关系恶化。',
  '在未知地点醒来，衣衫不整。',
  '被极度恐惧笼罩。',
  '产生恐惧症。',
  '产生躁狂症。',
];

/* ─── 解算器 ─── */

export class SanityResolver {
  private checkResolver: CheckResolver;

  constructor(checkResolver: CheckResolver) {
    this.checkResolver = checkResolver;
  }

  /**
   * 执行理智检定
   */
  sanCheck(input: SanCheckInput): SanCheckResult {
    const check = this.checkResolver.check(input.currentSan);

    const isSuccess = check.successLevel !== 'failure' && check.successLevel !== 'fumble';
    const lossExpr = isSuccess ? input.successLoss : input.failureLoss;

    // 大失败直接损失最大值
    let lossRoll: number;
    if (check.isFumble) {
      lossRoll = this.maxLoss(input.failureLoss);
    } else {
      const rollResult = roll(lossExpr);
      lossRoll = rollResult.total;
    }

    const actualLoss = Math.max(0, lossRoll);
    const newSan = Math.max(0, input.currentSan - actualLoss);

    // 判定疯狂
    const temporaryInsanity = actualLoss >= 5;
    const indefiniteInsanity = actualLoss >= Math.floor(input.currentSan / 5);

    const successStr = isSuccess ? '成功' : '失败';
    const detail = [
      `理智检定: ${check.detail}`,
      `${successStr}！理智损失: ${lossExpr}=${actualLoss}`,
      `理智变化: ${input.currentSan} → ${newSan}`,
      temporaryInsanity ? '⚠ 触发临时性疯狂！' : '',
      indefiniteInsanity ? '⚠ 触发不定性疯狂！' : '',
    ].filter(Boolean).join('\n');

    return {
      check,
      lossExpression: lossExpr,
      lossRoll,
      actualLoss,
      newSan,
      temporaryInsanity,
      indefiniteInsanity,
      detail,
    };
  }

  /**
   * 临时疯狂症状（即时症状）
   */
  rollTemporaryInsanity(): { index: number; symptom: string; duration: string } {
    const index = Math.floor(Math.random() * TEMPORARY_INSANITY.length);
    const rounds = roll('1d10').total;
    return {
      index: index + 1,
      symptom: TEMPORARY_INSANITY[index],
      duration: `${rounds} 轮`,
    };
  }

  /**
   * 总结疯狂症状
   */
  rollSummaryInsanity(): { index: number; symptom: string; duration: string } {
    const index = Math.floor(Math.random() * SUMMARY_INSANITY.length);
    const hours = roll('1d10').total;
    return {
      index: index + 1,
      symptom: SUMMARY_INSANITY[index],
      duration: `${hours} 小时`,
    };
  }

  /**
   * 计算表达式最大值（用于大失败时）
   */
  private maxLoss(expr: string): number {
    // 替换 NdM 为 N*M 然后求值
    const maxExpr = expr.replace(
      /(\d+)?[dD](\d+)/g,
      (_, count, sides) => String((parseInt(count) || 1) * parseInt(sides)),
    );
    try {
      const result = roll(maxExpr);
      return result.total;
    } catch {
      return parseInt(expr) || 0;
    }
  }
}
