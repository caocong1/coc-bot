import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi, type CampaignSummary } from '../../api';
import styles from './Player.module.css';

const STATUS_LABEL: Record<string, string> = {
  running: '🟢 进行中',
  paused: '⏸️ 已暂停',
  ended: '⚫ 已结束',
};

const Campaigns: Component = () => {
  const [campaigns] = createResource(() => playerApi.listCampaigns().catch(() => []));

  return (
    <div>
      <Show when={!campaigns.loading} fallback={<p class={styles.dim}>加载中...</p>}>
        <Show when={(campaigns() ?? []).length > 0} fallback={
          <div class={styles.empty}>
            <p>还没有参与任何跑团</p>
            <p class={styles.dim} style={{ 'margin-top': '0.5rem' }}>在 QQ 群里跑团后，你的进度会出现在这里。</p>
          </div>
        }>
          <div class={styles.listSection}>
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
    <a href={`/player/campaigns?id=${c.id}`} class={styles.campaignCard}>
      <div class={styles.campaignTop}>
        <span class={styles.campaignStatus}>{STATUS_LABEL[c.status] ?? c.status}</span>
        <span class={styles.dim} style={{ 'font-size': '0.8rem' }}>群 #{c.groupId}</span>
      </div>
      <div class={styles.campaignScene}>{c.currentScene ?? '（无场景）'}</div>
      <div class={styles.campaignMeta}>
        开始：{new Date(c.startedAt).toLocaleDateString()}
        {c.endedAt && ` · 结束：${new Date(c.endedAt).toLocaleDateString()}`}
      </div>
    </a>
  );
};

export default Campaigns;
