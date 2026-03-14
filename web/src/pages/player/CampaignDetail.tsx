import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi } from '../../api';

const ROLE_LABEL: Record<string, string> = {
  kp: '🎭 KP',
  player: '🧑 玩家',
  dice: '🎲 骰子',
  system: '⚙️ 系统',
};

const roleClass = (role: string) => {
  if (role === 'kp') return 'border-l-2 border-accent';
  if (role === 'dice') return 'border-l-2 border-warn';
  return '';
};

const CampaignDetail: Component<{ id: string }> = (props) => {
  const [detail] = createResource(() => playerApi.getCampaign(props.id).catch(() => null));
  const [messages] = createResource(() => playerApi.getCampaignMessages(props.id).catch(() => []));

  return (
    <Show when={!detail.loading && detail()} fallback={<p class="text-text-dim">加载中...</p>}>
      {(d) => (
        <div class="grid grid-cols-[300px_1fr] gap-6 h-[calc(100vh-130px)]">
          {/* 侧边栏：基本信息 + 线索 */}
          <aside class="flex flex-col gap-4 overflow-y-auto">
            <div class="bg-surface border border-border rounded-lg p-4 shadow-sm shadow-black/10">
              <h3 class="text-sm font-semibold mb-2 text-text-dim">场景</h3>
              <p class="text-[0.88rem]">{d().currentScene?.name ?? '（无场景）'}</p>
              <Show when={d().currentScene?.activeNpcs?.length}>
                <p class="text-text-dim">在场 NPC：{d().currentScene!.activeNpcs.join('、')}</p>
              </Show>
            </div>

            <div class="bg-surface border border-border rounded-lg p-4 shadow-sm shadow-black/10">
              <h3 class="text-sm font-semibold mb-2 text-text-dim">参与调查员</h3>
              <For each={d().players}>
                {(p) => <p class="text-text-dim">QQ {p.qqId}</p>}
              </For>
            </div>

            <div class="bg-surface border border-border rounded-lg p-4 shadow-sm shadow-black/10">
              <h3 class="text-sm font-semibold mb-2 text-text-dim">已发现线索</h3>
              <Show when={d().discoveredClues.length > 0} fallback={<p class="text-text-dim">尚无发现</p>}>
                <For each={d().discoveredClues}>
                  {(clue) => (
                    <div class="py-2 border-t border-border first:border-t-0">
                      <div class="font-semibold text-[0.88rem] mb-0.5">✅ {clue.title}</div>
                      <div class="text-text-dim" style={{ 'font-size': '0.82rem' }}>{clue.playerDescription}</div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </aside>

          {/* 消息历史 */}
          <div class="bg-surface border border-border rounded-lg flex flex-col overflow-hidden shadow-sm shadow-black/10">
            <div class="px-4 py-3 border-b border-border bg-white/[0.02]"><h3 class="text-[0.88rem] font-semibold">对话记录（只读）</h3></div>
            <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              <Show when={!messages.loading} fallback={<p class="text-text-dim">加载中...</p>}>
                <For each={messages()}>
                  {(m) => (
                    <div class={`p-2 rounded-md bg-white/[0.03] ${roleClass(m.role)}`}>
                      <span class="block text-[0.72rem] text-text-dim mb-0.5">{ROLE_LABEL[m.role] ?? m.role}{m.displayName ? ` · ${m.displayName}` : ''}</span>
                      <p class="text-[0.88rem] whitespace-pre-wrap">{m.content}</p>
                      <span class="block text-[0.68rem] text-text-dim mt-1">{new Date(m.timestamp).toLocaleString()}</span>
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
