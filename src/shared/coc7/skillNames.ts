export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  accounting: '会计',
  anthropology: '人类学',
  appraise: '估价',
  archaeology: '考古学',
  art1: '技艺①',
  art2: '技艺②',
  art3: '技艺③',
  charm: '魅惑',
  climb: '攀爬',
  computer: '计算机使用',
  credit: '信用评级',
  cthulhu: '克苏鲁神话',
  disguise: '乔装',
  dodge: '闪避',
  drive: '汽车驾驶',
  electrical: '电气维修',
  electronics: '电子学',
  fast_talk: '话术',
  fight_brawl: '格斗：斗殴',
  fight1: '格斗①',
  fight2: '格斗②',
  fight3: '格斗③',
  shoot_handgun: '射击：手枪',
  shoot1: '射击①',
  shoot2: '射击②',
  shoot3: '射击③',
  first_aid: '急救',
  history: '历史',
  intimidate: '恐吓',
  jump: '跳跃',
  lang1: '外语①',
  lang2: '外语②',
  native_lang: '母语',
  law: '法律',
  library: '图书馆使用',
  listen: '聆听',
  locksmith: '锁匠',
  mech_repair: '机械维修',
  medicine: '医学',
  natural_world: '博物学',
  navigate: '导航',
  occult: '神秘学',
  op_heavy: '操作重型机械',
  persuade: '说服',
  pilot: '驾驶',
  psychoanalysis: '精神分析',
  psychology: '心理学',
  ride: '骑术',
  science1: '科学①',
  science2: '科学②',
  sleight: '妙手',
  spot_hidden: '侦查',
  stealth: '潜行',
  survival: '生存',
  swim: '游泳',
  throw: '投掷',
  track: '追踪',
  animal_handling: '驯兽',
  diving: '潜水',
  explosives: '爆破',
  read_lips: '读唇',
  hypnosis: '催眠',
  artillery: '炮术',
};

const SKILL_ALIASES: Record<string, string[]> = {
  fight_brawl: ['斗殴', '格斗', '格斗斗殴'],
  shoot_handgun: ['手枪', '射击手枪'],
  library: ['图书馆', '图书馆使用'],
  spot_hidden: ['侦查'],
  credit: ['信用', '信用评级'],
  fast_talk: ['话术'],
  natural_world: ['博物学'],
  op_heavy: ['操作重型机械'],
  native_lang: ['母语'],
};

export function getSkillDisplayName(skillKey: string): string {
  return SKILL_DISPLAY_NAMES[skillKey] ?? skillKey;
}

export function resolveSkillKey(input: string, candidates?: Iterable<string>): string | null {
  const normalizedInput = normalizeSkillToken(input);
  if (!normalizedInput) return null;

  const keys = candidates ? Array.from(candidates) : Object.keys(SKILL_DISPLAY_NAMES);
  for (const key of keys) {
    if (normalizeSkillToken(key) === normalizedInput) return key;
    if (normalizeSkillToken(getSkillDisplayName(key)) === normalizedInput) return key;
    for (const alias of SKILL_ALIASES[key] ?? []) {
      if (normalizeSkillToken(alias) === normalizedInput) return key;
    }
  }

  for (const key of keys) {
    const haystacks = [key, getSkillDisplayName(key), ...(SKILL_ALIASES[key] ?? [])]
      .map((item) => normalizeSkillToken(item));
    if (haystacks.some((item) => item.includes(normalizedInput) || normalizedInput.includes(item))) {
      return key;
    }
  }

  return null;
}

export function normalizeSkillToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/[：:（）()\s·、，,／/]+/g, '')
    .trim();
}
