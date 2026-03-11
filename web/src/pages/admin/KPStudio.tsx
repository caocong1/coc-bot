import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi, type KpTemplate } from '../../api';
import styles from './Admin.module.css';

const KPStudio: Component = () => {
  const [templates] = createResource(() => adminApi.listKpTemplates().catch(() => []));
  const [selected, setSelected] = createSignal<KpTemplate | null>(null);

  const sessions$ = createResource(() => adminApi.listSessions().catch(() => []));
  const runningSessions = () => (sessions$[0]() ?? []).filter((s) => s.status === 'running');

  return (
    <div class={styles.studioGrid}>
      {/* 模板选择 */}
      <div class={styles.panel}>
        <div class={styles.panelHeader}><h3>KP 人格模板</h3></div>
        <Show when={!templates.loading} fallback={<p class={styles.dim}>加载中...</p>}>
          <For each={templates()}>
            {(t) => (
              <div
                class={`${styles.templateCard} ${selected()?.id === t.id ? styles.selectedCard : ''}`}
                onClick={() => setSelected(t)}
              >
                <div class={styles.templateName}>{t.name}</div>
                <div class={styles.templateDesc}>{t.description}</div>
                <div class={styles.bars}>
                  <Bar label="幽默" value={t.humorLevel} />
                  <Bar label="严格" value={t.rulesStrictness} />
                  <Bar label="灵活" value={t.narrativeFlexibility} />
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* 当前 session 切换模板 */}
      <div class={styles.panel}>
        <div class={styles.panelHeader}><h3>应用到跑团</h3></div>
        <Show when={selected()} fallback={<p class={styles.dim}>先从左侧选择一个模板</p>}>
          <p style={{ 'margin-bottom': '1rem' }}>
            选中模板：<strong>{selected()?.name}</strong>
          </p>
          <Show when={runningSessions().length > 0} fallback={<p class={styles.dim}>暂无进行中的跑团</p>}>
            <For each={runningSessions()}>
              {(s) => (
                <div class={styles.sessionCard}>
                  <span>群 #{s.groupId} — {s.currentScene ?? '无场景'}</span>
                  <button
                    class={styles.btn}
                    onClick={async () => {
                      // 目前通过注入信息的方式让 KP 知晓模板切换
                      // 后续可扩展为直接修改 session 的 kp_template_id
                      await adminApi.injectInfo(s.groupId,
                        `[KP 人格已切换为「${selected()!.name}」风格]`,
                      ).catch((e) => alert(String(e)));
                      alert('✅ 已注入人格切换提示');
                    }}
                  >
                    应用
                  </button>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <div class={styles.panelHeader} style={{ 'margin-top': '2rem' }}><h3>layerStats 调试</h3></div>
        <p class={styles.dim}>layerStats 记录在后端日志中，查看 Bot 控制台输出（含各层 token 数）。</p>
      </div>
    </div>
  );
};

const Bar: Component<{ label: string; value: number }> = (props) => (
  <div class={styles.barRow}>
    <span class={styles.barLabel}>{props.label}</span>
    <div class={styles.barTrack}>
      <div class={styles.barFill} style={{ width: `${props.value * 10}%` }} />
    </div>
    <span class={styles.barVal}>{props.value}/10</span>
  </div>
);

export default KPStudio;
