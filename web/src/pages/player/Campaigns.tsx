import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi, type CampaignSummary } from '../../api';

const STATUS_LABEL: Record<string, string> = {
  running: '🟢 进行中',
  paused: '⏸️ 已暂停',
  ended: '⚫ 已结束',
};

const Campaigns: Component = () => {
  const [campaigns] = createResource(() => playerApi.listCampaigns().catch(() => []));

  return (
    <div>
      <Show when={!campaigns.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(campaigns() ?? []).length > 0} fallback={
          <div class="text-center py-16 px-8 text-text-dim">
            <p>还没有参与任何跑团</p>
            <p class="text-text-dim" style={{ 'margin-top': '0.5rem' }}>在 QQ 群里跑团后，你的进度会出现在这里。</p>
          </div>
        }>
          <div class="flex flex-col gap-3">
            <For each={campaigns()}>
              {(c) => <CampaignCard campaign={c} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const CampaignCard: Component<{ campaign: CampaignSummary }> = (props) => {
  const c = props.campaign;
  return (
    <a href={`/player/campaigns?id=${c.id}`} class="block bg-surface border border-border rounded-xl p-5 no-underline text-text transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5">
      <div class="flex justify-between mb-2">
        <span class="text-sm">{STATUS_LABEL[c.status] ?? c.status}</span>
        <span class="text-text-dim" style={{ 'font-size': '0.8rem' }}>群 #{c.groupId}</span>
      </div>
      <div class="text-base font-semibold mb-1">{c.currentScene ?? '（无场景）'}</div>
      <div class="text-sm text-text-dim">
        开始：{new Date(c.startedAt).toLocaleDateString()}
        {c.endedAt && ` · 结束：${new Date(c.endedAt).toLocaleDateString()}`}
      </div>
    </a>
  );
};

export default Campaigns;
