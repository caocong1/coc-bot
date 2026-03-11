/**
 * 帮助命令：.help
 */

import type { CommandHandler, CommandContext, CommandResult } from './CommandRegistry';
import type { ParsedCommand } from './CommandParser';
import type { CommandRegistry } from './CommandRegistry';

export class HelpCommand implements CommandHandler {
  name = 'help';
  aliases = ['h'];
  description = '查看帮助';

  private registry: CommandRegistry;
  constructor(registry: CommandRegistry) { this.registry = registry; }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const topic = cmd.args[0];

    if (topic) {
      const handler = this.registry.find(topic);
      if (handler) {
        return { text: `${handler.name}: ${handler.description}` };
      }
      return { text: `未找到命令: ${topic}` };
    }

    const all = this.registry.getAllDescriptions();
    const lines = all.map(c => `  .${c.name} - ${c.description}`);
    return {
      text: `CoC Bot 命令列表:\n${lines.join('\n')}\n\n使用 .help [命令名] 查看详细说明`,
    };
  }
}
