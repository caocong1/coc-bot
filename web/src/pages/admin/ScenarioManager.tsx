import { createResource, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import { adminApi } from '../../api';
import styles from './Admin.module.css';

/**
 * 模组管理
 *
 * 上传剧本文件（category=scenario）和守密人秘密（category=keeper_secret）。
 * 与知识库（规则书）分离，专注于可跑的剧本内容管理。
 */

const ScenarioManager: Component = () => {
  const [files, { refetch: refetchFiles }] = createResource(() =>
    adminApi.listKnowledge().then((all) => all.filter((f) => f.category === 'scenario' || f.category === 'keeper_secret')).catch(() => []),
  );
  const [jobs, { refetch: refetchJobs }] = createResource(() => adminApi.listKnowledgeJobs().catch(() => []));

  const [uploading, setUploading] = createSignal(false);
  const [uploadType, setUploadType] = createSignal<'scenario' | 'keeper_secret'>('scenario');
  const [uploadErr, setUploadErr] = createSignal('');

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
      await adminApi.uploadKnowledge(file, uploadType());
      refetchJobs();
      startPoll();
    } catch (err) {
      setUploadErr(`上传失败：${String(err)}`);
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  // 按文件名前缀把 scenario + keeper_secret 配对分组
  const groups = () => {
    const list = files() ?? [];
    const scenarios = list.filter((f) => f.category === 'scenario');
    return scenarios.map((s) => {
      const base = s.name.replace(/\.[^.]+$/, ''); // 去掉扩展名
      const secrets = list.filter(
        (f) => f.category === 'keeper_secret' && f.name.replace(/\.[^.]+$/, '').startsWith(base),
      );
      return { scenario: s, secrets };
    });
  };

  const pendingJobs = () => (jobs() ?? []).filter((j) => j.category === 'scenario' || j.category === 'keeper_secret');

  return (
    <div>
      {/* 说明 */}
      <div class={styles.panel} style={{ 'max-width': '700px', 'margin-bottom': '2rem' }}>
        <div class={styles.panelHeader}><h3>上传模组文件</h3></div>
        <div style={{ padding: '1rem', display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
          <p class={styles.dim} style={{ 'font-size': '0.85rem' }}>
            支持 PDF、TXT、MD 格式。上传后自动导入并构建向量索引，已有文件不会被覆盖。
          </p>

          {/* 类型选择 */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              class={uploadType() === 'scenario' ? styles.btn : styles.btnSecondary}
              onClick={() => setUploadType('scenario')}
            >
              📖 模组正文
            </button>
            <button
              class={uploadType() === 'keeper_secret' ? styles.btn : styles.btnSecondary}
              onClick={() => setUploadType('keeper_secret')}
            >
              🔒 守密人专用
            </button>
          </div>

          <p class={styles.dim} style={{ 'font-size': '0.78rem' }}>
            {uploadType() === 'scenario'
              ? '模组正文：场景描述、NPC 介绍、公开线索等——AI KP 在跑团时可参考，玩家通过调查可间接获得。'
              : '守密人专用：幕后真相、隐藏线索、事件触发条件等——AI KP 知晓但不会直接告诉玩家，需要玩家自行发现。'}
          </p>

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

      {/* 导入任务 */}
      <Show when={pendingJobs().length > 0}>
        <div class={styles.section} style={{ 'margin-bottom': '1.5rem' }}>
          <div class={styles.sectionHeader}>
            <h2>导入任务</h2>
            <button class={styles.btnSm} onClick={() => { refetchJobs(); if (!hasPending()) refetchFiles(); }}>刷新</button>
          </div>
          <div class={styles.table}>
            <div class={styles.tableHeader} style={{ 'grid-template-columns': '2fr 1fr 1fr 1fr' }}>
              <span>文件名</span><span>类型</span><span>状态</span><span>时间</span>
            </div>
            <For each={pendingJobs()}>
              {(job) => (
                <div class={styles.tableRow} style={{ 'grid-template-columns': '2fr 1fr 1fr 1fr' }}>
                  <span style={{ 'font-size': '0.82rem' }}>{job.filename}</span>
                  <span class={styles.dim}>{job.category === 'scenario' ? '模组正文' : '守密人专用'}</span>
                  <span>
                    {job.status === 'pending' && <span style={{ color: 'var(--warn)' }}>⏳ 处理中</span>}
                    {job.status === 'done' && <span style={{ color: 'var(--success)' }}>✅ 完成</span>}
                    {job.status === 'failed' && <span style={{ color: 'var(--danger)' }} title={job.error}>❌ 失败</span>}
                  </span>
                  <span class={styles.dim} style={{ 'font-size': '0.78rem' }}>
                    {new Date(job.startedAt).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* 模组列表 */}
      <div class={styles.section}>
        <div class={styles.sectionHeader}>
          <h2>已导入模组</h2>
          <button class={styles.btnSm} onClick={refetchFiles}>刷新</button>
        </div>
        <Show when={!files.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <Show
            when={(files() ?? []).filter((f) => f.category === 'scenario').length > 0}
            fallback={<p class={styles.dim}>暂无模组，请上传剧本文件</p>}
          >
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
              <For each={groups()}>
                {(g) => (
                  <div class={styles.panel}>
                    <div class={styles.panelHeader} style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
                      <div>
                        <span style={{ 'font-weight': '600' }}>📖 {g.scenario.name}</span>
                        <span class={styles.dim} style={{ 'font-size': '0.78rem', 'margin-left': '0.75rem' }}>
                          {g.scenario.charCount > 0 ? `${(g.scenario.charCount / 1000).toFixed(0)}K 字` : ''}{' '}
                          {g.scenario.chunkCount > 0 ? `· ${g.scenario.chunkCount} 块` : ''}
                          {g.scenario.importedAt ? ` · ${new Date(g.scenario.importedAt).toLocaleDateString()}` : ''}
                        </span>
                      </div>
                    </div>
                    <Show when={g.secrets.length > 0}>
                      <div style={{ padding: '0.6rem 1rem', display: 'flex', 'flex-direction': 'column', gap: '0.3rem' }}>
                        <For each={g.secrets}>
                          {(sec) => (
                            <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center', 'font-size': '0.82rem' }}>
                              <span>🔒</span>
                              <span class={styles.dim}>{sec.name}</span>
                              <span class={`${styles.badge} ${styles.cat_keeper_secret}`}>守密人专用</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
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

export default ScenarioManager;
