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
}
