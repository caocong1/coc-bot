import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi } from '../../api';
import styles from './Player.module.css';

const Scenarios: Component = () => {
  const [scenarios] = createResource(() => playerApi.listScenarios().catch(() => []));

  return (
    <div>
      <p class={styles.dim} style={{ 'margin-bottom': '1.5rem' }}>以下为系统中已导入的模组。详细剧情仅守秘人可见。</p>
      <Show when={!scenarios.loading} fallback={<p class={styles.dim}>加载中...</p>}>
        <Show when={(scenarios() ?? []).length > 0} fallback={<p class={styles.dim}>暂无可用模组</p>}>
          <div class={styles.scenarioGrid}>
            <For each={scenarios()}>
              {(s) => (
                <div class={styles.scenarioCard}>
                  <div class={styles.scenarioName}>{s.name}</div>
                  <div class={styles.dim}>{s.description || '暂无简介'}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default Scenarios;
