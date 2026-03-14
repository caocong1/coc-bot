import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi, type KpTemplate } from '../../api';

const DIMS = [
  { key: 'tone' as const, label: '基调', low: '轻松', high: '恐怖' },
  { key: 'flexibility' as const, label: '灵活度', low: '规则', high: '叙事' },
  { key: 'guidance' as const, label: '引导度', low: '摸索', high: '手把手' },
  { key: 'lethality' as const, label: '致命度', low: '温和', high: '残酷' },
  { key: 'pacing' as const, label: '节奏', low: '慢热', high: '快节奏' },
] as const;

const KPStudio: Component = () => {
  const [templates, { refetch }] = createResource(() => adminApi.listKpTemplates().catch(() => []));
  const [selected, setSelected] = createSignal<KpTemplate | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');
  const [msg, setMsg] = createSignal('');

  // 编辑表单状态
  const [editName, setEditName] = createSignal('');
  const [editDesc, setEditDesc] = createSignal('');
  const [editTone, setEditTone] = createSignal(5);
  const [editFlex, setEditFlex] = createSignal(5);
  const [editGuide, setEditGuide] = createSignal(5);
  const [editLethal, setEditLethal] = createSignal(5);
  const [editPace, setEditPace] = createSignal(5);
  const [editPrompts, setEditPrompts] = createSignal('');

  const selectTemplate = (t: KpTemplate) => {
    setSelected(t);
    setEditing(false);
    setErr('');
    setMsg('');
    loadToForm(t);
  };

  const loadToForm = (t: KpTemplate) => {
    setEditName(t.name);
    setEditDesc(t.description);
    setEditTone(t.tone);
    setEditFlex(t.flexibility);
    setEditGuide(t.guidance);
    setEditLethal(t.lethality);
    setEditPace(t.pacing);
    setEditPrompts(t.customPrompts ?? '');
  };

  const startNew = () => {
    const base = selected();
    setSelected(null);
    setEditing(true);
    setErr('');
    setMsg('');
    setEditName(base ? `${base.name} (副本)` : '新模板');
    setEditDesc('');
    setEditTone(base?.tone ?? 5);
    setEditFlex(base?.flexibility ?? 5);
    setEditGuide(base?.guidance ?? 5);
    setEditLethal(base?.lethality ?? 5);
    setEditPace(base?.pacing ?? 5);
    setEditPrompts(base?.customPrompts ?? '');
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const data = {
        name: editName(),
        description: editDesc(),
        tone: editTone(),
        flexibility: editFlex(),
        guidance: editGuide(),
        lethality: editLethal(),
        pacing: editPace(),
        customPrompts: editPrompts(),
      };
      const sel = selected();
      if (sel && !sel.builtin) {
        await adminApi.updateKpTemplate(sel.id, data);
        setMsg('已保存');
      } else {
        const res = await adminApi.createKpTemplate(data);
        setMsg(`已创建 (${res.id})`);
      }
      await refetch();
      // 重新选中
      const list = templates() ?? [];
      const updated = list.find((t) => t.name === editName());
      if (updated) { setSelected(updated); setEditing(false); }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const sel = selected();
    if (!sel || sel.builtin) return;
    if (!confirm(`确认删除「${sel.name}」？`)) return;
    setErr('');
    try {
      await adminApi.deleteKpTemplate(sel.id);
      setSelected(null);
      setEditing(false);
      setMsg('已删除');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div class="grid grid-cols-[320px_1fr] gap-6">
      {/* 左侧：模板列表 */}
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
          <h3>KP 人格模板</h3>
          <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ 'font-size': '0.8rem' }} onClick={startNew}>+ 新建</button>
        </div>
        <Show when={!templates.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <For each={templates()}>
            {(t) => (
              <div
                class={`p-4 border border-border rounded-lg cursor-pointer mb-3 transition-colors hover:border-accent-dim shadow-sm shadow-black/10 ${selected()?.id === t.id ? 'border-accent bg-accent/[0.05]' : ''}`}
                onClick={() => selectTemplate(t)}
              >
                <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
                  <div class="font-semibold mb-1">{t.name}</div>
                  <Show when={!t.builtin}>
                    <span style={{ 'font-size': '0.7rem', color: 'var(--accent)', background: 'rgba(124,106,247,0.1)', padding: '0.1rem 0.4rem', 'border-radius': '4px' }}>自定义</span>
                  </Show>
                </div>
                <div class="text-[0.82rem] text-text-dim mb-3">{t.description}</div>
                <div class="flex flex-col gap-1.5">
                  <For each={DIMS}>
                    {(d) => <Bar label={d.label} value={t[d.key]} />}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* 右侧：详情/编辑面板 */}
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
        <Show when={selected() || editing()} fallback={<p class="text-text-dim text-[0.9rem]">从左侧选择一个模板查看或编辑</p>}>
          <Show when={msg()}>
            <div class="bg-success/[0.12] border border-success rounded-md px-3.5 py-2.5 text-success text-sm mb-3">{msg()}</div>
          </Show>
          <Show when={err()}>
            <div class="bg-danger/[0.12] border border-danger rounded-md px-3.5 py-2.5 text-danger text-sm mb-3">{err()}</div>
          </Show>

          {/* 顶部操作栏 */}
          <div style={{ display: 'flex', gap: '0.5rem', 'margin-bottom': '1rem', 'align-items': 'center' }}>
            <Show when={selected()?.builtin}>
              <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem' }}>内置模板（只读）</span>
              <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ 'margin-left': 'auto' }} onClick={startNew}>基于此新建</button>
            </Show>
            <Show when={selected() && !selected()!.builtin}>
              <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => { setEditing(true); loadToForm(selected()!); }} disabled={editing()}>编辑</button>
              <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={del}>删除</button>
            </Show>
            <Show when={!selected() && editing()}>
              <span style={{ 'font-weight': 600 }}>新建模板</span>
            </Show>
          </div>

          {/* 编辑模式 */}
          <Show when={editing() && (!selected()?.builtin)}>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
              <label>
                <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem' }}>名称</span>
                <input
                  class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
                  value={editName()}
                  onInput={(e) => setEditName(e.currentTarget.value)}
                  style={{ width: '100%', 'margin-top': '0.25rem' }}
                />
              </label>
              <label>
                <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem' }}>描述</span>
                <input
                  class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
                  value={editDesc()}
                  onInput={(e) => setEditDesc(e.currentTarget.value)}
                  style={{ width: '100%', 'margin-top': '0.25rem' }}
                />
              </label>

              <div style={{ 'margin-top': '0.5rem' }}>
                <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem', 'margin-bottom': '0.5rem', display: 'block' }}>五维参数</span>
                <Slider label="基调" low="轻松" high="恐怖" value={editTone()} onChange={setEditTone} />
                <Slider label="灵活度" low="规则" high="叙事" value={editFlex()} onChange={setEditFlex} />
                <Slider label="引导度" low="摸索" high="手把手" value={editGuide()} onChange={setEditGuide} />
                <Slider label="致命度" low="温和" high="残酷" value={editLethal()} onChange={setEditLethal} />
                <Slider label="节奏" low="慢热" high="快节奏" value={editPace()} onChange={setEditPace} />
              </div>

              <label>
                <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem' }}>自定义设定语</span>
                <textarea
                  class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] resize-y min-h-[60px]"
                  rows={3}
                  value={editPrompts()}
                  onInput={(e) => setEditPrompts(e.currentTarget.value)}
                  placeholder="追加到 AI 系统提示中的额外指令，如 NPC 口音、特定风格要求等"
                  style={{ width: '100%', 'margin-top': '0.25rem' }}
                />
              </label>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={save} disabled={saving()}>
                  {saving() ? '保存中...' : '保存'}
                </button>
                <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => { setEditing(false); if (!selected()) setSelected(null); }}>取消</button>
              </div>
            </div>
          </Show>

          {/* 只读模式（内置模板） */}
          <Show when={!editing() && selected()}>
            {(sel) => (
              <div>
                <h3 style={{ margin: '0 0 0.25rem' }}>{sel().name}</h3>
                <p class="text-text-dim text-[0.9rem]" style={{ margin: '0 0 1rem' }}>{sel().description}</p>
                <div class="flex flex-col gap-1.5">
                  <For each={DIMS}>
                    {(d) => <Bar label={`${d.label}`} value={sel()[d.key]} suffix={` (${d.low} ↔ ${d.high})`} />}
                  </For>
                </div>
                <Show when={sel().customPrompts}>
                  <div style={{ 'margin-top': '1rem' }}>
                    <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.8rem' }}>自定义设定语：</span>
                    <pre style={{ 'font-size': '0.82rem', 'white-space': 'pre-wrap', 'margin-top': '0.25rem', color: 'var(--text-dim)' }}>{sel().customPrompts}</pre>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
};

const Bar: Component<{ label: string; value: number; suffix?: string }> = (props) => (
  <div class="flex items-center gap-2">
    <span class="text-xs text-text-dim w-10">{props.label}</span>
    <div class="flex-1 h-1 bg-border rounded-sm overflow-hidden">
      <div class="h-full bg-accent rounded-sm transition-[width] duration-200" style={{ width: `${props.value * 10}%` }} />
    </div>
    <span class="text-[0.72rem] text-text-dim w-12 text-right">{props.value}/10{props.suffix ?? ''}</span>
  </div>
);

const Slider: Component<{
  label: string; low: string; high: string;
  value: number; onChange: (v: number) => void;
}> = (props) => (
  <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem', 'margin-bottom': '0.5rem' }}>
    <span style={{ width: '3.5rem', 'font-size': '0.82rem', 'text-align': 'right' }}>{props.label}</span>
    <span style={{ 'font-size': '0.7rem', color: 'var(--text-dim)', width: '3rem', 'text-align': 'right' }}>{props.low}</span>
    <input
      type="range"
      min={1}
      max={10}
      value={props.value}
      onInput={(e) => props.onChange(parseInt(e.currentTarget.value))}
      style={{ flex: 1 }}
    />
    <span style={{ 'font-size': '0.7rem', color: 'var(--text-dim)', width: '3rem' }}>{props.high}</span>
    <span style={{ width: '2rem', 'font-size': '0.82rem', 'font-weight': 600, 'text-align': 'center' }}>{props.value}</span>
  </div>
);

export default KPStudio;
