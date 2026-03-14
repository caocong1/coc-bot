import type { Database } from 'bun:sqlite';

/**
 * 用户个性化设置存储
 *
 * scope:
 *   'global'       — 全局（私聊设置或无群上下文）
 *   '{group_id}'   — 群专属
 *
 * 常用 key:
 *   'default_dice' — .set 设置的默认骰子面数（字符串形式的整数）
 *   'nn'           — .nn 设置的称呼
 */
export class UserSettingsStore {
  constructor(private readonly db: Database) {}

  get(userId: number, scope: string, key: string): string | null {
    const row = this.db
      .query<{ value: string }, [number, string, string]>(
        'SELECT value FROM user_settings WHERE user_id = ? AND scope = ? AND key = ?',
      )
      .get(userId, scope, key);
    return row?.value ?? null;
  }

  set(userId: number, scope: string, key: string, value: string): void {
    this.db.run(
      'INSERT OR REPLACE INTO user_settings (user_id, scope, key, value) VALUES (?, ?, ?, ?)',
      [userId, scope, key, value],
    );
  }

  delete(userId: number, scope: string, key: string): void {
    this.db.run(
      'DELETE FROM user_settings WHERE user_id = ? AND scope = ? AND key = ?',
      [userId, scope, key],
    );
  }

  deleteAll(userId: number, key: string): void {
    this.db.run(
      'DELETE FROM user_settings WHERE user_id = ? AND key = ?',
      [userId, key],
    );
  }

  /** 解析用户称呼：群专属 > 全局，都没有返回 null */
  getNickname(userId: number, groupId?: number): string | null {
    if (groupId) {
      const nn = this.get(userId, String(groupId), 'nn');
      if (nn) return nn;
    }
    return this.get(userId, 'global', 'nn');
  }

  /** 获取默认骰子面数，默认 100 */
  getDefaultDice(userId: number): number {
    const v = this.get(userId, 'global', 'default_dice');
    if (!v) return 100;
    const n = parseInt(v);
    return isNaN(n) ? 100 : n;
  }
}
