/**
 * 今日人品命令：.jrrp [话题]
 *
 * - 基于 userId + 日期哈希出当日固定的 1-100 数字
 * - 每次调用都生成新评价（随机风格），无次数限制
 * - 带后缀话题时：把后缀作为评语参考主题
 * - 兜底文案默认从项目内 jrrp.fallback.json 读取（可用 JRRP_GUGU_FILE 覆盖）
 */

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import { DashScopeClient } from '../../ai/client/DashScopeClient';

const PROJECT_JRRP_FALLBACK_FILE = new URL('./jrrp.fallback.json', import.meta.url);

/* ─── 兜底文案加载 ─── */

interface ProjectJrrpFallbackConfig {
  expr?: string;
}

interface GuguConfig {
  items?: { 娱乐?: { 今日人品?: [string, number][] } };
}

/** 从 {% $t人品 > 99 ? 'a', ... , 1 ? 'z' %} 解析出规则 */
function parseGuguExpr(expr: string): ((value: number) => string) | null {
  const m = expr.match(/\{%\s*([\s\S]*?)\s*%\}/);
  if (!m) return null;

  const rules: Array<{ minExclusive: number; text: string }> = [];
  let fallbackText: string | null = null;

  for (const line of m[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const quoteStart = trimmed.indexOf("'");
    const quoteEnd = trimmed.lastIndexOf("'");
    if (quoteStart < 0 || quoteEnd <= quoteStart) continue;

    const condition = trimmed.slice(0, quoteStart).trim();
    const text = trimmed.slice(quoteStart + 1, quoteEnd).replace(/\\'/g, "'");

    const condMatch = condition.match(/^\$t人品\s*>\s*(\d+)\s*\?$/);
    if (condMatch) {
      rules.push({ minExclusive: parseInt(condMatch[1], 10), text });
      continue;
    }

    if (/^\d+\s*\?$/.test(condition)) {
      fallbackText = text;
    }
  }

  if (!rules.length && !fallbackText) return null;

  return (value: number) => {
    for (const rule of rules) {
      if (value > rule.minExclusive) return rule.text;
    }
    return fallbackText ?? rules[rules.length - 1]?.text ?? '';
  };
}

function parseJsonExpr(content: string): string | null {
  try {
    const data = JSON.parse(content) as ProjectJrrpFallbackConfig;
    return typeof data.expr === 'string' && data.expr ? data.expr : null;
  } catch {
    return null;
  }
}

function loadLegacyGuguFallback(path: string): ((value: number) => string) | null {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  try {
    const content = readFileSync(resolved, 'utf-8');
    const data = JSON.parse(content) as GuguConfig;
    const template = data?.items?.娱乐?.今日人品?.[0]?.[0];
    if (!template || typeof template !== 'string') return null;
    return parseGuguExpr(template);
  } catch (err) {
    console.error('[JRRP] 加载 .jrrp.gugu.txt 失败:', err);
    return null;
  }
}

function loadProjectJrrpFallback(): ((value: number) => string) | null {
  if (!existsSync(PROJECT_JRRP_FALLBACK_FILE)) return null;
  try {
    const content = readFileSync(PROJECT_JRRP_FALLBACK_FILE, 'utf-8');
    const template = parseJsonExpr(content);
    if (!template || typeof template !== 'string') return null;
    return parseGuguExpr(template);
  } catch (err) {
    console.error('[JRRP] 加载项目内 jrrp.fallback.json 失败:', err);
    return null;
  }
}

function loadGuguFallback(): ((value: number) => string) | null {
  // 显式配置时优先读取旧版外部文件，便于兼容个人配置。
  const customPath = process.env.JRRP_GUGU_FILE?.trim();
  if (customPath) {
    const legacy = loadLegacyGuguFallback(customPath);
    if (legacy) return legacy;
    console.error(`[JRRP] JRRP_GUGU_FILE 无法读取: ${customPath}`);
  }

  return loadProjectJrrpFallback();
}

/* ─── 风格类型池 ─── */

interface CommentStyle {
  name: string;
  instruction: string;
}

const STYLES: CommentStyle[] = [
  {
    name: 'coc',
    instruction: '用 CoC/克苏鲁跑团梗（SAN值、大成功、调查员、KP、图书馆一把过、灵感闪现、奈亚等）来评价。',
  },
  {
    name: 'game',
    instruction: '用电子游戏梗（RPG、暴击、装备掉落、隐藏关卡、满血复活、通关、成就解锁、Boss战等）来评价。',
  },
  {
    name: 'anime',
    instruction: '用动漫/二次元梗（主角光环、前方高能、羁绊、觉醒、友情爆发、变身、中二等）来评价。',
  },
  {
    name: 'food',
    instruction: '用美食/做饭比喻来评价（满汉全席、深夜食堂、米其林、完美火候、加个蛋、干饭人、神仙味道等）。',
  },
  {
    name: 'office',
    instruction: '用打工人/职场梗来评价（不想上班、摸鱼成功、准时下班、年终奖、带薪摸鱼、周五心态、团建自由、涨薪等）。',
  },
  {
    name: 'cat',
    instruction: '用猫猫视角来评价（猫主子、纸箱、小鱼干、晒太阳、咕噜咕噜、蹭蹭、踩奶、窗台观鸟等）。',
  },
  {
    name: 'dog',
    instruction: '用狗狗视角来评价（摇尾巴、飞盘接住、遛弯、汪汪队、撒娇打滚、零食到手、被摸头、开心转圈等）。语气憨憨的。',
  },
  {
    name: 'xuanxue',
    instruction: '用玄学/算命风格来评价（锦鲤附体、转运、紫微斗数、上上签、财神眷顾、桃花运、贵人相助等）。',
  },
  {
    name: 'daily',
    instruction: '用日常生活梗来评价（快递到了、外卖准时、WiFi满格、手机满电、空调续命、周末补觉、绿灯一路、车位秒到等）。语气像朋友聊天。',
  },
  {
    name: 'sleep',
    instruction: '用睡觉/熬夜梗来评价（困、熬夜冠军、一觉到天亮、美梦成真、秒睡体质、午觉刚刚好、周末睡到自然醒、被窝舒服、早睡早起等）。',
  },
  {
    name: 'weather',
    instruction: '用天气/出门梗来评价（完美晴天、微风刚好、出门带伞果然下了、樱花季、秋高气爽、雪景拍照、适合散步等）。语气轻松日常。',
  },
];

/* ─── system prompt ─── */

function buildPrompt(style: CommentStyle, value: number, topic?: string): string {
  const tier =
    value >= 90 ? '极高（90-100）' :
    value >= 70 ? '偏高（70-89）' :
    value >= 50 ? '中等（50-69）' :
    value >= 30 ? '偏低（30-49）' :
    value >= 10 ? '很低（10-29）' :
    '极低（1-9）';

  const topicPrompt = topic
    ? `\n额外参考主题：\n- 用户这次特别想看「${topic}」这个方向的评语\n- 请尽量围绕这个主题来写，但只把它当参考场景，不要假定具体事件一定发生\n- 不要机械重复「${topic}」这几个字，可以自然化表达`
    : '';

  return `你是一个QQ群里幽默的骰子机器人。用户掷出了今日人品值 ${value} 分（满分100），属于${tier}档位。

请根据这个具体分数 ${value} 生成一句评价。

风格要求：
${style.instruction}${topicPrompt}

输出规则：
- 1-2句话，不超过50字
- 评价要贴合 ${value} 这个具体数字的高低——${value >= 50 ? '这个分数不错，但别夸成无脑开挂或天命无敌' : '这个分数偏低，请用幽默、安慰、带一点保守建议的方式表达'}
- 低分时少用纯倒霉、纯打击、纯唱衰语气；可以写成“今天别硬上”“适合保守”“宜避坑”“先苟住”这类半正向表达
- 不要写成统一鸡汤，也不要硬拗成大吉；仍然要让人感受到分数有高低差
- 可以巧妙融入数字本身的谐音梗或特殊含义（比如 66=溜溜、69=nice、42=宇宙终极答案、13=反转幸运等），但不是必须
- 不要重复"今日人品"四个字
- 不要加引号、不要解释、不要任何前缀标记，直接输出那句评价
- 幽默、有画面感、让人想转发`;
}

function buildNumberCentricPrompt(style: CommentStyle, value: number, topic?: string): string {
  const topicPrompt = topic
    ? `\n额外参考主题：\n- 用户这次特别想看「${topic}」这个方向的评语\n- 这个主题只是参考场景，不要把它写成唯一重点\n- 请把数字本身的味道放在第一位，再自然带到这个主题上`
    : '';

  return `你负责为 QQ 群里的 .jrrp 命令写一句短评。

这条短评的核心不是“高分低分”，而是“这个具体数字今天到底是什么味道”。
用户今天拿到的号码是 ${value}。

风格要求：
${style.instruction}${topicPrompt}

理解规则：
- 不要把 1~100 粗暴分成高分、低分、中间值来写
- 必须把 ${value} 当成一个独立号码理解，优先从它自己的谐音、节奏、重复、文化联想、数字画面感、怪味道里找灵感
- 即使 34 和 35、66 和 68、13 和 14，也应该写出不同的感觉
- 语气整体可以略偏积极、偏安慰，但不能硬洗成“全都很好”
- 如果数字本身带一点怪、背、邪门、拧巴、滑头、玄学、反转，都可以写出来
- 最好顺手给一句“今天适合怎么做 / 别怎么做”的轻建议

输出规则：
- 只写 1-2 句话，总长度不超过 48 个汉字
- 优先写具体画面、小建议或带梗比喻，少写空泛形容词
- 不要出现“今日人品”“高分”“低分”“评分”“分数”这些字样
- 不要写成统一鸡汤，也不要总是夸张地大吉大利
- 如果给了话题，就把它自然融进语境，不要机械重复原词，不要假定某个具体事件一定发生
- 不要加引号、emoji、括号说明、前缀标签
- 只输出最终短评，不要解释`;
}

/* ─── 命令实现 ─── */

export class JrrpCommand implements CommandHandler {
  name = 'jrrp';
  description = '今日人品：.jrrp [话题]';

  private aiClient: DashScopeClient | null;
  private guguEval: ((value: number) => string) | null = null;

  constructor(aiClient: DashScopeClient | null) {
    this.aiClient = aiClient;
    this.guguEval = loadGuguFallback();
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const today = this.getDateKey();
    const topic = this.normalizeTopic(cmd.rawArgs);
    const value = this.calcJrrp(ctx.userId, today);
    const style = topic
      ? this.pickTopicStyle(ctx.userId, today, topic)
      : this.pickRandomStyle();
    let comment = this.fallbackComment(value);

    if (this.aiClient) {
      try {
        comment = await this.generateComment(value, style, topic || undefined);
      } catch (err) {
        console.error('[JRRP] AI 生成失败，使用默认评价:', err);
      }
    }

    return { text: this.formatResult(ctx, value, comment) };
  }

  /* ─── 确定性哈希 ─── */

  private calcJrrp(userId: number, dateKey: string): number {
    return (Math.abs(this.hash(`jrrp:${userId}:${dateKey}:val`)) % 100) + 1;
  }

  /** 每次调用随机选一个风格 */
  private pickRandomStyle(): CommentStyle {
    return STYLES[Math.floor(Math.random() * STYLES.length)];
  }

  /** 带话题时基于哈希选风格 */
  private pickTopicStyle(userId: number, dateKey: string, topic: string): CommentStyle {
    const idx = Math.abs(this.hash(`jrrp:${userId}:${dateKey}:topic:${topic}`)) % STYLES.length;
    return STYLES[idx];
  }

  private normalizeTopic(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  private hash(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    return h;
  }

  /* ─── AI 生成 ─── */

  private async generateComment(value: number, style: CommentStyle, topic?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let result = '';
      let settled = false;

      const finishResolve = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      void this.aiClient!.streamChat(
        'qwen3.5-flash',
        [
          { role: 'system', content: buildNumberCentricPrompt(style, value, topic) },
          { role: 'user', content: topic ? `我掷出了 ${value} 分，这次想看和「${topic}」相关的评价` : `我掷出了 ${value} 分` },
        ],
        {
          onToken: (token) => { result += token; },
          onDone: () => {
            finishResolve(this.clean(result, value) || this.fallbackComment(value));
          },
          onError: (err) => {
            finishReject(new Error(err));
          },
        },
      ).catch((err) => {
        finishReject(new Error(err instanceof Error ? err.message : String(err)));
      });
    });
  }

  private clean(raw: string, value: number): string {
    return raw
      .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
      .replace(/^["'"「」『』]/g, '')
      .replace(/["'"「」『』]$/g, '')
      .trim() || this.fallbackComment(value);
  }

  /* ─── 兜底（优先使用 .jrrp.gugu.txt）─── */

  private fallbackComment(value: number): string {
    if (this.guguEval) {
      try {
        const s = this.guguEval(value);
        if (s && typeof s === 'string') return s;
      } catch (_) {}
    }
    return `（未找到 jrrp.fallback.json 兜底文案，当前分数 ${value}）`;
  }

  /* ─── util ─── */

  private formatResult(ctx: CommandContext, value: number, comment: string): string {
    const name = ctx.senderName ?? String(ctx.userId);
    return `${name} 今日人品为 ${value}，${comment}`;
  }

  private getDateKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

}
