import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi } from '../../api';

/**
 * 知识库 — 规则书管理
 *
 * 展示系统内置的规则书索引（category=rules）。
 * 规则书通过命令行一次性导入，此处只读展示，不需要通过 Web 上传。
 * 剧本文件请前往「模组管理」页面。
 */
const Knowledge: Component = () => {
  const [files, { refetch }] = createResource(() =>
    adminApi.listKnowledge().catch(() => []),
  );
  const [deleting, setDeleting] = createSignal<string | null>(null);

  const deleteFile = async (name: string) => {
    if (!confirm(`确认从知识库删除「${name}」？\n（仅移除索引，不影响原始文件）`)) return;
    setDeleting(name);
    try {
      await adminApi.deleteKnowledge(name);
      refetch();
    } catch (e) {
      alert(String(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10" style={{ 'max-width': '640px', 'margin-bottom': '2rem' }}>
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]"><h3>关于知识库</h3></div>
        <div style={{ padding: '1rem' }}>
          <p style={{ 'font-size': '0.88rem', 'margin-bottom': '0.75rem' }}>
            知识库存储 CoC7 规则书内容，供 AI KP 在跑团中检索规则细节。
          </p>
          <p class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.82rem', 'margin-bottom': '0.5rem' }}>
            规则书通过命令行一次性导入，<strong>不需要通过 Web 界面上传</strong>。
          </p>
          <div style={{
            background: 'rgba(124,106,247,0.08)', border: '1px solid rgba(124,106,247,0.2)',
            'border-radius': '6px', padding: '0.75rem', 'font-size': '0.8rem', 'font-family': 'monospace',
          }}>
            <div style={{ color: 'var(--text-dim)', 'margin-bottom': '0.35rem' }}># 初次导入规则书（只需运行一次）</div>
            <div style={{ color: 'var(--accent)' }}>
              bun scripts/import-pdfs.ts --file="[规则书]守秘人规则书.pdf" --category=rules
            </div>
            <div style={{ color: 'var(--accent)', 'margin-top': '0.25rem' }}>
              bun scripts/import-pdfs.ts --file="[调查员手册].pdf" --category=rules
            </div>
            <div style={{ color: 'var(--text-dim)', 'margin-top': '0.5rem' }}># 构建向量索引</div>
            <div style={{ color: 'var(--accent)' }}>bun scripts/build-indexes.ts --type=rules</div>
          </div>
          <p class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.78rem', 'margin-top': '0.75rem' }}>
            剧本和模组文件请前往 <strong>模组管理</strong> 页面上传。
          </p>
        </div>
      </div>

      <div class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold">已导入规则书</h2>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetch}>刷新</button>
        </div>
        <Show when={!files.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <Show when={(files() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无规则书，请按上方说明通过命令行导入</p>}>
            <div class="bg-surface border border-border rounded-lg overflow-hidden">
              <div class="grid gap-2 px-4 py-2.5 items-center text-xs bg-white/[0.03] text-text-dim uppercase tracking-wider border-b border-border" style={{ 'grid-template-columns': '2.5fr 0.7fr 0.7fr 1fr 2rem' }}>
                <span>文件名</span>
                <span>字符数</span>
                <span>分块数</span>
                <span>导入时间</span>
                <span></span>
              </div>
              <For each={files()}>
                {(f) => (
                  <div class="grid gap-2 px-4 py-2.5 items-center text-sm border-t border-border/50 hover:bg-white/[0.02] transition-colors" style={{ 'grid-template-columns': '2.5fr 0.7fr 0.7fr 1fr 2rem' }}>
                    <span style={{ 'font-size': '0.82rem' }}>📗 {f.name}</span>
                    <span class="text-text-dim text-[0.9rem]">{f.charCount > 0 ? `${(f.charCount / 1000).toFixed(0)}K` : '—'}</span>
                    <span class="text-text-dim text-[0.9rem]">{f.chunkCount || '—'}</span>
                    <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.78rem' }}>
                      {f.importedAt ? new Date(f.importedAt).toLocaleDateString() : '—'}
                    </span>
                    <button
                      class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200"
                      style={{ color: 'var(--error, #f87171)', 'border-color': 'var(--error, #f87171)', padding: '0.1rem 0.4rem' }}
                      disabled={deleting() === f.name}
                      onClick={() => deleteFile(f.name)}
                    >
                      {deleting() === f.name ? '...' : '✕'}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default Knowledge;
