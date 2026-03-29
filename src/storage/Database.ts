import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { Database } from 'bun:sqlite';

const DEFAULT_DATABASE_PATH = './data/storage/coc-bot.db';

export function resolveDatabasePath(rawPath?: string): string {
  return resolve(rawPath?.trim() || process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
}

export function openDatabase(rawPath?: string): Database {
  const path = resolveDatabasePath(rawPath);
  mkdirSync(dirname(path), { recursive: true });
  return new Database(path, { create: true });
}

export function migrateCoreSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL,
      campaign_id TEXT,
      name TEXT NOT NULL,
      occupation TEXT,
      age INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_characters_player_id ON characters(player_id);

    CREATE TABLE IF NOT EXISTS active_cards (
      binding_key TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jrrp_daily_cache (
      user_id INTEGER NOT NULL,
      date_key TEXT NOT NULL,
      value INTEGER NOT NULL,
      comments_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, date_key)
    );

    CREATE INDEX IF NOT EXISTS idx_jrrp_daily_cache_date_key ON jrrp_daily_cache(date_key);

    -- ── AI KP 会话表 ────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS kp_sessions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      group_id INTEGER NOT NULL,
      kp_template_id TEXT NOT NULL DEFAULT 'serious',
      status TEXT NOT NULL DEFAULT 'running',
      scenario_file_path TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_sessions_campaign ON kp_sessions(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_kp_sessions_group ON kp_sessions(group_id);

    CREATE TABLE IF NOT EXISTS kp_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel_id TEXT NOT NULL DEFAULT 'main',
      actor_id INTEGER,
      visibility TEXT NOT NULL DEFAULT 'public',
      payload_json TEXT NOT NULL,
      ingame_time TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_events_session_seq ON kp_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_kp_events_session_channel_seq ON kp_events(session_id, channel_id, seq);
    CREATE INDEX IF NOT EXISTS idx_kp_events_session_created ON kp_events(session_id, created_at);

    -- 当前场景（每个 session 只保留最新一条）
    CREATE TABLE IF NOT EXISTS kp_scenes (
      session_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active_npcs_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    -- 线索表
    CREATE TABLE IF NOT EXISTS kp_clues (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      keeper_content TEXT NOT NULL,
      player_description TEXT NOT NULL DEFAULT '',
      is_discovered INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT,
      discovered_by INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_clues_session ON kp_clues(session_id);

    -- 对话消息历史
    CREATE TABLE IF NOT EXISTS kp_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      user_id INTEGER,
      display_name TEXT,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_summarized INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_kp_messages_session ON kp_messages(session_id, is_summarized, timestamp);

    -- 摘要
    CREATE TABLE IF NOT EXISTS kp_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_summaries_session ON kp_summaries(session_id, created_at);


    -- 等待骰子状态（每个 session 一条 JSON 记录）
    CREATE TABLE IF NOT EXISTS kp_pending_rolls (
      session_id TEXT PRIMARY KEY,
      rolls_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    -- 参与本 session 的玩家
    CREATE TABLE IF NOT EXISTS kp_session_players (
      session_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (session_id, user_id)
    );

    -- 场景片段（模组分段后的内容，用于动态上下文窗口）
    CREATE TABLE IF NOT EXISTS kp_scene_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      title TEXT NOT NULL,
      full_text TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      char_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_scene_segments_session ON kp_scene_segments(session_id, seq);

    -- Web 登录 token（玩家通过 QQ 获取，凭 token 访问 Web 控制台）
    CREATE TABLE IF NOT EXISTS player_tokens (
      token TEXT PRIMARY KEY,
      qq_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_player_tokens_qq ON player_tokens(qq_id);

    -- ── 跑团房间（预开团大厅）──────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS campaign_rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_id INTEGER,
      creator_qq_id INTEGER NOT NULL,
      scenario_name TEXT,
      constraints_json TEXT NOT NULL DEFAULT '{}',
      director_prefs_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'waiting',
      kp_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_rooms_group ON campaign_rooms(group_id);

    CREATE TABLE IF NOT EXISTS campaign_room_members (
      room_id TEXT NOT NULL,
      qq_id INTEGER NOT NULL,
      character_id TEXT,
      ready_at TEXT,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, qq_id)
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_room_members_room ON campaign_room_members(room_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_room_members_qq ON campaign_room_members(qq_id);

    CREATE TABLE IF NOT EXISTS campaign_room_relationships (
      room_id TEXT NOT NULL REFERENCES campaign_rooms(id),
      user_a INTEGER NOT NULL,
      user_b INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_a, user_b)
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_room_relationships_room ON campaign_room_relationships(room_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_campaign_room_relationships_user_a ON campaign_room_relationships(user_a);
    CREATE INDEX IF NOT EXISTS idx_campaign_room_relationships_user_b ON campaign_room_relationships(user_b);

    CREATE TABLE IF NOT EXISTS campaign_room_relation_groups (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES campaign_rooms(id),
      relation_label TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by_qq_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_room_relation_groups_room ON campaign_room_relation_groups(room_id, updated_at);

    CREATE TABLE IF NOT EXISTS campaign_room_relation_participants (
      relation_id TEXT NOT NULL REFERENCES campaign_room_relation_groups(id),
      character_id TEXT NOT NULL REFERENCES characters(id),
      PRIMARY KEY (relation_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_room_relation_participants_character ON campaign_room_relation_participants(character_id);

    -- ── 模组管理 ────────────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS scenario_modules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      era TEXT,
      allowed_occupations TEXT NOT NULL DEFAULT '[]',
      min_stats TEXT NOT NULL DEFAULT '{}',
      total_points INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenario_module_files (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES scenario_modules(id),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'document',
      label TEXT,
      description TEXT,
      char_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      import_status TEXT NOT NULL DEFAULT 'pending',
      import_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scenario_module_files_module ON scenario_module_files(module_id);

    CREATE TABLE IF NOT EXISTS module_entities (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES scenario_modules(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      identity TEXT,
      motivation TEXT,
      public_image TEXT,
      hidden_truth TEXT,
      speaking_style TEXT,
      faction TEXT,
      danger_level TEXT,
      default_location TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      skills_json TEXT NOT NULL DEFAULT '{}',
      combat_json TEXT NOT NULL DEFAULT '{}',
      free_text TEXT NOT NULL DEFAULT '',
      relationships_json TEXT NOT NULL DEFAULT '[]',
      is_key INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_module_entities_module ON module_entities(module_id);
    CREATE INDEX IF NOT EXISTS idx_module_entities_review ON module_entities(module_id, review_status);
    CREATE INDEX IF NOT EXISTS idx_module_entities_key ON module_entities(module_id, is_key);

    CREATE TABLE IF NOT EXISTS module_items (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES scenario_modules(id),
      name TEXT NOT NULL,
      category TEXT,
      public_description TEXT,
      kp_notes TEXT,
      default_owner TEXT,
      default_location TEXT,
      visibility_condition TEXT,
      usage TEXT,
      is_key INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_module_items_module ON module_items(module_id);
    CREATE INDEX IF NOT EXISTS idx_module_items_review ON module_items(module_id, review_status);
    CREATE INDEX IF NOT EXISTS idx_module_items_key ON module_items(module_id, is_key);

    CREATE TABLE IF NOT EXISTS module_rule_packs (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES scenario_modules(id),
      play_privacy_mode TEXT NOT NULL DEFAULT 'public',
      privacy_notes TEXT NOT NULL DEFAULT '',
      san_rules TEXT NOT NULL DEFAULT '',
      combat_rules TEXT NOT NULL DEFAULT '',
      death_rules TEXT NOT NULL DEFAULT '',
      time_rules TEXT NOT NULL DEFAULT '',
      revelation_rules TEXT NOT NULL DEFAULT '',
      forbidden_assumptions TEXT NOT NULL DEFAULT '',
      free_text TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_module_rule_packs_module_unique ON module_rule_packs(module_id);
    CREATE INDEX IF NOT EXISTS idx_module_rule_packs_review ON module_rule_packs(module_id, review_status);

    -- ── 用户设置（.set 默认骰 / .nn 称呼）────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id  INTEGER NOT NULL,
      scope    TEXT    NOT NULL DEFAULT 'global', -- 'global' 或 '{group_id}'
      key      TEXT    NOT NULL,
      value    TEXT    NOT NULL,
      PRIMARY KEY (user_id, scope, key)
    );

    -- ── 通用键值设置（AI provider/模型配置等）────────────────────────────────
    CREATE TABLE IF NOT EXISTS bot_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 对已存在的旧表做安全迁移（列不存在时才执行，已有则忽略）
  try {
    db.exec('ALTER TABLE kp_sessions ADD COLUMN scenario_file_path TEXT;');
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec('ALTER TABLE kp_sessions ADD COLUMN current_segment_id TEXT;');
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec('ALTER TABLE campaign_rooms ADD COLUMN module_id TEXT;');
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec("ALTER TABLE campaign_rooms ADD COLUMN constraints_json TEXT NOT NULL DEFAULT '{}';");
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec("ALTER TABLE campaign_rooms ADD COLUMN director_prefs_json TEXT NOT NULL DEFAULT '{}';");
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec("ALTER TABLE module_rule_packs ADD COLUMN play_privacy_mode TEXT NOT NULL DEFAULT 'public';");
  } catch { /* ??????? */ }

  try {
    db.exec("ALTER TABLE module_rule_packs ADD COLUMN privacy_notes TEXT NOT NULL DEFAULT '';");
  } catch { /* ??????? */ }

  let addedScenarioModuleTotalPoints = false;
  try {
    db.exec('ALTER TABLE scenario_modules ADD COLUMN total_points INTEGER;');
    addedScenarioModuleTotalPoints = true;
  } catch { /* 列已存在，忽略 */ }

  if (addedScenarioModuleTotalPoints) {
    try {
      db.exec('UPDATE scenario_modules SET total_points = 460 WHERE total_points IS NULL;');
    } catch { /* 忽略已有或异常 */ }
  }

  try {
    db.exec('ALTER TABLE player_tokens ADD COLUMN group_id INTEGER;');
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec('ALTER TABLE campaign_room_members ADD COLUMN ready_at TEXT;');
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec("ALTER TABLE campaign_rooms ADD COLUMN kp_template_id TEXT NOT NULL DEFAULT 'serious';");
  } catch { /* 列已存在，忽略 */ }

  try {
    db.exec("ALTER TABLE campaign_rooms ADD COLUMN kp_custom_prompts TEXT NOT NULL DEFAULT '';");
  } catch { /* 列已存在，忽略 */ }

  // ── 游戏内时间轴 ─────────────────────────────────────────────────────────
  try {
    db.exec('ALTER TABLE kp_sessions ADD COLUMN ingame_time TEXT;');
  } catch { /* 列已存在，忽略 */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kp_timeline_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      ingame_time TEXT NOT NULL,
      delta_minutes INTEGER,
      description TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'ai',
      message_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kp_timeline_session ON kp_timeline_events(session_id, created_at);
  `);

  // ── 自定义 KP 模板表 ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS kp_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tone INTEGER NOT NULL DEFAULT 5,
      flexibility INTEGER NOT NULL DEFAULT 5,
      guidance INTEGER NOT NULL DEFAULT 5,
      lethality INTEGER NOT NULL DEFAULT 5,
      pacing INTEGER NOT NULL DEFAULT 5,
      custom_prompts TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // campaign_rooms.group_id: NOT NULL → nullable（SQLite 不支持 ALTER COLUMN，需重建表）
  try {
    const info = db.query("PRAGMA table_info(campaign_rooms)").all() as Array<{ name: string; notnull: number }>;
    const col = info.find((c) => c.name === 'group_id');
    if (col && col.notnull === 1) {
      // 动态获取现有列名，安全拷贝数据
      const cols = info.map((c) => c.name);
      const targetCols = ['id', 'name', 'group_id', 'creator_qq_id', 'scenario_name', 'module_id', 'constraints_json', 'director_prefs_json', 'status', 'kp_session_id', 'created_at', 'updated_at'];
      const existingCols = targetCols.filter((c) => cols.includes(c));
      const selectCols = existingCols.join(', ');

      db.exec(`
        CREATE TABLE campaign_rooms_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          group_id INTEGER,
          creator_qq_id INTEGER NOT NULL,
          scenario_name TEXT,
          module_id TEXT,
          constraints_json TEXT NOT NULL DEFAULT '{}',
          director_prefs_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'waiting',
          kp_session_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO campaign_rooms_new (${selectCols}) SELECT ${selectCols} FROM campaign_rooms;
        DROP TABLE campaign_rooms;
        ALTER TABLE campaign_rooms_new RENAME TO campaign_rooms;
        CREATE INDEX IF NOT EXISTS idx_campaign_rooms_group ON campaign_rooms(group_id);
      `);
      console.log('[DB] campaign_rooms.group_id migrated to nullable');
    }
  } catch (err) {
    console.error('[DB] campaign_rooms nullable migration failed:', err);
  }
}
