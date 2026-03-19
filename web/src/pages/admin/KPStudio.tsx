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
      const list = templates() ?? [];
      const updated = list.find((t) => t.name === editName());
      if (updated) {
        setSelected(updated);
        setEditing(false);
      }
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
    <div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
          <h3>KP 人格模板</h3>
          <button
            class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
            style={{ 'font-size': '0.8rem' }}
            onClick={startNew}
          >
            + 新建
          </button>
        </div>
        <div class="flex-1 p-4">
          <Show when={!templates.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
            <For each={templates()}>
              {(t) => (
                <div
                  class={`mb-3 cursor-pointer rounded-lg border border-border p-4 transition-colors hover:border-accent-dim shadow-sm shadow-black/10 ${
                    selected()?.id === t.id ? 'border-accent bg-accent/[0.05]' : ''
                  }`}
                  onClick={() => selectTemplate(t)}
                >
                  <div class="mb-1 flex items-center justify-between gap-3">
                    <div class="font-semibold">{t.name}</div>
                    <Show when={!t.builtin}>
                      <span class="rounded bg-accent/[0.1] px-2 py-0.5 text-[0.7rem] text-accent">自定义</span>
                    </Show>
                  </div>
                  <div class="mb-3 text-[0.82rem] leading-6 text-text-dim">{t.description}</div>
                  <div class="flex flex-col gap-1.5">
                    <For each={DIMS}>{(d) => <Bar label={d.label} value={t[d.key]} />}</For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <div class="min-h-[400px] md:min-h-[680px] overflow-hidden rounded-lg border border-border bg-surface shadow-sm shadow-black/10">
        <Show
          when={selected() || editing()}
          fallback={
            <div class="flex h-full min-h-[400px] md:min-h-[680px] items-center justify-center p-8 lg:p-10">
              <div class="max-w-md rounded-2xl border border-dashed border-border bg-white/[0.02] px-8 py-10 text-center">
                <div class="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-accent/80">KP Studio</div>
                <h3 class="text-2xl font-semibold text-text">从左侧选择一个模板开始</h3>
                <p class="mt-3 text-sm leading-7 text-text-dim">
                  查看五维倾向、阅读设定语，或者基于现有模板创建新的 Keeper 叙事风格。
                </p>
              </div>
            </div>
          }
        >
          <div class="flex h-full flex-col gap-5 p-6 lg:p-8">
            <Show when={msg()}>
              <div class="rounded-md border border-success bg-success/[0.12] px-3.5 py-2.5 text-sm text-success">
                {msg()}
              </div>
            </Show>
            <Show when={err()}>
              <div class="rounded-md border border-danger bg-danger/[0.12] px-3.5 py-2.5 text-sm text-danger">
                {err()}
              </div>
            </Show>

            <div class="rounded-2xl border border-border bg-white/[0.02] px-5 py-4 shadow-sm shadow-black/10">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="space-y-1">
                  <Show when={selected()}>
                    {(sel) => (
                      <>
                        <div class="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
                          {sel().builtin ? '内置模板' : '自定义模板'}
                        </div>
                        <h3 class="text-2xl font-semibold text-text">{sel().name}</h3>
                      </>
                    )}
                  </Show>
                  <Show when={!selected() && editing()}>
                    <>
                      <div class="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">新建模板</div>
                      <h3 class="text-2xl font-semibold text-text">创建新的 KP 模板</h3>
                    </>
                  </Show>
                  <p class="max-w-2xl text-sm leading-7 text-text-dim">
                    调整基调、灵活度和自定义设定语，整理出适合当前团风与模组气质的 Keeper 人格模板。
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Show when={selected()?.builtin}>
                    <button
                      class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                      onClick={startNew}
                    >
                      基于此新建
                    </button>
                  </Show>
                  <Show when={selected() && !selected()!.builtin}>
                    <button
                      class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                      onClick={() => {
                        setEditing(true);
                        loadToForm(selected()!);
                      }}
                      disabled={editing()}
                    >
                      编辑
                    </button>
                    <button
                      class="px-2.5 py-1 rounded-md border-none bg-danger text-sm text-white cursor-pointer transition-all duration-200 active:scale-95"
                      onClick={del}
                    >
                      删除
                    </button>
                  </Show>
                </div>
              </div>
            </div>

            <Show when={editing() && (!selected()?.builtin)}>
              <div class="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
                <div class="rounded-2xl border border-border bg-white/[0.02] p-5 shadow-sm shadow-black/10">
                  <div class="mb-4 space-y-1">
                    <div class="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">基础信息</div>
                    <p class="text-sm leading-7 text-text-dim">
                      先定义模板定位和用途，让房间里的人一眼就知道该模板适合怎样的跑团节奏。
                    </p>
                  </div>
                  <div class="flex flex-col gap-4">
                    <label>
                      <span class="text-[0.8rem] text-text-dim">名称</span>
                      <input
                        class="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-[0.88rem] text-text"
                        value={editName()}
                        onInput={(e) => setEditName(e.currentTarget.value)}
                      />
                    </label>
                    <label>
                      <span class="text-[0.8rem] text-text-dim">描述</span>
                      <input
                        class="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-[0.88rem] text-text"
                        value={editDesc()}
                        onInput={(e) => setEditDesc(e.currentTarget.value)}
                      />
                    </label>
                    <label>
                      <span class="text-[0.8rem] text-text-dim">自定义设定语</span>
                      <textarea
                        class="mt-2 min-h-[220px] w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-[0.88rem] text-text"
                        rows={9}
                        value={editPrompts()}
                        onInput={(e) => setEditPrompts(e.currentTarget.value)}
                        placeholder="追加到 AI 系统提示中的额外指令，如 NPC 口音、叙事风格、危险感控制等"
                      />
                    </label>
                  </div>
                </div>

                <div class="rounded-2xl border border-border bg-white/[0.02] p-5 shadow-sm shadow-black/10">
                  <div class="mb-4 space-y-1">
                    <div class="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">五维参数</div>
                    <p class="text-sm leading-7 text-text-dim">
                      数值越高越偏向右侧描述，适合快速塑造“规则严谨”或“电影化叙事”这类明显风格差。
                    </p>
                  </div>
                  <div class="space-y-3">
                    <Slider label="基调" low="轻松" high="恐怖" value={editTone()} onChange={setEditTone} />
                    <Slider label="灵活度" low="规则" high="叙事" value={editFlex()} onChange={setEditFlex} />
                    <Slider label="引导度" low="摸索" high="手把手" value={editGuide()} onChange={setEditGuide} />
                    <Slider label="致命度" low="温和" high="残酷" value={editLethal()} onChange={setEditLethal} />
                    <Slider label="节奏" low="慢热" high="快节奏" value={editPace()} onChange={setEditPace} />
                  </div>
                </div>

                <div class="flex flex-wrap gap-3 lg:col-span-2">
                  <button
                    class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                    onClick={save}
                    disabled={saving()}
                  >
                    {saving() ? '保存中...' : '保存'}
                  </button>
                  <button
                    class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                    onClick={() => {
                      setEditing(false);
                      if (!selected()) setSelected(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            </Show>

            <Show when={!editing() && selected()}>
              {(sel) => (
                <div class="flex flex-col gap-5">
                  <div class="rounded-2xl border border-border bg-white/[0.02] p-5 shadow-sm shadow-black/10">
                    <div class="space-y-3">
                      <div class="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">模板简介</div>
                      <p class="text-sm leading-7 text-text-dim">{sel().description}</p>
                      <Show when={sel().customPrompts}>
                        <div class="rounded-xl border border-border/80 bg-bg/60 p-4">
                          <div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">自定义设定语</div>
                          <pre class="whitespace-pre-wrap text-[0.82rem] leading-7 text-text-dim">{sel().customPrompts}</pre>
                        </div>
                      </Show>
                    </div>
                  </div>

                  <div class="rounded-2xl border border-border bg-white/[0.02] p-5 shadow-sm shadow-black/10">
                    <div class="mb-4 space-y-1">
                      <div class="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">五维倾向</div>
                      <p class="text-sm leading-7 text-text-dim">
                        查看模板在氛围、规则与节奏上的默认重心，方便判断它更适合哪类模组和玩家桌风。
                      </p>
                    </div>
                    <div class="space-y-3">
                      <For each={DIMS}>
                        {(d) => <Bar label={d.label} value={sel()[d.key]} suffix={` (${d.low} ↔ ${d.high})`} />}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

const Bar: Component<{ label: string; value: number; suffix?: string }> = (props) => (
  <div class="flex items-center gap-2">
    <span class="w-10 text-xs text-text-dim">{props.label}</span>
    <div class="h-1 flex-1 overflow-hidden rounded-sm bg-border">
      <div class="h-full rounded-sm bg-accent transition-[width] duration-200" style={{ width: `${props.value * 10}%` }} />
    </div>
    <span class={`${props.suffix ? 'min-w-[11rem] whitespace-nowrap' : 'w-10'} text-right text-[0.72rem] text-text-dim`}>
      {props.value}/10{props.suffix ?? ''}
    </span>
  </div>
);

const Slider: Component<{
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (v: number) => void;
}> = (props) => (
  <div class="grid gap-2 sm:grid-cols-[3.75rem_3.2rem_minmax(0,1fr)_3.2rem_2rem] sm:items-center">
    <span class="text-[0.82rem] sm:text-right">{props.label}</span>
    <span class="text-[0.7rem] text-text-dim sm:text-right">{props.low}</span>
    <input
      type="range"
      min={1}
      max={10}
      value={props.value}
      onInput={(e) => props.onChange(parseInt(e.currentTarget.value))}
      class="w-full"
    />
    <span class="text-[0.7rem] text-text-dim">{props.high}</span>
    <span class="text-center text-[0.82rem] font-semibold">{props.value}</span>
  </div>
);

export default KPStudio;
