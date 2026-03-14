/**
 * 角色卡存储
 *
 * 管理角色卡的创建、查询、更新和多卡切换。
 * 第一版使用内存存储，后续迁移到 SQLite。
 */

import type { Character, CharacterAttributes, CharacterDerived, CharacterAssets, InventoryItem, CharacterWeapon, CharacterArmor, CharacterVehicle, Spell, Companion, Experience, MythosEncounter } from '../../shared/types/Character';
import { type Database } from 'bun:sqlite';
import { migrateCoreSchema, openDatabase } from '../../storage/Database';

/** CoC7 默认技能初始值 */
const DEFAULT_SKILLS: Record<string, number> = {
  '会计': 5, '人类学': 1, '估价': 5, '考古学': 1,
  '取悦': 15, '攀爬': 20, '信用评级': 0, '克苏鲁神话': 0,
  '乔装': 5, '汽车驾驶': 20, '电气维修': 10, '话术': 5,
  '格斗': 25, '射击(手枪)': 20, '射击(步霰)': 25,
  '急救': 30, '历史': 5, '恐吓': 15, '跳跃': 20,
  '法律': 5, '图书馆使用': 20, '聆听': 20, '锁匠': 1,
  '机械维修': 10, '医学': 1, '博物学': 10, '导航': 10,
  '神秘学': 5, '说服': 10, '精神分析': 1, '心理学': 10,
  '骑术': 5, '侦查': 25, '潜行': 20, '游泳': 20,
  '投掷': 20, '追踪': 10, '妙手': 10, '生存': 10,
};

/** 技能别名映射 */
const SKILL_ALIASES: Record<string, string> = {
  '智力': '灵感', '灵感': '智力',
  '理智': 'san', 'san': '理智', 'SAN': '理智',
  '侦查': '侦查', '侦察': '侦查',
  '闪避': '闪避', 'dodge': '闪避',
  '母语': '母语',
  'hp': '生命值', '生命值': 'hp', 'HP': '生命值',
  'mp': '魔法值', '魔法值': 'mp', 'MP': '魔法值',
};

interface CharacterPayload {
  attributes: CharacterAttributes;
  derived: CharacterDerived;
  skills: Record<string, number>;
  backstory?: Record<string, string>;
  assets?: CharacterAssets;
  inventory?: InventoryItem[];
  weapons?: CharacterWeapon[];
  armor?: CharacterArmor;
  vehicle?: CharacterVehicle;
  spells?: Spell[];
  companions?: Companion[];
  experiences?: Experience[];
  phobiasAndManias?: string[];
  woundsAndScars?: string;
  mythosEncounters?: MythosEncounter[];
}

interface CharacterRow {
  id: string;
  player_id: number;
  campaign_id: string | null;
  name: string;
  occupation: string | null;
  age: number | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

interface ActiveCardRow {
  binding_key: string;
  character_id: string;
}

export class CharacterStore {
  private characters: Map<string, Character> = new Map();
  /** userId -> 当前使用的角色卡 ID */
  private activeCards: Map<string, string> = new Map();
  private db?: Database;

  /**
   * @param db 外部传入的已初始化 Database 实例（推荐）。
   *           不传时自行打开，兼容旧用法。
   */
  constructor(db?: Database) {
    try {
      if (db) {
        this.db = db;
      } else {
        this.db = openDatabase();
        migrateCoreSchema(this.db);
      }
      this.loadFromDatabase();
    } catch (err) {
      console.error('[CharacterStore] SQLite unavailable, fallback to in-memory mode:', err);
      this.db = undefined;
    }
  }

  /* ─── 创建 ─── */

  create(playerId: number, name: string, campaignId?: string): Character {
    const id = `${playerId}-${Date.now()}`;
    const character: Character = {
      id,
      playerId,
      campaignId,
      name,
      attributes: { str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0 },
      derived: { hp: 0, mp: 0, san: 0, luck: 0, mov: 0, build: 0, damageBonus: '0' },
      skills: { ...DEFAULT_SKILLS },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.characters.set(id, character);
    // 自动绑定
    const key = this.cardKey(playerId, campaignId);
    this.activeCards.set(key, id);
    this.persistCharacter(character);
    this.persistActiveBinding(key, id);
    return character;
  }

  /* ─── 查询 ─── */

  get(characterId: string): Character | undefined {
    return this.characters.get(characterId);
  }

  getActiveCharacter(userId: number, groupId?: number): Character | undefined {
    // 先找群绑定，再找全局绑定
    const groupKey = this.cardKey(userId, groupId ? String(groupId) : undefined);
    const globalKey = this.cardKey(userId);

    const id = this.activeCards.get(groupKey) ?? this.activeCards.get(globalKey);
    return id ? this.characters.get(id) : undefined;
  }

  listByPlayer(playerId: number): Character[] {
    return Array.from(this.characters.values()).filter(c => c.playerId === playerId);
  }

  /**
   * 返回当前在某群（groupId）有激活绑定的所有角色卡。
   * 优先取群绑定，无群绑定则取全局绑定。
   */
  getGroupActiveCharacters(groupId: number): Character[] {
    const suffix = `:${groupId}`;
    const result: Character[] = [];
    const seen = new Set<string>();

    // 群绑定优先
    for (const [key, charId] of this.activeCards.entries()) {
      if (key.endsWith(suffix)) {
        const char = this.characters.get(charId);
        if (char && !seen.has(charId)) {
          seen.add(charId);
          result.push(char);
        }
      }
    }
    return result;
  }

  /**
   * 返回房间成员绑定的角色卡。
   * 优先取 campaign_room_members.character_id，否则取玩家的激活角色卡。
   */
  getRoomCharacters(roomId: string): Character[] {
    if (!this.db) return [];
    const rows = this.db.query<{ qq_id: number; character_id: string | null }, string>(
      'SELECT qq_id, character_id FROM campaign_room_members WHERE room_id = ?',
    ).all(roomId);

    const result: Character[] = [];
    for (const row of rows) {
      let char: Character | undefined;
      if (row.character_id) {
        char = this.characters.get(row.character_id);
      }
      if (!char) {
        // fallback: 玩家的全局激活角色卡
        char = this.getActiveCharacter(row.qq_id);
      }
      if (char) result.push(char);
    }
    return result;
  }

  /* ─── 绑定 ─── */

  setActive(userId: number, characterId: string, groupId?: number): void {
    const key = this.cardKey(userId, groupId ? String(groupId) : undefined);
    this.activeCards.set(key, characterId);
    this.persistActiveBinding(key, characterId);
  }

  /* ─── 更新 ─── */

  updateAttributes(characterId: string, attrs: Partial<CharacterAttributes>): void {
    const c = this.characters.get(characterId);
    if (!c) return;
    Object.assign(c.attributes, attrs);
    this.recalcDerived(c);
    c.updatedAt = new Date();
    this.persistCharacter(c);
  }

  updateDerived(characterId: string, derived: Partial<CharacterDerived>): void {
    const c = this.characters.get(characterId);
    if (!c) return;
    Object.assign(c.derived, derived);
    c.updatedAt = new Date();
    this.persistCharacter(c);
  }

  setSkill(characterId: string, skillName: string, value: number): void {
    const c = this.characters.get(characterId);
    if (!c) return;
    const canonical = SKILL_ALIASES[skillName] ?? skillName;
    c.skills[canonical] = value;
    c.updatedAt = new Date();
    this.persistCharacter(c);
  }

  deleteSkill(characterId: string, skillName: string): boolean {
    const c = this.characters.get(characterId);
    if (!c) return false;
    const canonical = SKILL_ALIASES[skillName] ?? skillName;
    if (!(canonical in c.skills)) return false;
    delete c.skills[canonical];
    c.updatedAt = new Date();
    this.persistCharacter(c);
    return true;
  }

  renameCharacter(characterId: string, newName: string): boolean {
    const c = this.characters.get(characterId);
    if (!c) return false;
    c.name = newName;
    c.updatedAt = new Date();
    this.persistCharacter(c);
    return true;
  }

  modifySkill(characterId: string, skillName: string, delta: number): number {
    const c = this.characters.get(characterId);
    if (!c) return 0;
    const canonical = SKILL_ALIASES[skillName] ?? skillName;
    const current = c.skills[canonical] ?? 0;
    const newValue = Math.max(0, current + delta);
    c.skills[canonical] = newValue;
    c.updatedAt = new Date();
    this.persistCharacter(c);
    return newValue;
  }

  /* ─── 批量设置（.st 格式解析） ─── */

  batchSet(characterId: string, entries: Array<{ name: string; value: number }>): void {
    const c = this.characters.get(characterId);
    if (!c) return;

    const attrMap: Record<string, keyof CharacterAttributes> = {
      '力量': 'str', 'str': 'str', 'STR': 'str',
      '体质': 'con', 'con': 'con', 'CON': 'con',
      '体型': 'siz', 'siz': 'siz', 'SIZ': 'siz',
      '敏捷': 'dex', 'dex': 'dex', 'DEX': 'dex',
      '外貌': 'app', 'app': 'app', 'APP': 'app',
      '智力': 'int', 'int': 'int', 'INT': 'int',
      '意志': 'pow', 'pow': 'pow', 'POW': 'pow',
      '教育': 'edu', 'edu': 'edu', 'EDU': 'edu',
    };

    const derivedMap: Record<string, keyof CharacterDerived> = {
      'hp': 'hp', 'HP': 'hp', '生命值': 'hp',
      'mp': 'mp', 'MP': 'mp', '魔法值': 'mp',
      'san': 'san', 'SAN': 'san', '理智': 'san',
      '幸运': 'luck', 'luck': 'luck',
    };

    for (const { name, value } of entries) {
      const attrKey = attrMap[name];
      if (attrKey) {
        (c.attributes as Record<string, number>)[attrKey] = value;
        continue;
      }
      const derivedKey = derivedMap[name];
      if (derivedKey) {
        (c.derived as Record<string, unknown>)[derivedKey] = value;
        continue;
      }
      c.skills[name] = value;
    }

    this.recalcDerived(c);
    c.updatedAt = new Date();
    this.persistCharacter(c);
  }

  /* ─── 删除 ─── */

  delete(characterId: string): boolean {
    const existed = this.characters.delete(characterId);
    if (!existed) return false;

    for (const [key, id] of this.activeCards.entries()) {
      if (id === characterId) {
        this.activeCards.delete(key);
        this.deleteActiveBinding(key);
      }
    }

    this.deleteCharacter(characterId);
    return true;
  }

  /* ─── 导出 ─── */

  exportSt(characterId: string): string {
    const c = this.characters.get(characterId);
    if (!c) return '';

    const parts: string[] = [];
    const attrNames: Record<string, string> = {
      str: '力量', con: '体质', siz: '体型', dex: '敏捷',
      app: '外貌', int: '智力', pow: '意志', edu: '教育',
    };

    for (const [k, label] of Object.entries(attrNames)) {
      const val = (c.attributes as Record<string, number>)[k];
      if (val) parts.push(`${label}:${val}`);
    }
    if (c.derived.hp) parts.push(`hp:${c.derived.hp}`);
    if (c.derived.san) parts.push(`san:${c.derived.san}`);
    if (c.derived.luck) parts.push(`幸运:${c.derived.luck}`);

    for (const [skill, val] of Object.entries(c.skills)) {
      if (val !== (DEFAULT_SKILLS[skill] ?? 0)) {
        parts.push(`${skill}:${val}`);
      }
    }

    return `.st ${parts.join(' ')}`;
  }

  /* ─── internal ─── */

  private cardKey(userId: number, scope?: string): string {
    return scope ? `${userId}:${scope}` : `${userId}:global`;
  }

  private loadFromDatabase(): void {
    if (!this.db) return;

    const characterRows = this.db.query(`
      SELECT id, player_id, campaign_id, name, occupation, age, payload_json, created_at, updated_at
      FROM characters
    `).all() as CharacterRow[];

    for (const row of characterRows) {
      try {
        const payload = JSON.parse(row.payload_json) as CharacterPayload;
        const character: Character = {
          id: row.id,
          playerId: row.player_id,
          campaignId: row.campaign_id ?? undefined,
          name: row.name,
          occupation: row.occupation ?? undefined,
          age: row.age ?? undefined,
          attributes: payload.attributes,
          derived: payload.derived,
          skills: payload.skills,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          // 扩展字段
          backstory: payload.backstory,
          assets: payload.assets,
          inventory: payload.inventory,
          weapons: payload.weapons,
          armor: payload.armor,
          vehicle: payload.vehicle,
          spells: payload.spells,
          companions: payload.companions,
          experiences: payload.experiences,
          phobiasAndManias: payload.phobiasAndManias,
          woundsAndScars: payload.woundsAndScars,
          mythosEncounters: payload.mythosEncounters,
        };
        this.characters.set(character.id, character);
      } catch (err) {
        console.error(`[CharacterStore] failed to parse character row: id=${row.id}`, err);
      }
    }

    const activeRows = this.db.query(`
      SELECT binding_key, character_id
      FROM active_cards
    `).all() as ActiveCardRow[];

    for (const row of activeRows) {
      this.activeCards.set(row.binding_key, row.character_id);
    }
  }

  private persistCharacter(c: Character): void {
    if (!this.db) return;

    const payload: CharacterPayload = {
      attributes: c.attributes,
      derived: c.derived,
      skills: c.skills,
    };

    this.db.query(`
      INSERT INTO characters (
        id, player_id, campaign_id, name, occupation, age, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        player_id = excluded.player_id,
        campaign_id = excluded.campaign_id,
        name = excluded.name,
        occupation = excluded.occupation,
        age = excluded.age,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      c.id,
      c.playerId,
      c.campaignId ?? null,
      c.name,
      c.occupation ?? null,
      c.age ?? null,
      JSON.stringify(payload),
      c.createdAt.toISOString(),
      c.updatedAt.toISOString(),
    );
  }

  private deleteCharacter(characterId: string): void {
    if (!this.db) return;
    this.db.query('DELETE FROM characters WHERE id = ?').run(characterId);
  }

  private persistActiveBinding(bindingKey: string, characterId: string): void {
    if (!this.db) return;
    this.db.query(`
      INSERT INTO active_cards (binding_key, character_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(binding_key) DO UPDATE SET
        character_id = excluded.character_id,
        updated_at = excluded.updated_at
    `).run(bindingKey, characterId, new Date().toISOString());
  }

  private deleteActiveBinding(bindingKey: string): void {
    if (!this.db) return;
    this.db.query('DELETE FROM active_cards WHERE binding_key = ?').run(bindingKey);
  }

  private recalcDerived(c: Character): void {
    const { str, con, siz, dex, pow, edu } = c.attributes;
    if (con && siz) c.derived.hp = Math.floor((con + siz) / 10);
    if (pow) c.derived.mp = Math.floor(pow / 5);
    if (pow && !c.derived.san) c.derived.san = pow;
    if (dex) {
      c.skills['闪避'] = Math.floor(dex / 2);
    }
    if (edu) {
      c.skills['母语'] = edu;
    }

    // 伤害加值 & 体格
    const combined = str + siz;
    if (combined >= 2 && combined <= 64) { c.derived.damageBonus = '-2'; c.derived.build = -2; }
    else if (combined <= 84) { c.derived.damageBonus = '-1'; c.derived.build = -1; }
    else if (combined <= 124) { c.derived.damageBonus = '0'; c.derived.build = 0; }
    else if (combined <= 164) { c.derived.damageBonus = '1d4'; c.derived.build = 1; }
    else if (combined <= 204) { c.derived.damageBonus = '1d6'; c.derived.build = 2; }
    else { c.derived.damageBonus = '2d6'; c.derived.build = 3; }

    // MOV
    if (dex && str && siz) {
      if (dex < siz && str < siz) c.derived.mov = 7;
      else if (dex > siz && str > siz) c.derived.mov = 9;
      else c.derived.mov = 8;
    }
  }
}
