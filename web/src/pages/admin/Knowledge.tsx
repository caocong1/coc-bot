import { createResource, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import { adminApi, type KnowledgeCategory } from '../../api';
import styles from './Admin.module.css';

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  rules: '规则书',
  scenario: '模组内容',
  keeper_secret: '守密人专用',
};

const CATEGORY_HINT: Record<KnowledgeCategory, string> = {
  rules: '规则机制、技能说明、基础设定（如 CoC7 规则书、调查员手册）',
  scenario: '模组正文、场景描述（玩家可间接获取的信息）',
  keeper_secret: '守密人内幕、隐藏线索、真相（不对玩家透露）',
};

const Knowledge: Component = () => {
  const [files, { refetch: refetchFiles }] = createResource(() => adminApi.listKnowledge().catch(() => []));
  const [jobs, { refetch: refetchJobs }] = createResource(() => adminApi.listKnowledgeJobs().catch(() => []));
  const [uploading, setUploading] = createSignal(false);
  const [category, setCategory] = createSignal<KnowledgeCategory>('rules');
  const [uploadErr, setUploadErr] = createSignal('');

  // 有 pending 任务时自动轮询
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const hasPending = () => (jobs() ?? []).some((j) => j.status === 'pending');

  const startPoll = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      refetchJobs();
      if (!hasPending()) {
        clearInterval(pollTimer!);
        pollTimer = null;
        refetchFiles();
      }
    }, 3000);
  };

  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

  const handleUpload = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadErr('');
    try {
      await adminApi.uploadKnowledge(file, category());
      refetchJobs();
      startPoll();
    } catch (e) {
      setUploadErr(`上传失败：${String(e)}`);
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  return (
    <div>
      {/* 上传区 */}
      <div class={styles.panel} style={{ 'max-width': '640px', 'margin-bottom': '2rem' }}>
        <div class={styles.panelHeader}><h3>上传新文件</h3></div>
        <div style={{ padding: '1rem', display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
          <p class={styles.dim} style={{ 'font-size': '0.85rem' }}>
            支持 PDF、TXT、MD 格式。每次上传后系统自动导入并合并到知识库，不会覆盖已有文件。
          </p>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.35rem' }}>
            <label class={styles.label}>知识类型</label>
            <select
              class={styles.select}
              value={category()}
              onChange={(e) => setCategory(e.currentTarget.value as KnowledgeCategory)}
            >
              <option value="rules">规则书</option>
              <option value="scenario">模组内容</option>
              <option value="keeper_secret">守密人专用</option>
            </select>
            <p class={styles.dim} style={{ 'font-size': '0.78rem' }}>{CATEGORY_HINT[category()]}</p>
          </div>

          <label class={styles.uploadLabel}>
            {uploading() ? '上传中...' : '📁 选择文件（PDF / TXT / MD）'}
            <input
              type="file"
              accept=".pdf,.txt,.md"
              disabled={uploading()}
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
          </label>

          <Show when={uploadErr()}>
            <p style={{ color: 'var(--danger)', 'font-size': '0.85rem' }}>❌ {uploadErr()}</p>
          </Show>
        </div>
      </div>

      {/* 导入任务状态 */}
      <Show when={(jobs() ?? []).length > 0}>
        <div class={styles.section} style={{ 'margin-bottom': '2rem' }}>
          <div class={styles.sectionHeader}>
            <h2>导入任务</h2>
            <button class={styles.btnSm} onClick={() => { refetchJobs(); if (!hasPending()) refetchFiles(); }}>刷新</button>
          </div>
          <div class={styles.table}>
            <div class={styles.tableHeader}>
              <span>文件名</span>
              <span>类型</span>
              <span>状态</span>
              <span>时间</span>
            </div>
            <For each={jobs()}>
              {(job) => (
                <div class={styles.tableRow}>
                  <span style={{ 'font-size': '0.82rem' }}>{job.filename}</span>
                  <span class={styles.dim}>{CATEGORY_LABELS[job.category]}</span>
                  <span>
                    {job.status === 'pending' && <span style={{ color: 'var(--warn)' }}>⏳ 处理中...</span>}
                    {job.status === 'done' && <span style={{ color: 'var(--success)' }}>✅ 完成</span>}
                    {job.status === 'failed' && <span style={{ color: 'var(--danger)' }} title={job.error}>❌ 失败</span>}
                  </span>
                  <span class={styles.dim} style={{ 'font-size': '0.78rem' }}>
                    {new Date(job.startedAt).toLocaleTimeString()}
                    {job.finishedAt && ` → ${new Date(job.finishedAt).toLocaleTimeString()}`}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* 已导入文件列表 */}
      <div class={styles.section}>
        <div class={styles.sectionHeader}>
          <h2>已导入文件</h2>
          <button class={styles.btnSm} onClick={refetchFiles}>刷新</button>
        </div>
        <Show when={!files.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <Show when={(files() ?? []).length > 0} fallback={<p class={styles.dim}>暂无文件，请先上传</p>}>
            <div class={styles.table}>
              <div class={styles.tableHeader} style={{ 'grid-template-columns': '2fr 1fr 0.7fr 0.7fr 1fr' }}>
                <span>文件名</span>
                <span>类型</span>
                <span>字符数</span>
                <span>分块数</span>
                <span>导入时间</span>
              </div>
              <For each={files()}>
                {(f) => (
                  <div class={styles.tableRow} style={{ 'grid-template-columns': '2fr 1fr 0.7fr 0.7fr 1fr' }}>
                    <span style={{ 'font-size': '0.82rem' }}>{f.name}</span>
                    <span>
                      <span class={`${styles.badge} ${styles[`cat_${f.category}`]}`}>
                        {CATEGORY_LABELS[f.category]}
                      </span>
                    </span>
                    <span class={styles.dim}>{f.charCount > 0 ? `${(f.charCount / 1000).toFixed(0)}K` : '—'}</span>
                    <span class={styles.dim}>{f.chunkCount > 0 ? f.chunkCount : '—'}</span>
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
