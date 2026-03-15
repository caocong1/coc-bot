import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi, type RoomSummary } from '../../api';

const STATUS_LABEL: Record<string, string> = {
  waiting: '⏳ 等待中',
  reviewing: '📋 审卡中',
  running: '🟢 进行中',
  ended: '⚫ 已结束',
};

const Rooms: Component = () => {
  const [rooms, { refetch }] = createResource(() => playerApi.listRooms().catch(() => []));
  const [modules] = createResource(() => playerApi.listModules().catch(() => []));
  const [showCreate, setShowCreate] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [form, setForm] = createSignal({ name: '', moduleId: '' });
  const [error, setError] = createSignal('');
  const archivedHint = new URLSearchParams(location.search).get('archived') === '1';

  const selectedModule = () => (modules() ?? []).find((m) => m.id === form().moduleId) ?? null;

  const createRoom = async () => {
    const f = form();
    if (!f.name.trim()) {
      setError('房间名不能为空');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await playerApi.createRoom({
        name: f.name.trim(),
        moduleId: f.moduleId || undefined,
      });
      setShowCreate(false);
      setForm({ name: '', moduleId: '' });
      location.href = `/player/rooms?id=${res.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div class="mb-5 rounded-2xl border border-accent/20 bg-accent/[0.07] px-4 py-4 text-[0.85rem] leading-6 text-text-dim shadow-sm shadow-black/10">
        <strong class="text-text">一个房间就是一场跑团。</strong> 从组队、绑卡、审卡到进行中的消息历史，都统一挂在房间下；旧的“我的团”入口已并回这里。
      </div>
      <Show when={archivedHint}>
        <div class="mb-5 rounded-2xl border border-warn/20 bg-warn/10 px-4 py-3 text-[0.84rem] text-text-dim">
          你访问的是旧的跑团记录链接。对应房间已归档或不再对玩家侧单独暴露，因此已为你回到房间列表。
        </div>
      </Show>
      <div class="flex justify-end mb-6 gap-3">
        <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => setShowCreate(!showCreate())}>
          {showCreate() ? '取消' : '＋ 创建房间'}
        </button>
      </div>

      <Show when={showCreate()}>
        <div class="bg-surface border border-border rounded-xl p-6 mb-6">
          <h3 style={{ margin: '0 0 1rem' }}>新建房间</h3>
          <label class="block text-[0.82rem] text-text-dim mt-3 mb-1 first:mt-0">房间名称 *</label>
          <input
            class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent"
            placeholder="例：与苏珊共进晚餐"
            value={form().name}
            onInput={(e) => setForm({ ...form(), name: e.currentTarget.value })}
          />
          <label class="block text-[0.82rem] text-text-dim mt-3 mb-1 first:mt-0">选择模组（选填）</label>
          <select
            class="w-full bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] focus:outline-none focus:border-accent"
            value={form().moduleId}
            onChange={(e) => setForm({ ...form(), moduleId: e.currentTarget.value })}
          >
            <option value="">— 不指定模组 —</option>
            <For each={modules() ?? []}>
              {(m) => <option value={m.id}>{m.name}{m.era ? ` [${m.era}]` : ''}</option>}
            </For>
          </select>
          {/* 选中模组后展示约束预览 */}
          <Show when={selectedModule()}>
            {(m) => (
              <div class="mt-3 rounded-xl border border-accent/25 bg-accent/[0.07] px-4 py-3 text-[0.82rem] shadow-sm shadow-black/10">
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div class="font-semibold text-text">将继承到房间的筛卡条件</div>
                  <span class="rounded-full border border-accent/20 bg-white/5 px-2.5 py-0.5 text-[0.72rem] text-accent">
                    创建后可再调整
                  </span>
                </div>
                <div class="text-text-dim mb-2">{m().description || '（无简介）'}</div>
                <div class="flex flex-col gap-1">
                  <Show when={m().allowedOccupations.length > 0} fallback={<div>职业限制：不限</div>}>
                    <div>职业限制：{m().allowedOccupations.join('、')}</div>
                  </Show>
                  <Show when={m().totalPoints != null} fallback={<div>主属性总点：不校验</div>}>
                    <div>主属性总点：{m().totalPoints}</div>
                  </Show>
                </div>
                <div class="mt-2 text-[0.75rem] text-text-dim">
                  房间创建后，房主仍可在房间详情里微调总点要求；这不会改动角色卡本身。
                </div>
              </div>
            )}
          </Show>
          <Show when={error()}>
            <p class="text-danger text-[0.88rem] my-2">{error()}</p>
          </Show>
          <button class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95" onClick={createRoom} disabled={creating()}>
            {creating() ? '创建中...' : '确认创建'}
          </button>
        </div>
      </Show>

      <Show when={!rooms.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(rooms() ?? []).length > 0} fallback={
          <div class="text-center py-16 px-8 text-text-dim">
            <p>还没有房间</p>
            <p class="text-text-dim" style={{ 'margin-top': '0.5rem' }}>
              点击「创建房间」发起一次跑团，或让 KP 分享房间 ID。
            </p>
          </div>
        }>
          <div class="flex flex-col gap-3">
            <For each={rooms()}>
              {(r) => <RoomCard room={r} onRefetch={refetch} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const RoomCard: Component<{ room: RoomSummary; onRefetch: () => void }> = (props) => {
  const r = props.room;
  return (
    <a href={`/player/rooms?id=${r.id}`} class="block bg-surface border border-border rounded-xl p-5 no-underline text-text transition-colors duration-150 hover:border-accent">
      <div class="flex justify-between mb-2">
        <span class="text-[0.85rem]">{STATUS_LABEL[r.status] ?? r.status}</span>
        {r.groupId && <span class="text-text-dim" style={{ 'font-size': '0.8rem' }}>群 #{r.groupId}</span>}
      </div>
      <div class="text-base font-semibold mb-1">{r.name}</div>
      <div class="text-[0.8rem] text-text-dim">
        {r.scenarioName ? `模组：${r.scenarioName} · ` : ''}
        {r.memberCount} 人参与 · 创建于 {new Date(r.createdAt).toLocaleDateString()}
        {r.isCreator && <span class="bg-accent-dim text-white text-[0.72rem] px-2 py-0.5 rounded-[10px]" style={{ 'margin-left': '0.5rem' }}>我创建</span>}
      </div>
    </a>
  );
};

export default Rooms;
