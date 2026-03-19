/**
 * 角色卡创建/编辑表单（单页多 Tab）
 *
 * 掷属性集成在基本信息 Tab 的属性区域中（可折叠）
 * 提交后自动同步 bot，无需 QQ 命令
 */

import {
  createEffect, createResource, createSignal, createMemo, For, Show, type Component,
} from 'solid-js';
import { playerApi } from '../../api';
import { OCCUPATIONS } from './data/occupations';
import { SKILLS, type SkillDef } from './data/skills';

// 这些类型与 src/shared/types/Character.ts 保持同步
interface InventoryItem { name: string; location: 'body' | 'backpack'; slot?: string; notes?: string; }
interface Spell { name: string; cost: string; effect: string; }
interface Companion { name: string; player?: string; notes?: string; change?: string; encounterModule?: string; }
interface Experience { moduleName: string; changes: string; }
interface MythosEncounter { entity: string; result: string; notes?: string; cumulative: number; }
interface WeaponItem { name: string; templateName?: string; type?: string; skill: string; damage: string; range?: string; impale?: boolean; rof?: number; ammo?: string; malfunction?: string; _default?: boolean; }

interface Attrs { str: number; con: number; siz: number; dex: number; app: number; int: number; pow: number; edu: number; }
type SkillPoints = Record<string, { occ: number; hobby: number; growth: number; subType?: string }>;
type Tab = 'basic' | 'skills' | 'assets' | 'combat' | 'backstory' | 'magic' | 'companions';

interface RollSet extends Attrs { luck: number; total: number; }

interface Props { editId?: string; }

const DEFAULT_BACKSTORY = {
  appearance: '', ideology: '', significantPerson: '',
  meaningfulLocation: '', treasuredPossession: '', traits: '',
  injuries: '', backstory: '',
};

const createDefaultWeapons = (): WeaponItem[] => ([
  { name: '无', templateName: '徒手', type: '肉搏', skill: '斗殴', damage: '1D3+DB', range: '', impale: false, rof: 1, ammo: '', malfunction: '', _default: true },
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function matchOccupationId(occupationName: unknown): number | null {
  if (typeof occupationName !== 'string' || !occupationName.trim()) return null;
  let match = OCCUPATIONS.find((o) => o.name === occupationName);
  if (!match) {
    const parts = occupationName.split(/[、，/／（(）)]+/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      match = OCCUPATIONS.find((o) => o.name.includes(part));
      if (match) break;
    }
  }
  return match?.id ?? null;
}

// ─── 随机名字 ──────────────────────────────────────────────────────────────────

const CN_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹'.split('');
const CN_GIVEN_1 = '伟芳娜敏静秀娟英华慧巧美娜淑惠珠翠雅芝玉萍红娥玲芬燕彩春菊兰凤洁梅琳素云莲真环雪荣爱妹霞香月莺媛艳瑞凡佳嘉琼勤珍贞莉桂娣叶璧璐娅琦晶妍茜秋珊莎锦黛青倩婷姣婉娴瑾颖露瑶怡婵雁蓓纨仪荷丹蓉眉君琴蕊薇菁梦岚苑婕馨瑗琰韵融园艺咏卿聪澜纯毓悦昭冰爽琬茗羽希宁欣飘育滢馥筠柔竹霭思若薰鸿彬斌磊强军平保东文辉力明永健世广志义兴良海山仁波宁贵福生龙元全国胜学祥才发武新利清飞彪富顺信子杰涛昌成康星光天达安岩中茂进林有坚和彪博诚先敬震振壮会思群豪心邦承乐绍功松善厚庆磊民友裕河哲江超浩亮政谦亨奇固之轮翰朗伯宏言若鸣朋斌梁栋维启克伦翔旭鹏泽晨辰士以建家致树炎德行时泰盛雄琛钧冠策腾楠榕风航弘'.split('');
const CN_GIVEN_2 = '子轩宇涵睿嘉浩然天佑文博雪梅婉清思远语嫣晓雯若曦梦琪心怡'.split('');
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function randomChineseName(): string {
  const surname = pick(CN_SURNAMES);
  // 60% 双字名，40% 单字名
  const given = Math.random() < 0.6 ? pick(CN_GIVEN_1) + pick(CN_GIVEN_2) : pick(CN_GIVEN_1);
  return surname + given;
}

const EN_GIVEN_M = ['Arthur','Edwin','Harold','Walter','Frank','George','Henry','Albert','Ernest','Herbert','Leonard','Frederick','Ralph','Raymond','Clarence','Roy','Carl','Earl','Howard','Oscar','Stanley','Victor','Wilbur','Norman','Cecil','Reginald','Clifford','Everett','Lloyd','Elmer'];
const EN_GIVEN_F = ['Dorothy','Helen','Margaret','Ruth','Mildred','Anna','Elizabeth','Frances','Marie','Alice','Florence','Ethel','Grace','Lillian','Edna','Emma','Rose','Bessie','Hazel','Pearl','Bertha','Gladys','Alma','Ida','Martha','Irene','Mabel','Louise','Gertrude','Nora'];
const EN_SURNAMES = ['Smith','Johnson','Williams','Jones','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Garcia','Martinez','Robinson','Clark','Rodriguez','Lewis','Lee','Walker','Hall','Allen','Young','Hernandez','King','Wright','Scott','Green','Adams','Baker','Gonzalez','Nelson','Carter','Mitchell','Perez','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins','Stewart'];

function randomEnglishName(): string {
  const female = Math.random() < 0.5;
  const given = pick(female ? EN_GIVEN_F : EN_GIVEN_M);
  return `${given} ${pick(EN_SURNAMES)}`;
}

// ─── 骰点工具 ──────────────────────────────────────────────────────────────────

function rollDice(n: number, sides: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += Math.floor(Math.random() * sides) + 1;
  return t;
}
const r3d6x5 = () => rollDice(3, 6) * 5;
const r2d6p6x5 = () => (rollDice(2, 6) + 6) * 5;

function rollOneSet(): RollSet {
  const str = r3d6x5(), con = r3d6x5(), siz = r2d6p6x5();
  const dex = r3d6x5(), app = r3d6x5(), int = r2d6p6x5();
  const pow = r3d6x5(), edu = r2d6p6x5(), luck = r3d6x5();
  return { str, con, siz, dex, app, int, pow, edu, luck, total: str + con + siz + dex + app + int + pow + edu };
}

/** 生成精确等于目标总点的属性组（幸运独立随机，不计入总点） */
function rollOneSetWithTotal(target: number): RollSet {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const floor5 = (v: number) => Math.floor(v / 5) * 5;

  // 各属性合法范围
  const KEYS = ['str', 'con', 'dex', 'app', 'pow', 'siz', 'int', 'edu'] as const;
  const MIN: Record<string, number> = { str: 15, con: 15, dex: 15, app: 15, pow: 15, siz: 40, int: 40, edu: 40 };
  const MAX: Record<string, number> = { str: 90, con: 90, dex: 90, app: 90, pow: 90, siz: 90, int: 90, edu: 90 };

  // 1. 随机原始骰值（未 ×5），用于确定比例
  const raw: Record<string, number> = {
    str: rollDice(3, 6), con: rollDice(3, 6), dex: rollDice(3, 6),
    app: rollDice(3, 6), pow: rollDice(3, 6),
    siz: rollDice(2, 6) + 6, int: rollDice(2, 6) + 6, edu: rollDice(2, 6) + 6,
  };
  const rawSum = KEYS.reduce((s, k) => s + raw[k], 0);
  const scale = target / (rawSum * 5);

  // 2. 按比例缩放，向下取整到 5 的倍数，钳位到合法范围
  const vals: Record<string, number> = {};
  for (const k of KEYS) {
    vals[k] = clamp(floor5(raw[k] * 5 * scale), MIN[k], MAX[k]);
  }

  // 3. 补齐差值（差值必为 5 的倍数），从各属性里贪心分配
  let diff = target - KEYS.reduce((s, k) => s + vals[k], 0);
  const step = diff > 0 ? 5 : -5;
  let guard = 0;
  while (diff !== 0 && guard++ < 200) {
    for (const k of KEYS) {
      if (diff === 0) break;
      const next = vals[k] + step;
      if (next >= MIN[k] && next <= MAX[k]) {
        vals[k] = next;
        diff -= step;
      }
    }
  }

  const luck = r3d6x5();
  const total = KEYS.reduce((s, k) => s + vals[k], 0);
  return { str: vals.str, con: vals.con, siz: vals.siz, dex: vals.dex, app: vals.app, int: vals.int, pow: vals.pow, edu: vals.edu, luck, total };
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const CharacterForm: Component<Props> = (props) => {
  const importJson = props.editId ? null : sessionStorage.getItem('import_data');
  const isImport = !!importJson;
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [loadedEditId, setLoadedEditId] = createSignal<string | null>(null);
  const [editCharacter] = createResource(
    () => props.editId ?? null,
    async (id) => playerApi.getCharacter(id),
  );

  // ── 掷骰（集成在基本信息 Tab 中） ─────────────────────────────────────────
  const [showRoller, setShowRoller] = createSignal(false);
  const [rollSets, setRollSets] = createSignal<RollSet[]>([]);
  const [pickedIdx, setPickedIdx] = createSignal<number | null>(null);
  const [targetTotal, setTargetTotal] = createSignal('');

  const doRoll = () => {
    const t = parseInt(targetTotal(), 10);
    const gen = (!isNaN(t) && t >= 200 && t <= 700)
      ? () => rollOneSetWithTotal(t)
      : rollOneSet;
    setRollSets(Array.from({ length: 4 }, gen));
    setPickedIdx(null);
  };

  const confirmPick = () => {
    const idx = pickedIdx();
    if (idx === null) return;
    const s = rollSets()[idx];
    setAttrs({ str: s.str, con: s.con, siz: s.siz, dex: s.dex, app: s.app, int: s.int, pow: s.pow, edu: s.edu });
    setLuck(s.luck);
    setShowRoller(false);
  };

  // ── 基本信息 + 属性 ────────────────────────────────────────────────────────
  const [name, setName] = createSignal('');
  const [nameType, setNameType] = createSignal<'cn' | 'en'>('cn');
  const rollName = () => setName(nameType() === 'cn' ? randomChineseName() : randomEnglishName());
  const [age, setAge] = createSignal(25);
  const [gender, setGender] = createSignal('');
  const [residence, setResidence] = createSignal('');
  const [hometown, setHometown] = createSignal('');
  const [era, setEra] = createSignal<'1920s' | '现代' | '其他'>('1920s');
  const [occId, setOccId] = createSignal(0);
  const [luck, setLuck] = createSignal(50);
  const [attrs, setAttrs] = createSignal<Attrs>({ str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50 });

  const derived = createMemo(() => {
    const a = attrs();
    return {
      hp: Math.floor((a.con + a.siz) / 10),
      san: Math.min(a.pow, 99),
      mp: Math.floor(a.pow / 5),
      db: calcDamageBonus(a.str + a.siz),
      build: calcBuild(a.str + a.siz),
      mov: calcMov(a.str, a.dex, a.siz, age()),
    };
  });

  const filteredOccupations = createMemo(() => {
    const e = era();
    return OCCUPATIONS.filter((o) => {
      if (!o.era || o.era === 'any') return true;
      if (e === '1920s') return o.era === 'classic';
      if (e === '现代') return o.era === 'modern';
      return true;
    });
  });
  const occupation = createMemo(() => OCCUPATIONS.find((o) => o.id === occId()));
  const occPoints = createMemo(() => {
    const occ = occupation();
    return occ ? evalOccFormula(occ.formula, attrs()) : 0;
  });
  const hobbyPoints = createMemo(() => attrs().int * 2);

  const [skillPts, setSkillPts] = createSignal<SkillPoints>({});
  const setSkillVal = (id: string, field: 'occ' | 'hobby', val: number) =>
    setSkillPts((p) => ({ ...p, [id]: { ...p[id] ?? { occ: 0, hobby: 0, growth: 0 }, [field]: val } }));
  const setSubType = (id: string, sub: string) =>
    setSkillPts((p) => ({ ...p, [id]: { ...p[id] ?? { occ: 0, hobby: 0, growth: 0 }, subType: sub } }));

  const usedOcc = createMemo(() => Object.values(skillPts()).reduce((s, v) => s + (v.occ || 0), 0));
  const usedHobby = createMemo(() => Object.values(skillPts()).reduce((s, v) => s + (v.hobby || 0), 0));
  const remainOcc = createMemo(() => occPoints() - usedOcc());
  const remainHobby = createMemo(() => hobbyPoints() - usedHobby());
  const skillValue = (s: SkillDef) => {
    const pt = skillPts()[s.id] ?? { occ: 0, hobby: 0, growth: 0 };
    return s.baseValue(attrs()) + pt.occ + pt.hobby + pt.growth;
  };

  // ── 信用评级辅助 ──────────────────────────────────────────────────────────
  const creditRange = createMemo(() => {
    const occ = occupation();
    if (!occ?.creditRange) return null;
    const parts = occ.creditRange.split('-').map(Number);
    return { min: parts[0], max: parts[1] };
  });

  const creditValue = createMemo(() => {
    const s = SKILLS.find((sk) => sk.id === 'credit');
    if (!s) return 0;
    return skillValue(s);
  });

  const livingStandard = createMemo(() => {
    const cr = creditValue();
    const e = era();
    const currency = e === '1920s' ? '美元' : '元';
    if (cr <= 9)  return { level: '赤贫', spend: `0.5${currency}/周`, cash: `0-1${currency}`, assets: '几乎一无所有' };
    if (cr <= 19) return { level: '贫穷', spend: `2${currency}/周`, cash: `10-49${currency}`, assets: '微薄' };
    if (cr <= 49) return { level: '普通', spend: `10${currency}/周`, cash: `50-499${currency}`, assets: '一般' };
    if (cr <= 89) return { level: '富有', spend: `50${currency}/周`, cash: `500-4999${currency}`, assets: '可观' };
    if (cr <= 98) return { level: '富裕', spend: `250${currency}/周`, cash: `5000-49999${currency}`, assets: '相当雄厚' };
    return { level: '超级富有', spend: `1000+${currency}/周`, cash: `50000+${currency}`, assets: '极其庞大' };
  });

  const [tab, setTab] = createSignal<Tab>('basic');

  const [backstory, setBackstory] = createSignal({ ...DEFAULT_BACKSTORY });

  // ── 资产与装备 ──────────────────────────────────────────────────────────
  const [assetTransport, setAssetTransport] = createSignal('');
  const [assetResidence, setAssetResidence] = createSignal('');
  const [assetLuxuries, setAssetLuxuries] = createSignal('');
  const [assetSecurities, setAssetSecurities] = createSignal('');
  const [assetOther, setAssetOther] = createSignal('');
  const [inventory, setInventory] = createSignal<InventoryItem[]>([]);
  const addInventory = () => setInventory((l) => [...l, { name: '', location: 'backpack' }]);
  const removeInventory = (idx: number) => setInventory((l) => l.filter((_, i) => i !== idx));
  const updateInventory = (idx: number, patch: Partial<InventoryItem>) =>
    setInventory((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  // ── 战斗装备 ──────────────────────────────────────────────────────────
  const [weapons, setWeapons] = createSignal<WeaponItem[]>(createDefaultWeapons());
  const removeWeapon = (idx: number) => setWeapons((l) => l.filter((_, i) => i !== idx));
  const updateWeapon = (idx: number, patch: Partial<WeaponItem>) =>
    setWeapons((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  // 武器库选择器
  const [showWeaponPicker, setShowWeaponPicker] = createSignal(false);
  const [weaponRef, setWeaponRef] = createSignal<any[]>([]);
  const [weaponSearch, setWeaponSearch] = createSignal('');
  const loadWeaponRef = () => {
    if (weaponRef().length > 0) { setShowWeaponPicker(true); return; }
    playerApi.getReference<any[]>('weapons').then((data) => {
      setWeaponRef(data);
      setShowWeaponPicker(true);
    }).catch(() => alert('武器库加载失败'));
  };
  const pickWeapon = (w: any) => {
    setWeapons((l) => [...l, {
      name: '',
      templateName: w.name,
      type: w.type || '',
      skill: w.skill || '',
      damage: w.damage || '',
      range: w.range || '',
      impale: !!w.impale,
      rof: w.rof || 1,
      ammo: w.ammo || '',
      malfunction: w.malfunction || '',
    }]);
  };

  // 武器成功率：从角色技能表查找对应技能值
  const weaponSkillValue = (skillName: string): number | null => {
    if (!skillName) return null;
    let s = SKILLS.find((sk) => sk.name === skillName);
    if (!s) s = SKILLS.find((sk) => sk.name.includes(skillName) || skillName.includes(sk.name));
    return s ? skillValue(s) : null;
  };
  const filteredWeapons = createMemo(() => {
    const q = weaponSearch().toLowerCase();
    if (!q) return weaponRef();
    return weaponRef().filter((w: any) =>
      (w.name?.toLowerCase().includes(q)) ||
      (w.skill?.toLowerCase().includes(q)) ||
      (w.type?.toLowerCase().includes(q))
    );
  });

  const [armorName, setArmorName] = createSignal('');
  const [armorValue, setArmorValue] = createSignal('');
  const [vehicleName, setVehicleName] = createSignal('');
  const [vehicleSkill, setVehicleSkill] = createSignal('');

  // ── 法术与神话 ──────────────────────────────────────────────────────────
  const [spells, setSpells] = createSignal<Spell[]>([]);
  const addSpell = () => setSpells((l) => [...l, { name: '', cost: '', effect: '' }]);
  const removeSpell = (idx: number) => setSpells((l) => l.filter((_, i) => i !== idx));
  const updateSpell = (idx: number, patch: Partial<Spell>) =>
    setSpells((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const [mythosEncounters, setMythosEncounters] = createSignal<MythosEncounter[]>([]);
  const addMythos = () => setMythosEncounters((l) => [...l, { entity: '', result: '', cumulative: 0 }]);
  const removeMythos = (idx: number) => setMythosEncounters((l) => l.filter((_, i) => i !== idx));
  const updateMythos = (idx: number, patch: Partial<MythosEncounter>) =>
    setMythosEncounters((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const [phobiasManias, setPhobiasManias] = createSignal('');

  // ── 同伴与经历 ──────────────────────────────────────────────────────────
  const [companions, setCompanions] = createSignal<Companion[]>([]);
  const addCompanion = () => setCompanions((l) => [...l, { name: '' }]);
  const removeCompanion = (idx: number) => setCompanions((l) => l.filter((_, i) => i !== idx));
  const updateCompanion = (idx: number, patch: Partial<Companion>) =>
    setCompanions((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const [experiences, setExperiences] = createSignal<Experience[]>([]);
  const addExperience = () => setExperiences((l) => [...l, { moduleName: '', changes: '' }]);
  const removeExperience = (idx: number) => setExperiences((l) => l.filter((_, i) => i !== idx));
  const updateExperience = (idx: number, patch: Partial<Experience>) =>
    setExperiences((l) => l.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const applyCharacterPayload = (data: Record<string, unknown>) => {
    if (typeof data.name === 'string') setName(data.name);
    if (typeof data.age === 'number' && Number.isFinite(data.age)) setAge(data.age);
    if (typeof data.gender === 'string') setGender(data.gender);
    if (typeof data.residence === 'string') setResidence(data.residence);
    if (typeof data.hometown === 'string') setHometown(data.hometown);
    if (typeof data.luck === 'number' && Number.isFinite(data.luck)) setLuck(data.luck);
    if (data.era === '1920s' || data.era === '现代' || data.era === '其他') setEra(data.era);

    const nextAttrs = asRecord(data.attributes);
    if (Object.keys(nextAttrs).length > 0) {
      const current = attrs();
      setAttrs({
        str: typeof nextAttrs.str === 'number' ? nextAttrs.str : current.str,
        con: typeof nextAttrs.con === 'number' ? nextAttrs.con : current.con,
        siz: typeof nextAttrs.siz === 'number' ? nextAttrs.siz : current.siz,
        dex: typeof nextAttrs.dex === 'number' ? nextAttrs.dex : current.dex,
        app: typeof nextAttrs.app === 'number' ? nextAttrs.app : current.app,
        int: typeof nextAttrs.int === 'number' ? nextAttrs.int : current.int,
        pow: typeof nextAttrs.pow === 'number' ? nextAttrs.pow : current.pow,
        edu: typeof nextAttrs.edu === 'number' ? nextAttrs.edu : current.edu,
      });
    }

    const nextSkillPoints = asRecord(data.skillPoints);
    setSkillPts(Object.keys(nextSkillPoints).length > 0 ? nextSkillPoints as SkillPoints : {});

    const nextBackstory = asRecord(data.backstory);
    setBackstory({
      appearance: typeof nextBackstory.appearance === 'string' ? nextBackstory.appearance : '',
      ideology: typeof nextBackstory.ideology === 'string' ? nextBackstory.ideology : '',
      significantPerson: typeof nextBackstory.significantPerson === 'string' ? nextBackstory.significantPerson : '',
      meaningfulLocation: typeof nextBackstory.meaningfulLocation === 'string' ? nextBackstory.meaningfulLocation : '',
      treasuredPossession: typeof nextBackstory.treasuredPossession === 'string' ? nextBackstory.treasuredPossession : '',
      traits: typeof nextBackstory.traits === 'string' ? nextBackstory.traits : '',
      injuries: typeof data.woundsAndScars === 'string'
        ? data.woundsAndScars
        : (typeof nextBackstory.injuries === 'string' ? nextBackstory.injuries : ''),
      backstory: typeof nextBackstory.backstory === 'string' ? nextBackstory.backstory : '',
    });

    const assets = asRecord(data.assets);
    setAssetTransport(typeof assets.transportation === 'string' ? assets.transportation : '');
    setAssetResidence(typeof assets.residence === 'string' ? assets.residence : '');
    setAssetLuxuries(typeof assets.luxuries === 'string' ? assets.luxuries : '');
    setAssetSecurities(typeof assets.securities === 'string' ? assets.securities : '');
    setAssetOther(typeof assets.other === 'string' ? assets.other : '');

    setInventory(Array.isArray(data.inventory) ? data.inventory as InventoryItem[] : []);

    const nextWeapons = Array.isArray(data.weapons) ? data.weapons as WeaponItem[] : [];
    setWeapons(nextWeapons.length > 0 ? nextWeapons : createDefaultWeapons());

    const armor = asRecord(data.armor);
    setArmorName(typeof armor.name === 'string' ? armor.name : '');
    setArmorValue(
      typeof armor.armorValue === 'string'
        ? armor.armorValue
        : (typeof armor.armorValue === 'number' ? String(armor.armorValue) : ''),
    );

    const vehicle = asRecord(data.vehicle);
    setVehicleName(typeof vehicle.name === 'string' ? vehicle.name : '');
    setVehicleSkill(typeof vehicle.skill === 'string' ? vehicle.skill : '');

    setSpells(Array.isArray(data.spells) ? data.spells as Spell[] : []);
    setCompanions(Array.isArray(data.companions) ? data.companions as Companion[] : []);
    setExperiences(Array.isArray(data.experiences) ? data.experiences as Experience[] : []);
    setMythosEncounters(Array.isArray(data.mythosEncounters) ? data.mythosEncounters as MythosEncounter[] : []);

    if (Array.isArray(data.phobiasAndManias)) {
      setPhobiasManias(
        data.phobiasAndManias
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('、'),
      );
    } else if (typeof data.phobiasAndManias === 'string') {
      setPhobiasManias(data.phobiasAndManias);
    } else {
      setPhobiasManias('');
    }

    const matchedOccupationId = matchOccupationId(data.occupation);
    if (matchedOccupationId !== null) {
      setOccId(matchedOccupationId);
    } else if (typeof data.occupation === 'string' && data.occupation.trim()) {
      setOccId(0);
      setError(`职业「${data.occupation}」未匹配到标准列表，请手动选择。`);
    }
  };

  // ── Excel 导入预填充（用 queueMicrotask 确保 signal 初始化完成后再设值）──
  if (isImport && importJson) {
    queueMicrotask(() => {
      try {
        const d = JSON.parse(importJson) as Record<string, unknown>;
        sessionStorage.removeItem('import_data'); // 成功解析后才清除
        applyCharacterPayload({ ...d, occupation: d.occupationExcelName ?? d.occupation });
      } catch (e) {
        console.error('[Excel Import] 预填充失败:', e);
      }
    });
  }

  createEffect(() => {
    const loaded = editCharacter();
    if (!props.editId || !loaded || loadedEditId() === loaded.id) return;
    applyCharacterPayload(loaded as Record<string, unknown>);
    if (loaded.readonly) {
      setError('该角色卡正参与进行中的跑团，当前仅供查看，无法保存修改。');
    }
    setLoadedEditId(loaded.id);
  });

  createEffect(() => {
    if (!props.editId || !editCharacter.error) return;
    setError(editCharacter.error.message || '角色卡加载失败');
  });

  // ── 保存 ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!name().trim()) { setError('角色名不能为空'); return; }
    setSaving(true); setError('');
    const ls = livingStandard();
    const payload = {
      name: name(), age: age(), occupation: occupation()?.name ?? '',
      era: era(), gender: gender(), residence: residence(), hometown: hometown(),
      attributes: attrs(), derived: derived(), luck: luck(),
      skills: Object.fromEntries(SKILLS.map((s) => [s.id, skillValue(s)])),
      skillPoints: skillPts(),
      backstory: backstory(),
      assets: {
        creditRating: creditValue(),
        livingStandard: ls.level,
        spendingLevel: ls.spend,
        cash: ls.cash,
        currency: era() === '1920s' ? '$' : '¥',
        assets: '',
        transportation: assetTransport(),
        residence: assetResidence(),
        luxuries: assetLuxuries(),
        securities: assetSecurities(),
        other: assetOther(),
      },
      inventory: inventory().filter((i) => i.name.trim()),
      weapons: weapons().filter((w) => w.name.trim() && w.name !== '无'),
      armor: armorName() ? { name: armorName(), armorValue: armorValue() } : undefined,
      vehicle: vehicleName() ? { name: vehicleName(), skill: vehicleSkill() } : undefined,
      spells: spells().filter((s) => s.name.trim()),
      companions: companions().filter((c) => c.name.trim()),
      experiences: experiences().filter((e) => e.moduleName.trim()),
      mythosEncounters: mythosEncounters().filter((m) => m.entity.trim()),
      phobiasAndManias: phobiasManias().split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean),
      woundsAndScars: backstory().injuries,
    };
    try {
      if (props.editId) {
        await playerApi.updateCharacter(props.editId, payload);
      } else {
        await playerApi.createCharacter(payload);
      }
      location.href = '/player';
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <Show when={error()}><div class="bg-danger/15 border border-danger rounded-md px-4 py-3 text-danger mb-6">{error()}</div></Show>
      <Show when={props.editId && editCharacter.loading}>
        <div class="bg-surface border border-border rounded-md px-4 py-3 text-text-dim mb-6">正在加载角色卡原始数据…</div>
      </Show>

      {/* Tab 导航 + 操作按钮 */}
      <div class="flex items-center border-b border-border mb-6 flex-wrap">
        <div class="flex flex-wrap flex-1">
          {([
            ['basic', '基本信息'], ['skills', '技能分配'], ['assets', '资产装备'],
            ['combat', '战斗'], ['backstory', '背景故事'], ['magic', '法术与神话'], ['companions', '同伴与经历'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              class={`px-4 py-2 text-sm font-semibold bg-transparent border-0 border-b-2 cursor-pointer transition-all duration-150 hover:text-text ${tab() === t ? 'text-accent border-b-accent' : 'text-text-dim border-b-transparent'}`}
              onClick={() => setTab(t)}
            >{label}</button>
          ))}
        </div>
        <div class="flex gap-3 ml-auto pb-1">
          <a href="/player" class="inline-block px-5 py-2 bg-transparent text-text-dim border border-border rounded-md text-[0.9rem] cursor-pointer no-underline hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95">取消</a>
          <button class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95" onClick={save} disabled={saving() || (!!props.editId && editCharacter.loading)}>
            {saving() ? '保存中...' : (!!props.editId && editCharacter.loading) ? '加载中...' : '💾 保存角色卡'}
          </button>
        </div>
      </div>

      {/* ── Tab: 基本信息 ── */}
      <Show when={tab() === 'basic'}>
        <section class="mb-10">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <Field label="角色姓名 *">
              <div class="flex items-center gap-1.5">
                <input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" style={{ flex: 1 }} value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="输入或随机生成" />
                <div class="flex border border-border rounded-md overflow-hidden shrink-0">
                  <button
                    class={nameType() === 'cn' ? 'px-2.5 py-1.5 text-sm bg-accent text-white border-none cursor-pointer' : 'px-2.5 py-1.5 text-sm bg-transparent text-text-dim border-none cursor-pointer hover:bg-white/[0.07] hover:text-text'}
                    onClick={() => setNameType('cn')}
                    type="button"
                  >中文</button>
                  <button
                    class={nameType() === 'en' ? 'px-2.5 py-1.5 text-sm bg-accent text-white border-none cursor-pointer' : 'px-2.5 py-1.5 text-sm bg-transparent text-text-dim border-none cursor-pointer hover:bg-white/[0.07] hover:text-text'}
                    onClick={() => setNameType('en')}
                    type="button"
                  >外国</button>
                </div>
                <button class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200" onClick={rollName} type="button" title="随机生成姓名">🎲</button>
              </div>
            </Field>
            <Field label="年龄"><input type="number" class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={age()} onInput={(e) => setAge(+e.currentTarget.value)} min="15" max="90" /></Field>
            <Field label="性别"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={gender()} onInput={(e) => setGender(e.currentTarget.value)} /></Field>
            <Field label="住地"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={residence()} onInput={(e) => setResidence(e.currentTarget.value)} /></Field>
            <Field label="故乡"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={hometown()} onInput={(e) => setHometown(e.currentTarget.value)} /></Field>
            <Field label="时代">
              <select class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={era()} onChange={(e) => setEra(e.currentTarget.value as '1920s' | '现代' | '其他')}>
                <option value="1920s">1920s</option>
                <option value="现代">现代</option>
                <option value="其他">其他</option>
              </select>
            </Field>
            <Field label="职业" wide>
              <select class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={occId()} onChange={(e) => setOccId(+e.currentTarget.value)}>
                <option value="0">— 请选择职业 —</option>
                <For each={filteredOccupations()}>{(o) => <option value={o.id}>{o.name}</option>}</For>
              </select>
              <Show when={occupation()}>
                <p class="text-sm text-text-dim mt-1.5">{occupation()!.description}</p>
                <p class="text-sm text-accent mt-1">技能点：{occPoints()} | 核心技能：{occupation()!.coreSkills.join('、')}</p>
              </Show>
            </Field>
          </div>
        </section>

        {/* 属性区域 */}
        <section class="mb-10">
          {/* 可折叠随机生成 */}
          <div class="mb-4">
            <Show when={!props.editId && !isImport}>
              <button
                class="inline-flex items-center gap-1.5 px-4 py-2 bg-white/[0.05] border border-border rounded-md text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors text-text-dim"
                onClick={() => setShowRoller(!showRoller())}
                type="button"
              >
                🎲 随机生成属性 {showRoller() ? '▾' : '▸'}
              </button>
            </Show>
            <Show when={showRoller()}>
              <div class="mt-3 p-4 bg-surface border border-border rounded-lg">
                <div style={{ display: 'flex', 'align-items': 'center', gap: '0.75rem', 'margin-bottom': '0.75rem', 'flex-wrap': 'wrap' }}>
                  <div style={{ display: 'flex', 'align-items': 'center', gap: '0.4rem' }}>
                    <label style={{ 'font-size': '0.82rem', color: 'var(--color-text-dim)', 'white-space': 'nowrap' }}>目标总点（不含幸运）</label>
                    <input
                      type="number"
                      class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent"
                      style={{ width: '6rem', padding: '0.25rem 0.5rem', 'font-size': '0.85rem' }}
                      placeholder="留空随机"
                      min="200" max="700" step="5"
                      value={targetTotal()}
                      onInput={(e) => setTargetTotal(e.currentTarget.value)}
                    />
                  </div>
                  <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={doRoll}>🎲 掷骰（4组）</button>
                </div>
                <p class="text-text-dim" style={{ 'margin-bottom': '0.75rem', 'font-size': '0.85rem' }}>
                  点击"掷骰"生成四组随机属性，点选你想要的一组，然后点"确认选用"。
                  填写目标总点（不含幸运）可精确生成（范围 200-700，随机约 460）。幸运单独随机。
                </p>

                <Show when={rollSets().length > 0}>
                  <div class="bg-surface border border-border rounded-lg overflow-x-auto">
                    <div class="grid gap-1.5 px-3 py-2 text-[0.72rem] items-center bg-white/[0.03] text-text-dim uppercase font-semibold border-b border-border min-w-[600px]" style={{ 'grid-template-columns': '0.4fr repeat(9, 1fr) 1fr' }}>
                      <span>#</span>
                      <span>力量</span><span>体质</span><span>体型</span><span>敏捷</span>
                      <span>外貌</span><span>智力</span><span>意志</span><span>教育</span>
                      <span>幸运</span><span style={{ color: 'var(--color-accent)' }}>总点</span>
                    </div>
                    <For each={rollSets()}>
                      {(s, i) => (
                        <div
                          class={`grid gap-1.5 px-3 py-2 text-[0.82rem] items-center cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-white/[0.04] min-w-[600px] ${pickedIdx() === i() ? '!bg-accent/[0.12] outline outline-1 outline-accent' : ''}`}
                          style={{ 'grid-template-columns': '0.4fr repeat(9, 1fr) 1fr' }}
                          onClick={() => setPickedIdx(i())}
                        >
                          <span class="text-text-dim text-xs">{i() + 1}</span>
                          <span>{s.str}</span><span>{s.con}</span><span>{s.siz}</span><span>{s.dex}</span>
                          <span>{s.app}</span><span>{s.int}</span><span>{s.pow}</span><span>{s.edu}</span>
                          <span>{s.luck}</span>
                          <span style={{ 'font-weight': 700, color: 'var(--color-accent)' }}>{s.total}</span>
                        </div>
                      )}
                    </For>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', 'margin-top': '1rem', 'justify-content': 'flex-end' }}>
                    <button class="inline-block px-5 py-2 bg-transparent text-text-dim border border-border rounded-md text-[0.9rem] cursor-pointer no-underline hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95" onClick={doRoll}>重新掷骰</button>
                    <button
                      class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95"
                      disabled={pickedIdx() === null}
                      onClick={confirmPick}
                    >
                      确认选用
                    </button>
                  </div>
                </Show>

                <Show when={rollSets().length === 0}>
                  <div class="text-center py-8 text-text-dim bg-bg border border-dashed border-border rounded-lg">
                    <p>点击上方「🎲 掷骰（4组）」开始</p>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* 属性网格（始终可见可编辑） */}
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-2">
            <For each={[
              { key: 'str', label: '力量 STR', min: 15, max: 90 }, { key: 'con', label: '体质 CON', min: 15, max: 90 },
              { key: 'siz', label: '体型 SIZ', min: 40, max: 90 }, { key: 'dex', label: '敏捷 DEX', min: 15, max: 90 },
              { key: 'app', label: '外貌 APP', min: 15, max: 90 }, { key: 'int', label: '智力 INT', min: 40, max: 90 },
              { key: 'pow', label: '意志 POW', min: 15, max: 90 }, { key: 'edu', label: '教育 EDU', min: 40, max: 90 },
            ] as const}>
              {(a) => {
                const v = () => attrs()[a.key as keyof Attrs];
                return (
                  <div class="bg-surface border border-border rounded-lg p-3 flex flex-col items-center gap-1">
                    <div class="text-[0.72rem] text-text-dim text-center">{a.label}</div>
                    <input
                      type="number"
                      class="w-full text-xl font-bold text-center bg-transparent border-none border-b border-border text-text outline-none py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-b-accent"
                      value={v()}
                      min={a.min}
                      max={a.max}
                      step={1}
                      onInput={(e) => {
                        const n = parseInt(e.currentTarget.value);
                        if (!isNaN(n)) setAttrs((prev) => ({ ...prev, [a.key]: n }));
                      }}
                    />
                    <div class="flex gap-2 text-[0.7rem] text-text-dim">
                      <span>½ {Math.floor(v() / 2)}</span>
                      <span>⅕ {Math.floor(v() / 5)}</span>
                    </div>
                  </div>
                );
              }}
            </For>
            {/* 幸运 */}
            <div class="bg-surface border border-border rounded-lg p-3 flex flex-col items-center gap-1">
              <div class="text-[0.72rem] text-text-dim text-center">幸运 Luck</div>
              <input
                type="number"
                class="w-full text-xl font-bold text-center bg-transparent border-none border-b border-border text-text outline-none py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-b-accent"
                value={luck()}
                min={15}
                max={90}
                step={1}
                onInput={(e) => {
                  const n = parseInt(e.currentTarget.value);
                  if (!isNaN(n)) setLuck(n);
                }}
              />
              <div class="flex gap-2 text-[0.7rem] text-text-dim"><span>½ {Math.floor(luck() / 2)}</span></div>
            </div>
          </div>

          {/* 派生属性 */}
          <div class="flex gap-4 flex-wrap" style={{ 'margin-top': '1rem' }}>
            <DerivedStat label="HP" value={derived().hp} hint="(体质+体型)÷10" />
            <DerivedStat label="SAN" value={derived().san} hint="= 意志" />
            <DerivedStat label="MP" value={derived().mp} hint="意志÷5" />
            <DerivedStat label="移动力" value={derived().mov} hint="基础值" />
            <DerivedStat label="伤害加值" value={derived().db} hint="力量+体型" isText />
            <DerivedStat label="体格" value={derived().build} hint="力量+体型" />
          </div>
        </section>
      </Show>

      {/* ── Tab: 技能分配 ── */}
      <Show when={tab() === 'skills'}>
        <section class="mb-10">
          <div class="flex gap-4 mb-4 flex-wrap">
            <BudgetChip label="职业技能点" used={usedOcc()} total={occPoints()} warn={remainOcc() < 0} />
            <BudgetChip label="兴趣技能点" used={usedHobby()} total={hobbyPoints()} warn={remainHobby() < 0} />
          </div>
          <div class="bg-surface border border-border rounded-lg overflow-x-auto">
            <div class="grid gap-1.5 px-3 py-1.5 items-center text-[0.72rem] bg-white/[0.03] text-text-dim uppercase border-b border-border sticky top-0 min-w-[540px]" style={{ 'grid-template-columns': '2fr 0.6fr 0.7fr 0.7fr 0.6fr 0.6fr 0.6fr' }}>
              <span>技能</span><span>初始</span><span>职业点</span><span>兴趣点</span>
              <span>普通</span><span>困难</span><span>极限</span>
            </div>
            <For each={SKILLS}>
              {(s) => {
                const base = () => s.baseValue(attrs());
                const total = () => skillValue(s);
                const isCore = () => occupation()?.coreSkills.includes(s.name) ?? false;
                const pt = () => skillPts()[s.id] ?? { occ: 0, hobby: 0, growth: 0 };
                const cr = () => s.id === 'credit' ? creditRange() : null;
                const outOfRange = () => {
                  const r = cr();
                  if (!r) return false;
                  const v = total();
                  return v < r.min || v > r.max;
                };
                return (
                  <div class={`grid gap-1.5 px-3 py-1.5 items-center text-[0.82rem] border-t border-white/[0.04] min-w-[540px] ${isCore() ? 'bg-accent/[0.05]' : ''}`} style={{ 'grid-template-columns': '2fr 0.6fr 0.7fr 0.7fr 0.6fr 0.6fr 0.6fr' }}>
                    <span class="flex items-center gap-1">
                      {isCore() && <span class="text-accent mr-1">★</span>}
                      {s.name}
                      <Show when={s.hasSubType}>
                        <input class="w-[70px] text-xs px-1.5 py-0.5 bg-bg border border-border rounded text-text" placeholder="类型" value={pt().subType ?? ''}
                          onInput={(e) => setSubType(s.id, e.currentTarget.value)} />
                      </Show>
                      <Show when={cr()}>
                        <span style={{
                          'font-size': '0.72rem', color: outOfRange() ? 'var(--color-danger)' : 'var(--color-text-dim)',
                          'margin-left': '0.25rem',
                        }}>({cr()!.min}–{cr()!.max})</span>
                      </Show>
                    </span>
                    <span class="text-text-dim">{base()}</span>
                    <input type="number" class="w-[55px] px-1 py-0.5 bg-bg border border-border rounded text-text text-[0.82rem] text-center" value={pt().occ} min="0"
                      onInput={(e) => setSkillVal(s.id, 'occ', +e.currentTarget.value)} />
                    <input type="number" class="w-[55px] px-1 py-0.5 bg-bg border border-border rounded text-text text-[0.82rem] text-center" value={pt().hobby} min="0"
                      onInput={(e) => setSkillVal(s.id, 'hobby', +e.currentTarget.value)} />
                    <span class={total() > 50 ? 'text-success font-semibold' : ''}>{total()}</span>
                    <span>{Math.floor(total() / 2)}</span>
                    <span>{Math.floor(total() / 5)}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </section>
      </Show>

      {/* ── Tab: 资产与装备 ── */}
      <Show when={tab() === 'assets'}>
        <section class="mb-10">
          <p class="text-text-dim" style={{ 'margin-bottom': '0.75rem', 'font-size': '0.85rem' }}>
            根据当前信用评级（{creditValue()}）自动计算。调整技能表中「信用评级」的分配点数可改变生活水平。
            <Show when={creditRange()}>
              {' '}该职业要求信用评级在 {creditRange()!.min}–{creditRange()!.max} 之间。
            </Show>
          </p>
          <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {([
              { key: '生活水平', val: livingStandard().level },
              { key: '消费水平', val: livingStandard().spend },
              { key: '现金', val: livingStandard().cash },
              { key: '资产规模', val: livingStandard().assets },
            ]).map(({ key, val }) => (
              <div style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                'border-radius': '8px', padding: '0.6rem 0.9rem',
              }}>
                <div style={{ 'font-size': '0.75rem', color: 'var(--color-text-dim)', 'margin-bottom': '0.2rem' }}>{key}</div>
                <div style={{ 'font-weight': 600, color: creditValue() === 0 && key === '生活水平' ? 'var(--color-text-dim)' : 'var(--color-text)' }}>{val}</div>
              </div>
            ))}
          </div>
          <p class="text-text-dim" style={{ 'font-size': '0.78rem', 'margin-top': '0.75rem' }}>
            参考：0-9 赤贫 / 10-19 贫穷 / 20-49 普通 / 50-89 富有 / 90-98 富裕 / 99 超级富有
          </p>

          {/* 资产详情 */}
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4" style={{ 'margin-top': '1.25rem' }}>
            <Field label="交通工具"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={assetTransport()} onInput={(e) => setAssetTransport(e.currentTarget.value)} placeholder="例：福特T型车" /></Field>
            <Field label="住所"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={assetResidence()} onInput={(e) => setAssetResidence(e.currentTarget.value)} placeholder="例：波士顿市区公寓" /></Field>
            <Field label="奢侈品"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={assetLuxuries()} onInput={(e) => setAssetLuxuries(e.currentTarget.value)} /></Field>
            <Field label="股票/证券"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={assetSecurities()} onInput={(e) => setAssetSecurities(e.currentTarget.value)} /></Field>
            <Field label="其他资产" wide><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={assetOther()} onInput={(e) => setAssetOther(e.currentTarget.value)} /></Field>
          </div>
        </section>

        {/* 随身物品 */}
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">随身物品</h3>
          <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
            <thead><tr><th>物品名</th><th style={{ width: '100px' }}>携带方式</th><th style={{ width: '100px' }}>部位</th><th style={{ width: '120px' }}>备注</th><th style={{ width: '36px' }}></th></tr></thead>
            <tbody>
              <For each={inventory()}>
                {(it, i) => (
                  <tr>
                    <td><input value={it.name} onInput={(e) => updateInventory(i(), { name: e.currentTarget.value })} placeholder="物品名" /></td>
                    <td>
                      <select value={it.location} onChange={(e) => updateInventory(i(), { location: e.currentTarget.value as 'body' | 'backpack' })}>
                        <option value="body">随身</option><option value="backpack">背包</option>
                      </select>
                    </td>
                    <td><input value={it.slot ?? ''} onInput={(e) => updateInventory(i(), { slot: e.currentTarget.value || undefined })} placeholder="头/手/腰" /></td>
                    <td><input value={it.notes ?? ''} onInput={(e) => updateInventory(i(), { notes: e.currentTarget.value || undefined })} /></td>
                    <td><button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeInventory(i())}>×</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white/[0.05] border border-dashed border-border rounded-md text-text-dim text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors" onClick={addInventory}>+ 添加物品</button>
        </section>
      </Show>

      {/* ── Tab: 战斗 ── */}
      <Show when={tab() === 'combat'}>
        {/* 武器表 */}
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">武器</h3>
          <div class="bg-surface border border-border rounded-lg overflow-auto">
            <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
              <thead>
                <tr>
                  <th>自定义名称</th>
                  <th style={{ width: '90px' }}>武器类型</th>
                  <th style={{ width: '70px' }}>使用技能</th>
                  <th style={{ width: '45px' }}>普通</th>
                  <th style={{ width: '45px' }}>困难</th>
                  <th style={{ width: '45px' }}>极限</th>
                  <th style={{ width: '90px' }}>伤害</th>
                  <th style={{ width: '50px' }}>射程</th>
                  <th style={{ width: '40px' }}>穿刺</th>
                  <th style={{ width: '40px' }}>射速</th>
                  <th style={{ width: '50px' }}>装弹</th>
                  <th style={{ width: '50px' }}>故障值</th>
                  <th style={{ width: '36px' }}></th>
                </tr>
              </thead>
              <tbody>
                <For each={weapons()}>
                  {(w, i) => {
                    const sv = () => weaponSkillValue(w.skill);
                    return (
                      <tr class={w._default ? 'opacity-70' : ''}>
                        <td>
                          {w._default
                            ? <span class="text-text-dim text-xs">{w.name}</span>
                            : <input value={w.name} onInput={(e) => updateWeapon(i(), { name: e.currentTarget.value })} placeholder={w.templateName || ''} />
                          }
                        </td>
                        <td><span class="text-xs">{w.templateName || w.type || '—'}</span></td>
                        <td><span class="text-text-dim text-xs">{w.skill || '—'}</span></td>
                        <td class="text-center"><span class="text-xs">{sv() ?? '—'}</span></td>
                        <td class="text-center"><span class="text-xs">{sv() !== null ? Math.floor(sv()! / 2) : '—'}</span></td>
                        <td class="text-center"><span class="text-xs">{sv() !== null ? Math.floor(sv()! / 5) : '—'}</span></td>
                        <td><span class="text-xs font-mono text-accent">{w.damage}</span></td>
                        <td><span class="text-text-dim text-xs">{w.range || '—'}</span></td>
                        <td class="text-center"><span class="text-xs">{w.impale ? '✓' : '×'}</span></td>
                        <td class="text-center"><span class="text-text-dim text-xs">{w.rof}</span></td>
                        <td><span class="text-text-dim text-xs">{w.ammo || '—'}</span></td>
                        <td><span class="text-text-dim text-xs">{w.malfunction || '—'}</span></td>
                        <td>{w._default ? null : <button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeWeapon(i())}>×</button>}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <div class="mt-2">
            <button class="inline-flex items-center gap-1 px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-md text-accent text-sm cursor-pointer hover:bg-accent/20 transition-colors" onClick={loadWeaponRef}>+ 从武器库选择</button>
          </div>

          {/* 武器库搜索弹窗 */}
          <Show when={showWeaponPicker()}>
            <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowWeaponPicker(false); }}>
              <div class="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-[95vw] md:max-w-3xl max-h-[90vh] md:max-h-[80vh] flex flex-col">
                <div class="flex items-center justify-between px-5 py-3 border-b border-border">
                  <h3 class="text-base font-semibold">武器库</h3>
                  <button class="text-text-dim hover:text-text text-xl cursor-pointer bg-transparent border-none" onClick={() => setShowWeaponPicker(false)}>×</button>
                </div>
                <div class="px-5 py-3 border-b border-border">
                  <input
                    class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-sm focus:outline-none focus:border-accent"
                    placeholder="搜索武器名/技能/类型..."
                    value={weaponSearch()}
                    onInput={(e) => setWeaponSearch(e.currentTarget.value)}
                  />
                  <p class="text-xs text-text-dim mt-1">共 {filteredWeapons().length} 件 · 点击武器添加到角色卡</p>
                </div>
                <div class="flex-1 overflow-y-auto">
                  <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:text-text-dim [&_th]:bg-white/[0.03] [&_th]:border-b [&_th]:border-border [&_th]:sticky [&_th]:top-0 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-white/[0.04]">
                    <thead><tr><th>名称</th><th>技能</th><th>伤害</th><th>射程</th><th>穿刺</th><th>射速</th><th>装弹</th><th>故障</th><th>时代</th></tr></thead>
                    <tbody>
                      <For each={filteredWeapons()}>
                        {(w) => (
                          <tr class="cursor-pointer hover:bg-white/[0.04] transition-colors" onClick={() => { pickWeapon(w); setShowWeaponPicker(false); }}>
                            <td class="font-medium text-text">{w.name}</td>
                            <td>{w.skill}</td>
                            <td class="font-mono text-accent">{w.damage}</td>
                            <td>{w.range}</td>
                            <td>{w.impale ? '✓' : ''}</td>
                            <td>{w.rof}</td>
                            <td>{w.ammo}</td>
                            <td>{w.malfunction}</td>
                            <td class="text-text-dim text-xs">{Array.isArray(w.era) ? w.era.join('/') : w.era}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Show>
        </section>

        {/* 护甲 */}
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">护甲</h3>
          <div class="grid grid-cols-2 gap-4">
            <Field label="护甲名称"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={armorName()} onInput={(e) => setArmorName(e.currentTarget.value)} placeholder="例：皮甲克" /></Field>
            <Field label="护甲值"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={armorValue()} onInput={(e) => setArmorValue(e.currentTarget.value)} placeholder="例：1" /></Field>
          </div>
        </section>

        {/* 载具 */}
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">载具</h3>
          <div class="grid grid-cols-2 gap-4">
            <Field label="载具名称"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={vehicleName()} onInput={(e) => setVehicleName(e.currentTarget.value)} placeholder="例：福特T型车" /></Field>
            <Field label="驾驶技能"><input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" value={vehicleSkill()} onInput={(e) => setVehicleSkill(e.currentTarget.value)} placeholder="例：驾驶（汽车）" /></Field>
          </div>
        </section>
      </Show>

      {/* ── Tab: 背景故事 ── */}
      <Show when={tab() === 'backstory'}>
        <section class="mb-10">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {([
              ['appearance', '个人描述/外貌'],
              ['ideology', '思想与信念'],
              ['significantPerson', '重要之人'],
              ['meaningfulLocation', '意义非凡之地'],
              ['treasuredPossession', '宝贵之物'],
              ['traits', '特质'],
              ['injuries', '难言之隐/伤口疤痕'],
            ] as [keyof typeof backstory, string][]).map(([key, label]) => (
              <Field label={label} wide>
                <textarea class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent resize-y min-h-[60px]" rows="2"
                  value={backstory()[key]}
                  onInput={(e) => setBackstory((b) => ({ ...b, [key]: e.currentTarget.value }))} />
              </Field>
            ))}
            <Field label="完整背景故事" wide>
              <textarea class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent resize-y min-h-[60px]" rows="5"
                value={backstory().backstory}
                onInput={(e) => setBackstory((b) => ({ ...b, backstory: e.currentTarget.value }))} />
            </Field>
          </div>
        </section>
      </Show>

      {/* ── Tab: 法术与神话 ── */}
      <Show when={tab() === 'magic'}>
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">法术列表</h3>
          <p class="text-text-dim" style={{ 'font-size': '0.85rem', 'margin-bottom': '0.75rem' }}>
            初始角色通常无法术。跑团过程中学会的法术可在此记录。
          </p>
          <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
            <thead><tr><th>法术名</th><th style={{ width: '120px' }}>代价</th><th>效果</th><th style={{ width: '36px' }}></th></tr></thead>
            <tbody>
              <For each={spells()}>
                {(sp, i) => (
                  <tr>
                    <td><input value={sp.name} onInput={(e) => updateSpell(i(), { name: e.currentTarget.value })} placeholder="法术名" /></td>
                    <td><input value={sp.cost} onInput={(e) => updateSpell(i(), { cost: e.currentTarget.value })} placeholder="8mp 1d6san" /></td>
                    <td><input value={sp.effect} onInput={(e) => updateSpell(i(), { effect: e.currentTarget.value })} placeholder="效果描述" /></td>
                    <td><button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeSpell(i())}>×</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white/[0.05] border border-dashed border-border rounded-md text-text-dim text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors" onClick={addSpell}>+ 添加法术</button>
        </section>

        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">神话接触记录</h3>
          <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
            <thead><tr><th>遭遇实体</th><th style={{ width: '120px' }}>结果</th><th style={{ width: '80px' }}>累计CM</th><th>备注</th><th style={{ width: '36px' }}></th></tr></thead>
            <tbody>
              <For each={mythosEncounters()}>
                {(m, i) => (
                  <tr>
                    <td><input value={m.entity} onInput={(e) => updateMythos(i(), { entity: e.currentTarget.value })} placeholder="实体名" /></td>
                    <td><input value={m.result} onInput={(e) => updateMythos(i(), { result: e.currentTarget.value })} placeholder="CM+3, SAN-6" /></td>
                    <td><input type="number" value={m.cumulative} onInput={(e) => updateMythos(i(), { cumulative: +e.currentTarget.value })} /></td>
                    <td><input value={m.notes ?? ''} onInput={(e) => updateMythos(i(), { notes: e.currentTarget.value || undefined })} /></td>
                    <td><button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeMythos(i())}>×</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white/[0.05] border border-dashed border-border rounded-md text-text-dim text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors" onClick={addMythos}>+ 添加记录</button>
        </section>

        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">恐惧症 / 狂躁症</h3>
          <p class="text-text-dim" style={{ 'font-size': '0.85rem', 'margin-bottom': '0.5rem' }}>
            用逗号或换行分隔多个症状。疯狂发作时由 .ti / .li 命令决定。
          </p>
          <textarea
            class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent resize-y min-h-[60px]"
            rows="3"
            value={phobiasManias()}
            onInput={(e) => setPhobiasManias(e.currentTarget.value)}
            placeholder="例：恐高症, 沐浴癖"
          />
        </section>
      </Show>

      {/* ── Tab: 同伴与经历 ── */}
      <Show when={tab() === 'companions'}>
        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">调查员伙伴</h3>
          <p class="text-text-dim" style={{ 'font-size': '0.85rem', 'margin-bottom': '0.75rem' }}>
            记录跑团中结识的调查员伙伴。
          </p>
          <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
            <thead><tr><th>姓名</th><th style={{ width: '100px' }}>玩家</th><th>造成改变</th><th>相遇模组</th><th style={{ width: '36px' }}></th></tr></thead>
            <tbody>
              <For each={companions()}>
                {(c, i) => (
                  <tr>
                    <td><input value={c.name} onInput={(e) => updateCompanion(i(), { name: e.currentTarget.value })} placeholder="伙伴姓名" /></td>
                    <td><input value={c.player ?? ''} onInput={(e) => updateCompanion(i(), { player: e.currentTarget.value || undefined })} /></td>
                    <td><input value={c.change ?? ''} onInput={(e) => updateCompanion(i(), { change: e.currentTarget.value || undefined })} /></td>
                    <td><input value={c.encounterModule ?? ''} onInput={(e) => updateCompanion(i(), { encounterModule: e.currentTarget.value || undefined })} /></td>
                    <td><button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeCompanion(i())}>×</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white/[0.05] border border-dashed border-border rounded-md text-text-dim text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors" onClick={addCompanion}>+ 添加伙伴</button>
        </section>

        <section class="mb-10">
          <h3 class="text-sm font-semibold text-text-dim mb-3">经历模组</h3>
          <table class="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:text-text-dim [&_th]:border-b [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-white/[0.04] [&_input]:w-full [&_input]:bg-bg [&_input]:border [&_input]:border-border [&_input]:rounded [&_input]:text-text [&_input]:px-1.5 [&_input]:py-1 [&_input]:text-[0.82rem] [&_input:focus]:outline-none [&_input:focus]:border-accent [&_select]:w-full [&_select]:bg-bg [&_select]:border [&_select]:border-border [&_select]:rounded [&_select]:text-text [&_select]:px-1.5 [&_select]:py-1 [&_select]:text-[0.82rem] [&_select:focus]:outline-none [&_select:focus]:border-accent">
            <thead><tr><th>模组名</th><th>变化描述</th><th style={{ width: '36px' }}></th></tr></thead>
            <tbody>
              <For each={experiences()}>
                {(ex, i) => (
                  <tr>
                    <td><input value={ex.moduleName} onInput={(e) => updateExperience(i(), { moduleName: e.currentTarget.value })} placeholder="模组名" /></td>
                    <td><input value={ex.changes} onInput={(e) => updateExperience(i(), { changes: e.currentTarget.value })} placeholder="SAN-6, HP-2, 侦查+2" /></td>
                    <td><button class="bg-none border-none text-text-dim cursor-pointer text-[0.9rem] px-1 py-0.5 hover:text-danger transition-colors" onClick={() => removeExperience(i())}>×</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white/[0.05] border border-dashed border-border rounded-md text-text-dim text-sm cursor-pointer hover:bg-white/10 hover:text-text transition-colors" onClick={addExperience}>+ 添加经历</button>
        </section>
      </Show>
    </div>
  );
};

// ─── 子组件 ───────────────────────────────────────────────────────────────────

const Field: Component<{ label: string; wide?: boolean; children: any }> = (props) => (
  <div class={`flex flex-col gap-1.5 ${props.wide ? 'col-span-2' : ''}`}>
    <label class="text-[0.82rem] text-text-dim">{props.label}</label>
    {props.children}
  </div>
);

const DerivedStat: Component<{ label: string; value: number | string; hint: string; isText?: boolean }> = (props) => (
  <div class="bg-accent/[0.08] border border-accent/25 rounded-lg px-4 py-2.5 text-center min-w-[80px]">
    <div class="text-xl font-bold text-accent">{props.value}</div>
    <div class="text-[0.78rem] font-semibold">{props.label}</div>
    <div class="text-[0.65rem] text-text-dim">{props.hint}</div>
  </div>
);

const BudgetChip: Component<{ label: string; used: number; total: number; warn: boolean }> = (props) => (
  <div class={`px-4 py-2 bg-surface border border-border rounded-md text-sm flex gap-4 ${props.warn ? 'border-danger text-danger' : ''}`}>
    <span>{props.label}</span>
    <span>{props.used} / {props.total}（剩余 {props.total - props.used}）</span>
  </div>
);

// ─── 公式计算 ─────────────────────────────────────────────────────────────────

function evalOccFormula(formula: string, a: Attrs): number {
  const vars: Record<string, number> = {
    EDU: a.edu, STR: a.str, DEX: a.dex, CON: a.con,
    APP: a.app, INT: a.int, POW: a.pow, SIZ: a.siz,
  };
  try {
    const expr = formula
      .replace(/MAX\(([^)]+)\)/g, (_, inner) => {
        const nums = inner.split(',').map((s: string) => evalSimple(s.trim(), vars));
        return String(Math.max(...nums));
      })
      .replace(/[A-Z]+/g, (m) => String(vars[m] ?? 0));
    return evalSimple(expr, {});
  } catch { return 0; }
}

function evalSimple(expr: string, vars: Record<string, number>): number {
  const resolved = expr.replace(/[A-Z]+/g, (m) => String(vars[m] ?? 0));
  return Function(`"use strict"; return (${resolved})`)() as number;
}

function calcDamageBonus(sum: number): string {
  if (sum <= 64) return '-2';
  if (sum <= 84) return '-1';
  if (sum <= 124) return '0';
  if (sum <= 164) return '+1D4';
  if (sum <= 204) return '+1D6';
  if (sum <= 284) return '+2D6';
  if (sum <= 364) return '+3D6';
  if (sum <= 444) return '+4D6';
  return '+5D6';
}

function calcBuild(sum: number): number {
  if (sum <= 64) return -2;
  if (sum <= 84) return -1;
  if (sum <= 124) return 0;
  if (sum <= 164) return 1;
  if (sum <= 204) return 2;
  if (sum <= 284) return 3;
  if (sum <= 364) return 4;
  return 5;
}

function calcMov(str: number, dex: number, siz: number, age: number): number {
  let base = 8;
  if (str > siz && dex > siz) base += 1;
  else if (str < siz && dex < siz) base -= 1;
  return Math.max(1, base - (age > 30 ? Math.floor((age - 30) / 10) : 0));
}

export default CharacterForm;
