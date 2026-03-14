/**
 * 鸽子理由生成器：.gugu ([玩家名])
 *
 *   .gugu           为自己生成鸽子理由
 *   .gugu 李明      为指定玩家生成鸽子理由
 *
 * - 有 AI 时：调用 AI 生成创意鸽子理由，附带玩家名称
 * - 无 AI 时：从 gugu.fallback.json 随机挑一条
 */

import { readFileSync, existsSync } from 'fs';
import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { DashScopeClient } from '../../ai/client/DashScopeClient';

const FALLBACK_FILE = new URL('./gugu.fallback.json', import.meta.url);

let _fallback: string[] | null = null;

function loadFallback(): string[] {
  if (_fallback) return _fallback;
  try {
    if (existsSync(FALLBACK_FILE)) {
      const raw = readFileSync(FALLBACK_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        _fallback = data.filter((s): s is string => typeof s === 'string');
        return _fallback;
      }
    }
  } catch (err) {
    console.error('[Gugu] 加载 fallback 失败:', err);
  }
  _fallback = ['咕咕咕，{$t玩家}今天来不了了。'];
  return _fallback;
}

function pickFallback(player: string): string {
  const list = loadFallback();
  const tmpl = list[Math.floor(Math.random() * list.length)];
  return tmpl.replace(/\{\$t玩家\}/g, player);
}

// ── AI prompt ────────────────────────────────────────────────────────────────

const STYLES = [
  '克苏鲁/跑团风格（SAN值、深潜者、邪神、调查员、KP、大失败等梗）',
  '日常离奇风格（真实但荒诞的生活意外）',
  '二次元/奇幻风格（穿越、异世界、龙娘、精灵、邪神召唤等）',
  '打工人内卷风格（加班、甲方、绩效、周报、外卖等）',
  '动物/萌宠风格（猫主子、海豹、鸽子、仓鼠、鱼缸等）',
  '游戏梗风格（强制更新、boss战、存档、复活币、帧率崩了等）',
];

function buildPrompt(player: string, style: string): string {
  return `你是一个QQ群跑团机器人。有玩家"${player}"今天无法参加跑团，需要生成一条幽默的鸽子理由。

风格要求：${style}

输出规则：
- 1-3句话，不超过80字
- 要提到"${player}"这个名字（直接用名字，不加引号）
- 理由要荒诞有趣，带有克苏鲁/跑团氛围更好
- 不要加引号、不要解释、不要任何前缀标记，直接输出那条理由
- 结尾可以加一点感叹或者玩梗`;
}

// ── 命令 ─────────────────────────────────────────────────────────────────────

export class GuguCommand implements CommandHandler {
  name = 'gugu';
  aliases = [];
  description = '随机鸽子理由：.gugu [玩家名]';

  constructor(private readonly aiClient: DashScopeClient | null) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const player = cmd.args.join(' ').trim() || ctx.senderName || '某人';
    const style = STYLES[Math.floor(Math.random() * STYLES.length)];

    if (!this.aiClient) {
      return { text: `🕊️ ${pickFallback(player)}` };
    }

    try {
      const reason = await this.generate(player, style);
      return { text: `🕊️ ${reason}` };
    } catch (err) {
      console.error('[Gugu] AI 生成失败，使用 fallback:', err);
      return { text: `🕊️ ${pickFallback(player)}` };
    }
  }

  private async generate(player: string, style: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let result = '';
      let settled = false;

      const done = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text || pickFallback(player));
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      void this.aiClient!.streamChat(
        'qwen3.5-flash',
        [
          { role: 'system', content: buildPrompt(player, style) },
          { role: 'user', content: `帮我生成一条关于"${player}"的鸽子理由` },
        ],
        {
          onToken: (token) => { result += token; },
          onDone: () => {
            const cleaned = result
              .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
              .replace(/^["'"「」『』]/g, '')
              .replace(/["'"「」『』]$/g, '')
              .trim();
            done(cleaned);
          },
          onError: (err) => fail(new Error(err)),
        },
      ).catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
  }
}
