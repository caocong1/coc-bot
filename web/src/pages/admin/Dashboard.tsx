import { createResource, For, Show, type Component } from 'solid-js';
import { adminApi } from '../../api';
import type { AIProvider, AIFeatureBinding, RoutingPolicy } from '../../api';

const STATUS_LABEL: Record<string, string> = {
  running: '🟢 进行中',
  paused: '⏸️ 已暂停',
  ended: '⚫ 已结束',
};

const FEATURE_LABELS: Record<string, string> = {
  'kp.chat': 'KP 对话',
  'kp.guardrail': '护栏检查',
  'kp.opening': '开场生成',
  'kp.recap': '回顾摘要',
  'image.prompt': '图片提示词',
  'image.generate': '图片生成',
  'knowledge.embedding': '向量索引',
  'fun.jrrp': '人品',
  'fun.gugu': '占卜',
  'module.extract': '模组提取',
};

function unwrap<T>(res: { data: T } | T[] | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res as T[];
  return (res as { data: T }).data;
}

function featureRouteLabel(policy: RoutingPolicy, provMap: Map<string, AIProvider>): string {
  const fmt = (providerId: string, modelId: string) => {
    const prov = provMap.get(providerId);
    const provName = prov?.name.split(' ')[0] ?? providerId;
    const modelName = modelId.split(':')[1];
    return `${provName} / ${modelName}`;
  };
  if (policy.type === 'fallback') {
    return `${fmt(policy.primary.providerId, policy.primary.modelId)} → ${fmt(policy.fallback.providerId, policy.fallback.modelId)}`;
  }
  return fmt(policy.providerId, policy.modelId);
}

const Dashboard: Component = () => {
  const [sessions, { refetch }] = createResource(() => adminApi.listSessions().catch(() => []));

  const [rawProviders] = createResource(() =>
    adminApi.aiProviders.list().catch(() => ({ data: [] as AIProvider[] })),
  );
  const [rawFeatures] = createResource(() =>
    adminApi.aiProviders.listFeatures().catch(() => ({ data: [] as AIFeatureBinding[] })),
  );

  const running = () => (sessions() ?? []).filter((s) => s.status === 'running');
  const paused = () => (sessions() ?? []).filter((s) => s.status === 'paused');

  return (
    <div>
      <div class="flex gap-4 mb-8 flex-wrap">
        <Stat label="进行中的团" value={running().length} color="var(--color-success)" />
        <Stat label="暂停中的团" value={paused().length} color="var(--color-warn)" />
        <Stat label="总团数" value={(sessions() ?? []).length} color="var(--color-accent)" />
      </div>

      {/* AI 配置区块 */}
      <Show when={!rawProviders.loading && !rawFeatures.loading}>
        {() => {
          const provs = unwrap<AIProvider>(rawProviders());
          const feats = unwrap<AIFeatureBinding>(rawFeatures());
          const provMap = new Map(provs.map(p => [p.id, p]));
          return (
          <div class="mb-8 bg-surface border border-border rounded-lg p-5 shadow-sm shadow-black/10">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-base font-semibold">AI 配置</h2>
              <a href="/admin/ai-providers"
                class="px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-all">
                管理 AI Provider →
              </a>
            </div>

            {/* Feature → Provider / Model 路由 */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <For each={feats}>
                {(b) => (
                  <div class="flex justify-between items-center px-3 py-2 rounded bg-white/[0.02] border border-border/50">
                    <span class="text-xs text-text-dim">{FEATURE_LABELS[b.feature] ?? b.feature}</span>
                    <span class="text-xs font-mono text-accent">{featureRouteLabel(b.routingPolicy, provMap)}</span>
                  </div>
                )}
              </For>
            </div>

            {/* Providers */}
            <div class="flex flex-wrap gap-2">
              <For each={provs}>
                {(p) => (
                  <span class="px-2.5 py-1 text-xs rounded border border-border bg-white/[0.02]">
                    {p.name}
                    {p.enabled === false && <span class="text-red-400 ml-1">[已禁用]</span>}
                  </span>
                )}
              </For>
            </div>
          </div>
          );
        }}
      </Show>

      <div class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold">所有跑团</h2>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={refetch}>刷新</button>
        </div>
        <Show when={!sessions.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <Show when={(sessions() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无跑团记录</p>}>
            <div class="bg-surface border border-border rounded-lg overflow-x-auto shadow-sm shadow-black/10">
              <div class="grid gap-2 px-4 py-2.5 items-center text-xs bg-white/[0.03] text-text-dim uppercase tracking-wider border-b border-border min-w-[700px]" style={{ 'grid-template-columns': '1fr 1fr 1.5fr 1fr 0.7fr 0.7fr 1.2fr' }}>
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
  <div class="bg-surface border border-border border-l-4 rounded-lg px-4 py-3 md:px-6 md:py-4 min-w-[140px] shadow-sm shadow-black/10 hover:-translate-y-0.5 transition-all duration-200" style={{ 'border-left-color': props.color }}>
    <div class="text-4xl font-bold" style={{ color: props.color }}>{props.value}</div>
    <div class="text-text-dim text-sm mt-1">{props.label}</div>
  </div>
);

const SessionRow: Component<{ session: SessionInfo; onAction: () => void }> = (props) => {
  const s = props.session;
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); props.onAction(); } catch (e) { alert(String(e)); }
  };

  return (
    <div class="grid gap-2 px-4 py-2.5 items-center text-sm border-t border-border/50 hover:bg-white/[0.02] transition-colors min-w-[700px]" style={{ 'grid-template-columns': '1fr 1fr 1.5fr 1fr 0.7fr 0.7fr 1.2fr' }}>
      <span class="font-mono">#{s.groupId}</span>
      <span>{STATUS_LABEL[s.status] ?? s.status}</span>
      <span>{s.currentScene ?? '—'}</span>
      <span>{s.kpTemplate}</span>
      <span>{s.messageCount}</span>
      <span>{s.segmentCount > 0 ? `${s.segmentCount} 段` : '—'}</span>
      <span class="flex gap-1.5 flex-wrap">
        {s.status === 'running' && (
          <button class="px-2.5 py-1 bg-warn text-[#1a1a1a] border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => act(() => adminApi.pauseSession(s.groupId))}>暂停</button>
        )}
        {s.status === 'paused' && (
          <button class="px-2.5 py-1 bg-success text-[#1a1a1a] border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => act(() => adminApi.resumeSession(s.groupId))}>继续</button>
        )}
        {(s.status === 'running' || s.status === 'paused') && (
          <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => {
            if (confirm('确定结束本跑团？')) act(() => adminApi.stopSession(s.groupId));
          }}>结束</button>
        )}
        <a href="/admin/rooms" class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200">房间管理</a>
      </span>
    </div>
  );
};

export default Dashboard;
