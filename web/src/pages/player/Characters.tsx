import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi, type CharacterSummary } from '../../api';

const Characters: Component = () => {
  const [chars, { refetch }] = createResource(() => playerApi.listCharacters().catch(() => []));
  const [importing, setImporting] = createSignal(false);
  const [downloadingTemplate, setDownloadingTemplate] = createSignal(false);
  let fileInput!: HTMLInputElement;

  const del = async (id: string, name: string) => {
    if (!confirm(`确定删除角色卡「${name}」？此操作不可撤销。`)) return;
    await playerApi.deleteCharacter(id).catch((e) => alert(String(e)));
    refetch();
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    setImporting(true);
    try {
      const result = await playerApi.importExcel(file);
      sessionStorage.setItem('import_data', JSON.stringify(result));
      location.href = '/player/characters/new?import=1';
    } catch (err) {
      alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      await playerApi.downloadCharacterTemplate();
    } catch (err) {
      alert(`下载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  return (
    <div>
      <div class="flex justify-end mb-6 gap-3">
        <a href="/player/characters/new" class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95">＋ 新建角色卡</a>
        <button class="inline-block px-5 py-2 bg-transparent text-text-dim border border-border rounded-md text-[0.9rem] cursor-pointer no-underline hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95" onClick={() => fileInput.click()} disabled={importing()}>
          {importing() ? '导入中...' : '导入 Excel'}
        </button>
        <button
          class="inline-block px-5 py-2 bg-transparent text-text-dim border border-border rounded-md text-[0.9rem] cursor-pointer no-underline hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95"
          onClick={handleDownloadTemplate}
          disabled={downloadingTemplate()}
        >
          {downloadingTemplate() ? '下载中...' : '空白卡下载'}
        </button>
        <input ref={fileInput} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleImport} />
      </div>

      <Show when={!chars.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(chars() ?? []).length > 0} fallback={
          <div class="text-center py-16 px-8 text-text-dim">
            <p>还没有角色卡</p>
            <a href="/player/characters/new" class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ 'margin-top': '1rem' }}>新建第一张角色卡</a>
          </div>
        }>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            <For each={chars()}>
              {(c) => <CharCard char={c} onDelete={del} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const CharCard: Component<{ char: CharacterSummary; onDelete: (id: string, name: string) => void }> = (props) => {
  const c = props.char;
  return (
    <div class={`bg-surface border border-border rounded-xl p-5 flex flex-col gap-2.5 shadow-sm shadow-black/10 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 ${c.readonly ? 'opacity-75 border-dashed' : ''}`}>
      <div class="text-lg font-bold">{c.name}</div>
      <div class="flex gap-2 items-center text-text-dim text-sm">
        {c.occupation && <span>{c.occupation}</span>}
        {c.age && <span>· {c.age}岁</span>}
        {c.readonly && <span class="bg-accent-dim text-white text-[0.72rem] px-2 py-0.5 rounded-[10px]">跑团中</span>}
      </div>
      <div class="flex gap-3">
        <StatChip label="HP" value={c.hp} />
        <StatChip label="SAN" value={c.san} />
      </div>
      <div class="flex gap-2 mt-auto">
        {!c.readonly && (
          <>
            <a href={`/player?edit=${c.id}`} class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200">编辑</a>
            <button class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => props.onDelete(c.id, c.name)}>删除</button>
          </>
        )}
        {c.readonly && <span class="text-text-dim" style={{ 'font-size': '0.78rem' }}>跑团中不可编辑</span>}
      </div>
    </div>
  );
};

const StatChip: Component<{ label: string; value: number | null }> = (props) => (
  <div class="flex flex-col items-center bg-bg rounded-md px-2.5 py-1.5 min-w-[50px]">
    <span class="text-[0.7rem] text-text-dim">{props.label}</span>
    <span class="text-base font-bold">{props.value ?? '—'}</span>
  </div>
);

export default Characters;
