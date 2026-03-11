import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi } from '../../api';
import styles from './Player.module.css';

const ROLE_LABEL: Record<string, string> = {
  kp: '🎭 KP',
  player: '🧑 玩家',
  dice: '🎲 骰子',
  system: '⚙️ 系统',
};

const CampaignDetail: Component<{ id: string }> = (props) => {
  const [detail] = createResource(() => playerApi.getCampaign(props.id).catch(() => null));
  const [messages] = createResource(() => playerApi.getCampaignMessages(props.id).catch(() => []));

  return (
    <Show when={!detail.loading && detail()} fallback={<p class={styles.dim}>加载中...</p>}>
      {(d) => (
        <div class={styles.detailLayout}>
          {/* 侧边栏：基本信息 + 线索 */}
          <aside class={styles.detailSide}>
            <div class={styles.infoCard}>
              <h3>场景</h3>
              <p>{d().currentScene?.name ?? '（无场景）'}</p>
              <Show when={d().currentScene?.activeNpcs?.length}>
                <p class={styles.dim}>在场 NPC：{d().currentScene!.activeNpcs.join('、')}</p>
              </Show>
            </div>

            <div class={styles.infoCard}>
              <h3>参与调查员</h3>
              <For each={d().players}>
                {(p) => <p class={styles.dim}>QQ {p.qqId}</p>}
              </For>
            </div>

            <div class={styles.infoCard}>
              <h3>已发现线索</h3>
              <Show when={d().discoveredClues.length > 0} fallback={<p class={styles.dim}>尚无发现</p>}>
                <For each={d().discoveredClues}>
                  {(clue) => (
                    <div class={styles.clueItem}>
                      <div class={styles.clueTitle}>✅ {clue.title}</div>
                      <div class={styles.dim} style={{ 'font-size': '0.82rem' }}>{clue.playerDescription}</div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </aside>

          {/* 消息历史 */}
          <div class={styles.msgPanel}>
            <div class={styles.panelHeader}><h3>对话记录（只读）</h3></div>
            <div class={styles.msgList}>
              <Show when={!messages.loading} fallback={<p class={styles.dim}>加载中...</p>}>
                <For each={messages()}>
                  {(m) => (
                    <div class={`${styles.msgItem} ${styles[`role_${m.role}`] ?? ''}`}>
                      <span class={styles.msgRole}>{ROLE_LABEL[m.role] ?? m.role}{m.displayName ? ` · ${m.displayName}` : ''}</span>
                      <p class={styles.msgText}>{m.content}</p>
                      <span class={styles.msgTime}>{new Date(m.timestamp).toLocaleString()}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default CampaignDetail;
