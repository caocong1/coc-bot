import { createResource, For, Show, type Component } from 'solid-js';
import { adminApi, type SessionInfo } from '../../api';
import styles from './Admin.module.css';

const STATUS_LABEL: Record<string, string> = {
  running: '🟢 进行中',
  paused: '⏸️ 已暂停',
  ended: '⚫ 已结束',
};

const Dashboard: Component = () => {
  const [sessions, { refetch }] = createResource(() => adminApi.listSessions().catch(() => []));

  const running = () => (sessions() ?? []).filter((s) => s.status === 'running');
  const paused = () => (sessions() ?? []).filter((s) => s.status === 'paused');

  return (
    <div>
      <div class={styles.statRow}>
        <Stat label="进行中的团" value={running().length} color="var(--success)" />
        <Stat label="暂停中的团" value={paused().length} color="var(--warn)" />
        <Stat label="总团数" value={(sessions() ?? []).length} color="var(--accent)" />
      </div>

      <div class={styles.section}>
        <div class={styles.sectionHeader}>
          <h2>所有跑团</h2>
          <button class={styles.btnSm} onClick={refetch}>刷新</button>
        </div>
        <Show when={!sessions.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <Show when={(sessions() ?? []).length > 0} fallback={<p class={styles.dim}>暂无跑团记录</p>}>
            <div class={styles.table}>
              <div class={styles.tableHeader}>
                <span>群组</span>
                <span>状态</span>
                <span>当前场景</span>
                <span>KP 模板</span>
                <span>消息数</span>
                <span>分段</span>
                <span>操作</span>
              </div>
              <For each={sessions()}>
                {(s) => <SessionRow session={s} onAction={refetch} />}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

const Stat: Component<{ label: string; value: number; color: string }> = (props) => (
  <div class={styles.stat} style={{ 'border-left-color': props.color }}>
    <div class={styles.statValue} style={{ color: props.color }}>{props.value}</div>
    <div class={styles.statLabel}>{props.label}</div>
  </div>
);

const SessionRow: Component<{ session: SessionInfo; onAction: () => void }> = (props) => {
  const s = props.session;
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); props.onAction(); } catch (e) { alert(String(e)); }
  };

  return (
    <div class={styles.tableRow}>
      <span class={styles.mono}>#{s.groupId}</span>
      <span>{STATUS_LABEL[s.status] ?? s.status}</span>
      <span>{s.currentScene ?? '—'}</span>
      <span>{s.kpTemplate}</span>
      <span>{s.messageCount}</span>
      <span>{s.segmentCount > 0 ? `${s.segmentCount} 段` : '—'}</span>
      <span class={styles.actions}>
        {s.status === 'running' && (
          <button class={styles.btnWarn} onClick={() => act(() => adminApi.pauseSession(s.groupId))}>暂停</button>
        )}
        {s.status === 'paused' && (
          <button class={styles.btnSuccess} onClick={() => act(() => adminApi.resumeSession(s.groupId))}>继续</button>
        )}
        {(s.status === 'running' || s.status === 'paused') && (
          <button class={styles.btnDanger} onClick={() => {
            if (confirm('确定结束本跑团？')) act(() => adminApi.stopSession(s.groupId));
          }}>结束</button>
        )}
        <a href={`/admin/sessions?group=${s.groupId}`} class={styles.btnSm}>详情</a>
      </span>
    </div>
  );
};

export default Dashboard;
