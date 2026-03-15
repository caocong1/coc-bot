import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi, type ScenarioSummary } from '../../api';

const Scenarios: Component = () => {
  const [modules] = createResource(() => playerApi.listModules().catch(() => []));

  return (
    <div>
      <p class="text-text-dim" style={{ 'margin-bottom': '1.5rem' }}>
        以下为系统中已导入的模组。剧情细节由守秘人在跑团中逐步呈现。
      </p>
      <Show when={!modules.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(modules() ?? []).length > 0} fallback={<p class="text-text-dim">暂无可用模组</p>}>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            <For each={modules()}>
              {(m) => <ModuleCard module={m} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const ModuleCard: Component<{ module: ScenarioSummary }> = (props) => {
  const m = props.module;
  return (
    <div class="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2 shadow-sm shadow-black/10 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5">
      <div class="text-base font-semibold">{m.name}</div>
      <Show when={m.era}>
        <span class="bg-accent-dim text-white text-[0.72rem] py-[0.15em] px-2 rounded-[10px] inline-block mb-2">{m.era}</span>
      </Show>
      <div class="text-text-dim" style={{ 'font-size': '0.85rem' }}>{m.description || '暂无简介'}</div>
      <Show when={m.allowedOccupations.length > 0 || m.totalPoints != null}>
        <div style={{ 'margin-top': '0.5rem', 'font-size': '0.78rem', color: 'var(--text-dim)' }}>
          <Show when={m.allowedOccupations.length > 0}>
            <div>职业限制：{m.allowedOccupations.join('、')}</div>
          </Show>
          <Show when={m.totalPoints != null}>
            <div>总点要求：{m.totalPoints}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default Scenarios;
