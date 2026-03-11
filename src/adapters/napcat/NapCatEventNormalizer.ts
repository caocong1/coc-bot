/**
 * NapCat 事件归一化器
 *
 * 将 NapCat/OneBot 原始事件转换为内部统一 MessageContext
 */

import type { MessageContext } from '../../shared/contracts/RuntimeContracts';

/** OneBot 消息段 */
export interface OneBotSegment {
  type: string;
  data: Record<string, unknown>;
}

/** OneBot 原始事件 */
export interface OneBotEvent {
  post_type: string;
  message_type?: string;
  sub_type?: string;
  group_id?: number;
  user_id: number;
  message_id: number;
  message: string | OneBotSegment[];
  raw_message?: string;
  self_id?: number;
  sender?: {
    nickname?: string;
    card?: string;
    role?: string;
    [k: string]: unknown;
  };
  time: number;
  [key: string]: unknown;
}

export class NapCatEventNormalizer {
  private selfId?: number;

  setSelfId(id: number): void {
    this.selfId = id;
  }

  normalizeMessage(event: OneBotEvent): MessageContext | null {
    if (event.post_type !== 'message') return null;

    const messageType = event.message_type === 'group' ? 'group' as const : 'private' as const;
    const segments = this.toSegments(event.message);
    const plainText = this.segmentsToPlainText(segments);
    const isAtBot = this.checkAtBot(segments);
    const mentionedUsers = this.extractMentions(segments);

    return {
      platform: 'onebot',
      messageType,
      groupId: event.group_id,
      userId: event.user_id,
      messageId: String(event.message_id),
      rawMessage: event.raw_message ?? plainText,
      plainText,
      isAtBot,
      isReplyToBot: false,
      isCommand: this.isCommand(plainText),
      commandName: this.extractCommandName(plainText),
      mentionedUsers,
      timestamp: new Date(event.time * 1000),
    };
  }

  /* ───────── segments ───────── */

  private toSegments(msg: string | OneBotSegment[]): OneBotSegment[] {
    if (Array.isArray(msg)) return msg;
    return [{ type: 'text', data: { text: msg } }];
  }

  private segmentsToPlainText(segments: OneBotSegment[]): string {
    return segments
      .filter(s => s.type === 'text')
      .map(s => String(s.data.text ?? ''))
      .join('')
      .trim();
  }

  private checkAtBot(segments: OneBotSegment[]): boolean {
    if (!this.selfId) return false;
    return segments.some(
      s => s.type === 'at' && String(s.data.qq) === String(this.selfId),
    );
  }

  private extractMentions(segments: OneBotSegment[]): number[] {
    return segments
      .filter(s => s.type === 'at' && s.data.qq !== 'all')
      .map(s => Number(s.data.qq))
      .filter(n => !isNaN(n));
  }

  /* ───────── command detection ───────── */

  private isCommand(text: string): boolean {
    return /^[.。!！/]/.test(text.trim());
  }

  private extractCommandName(text: string): string | undefined {
    // 支持 .r  .ra  .rc  .st  .sc  .ti  .li  .en  .setcoc  .coc  .help  .bot 等
    const match = text.trim().match(/^[.。!！/]([a-zA-Z]+)/);
    return match?.[1]?.toLowerCase();
  }
}
