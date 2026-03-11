/**
 * 命令解析器
 *
 * 从消息文本解析命令名、子命令和参数。
 * 兼容 Dice! 和海豹骰的常见指令格式。
 */

/* ─── 解析结果 ─── */

export interface ParsedCommand {
  /** 主命令名（小写），如 r, ra, rc, st, pc, sc, coc, setcoc, help, bot */
  name: string;
  /** 命令后面的全部原始文本 */
  rawArgs: string;
  /** 按空格拆分的参数列表 */
  args: string[];
  /** 多轮标记：3#1d6 中的 3 */
  repeat?: number;
  /** 奖惩骰标记 */
  bonus?: number;
  penalty?: number;
  /** 困难等级前缀 */
  difficulty?: 'hard' | 'extreme';
}

/* ─── 命令前缀字符 ─── */

const PREFIX_RE = /^[.。!！/]/;

/**
 * 命令解析器
 */
export class CommandParser {
  /**
   * 判断文本是否是命令
   */
  isCommand(text: string): boolean {
    return PREFIX_RE.test(text.trim());
  }

  /**
   * 解析命令文本
   */
  parse(text: string): ParsedCommand | null {
    const trimmed = text.trim();
    if (!PREFIX_RE.test(trimmed)) return null;

    // 去除前缀
    const body = trimmed.replace(PREFIX_RE, '');
    if (!body) return null;

    // 提取命令名 —— 命令名仅由字母组成
    const nameMatch = body.match(/^([a-zA-Z]+)/);
    if (!nameMatch) return null;

    const name = nameMatch[1].toLowerCase();
    let rest = body.slice(nameMatch[0].length).trim();

    let repeat: number | undefined;
    let bonus: number | undefined;
    let penalty: number | undefined;
    let difficulty: 'hard' | 'extreme' | undefined;

    // 检查多轮标记：紧接命令名后 3#
    const repeatMatch = rest.match(/^(\d+)#\s*/);
    if (repeatMatch) {
      repeat = parseInt(repeatMatch[1]);
      rest = rest.slice(repeatMatch[0].length);
    }

    // 检查奖惩骰（仅对 r/ra/rc 类命令）
    if (['r', 'ra', 'rc', 'rh', 'rah', 'rch'].includes(name)) {
      // .rb2 / .rp
      const bpMatch = body.match(/^r([bp])(\d*)/);
      if (bpMatch) {
        const count = parseInt(bpMatch[2]) || 1;
        if (bpMatch[1] === 'b') bonus = count;
        else penalty = count;
        rest = body.slice(bpMatch[0].length).trim();
      }
    }

    // 检查困难等级前缀
    if (['ra', 'rc'].includes(name)) {
      if (rest.startsWith('困难')) {
        difficulty = 'hard';
        rest = rest.slice(2).trim();
      } else if (rest.startsWith('极难')) {
        difficulty = 'extreme';
        rest = rest.slice(2).trim();
      }
    }

    const args = rest ? rest.split(/\s+/) : [];

    return { name, rawArgs: rest, args, repeat, bonus, penalty, difficulty };
  }
}
