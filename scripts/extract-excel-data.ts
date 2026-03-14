/**
 * 从 CoC7 角色卡 Excel 提取参考数据为 JSON 文件
 * 用法: bun run scripts/extract-excel-data.ts
 */
import * as XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const EXCEL_PATH = join(__dirname, '../../[充实车卡版本]空白卡.xlsx');
const OUT_DIR = join(__dirname, '../data/reference');

mkdirSync(OUT_DIR, { recursive: true });

const wb = XLSX.readFile(EXCEL_PATH);

function getSheet(name: string): any[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found`);
  return XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
}

function writeJson(filename: string, data: unknown) {
  const path = join(OUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✓ ${filename} (${Array.isArray(data) ? data.length + ' items' : 'object'})`);
}

function clean(val: unknown): string {
  if (val == null) return '';
  return String(val).replace(/\r\n/g, '\n').trim();
}

// ─── 1. 武器列表 ───
function extractWeapons() {
  const data = getSheet('武器列表');
  // row0 = header: [null, 武器类型, 技能, 伤害, 射程, 贯穿, 每轮, 装弹量, 故障值, 常见时代, 价格, 类型]
  const weapons: any[] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || !r[1]) continue;
    const name = clean(r[1]);
    const skill = clean(r[2]);
    const damage = clean(r[3]);
    if (!name || !skill || !damage) continue; // 需要技能和伤害字段才是真正的武器
    weapons.push({
      name,
      skill: clean(r[2]),
      damage: clean(r[3]),
      range: clean(r[4]),
      impale: clean(r[5]) === '√',
      rof: typeof r[6] === 'number' ? r[6] : parseInt(clean(r[6])) || 1,
      ammo: clean(r[7]),
      malfunction: clean(r[8]),
      era: clean(r[9]).split(',').map((s: string) => s.trim()).filter(Boolean),
      price: clean(r[10]),
      type: clean(r[11]) || undefined,
    });
  }
  writeJson('weapons.json', weapons);
}

// ─── 2. 防具表 + 载具表 ───
function extractArmorAndVehicles() {
  const data = getSheet('防具表 载具表');
  // Armor: cols 1-11 (B-L)
  const armor: any[] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || !r[1]) continue;
    const name = clean(r[1]);
    if (!name || name.startsWith('请看')) continue;
    armor.push({
      name,
      armorValue: clean(r[2]),
      movPenalty: clean(r[3]),
      coverage: clean(r[4]),
      species: clean(r[5]),
      antiPierce: clean(r[6]) === '√',
      protectionLevel: clean(r[7]),
      era: clean(r[8]).split(',').map((s: string) => s.trim()).filter(Boolean),
      price: clean(r[9]),
    });
  }
  writeJson('armor.json', armor);

  // Vehicles: cols 17-27 (R-AB)
  // row0 headers: 载具类型(17), 技能(18), 移动力MOV(19), 体格Build(20), 乘客护甲(21), 乘客(22), 可驾驶体格(23), 可乘坐体格(24), 常见时代(25), 类型(26), 注释(27)
  const vehicles: any[] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || !r[17]) continue;
    const name = clean(r[17]);
    if (!name) continue;
    vehicles.push({
      name,
      skill: clean(r[18]),
      mov: typeof r[19] === 'number' ? r[19] : clean(r[19]),
      build: typeof r[20] === 'number' ? r[20] : clean(r[20]),
      passengerArmor: typeof r[21] === 'number' ? r[21] : clean(r[21]),
      passengers: clean(r[22]),
      drivableBuild: clean(r[23]),
      ridableBuild: clean(r[24]),
      era: clean(r[25]).split(',').map((s: string) => s.trim()).filter(Boolean),
      type: clean(r[26]) || undefined,
      notes: clean(r[27]) || undefined,
    });
  }
  writeJson('vehicles.json', vehicles);
}

// ─── 3. 疯狂附表（恐惧症 + 狂躁症 D100 表）───
function extractPhobiasAndManias() {
  const data = getSheet('疯狂附表');
  // row0: [null, 恐惧症状表, null, 狂躁症状表]
  // row1: description
  // row2+: [index, phobia_desc, index, mania_desc]
  const phobias: any[] = [];
  const manias: any[] = [];
  for (let i = 2; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;
    if (r[0] != null && r[1]) {
      const num = typeof r[0] === 'number' ? r[0] : parseInt(String(r[0]));
      if (!isNaN(num) && num >= 1 && num <= 100) {
        phobias.push({ id: num, description: clean(r[1]) });
      }
    }
    if (r[2] != null && r[3]) {
      const num = typeof r[2] === 'number' ? r[2] : parseInt(String(r[2]));
      if (!isNaN(num) && num >= 1 && num <= 100) {
        manias.push({ id: num, description: clean(r[3]) });
      }
    }
  }
  writeJson('phobias.json', phobias);
  writeJson('manias.json', manias);
}

// ─── 4. 疯狂表（即时症状 1-10）───
function extractInsanitySymptoms() {
  const data = getSheet('疯狂表');
  const immediate: any[] = [];
  // Immediate symptoms: rows 3-12 (col 2=number, col 3=description)
  for (let i = 2; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;
    const num = r[2];
    if (typeof num === 'number' && num >= 1 && num <= 10 && r[3]) {
      immediate.push({ id: num, description: clean(r[3]) });
    }
  }

  // Also extract rules text blocks for reference
  const rules: any[] = [];
  const ruleKeywords = ['看透疯狂', '精神固化', '潜在疯狂', '失败的', '疯狂的', '幻觉'];
  for (let i = 20; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;
    const title = clean(r[2]);
    const desc = clean(r[3]);
    if (title && ruleKeywords.some(k => title.includes(k))) {
      // Collect description from this row and potentially next rows
      let fullDesc = desc;
      for (let j = i + 1; j < Math.min(i + 5, data.length); j++) {
        const nr = data[j];
        if (nr && nr[3] && !nr[2]) {
          fullDesc += '\n' + clean(nr[3]);
        } else break;
      }
      rules.push({ title: title.replace(/\n/g, ''), description: fullDesc });
    }
  }

  writeJson('insanity-symptoms.json', { immediate, rules });
}

// ─── 5. 职业列表 ───
function extractOccupations() {
  const data = getSheet('职业列表');
  // row0: [序号, 职业, null, 信誉, 职业属性, 技能点, 本职技能, ..., 推荐关系人(col10), null, 职业介绍(col12)]
  const occupations: any[] = [];
  for (let i = 2; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;
    const id = r[0];
    if (typeof id !== 'number' || id < 1) continue;
    const name = clean(r[1]);
    if (!name) continue;
    occupations.push({
      id,
      name,
      creditRange: clean(r[3]),
      formula: clean(r[4]),
      coreSkills: clean(r[6]),
      suggestedContacts: clean(r[10]),
      description: clean(r[12]),
    });
  }
  writeJson('occupations.json', occupations);
}

// ─── 6. 分支技能与资产 ───
function extractBranchSkills() {
  const data = getSheet('分支技能与资产');
  // row1: [null, 艺术与手艺, null, null, 科学, null, null, 格斗, null, null, 射击, null, null, 技能成功等级与注释]
  // row2: [null, 技能, 基础值, null, 技能, 基础值, null, 技能, 基础值, null, 技能, 基础值, null, 成功率, 解释]

  const artCraft: any[] = [];
  const science: any[] = [];
  const fighting: any[] = [];
  const shooting: any[] = [];
  const skillLevels: any[] = [];

  for (let i = 3; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;

    // Art & Craft (cols 1-2)
    if (r[1] && r[2] != null) {
      const name = clean(r[1]);
      const base = typeof r[2] === 'number' ? r[2] : parseInt(clean(r[2]));
      if (name && !isNaN(base)) {
        artCraft.push({ name, baseValue: base });
      }
    }

    // Science (cols 4-5)
    if (r[4] && r[5] != null) {
      const name = clean(r[4]);
      const base = typeof r[5] === 'number' ? r[5] : parseInt(clean(r[5]));
      if (name && !isNaN(base)) {
        science.push({ name, baseValue: base });
      }
    }

    // Fighting (cols 7-8)
    if (r[7] && r[8] != null) {
      const name = clean(r[7]);
      const base = typeof r[8] === 'number' ? r[8] : parseInt(clean(r[8]));
      if (name && !isNaN(base)) {
        fighting.push({ name, baseValue: base });
      }
    }

    // Shooting (cols 10-11)
    if (r[10] && r[11] != null) {
      const name = clean(r[10]);
      const base = typeof r[11] === 'number' ? r[11] : parseInt(clean(r[11]));
      if (name && !isNaN(base)) {
        shooting.push({ name, baseValue: base });
      }
    }

    // Skill level descriptions (cols 13-14)
    if (r[13] != null && r[14]) {
      const level = typeof r[13] === 'number' ? r[13] : parseInt(clean(r[13]));
      const desc = clean(r[14]);
      if (!isNaN(level) && desc) {
        skillLevels.push({ level, description: desc });
      }
    }
  }

  writeJson('branch-skills.json', {
    artCraft,
    science,
    fighting,
    shooting,
    skillLevels,
  });
}

// ─── 7. 属性描述 ───
function extractAttributeDescriptions() {
  const data = getSheet('属性和掷骰');
  // Attribute descriptions start at row 19
  // row19: [_, 力量 STR, ..., 体质 CON, ..., 体型 SIZ, ..., 敏捷 DEX, ..., 外貌 APP, ..., 智力 INT, ..., 意志 POW, ..., 教育 EDU]
  // Each attribute block is 6 columns wide (col, value, description, _, _, _)
  // Attributes at col offsets: STR=1, CON=7, SIZ=13, DEX=19, APP=25, INT=31, POW=37, EDU=43

  const attrCols: [string, number][] = [
    ['STR', 1], ['CON', 7], ['SIZ', 13], ['DEX', 19], ['APP', 25], ['INT', 31], ['POW', 37], ['EDU', 43],
  ];

  const attributes: Record<string, any[]> = {};
  for (const [attr] of attrCols) {
    attributes[attr] = [];
  }

  for (let i = 20; i < 40; i++) {
    const r = data[i];
    if (!r) continue;
    for (const [attr, col] of attrCols) {
      const val = r[col];
      const desc = r[col + 1];
      if (val != null && desc) {
        const numVal = typeof val === 'number' ? val : clean(val);
        attributes[attr].push({ value: numVal, description: clean(desc) });
      }
    }
  }

  // Also extract attribute explanations (row 38+)
  const explanations: Record<string, string> = {};
  if (data[38]) {
    for (const [attr, col] of attrCols) {
      const desc = clean(data[38][col + 1]) || clean(data[38][col]);
      if (desc) explanations[attr] = desc;
    }
  }

  writeJson('attribute-descriptions.json', { attributes, explanations });
}

// ─── Run all ───
console.log('Extracting CoC7 reference data from Excel...\n');
extractWeapons();
extractArmorAndVehicles();
extractPhobiasAndManias();
extractInsanitySymptoms();
extractOccupations();
extractBranchSkills();
extractAttributeDescriptions();
console.log('\nDone! Files written to data/reference/');
