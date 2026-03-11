/**
 * 掷骰引擎
 *
 * 支持：
 *  - NdM          基础掷骰
 *  - NdMkH / kL   取最高/最低 H 个
 *  - b / p         CoC 奖励骰/惩罚骰（百面骰十位替换）
 *  - + - * /       四则运算
 *  - 括号          嵌套
 *  - #             多轮
 */

/* ─── 掷骰结果 ─── */

export interface SingleDieResult {
  sides: number;
  value: number;
  dropped?: boolean;
}

export interface DiceGroupResult {
  expression: string;
  dice: SingleDieResult[];
  kept: number[];
  total: number;
}

export interface RollResult {
  input: string;
  detail: string;       // 展开后的中间步骤
  total: number;
  groups: DiceGroupResult[];
}

/* ─── public api ─── */

export function roll(expression: string): RollResult {
  const groups: DiceGroupResult[] = [];
  let detail = expression;

  // 把每个 NdM(kH|kL)? 替换为数值
  const replaced = expression.replace(
    /(\d+)?[dD](\d+)(?:[kK]([hHlL]?)(\d+))?/g,
    (match, countStr, sidesStr, keepType, keepCountStr) => {
      const count = countStr ? parseInt(countStr) : 1;
      const sides = parseInt(sidesStr);
      const keepCount = keepCountStr ? parseInt(keepCountStr) : undefined;
      const keepHigh = !keepType || keepType.toLowerCase() === 'h';

      const dice: SingleDieResult[] = [];
      for (let i = 0; i < count; i++) {
        dice.push({ sides, value: randInt(1, sides) });
      }

      let kept: number[];
      if (keepCount !== undefined && keepCount < count) {
        const sorted = dice
          .map((d, i) => ({ val: d.value, idx: i }))
          .sort((a, b) => keepHigh ? b.val - a.val : a.val - b.val);

        const keepSet = new Set(sorted.slice(0, keepCount).map(s => s.idx));
        dice.forEach((d, i) => { if (!keepSet.has(i)) d.dropped = true; });
        kept = sorted.slice(0, keepCount).map(s => s.val);
      } else {
        kept = dice.map(d => d.value);
      }

      const total = kept.reduce((s, v) => s + v, 0);
      const group: DiceGroupResult = { expression: match, dice, kept, total };
      groups.push(group);

      const diceStr = dice
        .map(d => d.dropped ? `~~${d.value}~~` : String(d.value))
        .join('+');

      detail = detail.replace(match, `[${diceStr}=${total}]`);
      return String(total);
    },
  );

  // 计算四则运算
  const total = safeEval(replaced);

  return { input: expression, detail, total, groups };
}

/**
 * CoC 奖励骰
 * 掷一个 d100 并额外掷 bonusCount 个十位骰，取最小十位
 */
export function rollBonus(bonusCount: number): RollResult {
  const units = randInt(0, 9);
  const tens: number[] = [];
  for (let i = 0; i <= bonusCount; i++) {
    tens.push(randInt(0, 9));
  }
  const bestTen = Math.min(...tens);
  const total = bestTen * 10 + units === 0 ? 100 : bestTen * 10 + units;

  const detail = `b${bonusCount}: tens=[${tens.join(',')}] units=${units}`;
  return {
    input: `b${bonusCount}`,
    detail,
    total: bestTen * 10 + units || 100,
    groups: [],
  };
}

/**
 * CoC 惩罚骰
 * 掷一个 d100 并额外掷 penaltyCount 个十位骰，取最大十位
 */
export function rollPenalty(penaltyCount: number): RollResult {
  const units = randInt(0, 9);
  const tens: number[] = [];
  for (let i = 0; i <= penaltyCount; i++) {
    tens.push(randInt(0, 9));
  }
  const worstTen = Math.max(...tens);
  const total = worstTen * 10 + units === 0 ? 100 : worstTen * 10 + units;

  const detail = `p${penaltyCount}: tens=[${tens.join(',')}] units=${units}`;
  return {
    input: `p${penaltyCount}`,
    detail,
    total: worstTen * 10 + units || 100,
    groups: [],
  };
}

/**
 * 简单 d100 掷骰
 */
export function rollD100(): number {
  return randInt(1, 100);
}

/**
 * 多轮掷骰
 */
export function rollMultiple(expression: string, times: number): RollResult[] {
  const results: RollResult[] = [];
  for (let i = 0; i < times; i++) {
    results.push(roll(expression));
  }
  return results;
}

/* ─── helpers ─── */

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 安全表达式求值，仅允许数字和 + - * / ( )
 */
function safeEval(expr: string): number {
  const sanitized = expr.replace(/\s/g, '');
  if (!/^[\d+\-*/().]+$/.test(sanitized)) {
    throw new Error(`Invalid expression: ${expr}`);
  }
  // 递归下降解析器
  return parseExpression(sanitized, { pos: 0 });
}

interface ParseState { pos: number }

function parseExpression(s: string, st: ParseState): number {
  let result = parseTerm(s, st);
  while (st.pos < s.length && (s[st.pos] === '+' || s[st.pos] === '-')) {
    const op = s[st.pos++];
    const right = parseTerm(s, st);
    result = op === '+' ? result + right : result - right;
  }
  return result;
}

function parseTerm(s: string, st: ParseState): number {
  let result = parseFactor(s, st);
  while (st.pos < s.length && (s[st.pos] === '*' || s[st.pos] === '/')) {
    const op = s[st.pos++];
    const right = parseFactor(s, st);
    result = op === '*' ? result * right : Math.floor(result / right);
  }
  return result;
}

function parseFactor(s: string, st: ParseState): number {
  if (s[st.pos] === '(') {
    st.pos++; // skip (
    const result = parseExpression(s, st);
    st.pos++; // skip )
    return result;
  }
  if (s[st.pos] === '-') {
    st.pos++;
    return -parseFactor(s, st);
  }
  let numStr = '';
  while (st.pos < s.length && /\d/.test(s[st.pos])) {
    numStr += s[st.pos++];
  }
  return parseInt(numStr) || 0;
}
