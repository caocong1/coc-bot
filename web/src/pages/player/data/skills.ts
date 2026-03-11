/**
 * CoC7 完整技能表
 * baseValue: 接收属性对象，返回该技能的初始值
 * hasSubType: 是否需要玩家填写子类型（如技艺：摄影、外语：英语）
 */

export interface SkillDef {
  id: string;
  name: string;
  baseValue: (a: { str: number; con: number; siz: number; dex: number; app: number; int: number; pow: number; edu: number }) => number;
  hasSubType?: boolean;
}

type A = { str: number; con: number; siz: number; dex: number; app: number; int: number; pow: number; edu: number };

export const SKILLS: SkillDef[] = [
  { id: 'accounting',    name: '会计',       baseValue: () => 5 },
  { id: 'anthropology',  name: '人类学',     baseValue: () => 1 },
  { id: 'appraise',      name: '估价',       baseValue: () => 5 },
  { id: 'archaeology',   name: '考古学',     baseValue: () => 1 },
  { id: 'art1',          name: '技艺①',     baseValue: () => 5, hasSubType: true },
  { id: 'art2',          name: '技艺②',     baseValue: () => 5, hasSubType: true },
  { id: 'art3',          name: '技艺③',     baseValue: () => 5, hasSubType: true },
  { id: 'charm',         name: '魅惑',       baseValue: () => 15 },
  { id: 'climb',         name: '攀爬',       baseValue: () => 20 },
  { id: 'computer',      name: '计算机使用', baseValue: () => 5 },
  { id: 'credit',        name: '信用评级',   baseValue: () => 0 },
  { id: 'cthulhu',       name: '克苏鲁神话', baseValue: () => 0 },
  { id: 'disguise',      name: '乔装',       baseValue: () => 5 },
  { id: 'dodge',         name: '闪避',       baseValue: (a: A) => Math.floor(a.dex / 2) },
  { id: 'drive',         name: '汽车驾驶',   baseValue: () => 20 },
  { id: 'electrical',    name: '电气维修',   baseValue: () => 10 },
  { id: 'electronics',   name: '电子学',     baseValue: () => 1 },
  { id: 'fast_talk',     name: '话术',       baseValue: () => 5 },
  { id: 'fight_brawl',   name: '格斗：斗殴', baseValue: () => 25 },
  { id: 'fight1',        name: '格斗①',     baseValue: () => 15, hasSubType: true },
  { id: 'fight2',        name: '格斗②',     baseValue: () => 15, hasSubType: true },
  { id: 'shoot_handgun', name: '射击：手枪', baseValue: () => 20 },
  { id: 'shoot1',        name: '射击①',     baseValue: () => 25, hasSubType: true },
  { id: 'shoot2',        name: '射击②',     baseValue: () => 25, hasSubType: true },
  { id: 'first_aid',     name: '急救',       baseValue: () => 30 },
  { id: 'history',       name: '历史',       baseValue: () => 5 },
  { id: 'intimidate',    name: '恐吓',       baseValue: () => 15 },
  { id: 'jump',          name: '跳跃',       baseValue: () => 20 },
  { id: 'lang1',         name: '外语①',     baseValue: () => 1, hasSubType: true },
  { id: 'lang2',         name: '外语②',     baseValue: () => 1, hasSubType: true },
  { id: 'native_lang',   name: '母语',       baseValue: (a: A) => a.edu },
  { id: 'law',           name: '法律',       baseValue: () => 5 },
  { id: 'library',       name: '图书馆使用', baseValue: () => 20 },
  { id: 'listen',        name: '聆听',       baseValue: () => 20 },
  { id: 'locksmith',     name: '锁匠',       baseValue: () => 1 },
  { id: 'mech_repair',   name: '机械维修',   baseValue: () => 10 },
  { id: 'medicine',      name: '医学',       baseValue: () => 1 },
  { id: 'natural_world', name: '博物学',     baseValue: () => 10 },
  { id: 'navigate',      name: '领航',       baseValue: () => 10 },
  { id: 'occult',        name: '神秘学',     baseValue: () => 5 },
  { id: 'op_heavy',      name: '操作重型机械', baseValue: () => 1 },
  { id: 'persuade',      name: '说服',       baseValue: () => 10 },
  { id: 'pilot',         name: '驾驶',       baseValue: () => 1, hasSubType: true },
  { id: 'psychoanalysis',name: '精神分析',   baseValue: () => 1 },
  { id: 'psychology',    name: '心理学',     baseValue: () => 10 },
  { id: 'ride',          name: '骑术',       baseValue: () => 5 },
  { id: 'science1',      name: '科学①',     baseValue: () => 1, hasSubType: true },
  { id: 'science2',      name: '科学②',     baseValue: () => 1, hasSubType: true },
  { id: 'sleight',       name: '妙手',       baseValue: () => 10 },
  { id: 'spot_hidden',   name: '侦查',       baseValue: () => 25 },
  { id: 'stealth',       name: '潜行',       baseValue: () => 20 },
  { id: 'survival',      name: '生存',       baseValue: () => 10, hasSubType: true },
  { id: 'swim',          name: '游泳',       baseValue: () => 20 },
  { id: 'throw',         name: '投掷',       baseValue: () => 20 },
  { id: 'track',         name: '追踪',       baseValue: () => 10 },
  { id: 'animal_handling',name: '驯兽',      baseValue: () => 5 },
  { id: 'diving',        name: '潜水',       baseValue: () => 1 },
  { id: 'explosives',    name: '爆破',       baseValue: () => 1 },
  { id: 'read_lips',     name: '读唇',       baseValue: () => 1 },
  { id: 'hypnosis',      name: '催眠',       baseValue: () => 1 },
  { id: 'artillery',     name: '炮术',       baseValue: () => 1 },
];
