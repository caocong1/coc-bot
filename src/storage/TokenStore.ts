/**
 * 玩家 Web 登录 Token 管理
 *
 * 玩家发送 .web login 后，Bot 生成一次性 token 链接（24h 有效）。
 * 玩家通过浏览器访问该链接完成身份绑定，后续携带 token 访问 API。
 */

import type { Database } from 'bun:sqlite';
import { randomBytes } from 'crypto';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

export interface PlayerToken {
  token: string;
  qqId: number;
  groupId: number | null;
  expiresAt: Date;
  createdAt: Date;
}

export class TokenStore {
  constructor(private readonly db: Database) {}

  /** 为指定 QQ 号生成新 token（同时作废旧 token）；groupId 为发起登录的群号 */
  generate(qqId: number, groupId?: number): string {
    // 清除该用户旧 token
    this.db.run('DELETE FROM player_tokens WHERE qq_id = ?', [qqId]);

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

    this.db.run(
      'INSERT INTO player_tokens (token, qq_id, group_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [token, qqId, groupId ?? null, expiresAt.toISOString(), now.toISOString()],
    );

    return token;
  }

  /** 验证 token，返回对应 QQ 号和群号；无效/过期返回 null */
  verify(token: string): { qqId: number; groupId: number | null } | null {
    const row = this.db.query<{ qq_id: number; group_id: number | null; expires_at: string }, string>(
      'SELECT qq_id, group_id, expires_at FROM player_tokens WHERE token = ?',
    ).get(token);

    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      this.db.run('DELETE FROM player_tokens WHERE token = ?', [token]);
      return null;
    }

    return { qqId: row.qq_id, groupId: row.group_id ?? null };
  }

  /** 定期清理过期 token（在服务启动时调用一次即可） */
  cleanup(): void {
    this.db.run('DELETE FROM player_tokens WHERE expires_at < ?', [new Date().toISOString()]);
  }
}
