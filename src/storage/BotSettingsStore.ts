/**
 * 通用键值设置存储
 *
 * 提供 bot_settings 表的读写接口，以及 AI 配置的高级封装。
 */

import type { Database } from 'bun:sqlite';

// ─── 通用读写 ────────────────────────────────────────────────────────────────

export function getBotSetting(db: Database, key: string): string | null {
  const row = db.query<{ value: string }, [string]>(
    'SELECT value FROM bot_settings WHERE key = ?',
  ).get(key);
  return row?.value ?? null;
}

export function setBotSetting(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO bot_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value],
  );
}

// ─── AI 配置 ────────────────────────────────────────────────────────────────

export type AIProvider = 'dashscope' | 'openlimits';

export interface AISettings {
  provider: AIProvider;
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
  imagePromptModel: string;
  embedModel: string;
}

export interface AIConfig extends AISettings {
  /** capability 信息（不持久化，仅运行时派生） */
  capabilities: {
    imageGeneration: boolean;
    embedding: boolean;
  };
}

const KEY_AI_SETTINGS = 'ai_settings';

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'dashscope',
  chatModel: 'qwen3.5-plus',
  guardrailModel: 'qwen3.5-flash',
  openingModel: 'qwen3.5-plus',
  recapModel: 'qwen3.5-plus',
  imagePromptModel: 'qwen3.5-plus',
  embedModel: 'text-embedding-v4',
};

export function getAISettings(db: Database): AISettings {
  const raw = getBotSetting(db, KEY_AI_SETTINGS);
  if (!raw) return { ...DEFAULT_AI_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return { ...DEFAULT_AI_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function updateAISettings(db: Database, patch: Partial<AISettings>): AISettings {
  const current = getAISettings(db);
  const updated = { ...current, ...patch };
  setBotSetting(db, KEY_AI_SETTINGS, JSON.stringify(updated));
  return updated;
}

export function getAIConfig(db: Database): AIConfig {
  const settings = getAISettings(db);
  return {
    ...settings,
    capabilities: {
      imageGeneration: settings.provider === 'dashscope',
      embedding: settings.provider === 'dashscope',
    },
  };
}
