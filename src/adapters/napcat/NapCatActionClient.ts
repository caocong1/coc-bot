/**
 * NapCat 动作客户端
 *
 * 封装向 NapCat 发送 OneBot API 调用的接口
 */

export interface SendMessageOptions {
  groupId?: number;
  userId?: number;
  message: string;
}

interface OneBotApiResult {
  status: string;
  retcode: number;
  data: Record<string, unknown> | null;
  echo?: string;
}

export class NapCatActionClient {
  private httpUrl: string;
  private token: string;

  constructor(httpUrl: string, token?: string) {
    this.httpUrl = httpUrl.replace(/\/+$/, '');
    this.token = token ?? '';
  }

  /* ───────── core send ───────── */

  async sendGroupMessage(groupId: number, message: string): Promise<number> {
    const res = await this.callApi('send_group_msg', {
      group_id: groupId,
      message,
    });
    return (res.data?.message_id as number) ?? 0;
  }

  async sendPrivateMessage(userId: number, message: string): Promise<number> {
    const res = await this.callApi('send_private_msg', {
      user_id: userId,
      message,
    });
    return (res.data?.message_id as number) ?? 0;
  }

  async sendMessage(opts: SendMessageOptions): Promise<number> {
    if (opts.groupId) return this.sendGroupMessage(opts.groupId, opts.message);
    if (opts.userId) return this.sendPrivateMessage(opts.userId, opts.message);
    throw new Error('Either groupId or userId must be provided');
  }

  /* ───────── query apis ───────── */

  async getLoginInfo(): Promise<{ user_id: number; nickname: string }> {
    const res = await this.callApi('get_login_info', {});
    return res.data as { user_id: number; nickname: string };
  }

  async getGroupList(): Promise<Array<{ group_id: number; group_name: string }>> {
    const res = await this.callApi('get_group_list', {});
    return (res.data as unknown as Array<{ group_id: number; group_name: string }>) ?? [];
  }

  async getGroupMemberInfo(groupId: number, userId: number): Promise<Record<string, unknown>> {
    const res = await this.callApi('get_group_member_info', {
      group_id: groupId,
      user_id: userId,
    });
    return res.data ?? {};
  }

  async deleteMsg(messageId: number): Promise<void> {
    await this.callApi('delete_msg', { message_id: messageId });
  }

  /**
   * 向群聊发送图片（本地文件路径）。
   * 若提供 caption，先发一条说明文字，间隔 400ms 再发图。
   * @param imagePath 本机绝对路径，如 /data/knowledge/images/file-abc/img-001.jpg
   */
  async sendGroupImage(groupId: number, imagePath: string, caption?: string): Promise<void> {
    if (caption) {
      await this.sendGroupMessage(groupId, caption);
      await new Promise<void>((r) => setTimeout(r, 400));
    }
    // OneBot v11 CQ 码：file:/// + 正斜杠路径（Windows 路径也要转斜杠）
    const normalizedPath = imagePath.replace(/\\/g, '/');
    const cqMsg = `[CQ:image,file=file:///${normalizedPath.replace(/^\//, '')}]`;
    await this.callApi('send_group_msg', { group_id: groupId, message: cqMsg });
  }

  /* ───────── internal ───────── */

  private async callApi(action: string, params: Record<string, unknown>): Promise<OneBotApiResult> {
    const url = `${this.httpUrl}/${action}`;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OneBot API ${action} failed (${response.status}): ${text}`);
      }

      return (await response.json()) as OneBotApiResult;
    } catch (err) {
      console.error(`[NapCat] API call ${action} error:`, err);
      throw err;
    }
  }
}
