import { createResource, For, Show, type Component } from 'solid-js';
import { adminApi } from '../../api';
import styles from './Admin.module.css';

/**
 * 知识库 — 规则书管理
 *
 * 展示系统内置的规则书索引（category=rules）。
 * 规则书通过命令行一次性导入，此处只读展示，不需要通过 Web 上传。
 * 剧本文件请前往「模组管理」页面。
 */
const Knowledge: Component = () => {
  const [files, { refetch }] = createResource(() =>
    adminApi.listKnowledge().then((all) => all.filter((f) => f.category === 'rules')).catch(() => []),
  );

  return (
    <div>
      <div class={styles.panel} style={{ 'max-width': '640px', 'margin-bottom': '2rem' }}>
        <div class={styles.panelHeader}><h3>关于知识库</h3></div>
        <div style={{ padding: '1rem' }}>
          <p style={{ 'font-size': '0.88rem', 'margin-bottom': '0.75rem' }}>
            知识库存储 CoC7 规则书内容，供 AI KP 在跑团中检索规则细节。
          </p>
          <p class={styles.dim} style={{ 'font-size': '0.82rem', 'margin-bottom': '0.5rem' }}>
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
          <p class={styles.dim} style={{ 'font-size': '0.78rem', 'margin-top': '0.75rem' }}>
            剧本和模组文件请前往 <strong>模组管理</strong> 页面上传。
          </p>
        </div>
      </div>

      <div class={styles.section}>
        <div class={styles.sectionHeader}>
          <h2>已导入规则书</h2>
          <button class={styles.btnSm} onClick={refetch}>刷新</button>
        </div>
        <Show when={!files.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <Show when={(files() ?? []).length > 0} fallback={<p class={styles.dim}>暂无规则书，请按上方说明通过命令行导入</p>}>
            <div class={styles.table}>
              <div class={styles.tableHeader} style={{ 'grid-template-columns': '2.5fr 0.7fr 0.7fr 1fr' }}>
                <span>文件名</span>
                <span>字符数</span>
                <span>分块数</span>
                <span>导入时间</span>
              </div>
              <For each={files()}>
                {(f) => (
                  <div class={styles.tableRow} style={{ 'grid-template-columns': '2.5fr 0.7fr 0.7fr 1fr' }}>
                    <span style={{ 'font-size': '0.82rem' }}>📗 {f.name}</span>
                    <span class={styles.dim}>{f.charCount > 0 ? `${(f.charCount / 1000).toFixed(0)}K` : '—'}</span>
                    <span class={styles.dim}>{f.chunkCount || '—'}</span>
                    <span class={styles.dim} style={{ 'font-size': '0.78rem' }}>
                      {f.importedAt ? new Date(f.importedAt).toLocaleDateString() : '—'}
                    </span>
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
