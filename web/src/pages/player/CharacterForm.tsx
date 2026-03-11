/**
 * 角色卡创建/编辑表单
 *
 * 完整还原 Excel 车卡逻辑：
 * - 8 大属性 → 派生属性自动计算
 * - 231 职业选择 → 职业技能点公式
 * - 完整技能表（含子技能）
 * - 背景故事 8 字段
 * - .st 指令导出
 */

import {
  createSignal, createMemo, createEffect, For, Show, type Component,
} from 'solid-js';
import { playerApi } from '../../api';
import { OCCUPATIONS } from './data/occupations';
import { SKILLS, type SkillDef } from './data/skills';
import styles from './Player.module.css';

interface Attrs { str: number; con: number; siz: number; dex: number; app: number; int: number; pow: number; edu: number; }
type SkillPoints = Record<string, { occ: number; hobby: number; growth: number; subType?: string }>;

interface Props { editId?: string; }

const CharacterForm: Component<Props> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [stCopied, setStCopied] = createSignal(false);

  // ─── 基本信息 ──────────────────────────────────────────────────────────────
  const [name, setName] = createSignal('');
  const [age, setAge] = createSignal(25);
  const [gender, setGender] = createSignal('');
  const [residence, setResidence] = createSignal('');
  const [hometown, setHometown] = createSignal('');
  const [era, setEra] = createSignal<'1920s' | '现代' | '其他'>('1920s');
  const [occId, setOccId] = createSignal(0);
  const [luck, setLuck] = createSignal(50);

  // ─── 属性 ──────────────────────────────────────────────────────────────────
  const [attrs, setAttrs] = createSignal<Attrs>({ str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50 });
  const setAttr = (k: keyof Attrs, v: number) => setAttrs((a) => ({ ...a, [k]: v }));

  // ─── 派生属性 ──────────────────────────────────────────────────────────────
  const derived = createMemo(() => {
    const a = attrs();
    const hp = Math.floor((a.con + a.siz) / 10);
    const san = Math.min(a.pow, 99);
    const mp = Math.floor(a.pow / 5);
    const db = calcDamageBonus(a.str + a.siz);
    const build = calcBuild(a.str + a.siz);
    const mov = calcMov(a.str, a.dex, a.siz, age());
    return { hp, san, mp, db, build, mov };
  });

  // ─── 职业 ──────────────────────────────────────────────────────────────────
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
    if (!occ) return 0;
    const a = attrs();
    return evalOccFormula(occ.formula, a);
  });
  const hobbyPoints = createMemo(() => attrs().int * 2);

  // ─── 技能分配 ──────────────────────────────────────────────────────────────
  const [skillPts, setSkillPts] = createSignal<SkillPoints>({});

  const setSkillVal = (skillId: string, field: 'occ' | 'hobby', val: number) => {
    setSkillPts((prev) => ({
      ...prev,
      [skillId]: { ...prev[skillId] ?? { occ: 0, hobby: 0, growth: 0 }, [field]: val },
    }));
  };

  const setSubType = (skillId: string, sub: string) => {
    setSkillPts((prev) => ({
      ...prev,
      [skillId]: { ...prev[skillId] ?? { occ: 0, hobby: 0, growth: 0 }, subType: sub },
    }));
  };

  const usedOcc = createMemo(() => Object.values(skillPts()).reduce((s, v) => s + (v.occ || 0), 0));
  const usedHobby = createMemo(() => Object.values(skillPts()).reduce((s, v) => s + (v.hobby || 0), 0));
  const remainOcc = createMemo(() => occPoints() - usedOcc());
  const remainHobby = createMemo(() => hobbyPoints() - usedHobby());

  const skillValue = (s: SkillDef) => {
    const base = s.baseValue(attrs());
    const pt = skillPts()[s.id] ?? { occ: 0, hobby: 0, growth: 0 };
    return base + pt.occ + pt.hobby + pt.growth;
  };

  // ─── 背景故事 ──────────────────────────────────────────────────────────────
  const [backstory, setBackstory] = createSignal({
    appearance: '', ideology: '', significantPerson: '',
    meaningfulLocation: '', treasuredPossession: '', traits: '',
    injuries: '', backstory: '',
  });

  // ─── .st 导出 ──────────────────────────────────────────────────────────────
  const stCommand = createMemo(() => {
    const a = attrs();
    const d = derived();
    const parts = [
      `力量:${a.str}`, `体质:${a.con}`, `体型:${a.siz}`, `敏捷:${a.dex}`,
      `外貌:${a.app}`, `智力:${a.int}`, `意志:${a.pow}`, `教育:${a.edu}`,
      `幸运:${luck()}`,
      `HP:${d.hp}`, `SAN:${d.san}`, `MP:${d.mp}`,
      `母语:${a.edu}`, `闪避:${Math.floor(a.dex / 2)}`,
    ];
    for (const s of SKILLS) {
      const val = skillValue(s);
      if (val > 0 && s.baseValue(attrs()) < val) {
        const label = skillPts()[s.id]?.subType ? `${s.name}(${skillPts()[s.id].subType})` : s.name;
        parts.push(`${label}:${val}`);
      }
    }
    return `.st ` + parts.join(' ');
  });

  const copyStCmd = () => {
    navigator.clipboard.writeText(stCommand()).then(() => {
      setStCopied(true);
      setTimeout(() => setStCopied(false), 2000);
    });
  };

  // ─── 保存 ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!name().trim()) { setError('角色名不能为空'); return; }
    setSaving(true); setError('');
    const payload = {
      name: name(), age: age(), occupation: occupation()?.name ?? '',
      era: era(), gender: gender(), residence: residence(), hometown: hometown(),
      attributes: attrs(), derived: derived(), luck: luck(),
      skills: Object.fromEntries(SKILLS.map((s) => [s.id, skillValue(s)])),
      skillPoints: skillPts(),
      backstory: backstory(),
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

  return (
    <div class={styles.form}>
      <Show when={error()}><div class={styles.errorBanner}>{error()}</div></Show>

      {/* 基本信息 */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>基本信息</h2>
        <div class={styles.fieldGrid}>
          <Field label="角色姓名 *"><input class={styles.input} value={name()} onInput={(e) => setName(e.currentTarget.value)} /></Field>
          <Field label="年龄"><input type="number" class={styles.input} value={age()} onInput={(e) => setAge(+e.currentTarget.value)} min="15" max="90" /></Field>
          <Field label="性别"><input class={styles.input} value={gender()} onInput={(e) => setGender(e.currentTarget.value)} /></Field>
          <Field label="住地"><input class={styles.input} value={residence()} onInput={(e) => setResidence(e.currentTarget.value)} /></Field>
          <Field label="故乡"><input class={styles.input} value={hometown()} onInput={(e) => setHometown(e.currentTarget.value)} /></Field>
          <Field label="时代">
            <select class={styles.input} value={era()} onChange={(e) => setEra(e.currentTarget.value as '1920s' | '现代' | '其他')}>
              <option value="1920s">1920s</option>
              <option value="现代">现代</option>
              <option value="其他">其他</option>
            </select>
          </Field>
          <Field label="职业" wide>
            <select class={styles.input} value={occId()} onChange={(e) => setOccId(+e.currentTarget.value)}>
              <option value="0">— 请选择职业 —</option>
              <For each={filteredOccupations()}>{(o) => <option value={o.id}>{o.name}</option>}</For>
            </select>
            <Show when={occupation()}>
              <p class={styles.occDesc}>{occupation()!.description}</p>
              <p class={styles.occDetail}>技能点：{occPoints()} | 核心技能：{occupation()!.coreSkills.join('、')}</p>
            </Show>
          </Field>
        </div>
      </section>

      {/* 八大属性 */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>八大属性</h2>
        <div class={styles.attrGrid}>
          <For each={[
            { key: 'str', label: '力量 STR', dice: '3D6×5' },
            { key: 'con', label: '体质 CON', dice: '3D6×5' },
            { key: 'siz', label: '体型 SIZ', dice: '(2D6+6)×5' },
            { key: 'dex', label: '敏捷 DEX', dice: '3D6×5' },
            { key: 'app', label: '外貌 APP', dice: '3D6×5' },
            { key: 'int', label: '智力 INT', dice: '(2D6+6)×5' },
            { key: 'pow', label: '意志 POW', dice: '3D6×5' },
            { key: 'edu', label: '教育 EDU', dice: '(2D6+6)×5' },
          ] as const}>
            {(a) => (
              <div class={styles.attrBlock}>
                <label class={styles.attrLabel}>{a.label}</label>
                <input
                  type="number"
                  class={styles.attrInput}
                  value={attrs()[a.key as keyof Attrs]}
                  onInput={(e) => setAttr(a.key as keyof Attrs, +e.currentTarget.value)}
                  min="1" max="100"
                />
                <span class={styles.attrDice}>{a.dice}</span>
                <div class={styles.attrSubs}>
                  <span>½ {Math.floor(attrs()[a.key as keyof Attrs] / 2)}</span>
                  <span>⅕ {Math.floor(attrs()[a.key as keyof Attrs] / 5)}</span>
                </div>
              </div>
            )}
          </For>
          {/* 幸运 */}
          <div class={styles.attrBlock}>
            <label class={styles.attrLabel}>幸运 Luck</label>
            <input type="number" class={styles.attrInput} value={luck()} onInput={(e) => setLuck(+e.currentTarget.value)} min="1" max="99" />
            <span class={styles.attrDice}>3D6×5</span>
          </div>
        </div>

        {/* 派生属性 */}
        <div class={styles.derivedRow}>
          <DerivedStat label="HP" value={derived().hp} hint="(体质+体型)÷10" />
          <DerivedStat label="SAN" value={derived().san} hint="= 意志" />
          <DerivedStat label="MP" value={derived().mp} hint="意志÷5" />
          <DerivedStat label="移动力" value={derived().mov} hint="基础值" />
          <DerivedStat label="伤害加值" value={derived().db} hint="力量+体型" isText />
          <DerivedStat label="体格" value={derived().build} hint="力量+体型" />
        </div>
      </section>

      {/* 技能分配 */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>技能分配</h2>
        <div class={styles.budgetBar}>
          <BudgetChip label="职业技能点" used={usedOcc()} total={occPoints()} warn={remainOcc() < 0} />
          <BudgetChip label="兴趣技能点" used={usedHobby()} total={hobbyPoints()} warn={remainHobby() < 0} />
        </div>
        <div class={styles.skillTable}>
          <div class={styles.skillHeader}>
            <span>技能</span>
            <span>初始</span>
            <span>职业点</span>
            <span>兴趣点</span>
            <span>普通</span>
            <span>困难</span>
            <span>极限</span>
          </div>
          <For each={SKILLS}>
            {(s) => {
              const base = createMemo(() => s.baseValue(attrs()));
              const total = createMemo(() => skillValue(s));
              const isCore = createMemo(() => occupation()?.coreSkills.includes(s.name) ?? false);
              const pt = createMemo(() => skillPts()[s.id] ?? { occ: 0, hobby: 0, growth: 0 });
              return (
                <div class={`${styles.skillRow} ${isCore() ? styles.coreSkill : ''}`}>
                  <span class={styles.skillName}>
                    {isCore() && <span class={styles.star}>★</span>}
                    {s.name}
                    <Show when={s.hasSubType}>
                      <input
                        class={styles.subInput}
                        placeholder="类型"
                        value={pt().subType ?? ''}
                        onInput={(e) => setSubType(s.id, e.currentTarget.value)}
                      />
                    </Show>
                  </span>
                  <span class={styles.dim}>{base()}</span>
                  <input type="number" class={styles.ptInput} value={pt().occ} min="0"
                    onInput={(e) => setSkillVal(s.id, 'occ', +e.currentTarget.value)} />
                  <input type="number" class={styles.ptInput} value={pt().hobby} min="0"
                    onInput={(e) => setSkillVal(s.id, 'hobby', +e.currentTarget.value)} />
                  <span class={total() > 50 ? styles.high : ''}>{total()}</span>
                  <span>{Math.floor(total() / 2)}</span>
                  <span>{Math.floor(total() / 5)}</span>
                </div>
              );
            }}
          </For>
        </div>
      </section>

      {/* 背景故事 */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>背景故事</h2>
        <div class={styles.fieldGrid}>
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
              <textarea
                class={`${styles.input} ${styles.textarea}`}
                rows="2"
                value={backstory()[key]}
                onInput={(e) => setBackstory((b) => ({ ...b, [key]: e.currentTarget.value }))}
              />
            </Field>
          ))}
          <Field label="完整背景故事" wide>
            <textarea
              class={`${styles.input} ${styles.textarea}`}
              rows="5"
              value={backstory().backstory}
              onInput={(e) => setBackstory((b) => ({ ...b, backstory: e.currentTarget.value }))}
            />
          </Field>
        </div>
      </section>

      {/* .st 导出 */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>.st 指令导出</h2>
        <p class={styles.dim} style={{ 'margin-bottom': '0.75rem' }}>复制后在 QQ 群里发送，与骰子机器人同步角色属性。</p>
        <div class={styles.stBox}>
          <code class={styles.stCode}>{stCommand()}</code>
          <button class={styles.btn} onClick={copyStCmd}>
            {stCopied() ? '✅ 已复制' : '📋 复制'}
          </button>
        </div>
      </section>

      {/* 操作 */}
      <div class={styles.formActions}>
        <a href="/player" class={styles.btnSecondary}>取消</a>
        <button class={styles.btn} onClick={save} disabled={saving()}>
          {saving() ? '保存中...' : '💾 保存角色卡'}
        </button>
      </div>
    </div>
  );
};

// ─── 子组件 ───────────────────────────────────────────────────────────────────

const Field: Component<{ label: string; wide?: boolean; children: any }> = (props) => (
  <div class={`${styles.field} ${props.wide ? styles.fieldWide : ''}`}>
    <label class={styles.label}>{props.label}</label>
    {props.children}
  </div>
);

const DerivedStat: Component<{ label: string; value: number | string; hint: string; isText?: boolean }> = (props) => (
  <div class={styles.derivedStat}>
    <div class={styles.derivedVal}>{props.value}</div>
    <div class={styles.derivedLabel}>{props.label}</div>
    <div class={styles.derivedHint}>{props.hint}</div>
  </div>
);

const BudgetChip: Component<{ label: string; used: number; total: number; warn: boolean }> = (props) => (
  <div class={`${styles.budget} ${props.warn ? styles.budgetOver : ''}`}>
    <span>{props.label}</span>
    <span>{props.used} / {props.total}（剩余 {props.total - props.used}）</span>
  </div>
);

// ─── 公式计算 ─────────────────────────────────────────────────────────────────

function evalOccFormula(formula: string, a: Attrs): number {
  // 支持 EDU*4, EDU*2+DEX*2, EDU*2+MAX(STR*2,DEX*2) 等格式
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
  } catch {
    return 0;
  }
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
  const agePen = age > 30 ? Math.floor((age - 30) / 10) : 0;
  return Math.max(1, base - agePen);
}

export default CharacterForm;
