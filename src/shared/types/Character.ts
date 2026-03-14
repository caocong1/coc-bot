/**
 * 调查员（PC）基础属性
 */
export interface CharacterAttributes {
  [key: string]: number;
  str: number;  // 力量
  con: number;  // 体质
  siz: number;  // 体型
  dex: number;  // 敏捷
  app: number;  // 外貌
  int: number;  // 智力
  pow: number;  // 意志
  edu: number;  // 教育
}

/**
 * 调查员（PC）派生属性
 */
export interface CharacterDerived {
  [key: string]: number | string;
  hp: number;        // 生命值
  mp: number;        // 魔法值
  san: number;       // 理智值
  luck: number;      // 幸运
  mov: number;       // 移动力
  build: number;     // 体格
  damageBonus: string; // 伤害加值
}

/** 资产信息 */
export interface CharacterAssets {
  creditRating: number;       // 信用评级（0-99）
  livingStandard: string;     // 生活水平
  cash: number;               // 当前现金
  currency: string;           // 货币单位（$, £）
  spendingLevel: string;      // 消费水平
  assets: string;             // 其他资产描述
  transportation: string;     // 交通工具
  residence: string;          // 住所
  luxuries: string;           // 奢侈品
  securities: string;         // 股票/证券
  other: string;              // 其他
}

/** 随身物品 */
export interface InventoryItem {
  name: string;
  location: 'body' | 'backpack';
  slot?: string;               // 部位（头/身体/手/腰）
  notes?: string;
}

/** 法术 */
export interface Spell {
  name: string;
  cost: string;               // "8mp 1d6san 1h"
  effect: string;
}

/** 调查员伙伴 */
export interface Companion {
  name: string;
  player?: string;
  notes?: string;
  change?: string;
  encounterModule?: string;
}

/** 经历记录 */
export interface Experience {
  moduleName: string;
  changes: string;             // "SAN-6,HP-2,侦查+2"
}

/** 神话接触记录 */
export interface MythosEncounter {
  entity: string;
  result: string;              // "CM+3, SAN-6"
  notes?: string;
  cumulative: number;          // 累计 CM
}

/** 武器 */
export interface CharacterWeapon {
  name: string;
  templateName?: string;        // 武器类型名（从武器库选择）
  type?: string;               // 分类（肉搏/射击/投掷）
  skill: string;               // 使用技能
  damage: string;              // 伤害公式
  range?: string;
  impale?: boolean;
  rof?: number;
  ammo?: string;
  malfunction?: string;
}

/** 防具 */
export interface CharacterArmor {
  name: string;
  armorValue: string;
  movPenalty?: string;
}

/** 载具 */
export interface CharacterVehicle {
  name: string;
  skill?: string;
  mov?: number;
  build?: number;
}

/**
 * 调查员（PC）
 */
export interface Character {
  id: string;
  playerId: number;  // QQ 用户 ID
  campaignId?: string;
  name: string;
  occupation?: string;
  age?: number;
  attributes: CharacterAttributes;
  derived: CharacterDerived;
  skills: Record<string, number>; // 技能名 -> 技能值
  createdAt: Date;
  updatedAt: Date;

  // ── 扩展字段 ──
  backstory?: Record<string, string>;
  assets?: CharacterAssets;
  inventory?: InventoryItem[];
  spells?: Spell[];
  companions?: Companion[];
  experiences?: Experience[];
  phobiasAndManias?: string[];
  woundsAndScars?: string;
  mythosEncounters?: MythosEncounter[];
  weapons?: CharacterWeapon[];
  armor?: CharacterArmor;
  vehicle?: CharacterVehicle;
}
