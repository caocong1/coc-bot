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

    // 提取命令名 —— 首字母必须是字母，后续可含数字（如 v50、coc7）
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (!nameMatch) return null;

    let name = nameMatch[1].toLowerCase();
    let rest = body.slice(nameMatch[0].length);

    // 无空格格式：.r3d6 -> rest = ""，需要从 name 末尾提取骰子表达式
    rest = rest.trim();

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

    // 无空格格式 .r3d6 / .r3d6*5：命令名以"单字母 + 数字"开头时拆分
    // 例如 .r3d6*5 -> name="r3d6*5"，拆成 name="r", rest="3d6*5"
    // 天然排除所有多字母命令（ra、rc、rah、st、ri 等第二个字符是字母）
    const splitMatch = name.match(/^([a-zA-Z])(\d.*)$/i);
    if (splitMatch) {
      name = splitMatch[1].toLowerCase();
      rest = splitMatch[2] + rest;
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
