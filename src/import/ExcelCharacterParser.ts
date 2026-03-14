/**
 * Excel 角色卡导入解析器
 *
 * 解析中文 CoC7 标准角色卡 Excel（如 [充实车卡版本]空白卡.xlsx）的「人物卡」sheet，
 * 将数据映射为系统 CharacterPayload 格式。
 */

import * as XLSX from 'xlsx';

/* ─── 技能名 → 系统 ID 映射 ─── */

const SKILL_NAME_MAP: Record<string, string> = {
  '会计': 'accounting',
  '人类学': 'anthropology',
  '估价': 'appraise',
  '考古学': 'archaeology',
  '技艺①': 'art1',
  '技艺②': 'art2',
  '技艺③': 'art3',
  '魅惑': 'charm',
  '攀爬': 'climb',
  '计算机使用': 'computer',
  '信用评级': 'credit',
  '克苏鲁神话': 'cthulhu',
  '乔装': 'disguise',
  '闪避': 'dodge',
  '汽车驾驶': 'drive',
  '电气维修': 'electrical',
  '电子学': 'electronics',
  '话术': 'fast_talk',
  '格斗：': 'fight_brawl',
  '格斗：斗殴': 'fight_brawl',
  '格斗①': 'fight1',
  '格斗②': 'fight2',
  '格斗③': 'fight3',
  '射击：': 'shoot_handgun',
  '射击：手枪': 'shoot_handgun',
  '射击①': 'shoot1',
  '射击②': 'shoot2',
  '射击③': 'shoot3',
  '急救': 'first_aid',
  '历史': 'history',
  '恐吓': 'intimidate',
  '跳跃': 'jump',
  '外语①': 'lang1',
  '外语②': 'lang2',
  '母语': 'native_lang',
  '法律': 'law',
  '图书馆使用': 'library',
  '聆听': 'listen',
  '锁匠': 'locksmith',
  '机械维修': 'mech_repair',
  '医学': 'medicine',
  '博物学': 'natural_world',
  '领航': 'navigate',
  '神秘学': 'occult',
  '操作重型机械': 'op_heavy',
  '说服': 'persuade',
  '驾驶：': 'pilot',
  '精神分析': 'psychoanalysis',
  '心理学': 'psychology',
  '骑术': 'ride',
  '科学①': 'science1',
  '科学②': 'science2',
  '妙手': 'sleight',
  '侦查': 'spot_hidden',
  '潜行': 'stealth',
  '生存：': 'survival',
  '游泳': 'swim',
  '投掷': 'throw',
  '追踪': 'track',
  '驯兽': 'animal_handling',
  '潜水': 'diving',
  '爆破': 'explosives',
  '读唇': 'read_lips',
  '催眠': 'hypnosis',
  '炮术': 'artillery',
};

/* ─── 类型定义（与 CharacterForm 保存时的 payload 对齐）─── */

export interface ImportedCharacter {
  name: string;
  age: number;
  occupation: string;
  occupationIndex?: number;
  occupationExcelName?: string;
  era: string;
  gender: string;
  attributes: {
    str: number; con: number; siz: number; dex: number;
    app: number; int: number; pow: number; edu: number;
  };
  derived: {
    hp: number; san: number; mp: number;
    mov: number; movAdjust: number; db: string; build: number;
  };
  luck: number;
  skills: Record<string, number>;
  skillPoints: Record<string, { occ: number; hobby: number; growth: number; subType?: string }>;
  backstory: {
    appearance: string;
    ideology: string;
    significantPerson: string;
    significantPlace: string;
    treasure: string;
    traits: string;
    injuries: string;
  };
  assets?: {
    creditRating: number;
    livingStandard: string;
    spendingLevel: string;
    cash: number;
    currency: string;
    assets: string;
    transportation: string;
    residence: string;
    luxuries: string;
    securities: string;
    other: string;
  };
  inventory?: { name: string; location: 'body' | 'backpack'; slot?: string; notes?: string }[];
  weapons?: { name: string; type?: string; skill: string; successRate?: number; damage: string; range?: string; impale?: boolean; rof?: number; ammo?: string; malfunction?: string }[];
  phobiasAndManias?: string[];
  woundsAndScars?: string;
}

/* ─── 辅助函数 ─── */

function cell(ws: XLSX.WorkSheet, ref: string): any {
  const c = ws[ref];
  return c ? c.v : undefined;
}

function cellStr(ws: XLSX.WorkSheet, ref: string): string {
  const v = cell(ws, ref);
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function cellNum(ws: XLSX.WorkSheet, ref: string): number {
  const v = cell(ws, ref);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/** 清理技能名：去掉 Ω 后缀和多余空格 */
function cleanSkillName(raw: string): string {
  return raw.replace(/\s*Ω\s*$/, '').replace(/\s+/g, '').trim();
}

/** 从技能名中提取子类型，如 "科学①(数学)" → { name: "科学①", subType: "数学" } */
function extractSubType(name: string): { name: string; subType?: string } {
  const m = name.match(/^(.+?)[（(](.+?)[）)]$/);
  if (m) return { name: m[1], subType: m[2] };
  return { name };
}

/** 计算 DB 和 Build（基于 STR + SIZ） */
function calcDbBuild(str: number, siz: number): { db: string; build: number } {
  const total = str + siz;
  if (total <= 64) return { db: '-2', build: -2 };
  if (total <= 84) return { db: '-1', build: -1 };
  if (total <= 124) return { db: '0', build: 0 };
  if (total <= 164) return { db: '+1D4', build: 1 };
  if (total <= 204) return { db: '+1D6', build: 2 };
  if (total <= 284) return { db: '+2D6', build: 3 };
  if (total <= 364) return { db: '+3D6', build: 4 };
  if (total <= 444) return { db: '+4D6', build: 5 };
  return { db: '+5D6', build: 6 };
}

/** 计算 MOV（基于属性和年龄） */
function calcMov(str: number, dex: number, siz: number, age: number): number {
  let base: number;
  if (dex < siz && str < siz) base = 7;
  else if (dex > siz && str > siz) base = 9;
  else base = 8;

  if (age >= 80) base -= 5;
  else if (age >= 70) base -= 4;
  else if (age >= 60) base -= 3;
  else if (age >= 50) base -= 2;
  else if (age >= 40) base -= 1;

  return Math.max(1, base);
}

/* ─── 主解析函数 ─── */

export function parseExcelCharacter(buffer: ArrayBuffer): ImportedCharacter {
  const wb = XLSX.read(buffer);

  // 查找 "人物卡" sheet
  const sheetName = wb.SheetNames.find((n) => n.includes('人物卡'));
  if (!sheetName) {
    throw new Error('找不到「人物卡」工作表，请确认上传的是 CoC7 标准角色卡 Excel');
  }
  const ws = wb.Sheets[sheetName];

  // ── 基本信息 ──
  const name = cellStr(ws, 'C3');
  if (!name) throw new Error('角色名为空，请检查 Excel 中 C3 单元格');

  const occupation = cellStr(ws, 'C5');
  const occupationIndex = cellNum(ws, 'G5'); // Excel 职业序号
  const age = cellNum(ws, 'C6') || 25;
  const era = cellStr(ws, 'G4') || '现代';
  const gender = cellStr(ws, 'G6') || '';

  // 从"职业列表" sheet 查询标准职业名
  let occupationExcelName: string | undefined;
  if (occupationIndex > 0) {
    const occSheet = wb.SheetNames.find((n) => n.includes('职业列表'));
    if (occSheet) {
      const occWs = wb.Sheets[occSheet];
      const occData = XLSX.utils.sheet_to_json(occWs, { header: 1 }) as any[][];
      for (let i = 2; i < occData.length; i++) {
        const row = occData[i];
        if (row && row[0] === occupationIndex && row[1]) {
          occupationExcelName = String(row[1]).trim();
          break;
        }
      }
    }
  }

  // ── 八大属性 ──
  const attributes = {
    str: cellNum(ws, 'K3') || 50,
    con: cellNum(ws, 'K5') || 50,
    siz: cellNum(ws, 'K7') || 60,
    dex: cellNum(ws, 'N3') || 50,
    app: cellNum(ws, 'N5') || 50,
    int: cellNum(ws, 'N7') || 60,
    pow: cellNum(ws, 'Q3') || 50,
    edu: cellNum(ws, 'Q5') || 60,
  };

  // ── 派生值 ──
  const hpExcel = cellNum(ws, 'D10');
  const sanExcel = cellNum(ws, 'I10');
  const luckExcel = cellNum(ws, 'M10');
  const mpExcel = cellNum(ws, 'Q10');
  const movExcel = cellNum(ws, 'Q7');
  const movAdjust = cellNum(ws, 'R8'); // MOV 调整值

  const { db, build } = calcDbBuild(attributes.str, attributes.siz);
  const hp = hpExcel || Math.floor((attributes.con + attributes.siz) / 10);
  const san = sanExcel || attributes.pow;
  const mp = mpExcel || Math.floor(attributes.pow / 5);
  const luck = luckExcel || 50;
  const mov = movExcel || calcMov(attributes.str, attributes.dex, attributes.siz, age);

  // ── 技能 ──
  const skills: Record<string, number> = {};
  const skillPoints: Record<string, { occ: number; hobby: number; growth: number; subType?: string }> = {};

  function parseSkillRow(
    nameCol: string, baseCol: string, growthCol: string,
    occCol: string, hobbyCol: string, totalCol: string,
    row: number,
  ) {
    const rawName = cellStr(ws, `${nameCol}${row}`);
    if (!rawName || rawName === '学问：' || rawName === '自定义技能') return;

    const cleaned = cleanSkillName(rawName);
    const { name: skillName, subType } = extractSubType(cleaned);

    const skillId = SKILL_NAME_MAP[skillName];
    if (!skillId) return; // 无法匹配的技能跳过

    const total = cellNum(ws, `${totalCol}${row}`);
    const base = cellNum(ws, `${baseCol}${row}`);
    const occRaw = cellStr(ws, `${occCol}${row}`);
    const hobbyRaw = cellStr(ws, `${hobbyCol}${row}`);
    const growthRaw = cellStr(ws, `${growthCol}${row}`);

    const occ = (occRaw && occRaw !== '——') ? parseInt(occRaw, 10) || 0 : 0;
    const hobby = (hobbyRaw && hobbyRaw !== '——') ? parseInt(hobbyRaw, 10) || 0 : 0;
    const growth = (growthRaw && growthRaw !== '——') ? parseInt(growthRaw, 10) || 0 : 0;

    // 只记录有实际点数分配或成长的技能
    if (total > base || occ > 0 || hobby > 0 || growth > 0) {
      skills[skillId] = total;
      skillPoints[skillId] = { occ, hobby, growth };
      if (subType) {
        skillPoints[skillId].subType = subType;
      }
    }
  }

  for (let row = 16; row <= 48; row++) {
    // 左侧：D=name, G=base, H=growth, I=occ, J=hobby, K=total
    parseSkillRow('D', 'G', 'H', 'I', 'J', 'K', row);
    // 右侧：P=name, R=base, S=growth, T=occ, U=hobby, V=total
    parseSkillRow('P', 'R', 'S', 'T', 'U', 'V', row);
  }

  // ── 背景故事 ──
  const backstory = {
    appearance: cellStr(ws, 'M62') || cellStr(ws, 'N62'),
    ideology: cellStr(ws, 'M64') || cellStr(ws, 'N64'),
    significantPerson: cellStr(ws, 'M66') || cellStr(ws, 'N66'),
    significantPlace: cellStr(ws, 'M68') || cellStr(ws, 'N68'),
    treasure: cellStr(ws, 'M70') || cellStr(ws, 'N70'),
    traits: cellStr(ws, 'M72') || cellStr(ws, 'N72'),
    injuries: cellStr(ws, 'M74') || cellStr(ws, 'N74'),
  };

  // ── 恐惧症和狂躁症 ──
  const phobiasRaw = cellStr(ws, 'M78') || cellStr(ws, 'N78');
  const phobiasAndManias = phobiasRaw
    ? phobiasRaw.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  // ── 伤口和疤痕 ──
  const woundsAndScars = cellStr(ws, 'M76') || cellStr(ws, 'N76');

  // ── 资产 ──
  const creditStr = cellStr(ws, 'B62'); // "20%/10%/4%"
  const creditRating = creditStr ? (parseInt(creditStr, 10) || 0) : (skills['credit'] || 0);

  const assets = {
    creditRating,
    livingStandard: cellStr(ws, 'D62'),
    spendingLevel: cellStr(ws, 'E62'),
    cash: cellNum(ws, 'I62'),
    currency: cellStr(ws, 'K62') || '$',
    assets: (() => {
      const detail = cellStr(ws, 'G63');
      if (detail && !detail.includes('请在这里')) return detail;
      const total = cellNum(ws, 'G62');
      return total ? String(total) : '';
    })(),
    transportation: cellStr(ws, 'B70'),
    residence: cellStr(ws, 'D70'),
    luxuries: cellStr(ws, 'F70'),
    securities: cellStr(ws, 'H70'),
    other: cellStr(ws, 'J70'),
  };

  // ── 随身物品 ──
  const inventory: ImportedCharacter['inventory'] = [];
  for (let row = 79; row <= 100; row++) {
    const itemName = cellStr(ws, `D${row}`);
    if (!itemName) break;
    const loc = cellStr(ws, `C${row}`);
    inventory.push({
      name: itemName,
      location: loc ? 'body' : 'backpack',
      slot: loc || undefined,
    });
  }

  // ── 武器（行 53-58，行 52 为表头）──
  const weapons: ImportedCharacter['weapons'] = [];
  for (let row = 53; row <= 58; row++) {
    const weaponName = cellStr(ws, `B${row}`);
    if (!weaponName || weaponName === '无') continue;
    const impaleStr = cellStr(ws, `N${row}`);
    weapons.push({
      name: weaponName,
      type: cellStr(ws, `D${row}`) || undefined,
      skill: cellStr(ws, `E${row}`) || '斗殴',
      successRate: cellNum(ws, `G${row}`) || undefined,
      damage: cellStr(ws, `J${row}`) || '',
      range: cellStr(ws, `L${row}`) || undefined,
      impale: impaleStr === '√' || impaleStr === '✓',
      rof: cellNum(ws, `O${row}`) || undefined,
      ammo: cellStr(ws, `Q${row}`) || undefined,
      malfunction: cellStr(ws, `S${row}`) || undefined,
    });
  }

  return {
    name,
    age,
    occupation,
    occupationIndex: occupationIndex || undefined,
    occupationExcelName: occupationExcelName || undefined,
    era,
    gender,
    attributes,
    derived: { hp, san, mp, mov, movAdjust, db, build },
    luck,
    skills,
    skillPoints,
    backstory,
    assets,
    inventory: inventory.length > 0 ? inventory : undefined,
    weapons: weapons.length > 0 ? weapons : undefined,
    phobiasAndManias: phobiasAndManias.length > 0 ? phobiasAndManias : undefined,
    woundsAndScars: woundsAndScars || undefined,
  };
}
