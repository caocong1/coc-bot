import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi, type Clue, type Message, type SessionInfo } from '../../api';
import styles from './Admin.module.css';

const Sessions: Component = () => {
  const groupId = parseInt(new URLSearchParams(location.search).get('group') ?? '0');
  const [sessions] = createResource(() => adminApi.listSessions().catch(() => []));

  // 如果 URL 指定了群，直接进详情
  if (groupId) return <SessionDetail groupId={groupId} />;

  return (
    <div>
      <p class={styles.dim}>从 URL 参数 <code>?group=&lt;群号&gt;</code> 进入详情，或在总览页点击「详情」。</p>
      <Show when={!sessions.loading}>
        <div class={styles.table} style={{ 'margin-top': '1.5rem' }}>
          <div class={styles.tableHeader}><span>群号</span><span>状态</span><span>场景</span><span></span></div>
          <For each={sessions()}>
            {(s) => (
              <div class={styles.tableRow}>
                <span class={styles.mono}>#{s.groupId}</span>
                <span>{s.status}</span>
                <span>{s.currentScene ?? '—'}</span>
                <a href={`?group=${s.groupId}`} class={styles.btnSm}>详情</a>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const SessionDetail: Component<{ groupId: number }> = (props) => {
  const [clues, { refetch: refetchClues }] = createResource(() => adminApi.listClues(props.groupId).catch(() => []));
  const [injectText, setInjectText] = createSignal('');
  const [messages, setMessages] = createSignal<Message[]>([]);

  // SSE 连接
  let es: EventSource | null = null;
  const connectSSE = () => {
    es?.close();
    es = new EventSource(adminApi.messagesStreamUrl(props.groupId));
    es.onmessage = (e) => {
      const m = JSON.parse(e.data) as Message;
      setMessages((prev) => [...prev.slice(-99), m]);
    };
  };
  connectSSE();

  const inject = async () => {
    const text = injectText().trim();
    if (!text) return;
    await adminApi.injectInfo(props.groupId, text).catch((e) => alert(String(e)));
    setInjectText('');
  };

  const discoverClue = async (clueId: string) => {
    await adminApi.discoverClue(props.groupId, clueId).catch((e) => alert(String(e)));
    refetchClues();
  };

  return (
    <div class={styles.detailGrid}>
      {/* 消息流 */}
      <div class={styles.panel}>
        <div class={styles.panelHeader}>
          <h3>实时消息流</h3>
          <button class={styles.btnSm} onClick={connectSSE}>重连</button>
        </div>
        <div class={styles.messageList}>
          <For each={messages()}>
            {(m) => (
              <div class={`${styles.msg} ${styles[`role_${m.role}`] ?? ''}`}>
                <span class={styles.msgMeta}>{m.role === 'kp' ? '🎭 KP' : m.displayName ?? m.role}</span>
                <span class={styles.msgContent}>{m.content}</span>
              </div>
            )}
          </For>
        </div>
        <div class={styles.injectRow}>
          <input
            class={styles.input}
            placeholder="向 KP 注入信息（不对玩家显示）..."
            value={injectText()}
            onInput={(e) => setInjectText(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && inject()}
          />
          <button class={styles.btn} onClick={inject}>注入</button>
        </div>
      </div>

      {/* 线索列表 */}
      <div class={styles.panel}>
        <div class={styles.panelHeader}>
          <h3>线索</h3>
          <button class={styles.btnSm} onClick={refetchClues}>刷新</button>
        </div>
        <Show when={!clues.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <Show when={(clues() ?? []).length > 0} fallback={<p class={styles.dim}>暂无线索</p>}>
            <For each={clues()}>
              {(c) => (
                <div class={`${styles.clueItem} ${c.isDiscovered ? styles.discovered : ''}`}>
                  <div class={styles.clueTitle}>
                    {c.isDiscovered ? '✅' : '🔒'} {c.title}
                  </div>
                  <div class={styles.clueDesc}>{c.keeperContent ?? c.playerDescription}</div>
                  {!c.isDiscovered && (
                    <button class={styles.btnSm} onClick={() => discoverClue(c.id)}>标记已发现</button>
                  )}
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default Sessions;
