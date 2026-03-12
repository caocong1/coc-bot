/**
 * .web 命令
 *
 * 用法：
 *   .web login         — 获取个人 Web 控制台登录链接（24h 有效）
 *   .web room <roomId> — 获取跑团房间直达链接（含个人 token）
 *   .web help          — 显示帮助
 */

import type { CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { TokenStore } from '../../storage/TokenStore';

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:5173';

export class WebCommand {
  readonly name = 'web';
  readonly aliases: string[] = [];
  readonly description = '获取 Web 控制台登录链接';
  readonly usage = '.web login';

  constructor(private readonly tokenStore: TokenStore) {}

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const sub = (cmd.args[0] ?? '').toLowerCase();

    if (sub === 'login') {
      const token = this.tokenStore.generate(ctx.userId);
      const url = `${WEB_BASE_URL}/player?token=${token}`;
      return {
        text: `🔑 你的专属登录链接（24小时有效）：\n${url}\n\n请勿分享给他人，链接包含你的个人凭证。`,
        private: true,
        publicHint: ctx.messageType === 'group' ? '🔑 登录链接已私发给你。' : undefined,
      };
    }

    if (sub === 'room') {
      const roomId = cmd.args[1]?.trim();
      if (!roomId) {
        return { text: '用法：.web room <房间ID>' };
      }
      const token = this.tokenStore.generate(ctx.userId);
      const url = `${WEB_BASE_URL}/player/rooms?id=${roomId}&token=${token}`;
      return {
        text: `🎭 跑团房间直达链接（24小时有效）：\n${url}\n\n请勿分享给他人，链接包含你的个人凭证。`,
        private: true,
        publicHint: ctx.messageType === 'group' ? '🎭 房间链接已私发给你。' : undefined,
      };
    }

    return {
      text:
        '📖 Web 控制台指令：\n' +
        '  .web login         — 获取个人登录链接（私发，24h 有效）\n' +
        '  .web room <房间ID> — 获取跑团房间直达链接\n\n' +
        '登录后可以：\n' +
        '  • 管理你的角色卡（新建/编辑/删除）\n' +
        '  • 查看参与的团进度与线索\n' +
        '  • 浏览可用模组列表\n' +
        '  • 加入/查看跑团房间\n' +
        '  • 查看指令手册',
    };
  }
}
