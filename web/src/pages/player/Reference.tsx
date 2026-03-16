import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi } from '../../api';

type Tab = 'weapons' | 'armor' | 'vehicles' | 'insanity' | 'attributes';

interface Weapon {
  name: string; skill: string; damage: string; range: string;
  impale: boolean; rof: number; ammo: string; malfunction: string;
  era: string[]; price: string; type?: string;
}

interface Armor {
  name: string; armorValue: string; movPenalty: string; coverage: string;
  species: string; antiPierce: boolean; protectionLevel: string;
  era: string[]; price: string;
}

interface Vehicle {
  name: string; skill: string; mov: number | string; build: number | string;
  passengerArmor: number | string; passengers: string;
  drivableBuild: string; ridableBuild: string;
  era: string[]; type?: string; notes?: string;
}

interface InsanityData {
  immediate: { id: number; description: string }[];
  rules: { title: string; description: string }[];
}

interface Phobia { id: number; description: string; }

const Reference: Component = () => {
  const [tab, setTab] = createSignal<Tab>('weapons');
  const [weaponFilter, setWeaponFilter] = createSignal('');
  const [armorFilter, setArmorFilter] = createSignal('');
  const [phobiaPage, setPhobiaPage] = createSignal<'phobias' | 'manias'>('phobias');

  const [weapons] = createResource(() => playerApi.getReference<Weapon[]>('weapons').catch(() => []));
  const [armor] = createResource(() => playerApi.getReference<Armor[]>('armor').catch(() => []));
  const [vehicles] = createResource(() => playerApi.getReference<Vehicle[]>('vehicles').catch(() => []));
  const [insanity] = createResource(() => playerApi.getReference<InsanityData>('insanity').catch(() => ({ immediate: [], rules: [] })));
  const [phobias] = createResource(() => playerApi.getReference<Phobia[]>('phobias').catch(() => []));
  const [manias] = createResource(() => playerApi.getReference<Phobia[]>('manias').catch(() => []));

  const filteredWeapons = () => {
    const f = weaponFilter().toLowerCase();
    return (weapons() ?? []).filter((w) => !f || w.name.includes(f) || w.skill.includes(f) || (w.type ?? '').includes(f));
  };

  const filteredArmor = () => {
    const f = armorFilter().toLowerCase();
    return (armor() ?? []).filter((a) => !f || a.name.includes(f) || a.coverage.includes(f));
  };

  return (
    <div>
      <div class="flex border-b border-border mb-6 flex-wrap">
        {([
          ['weapons', '武器表'], ['armor', '防具表'], ['vehicles', '载具表'],
          ['insanity', '疯狂症状'], ['attributes', '参考信息'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            class={`px-4 py-2 text-sm font-semibold bg-transparent border-0 border-b-2 cursor-pointer transition-all duration-150 hover:text-text ${tab() === t ? 'text-accent border-b-accent' : 'text-text-dim border-b-transparent'}`}
            onClick={() => setTab(t)}
          >{label}</button>
        ))}
      </div>

      {/* 武器表 */}
      <Show when={tab() === 'weapons'}>
        <div style={{ 'margin-bottom': '0.75rem' }}>
          <input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" style={{ width: '300px' }} placeholder="搜索武器名/技能/类型..."
            value={weaponFilter()} onInput={(e) => setWeaponFilter(e.currentTarget.value)} />
          <span class="text-text-dim" style={{ 'margin-left': '0.75rem', 'font-size': '0.82rem' }}>
            共 {filteredWeapons().length} 件
          </span>
        </div>
        <div style={{ 'overflow-x': 'auto' }}>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">名称</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">技能</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">伤害</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">射程</th>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">贯穿</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">每轮</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">装弹</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">故障</th>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">时代</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">价格</th>
              </tr>
            </thead>
            <tbody>
              <For each={filteredWeapons()}>
                {(w) => (
                  <tr>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{w.name}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.skill}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.damage}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.range}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{w.impale ? '√' : '×'}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.rof}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.ammo}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.malfunction}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{w.era.join(',')}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{w.price}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* 防具表 */}
      <Show when={tab() === 'armor'}>
        <div style={{ 'margin-bottom': '0.75rem' }}>
          <input class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent" style={{ width: '300px' }} placeholder="搜索防具名/覆盖位置..."
            value={armorFilter()} onInput={(e) => setArmorFilter(e.currentTarget.value)} />
          <span class="text-text-dim" style={{ 'margin-left': '0.75rem', 'font-size': '0.82rem' }}>
            共 {filteredArmor().length} 件
          </span>
        </div>
        <div style={{ 'overflow-x': 'auto' }}>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">名称</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">护甲值</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">MOV惩罚</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">覆盖位置</th>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">适用物种</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">防穿刺</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">防护等级</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">时代</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">价格</th>
              </tr>
            </thead>
            <tbody>
              <For each={filteredArmor()}>
                {(a) => (
                  <tr>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{a.name}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.armorValue}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.movPenalty}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.coverage}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{a.species}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.antiPierce ? '√' : '×'}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.protectionLevel}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{a.era.join(',')}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{a.price}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* 载具表 */}
      <Show when={tab() === 'vehicles'}>
        <div style={{ 'overflow-x': 'auto' }}>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">名称</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">技能</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">MOV</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">体格</th>
                <th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">乘客护甲</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">乘客</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">可驾驶体格</th><th class="text-left px-3 py-1.5 bg-white/[0.03] text-text-dim text-xs uppercase border-b border-border">时代</th>
              </tr>
            </thead>
            <tbody>
              <For each={vehicles()}>
                {(v) => (
                  <tr>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{v.name}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{v.skill}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{v.mov}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{v.build}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{v.passengerArmor}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{v.passengers}</td><td class="px-3 py-1.5 border-b border-white/[0.04]">{v.drivableBuild}</td>
                    <td class="px-3 py-1.5 border-b border-white/[0.04]">{v.era.join(',')}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* 疯狂症状 */}
      <Show when={tab() === 'insanity'}>
        <h3 style={{ margin: '0 0 0.75rem' }}>疯狂发作 — 即时症状（1D10）</h3>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem', 'margin-bottom': '2rem' }}>
          <For each={insanity()?.immediate ?? []}>
            {(s) => (
              <div style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                'border-radius': '8px', padding: '0.75rem 1rem',
              }}>
                <span style={{ 'font-weight': 700, color: 'var(--color-accent)', 'margin-right': '0.5rem' }}>{s.id}.</span>
                <span style={{ 'white-space': 'pre-wrap' }}>{s.description}</span>
              </div>
            )}
          </For>
        </div>

        <h3 style={{ margin: '0 0 0.75rem' }}>
          <button class={`px-4 py-2 text-sm font-semibold bg-transparent border-0 border-b-2 cursor-pointer transition-all duration-150 hover:text-text ${phobiaPage() === 'phobias' ? 'text-accent border-b-accent' : 'text-text-dim border-b-transparent'}`}
            onClick={() => setPhobiaPage('phobias')}>恐惧症（D100）</button>
          <button class={`px-4 py-2 text-sm font-semibold bg-transparent border-0 border-b-2 cursor-pointer transition-all duration-150 hover:text-text ${phobiaPage() === 'manias' ? 'text-accent border-b-accent' : 'text-text-dim border-b-transparent'}`}
            onClick={() => setPhobiaPage('manias')}>狂躁症（D100）</button>
        </h3>
        <div style={{ 'max-height': '400px', 'overflow-y': 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', 'border-radius': '8px', padding: '0.5rem' }}>
          <For each={phobiaPage() === 'phobias' ? (phobias() ?? []) : (manias() ?? [])}>
            {(p) => (
              <div style={{ padding: '0.25rem 0.5rem', 'border-bottom': '1px solid rgba(255,255,255,0.04)', 'font-size': '0.85rem' }}>
                <span style={{ color: 'var(--color-accent)', 'font-weight': 600, 'margin-right': '0.5rem', 'min-width': '2rem', display: 'inline-block' }}>{p.id}.</span>
                {p.description}
              </div>
            )}
          </For>
        </div>

        <Show when={(insanity()?.rules ?? []).length > 0}>
          <h3 style={{ margin: '1.5rem 0 0.75rem' }}>疯狂与理智规则</h3>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
            <For each={insanity()?.rules ?? []}>
              {(r) => (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', 'border-radius': '8px', padding: '0.75rem 1rem' }}>
                  <div style={{ 'font-weight': 700, 'margin-bottom': '0.25rem' }}>{r.title}</div>
                  <div style={{ 'white-space': 'pre-wrap', 'font-size': '0.85rem', color: 'var(--color-text-dim)' }}>{r.description}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* 参考信息 */}
      <Show when={tab() === 'attributes'}>
        <p class="text-text-dim" style={{ 'margin-bottom': '1rem' }}>
          属性说明、技能等级说明等参考信息。数据来源于 CoC7 规则书附录。
        </p>
        <p class="text-text-dim">更多参考数据正在整理中...</p>
      </Show>
    </div>
  );
};

export default Reference;
