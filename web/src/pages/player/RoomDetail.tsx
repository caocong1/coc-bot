import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi, type RoomDetail, type RoomMember, type CharacterSummary, type Message } from '../../api';

const STATUS_LABEL: Record<string, string> = {
  waiting: '⏳ 等待中',
  reviewing: '📋 审卡中',
  running: '🟢 进行中',
  ended: '⚫ 已结束',
};

const RoomDetailPage: Component<{ id: string }> = (props) => {
  const [room, { refetch }] = createResource(() => playerApi.getRoom(props.id).catch(() => null));
  const [chars] = createResource(() => playerApi.listCharacters().catch(() => []));
  const [roomTime] = createResource(
    () => room()?.status === 'running' ? props.id : null,
    (id) => id ? playerApi.getRoomTime(id).then((r) => r.ingameTime).catch(() => null) : null,
  );
  const [starting, setStarting] = createSignal(false);
  const [readying, setReadying] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);

  const myQqId = () => {
    // 从 room members 里找自己（通过 isCreator 或 character player_id 无法直接知道，
    // 所以先 join 确保在里面，然后通过 /me 获取）
    return null; // 简化：通过 join/setChar 操作时后端会用 token 识别
  };

  const isMember = () => {
    const r = room();
    if (!r) return false;
    return r.members.length > 0; // 展示所有人，join 后刷新
  };

  const join = async () => {
    setJoining(true);
    setErr('');
    try {
      await playerApi.joinRoom(props.id);
      await refetch();
      setMsg('已加入房间');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setJoining(false);
    }
  };

  const setCharacter = async (characterId: string | null) => {
    setErr('');
    try {
      await playerApi.setRoomCharacter(props.id, characterId);
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const startRoom = async () => {
    setStarting(true);
    setErr('');
    setMsg('');
    try {
      const res = await playerApi.startRoom(props.id);
      setMsg(res.summary || '📋 已进入审卡阶段，所有玩家请确认准备');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const readyRoom = async () => {
    setReadying(true);
    setErr('');
    setMsg('');
    try {
      const res = await playerApi.readyRoom(props.id);
      if (res.allReady) {
        setMsg('✅ 所有玩家已准备，开团中...');
      } else {
        setMsg(`✅ 已确认准备（${res.readyCount}/${res.total}）`);
      }
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setReadying(false);
    }
  };

  const cancelReviewRoom = async () => {
    setCancelling(true);
    setErr('');
    setMsg('');
    try {
      await playerApi.cancelReview(props.id);
      setMsg('已取消审卡，回到等待状态');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const deleteRoom = async (force = false) => {
    setDeleting(true);
    setErr('');
    try {
      await playerApi.deleteRoom(props.id, force);
      location.href = '/player/rooms';
    } catch (e: unknown) {
      const err = e as Error & { isRunning?: boolean };
      if (err.message?.includes('确认删除')) {
        setShowDeleteConfirm(true);
      } else {
        setErr(err.message);
      }
    } finally {
      setDeleting(false);
    }
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(`.web room ${props.id}`).then(() => {
      setMsg('✅ 邀请指令已复制，发送到 QQ 私聊即可获取链接');
    });
  };

  return (
    <Show when={!room.loading} fallback={<p class="text-text-dim">加载中...</p>}>
      <Show when={room()} fallback={<p class="text-danger text-[0.88rem] my-2">房间不存在或无权访问</p>}>
        {(r) => (
          <div>
            {/* 头部信息 */}
            <div class="flex justify-between items-start mb-4 flex-wrap gap-3">
              <div>
                <h2 style={{ margin: '0 0 0.25rem' }}>{r().name}</h2>
                <span class="text-[0.85rem]">{STATUS_LABEL[r().status]}</span>
                {r().scenarioName && <span class="text-text-dim" style={{ 'margin-left': '0.75rem' }}>模组：{r().scenarioName}</span>}
                <Show when={roomTime()}>
                  <span style={{ 'margin-left': '0.75rem', color: 'var(--accent, #7c6af7)', 'font-weight': 600 }}>
                    游戏时间：{roomTime()}
                  </span>
                </Show>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
                <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={copyInvite}>📋 复制邀请指令</button>
                <Show when={r().status === 'waiting'}>
                  <button
                    class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95"
                    onClick={startRoom}
                    disabled={starting()}
                    style={{ background: 'var(--success)' }}
                  >
                    {starting() ? '审卡中...' : '📋 开始审卡'}
                  </button>
                </Show>
                <Show when={r().status === 'reviewing'}>
                  <button
                    class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95"
                    onClick={readyRoom}
                    disabled={readying()}
                  >
                    {readying() ? '确认中...' : '✅ 确认准备'}
                  </button>
                  <button
                    class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                    onClick={cancelReviewRoom}
                    disabled={cancelling()}
                  >
                    {cancelling() ? '取消中...' : '取消审卡'}
                  </button>
                </Show>
                <Show when={r().isCreator && (r().status === 'waiting' || r().status === 'reviewing')}>
                  <button class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => deleteRoom()} disabled={deleting()}>删除</button>
                </Show>
              </div>
            </div>

            {/* 状态消息 */}
            <Show when={msg()}>
              <div class="bg-success/[0.12] border border-success rounded-md px-4 py-3 text-success mb-4">{msg()}</div>
            </Show>
            <Show when={err()}>
              <div class="bg-danger/15 border border-danger rounded-md px-4 py-3 text-danger mb-6">{err()}</div>
            </Show>

            {/* 强制删除确认 */}
            <Show when={showDeleteConfirm()}>
              <div class="bg-danger/10 border border-danger rounded-md px-4 py-3 mb-4 text-[0.88rem]">
                <p>⚠️ 跑团正在进行中，确认删除？此操作不可撤销。</p>
                <div style={{ display: 'flex', gap: '0.5rem', 'margin-top': '0.5rem' }}>
                  <button class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => deleteRoom(true)}>确认删除</button>
                  <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => setShowDeleteConfirm(false)}>取消</button>
                </div>
              </div>
            </Show>

            {/* PC 合规性警告 */}
            <Show when={(r().warnings ?? []).length > 0}>
              <div class="bg-warn/10 border border-warn rounded-md px-4 py-3 mb-4 text-[0.88rem]">
                <strong>⚠️ 合规性提示：</strong>
                <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                  <For each={r().warnings}>
                    {(w) => <li>{w}</li>}
                  </For>
                </ul>
              </div>
            </Show>

            <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '1.5rem', 'margin-top': '1rem' }}>
              {/* 成员列表 */}
              <div>
                <h3 style={{ margin: '0 0 0.75rem' }}>成员 ({r().members.length})</h3>
                <For each={r().members}>
                  {(m) => <MemberRow member={m} />}
                </For>
                <Show when={r().status === 'waiting'}>
                  <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ 'margin-top': '0.75rem', width: '100%' }} onClick={join} disabled={joining()}>
                    {joining() ? '加入中...' : '加入房间'}
                  </button>
                </Show>
              </div>

              {/* 我的 PC 选择 */}
              <div>
                <h3 style={{ margin: '0 0 0.75rem' }}>选择我的 PC</h3>
                <Show when={!chars.loading} fallback={<p class="text-text-dim">加载角色卡...</p>}>
                  <Show when={(chars() ?? []).length > 0} fallback={
                    <p class="text-text-dim">还没有角色卡，<a href="/player/characters/new">去新建</a></p>
                  }>
                    <div class="flex flex-col gap-2">
                      <For each={chars()}>
                        {(c) => (
                          <button
                            class="text-left bg-surface border border-border rounded-lg px-4 py-3 cursor-pointer text-text w-full hover:border-accent transition-colors"
                            onClick={() => setCharacter(c.id)}
                          >
                            <div style={{ 'font-weight': 600 }}>{c.name}</div>
                            <div class="text-text-dim" style={{ 'font-size': '0.8rem' }}>
                              {c.occupation ?? '未知职业'} · HP {c.hp ?? '?'} · SAN {c.san ?? '?'}
                            </div>
                          </button>
                        )}
                      </For>
                      <button class="text-left bg-surface border border-border rounded-lg px-4 py-3 cursor-pointer text-text w-full hover:border-accent transition-colors" style={{ color: 'var(--text-dim)' }} onClick={() => setCharacter(null)}>
                        取消选择
                      </button>
                    </div>
                  </Show>
                </Show>

                {/* 模组约束说明 */}
                <Show when={r().constraints && (r().constraints.era || (r().constraints.allowedOccupations?.length ?? 0) > 0 || r().constraints.minStats)}>
                  <div class="mt-5 bg-accent/[0.07] border border-accent/25 rounded-lg px-4 py-3 text-sm flex flex-col gap-1">
                    <strong>模组要求</strong>
                    <Show when={r().constraints.era}>
                      <div>时代：{r().constraints.era}</div>
                    </Show>
                    <Show when={(r().constraints.allowedOccupations?.length ?? 0) > 0}>
                      <div>职业：{r().constraints.allowedOccupations?.join('、')}</div>
                    </Show>
                    <Show when={r().constraints.minStats}>
                      <div>
                        最低属性：{Object.entries(r().constraints.minStats ?? {}).map(([k, v]) => `${k}≥${v}`).join(' ')}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>

            {/* 跑团记录 */}
            <Show when={r().status === 'running' || r().status === 'ended'}>
              <RoomMessages roomId={props.id} />
            </Show>
          </div>
        )}
      </Show>
    </Show>
  );
};

const RoomMessages: Component<{ roomId: string }> = (props) => {
  const [messages, { refetch }] = createResource(() =>
    playerApi.getRoomMessages(props.roomId).catch(() => []),
  );

  return (
    <div style={{ 'margin-top': '1.5rem' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '0.75rem' }}>
        <h3 style={{ margin: 0 }}>跑团记录</h3>
        <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={refetch}>刷新</button>
      </div>
      <Show when={!messages.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(messages() ?? []).length > 0} fallback={<p class="text-text-dim">暂无消息记录</p>}>
          <div style={{
            background: 'var(--surface, #1e1e2e)', border: '1px solid var(--border, #333)',
            'border-radius': '8px', padding: '0.75rem', 'max-height': '400px', 'overflow-y': 'auto',
          }}>
            <For each={messages()}>
              {(m: Message) => (
                <div style={{
                  padding: '0.35rem 0', 'border-bottom': '1px solid rgba(255,255,255,0.05)',
                  'font-size': '0.85rem',
                }}>
                  <span style={{
                    'font-weight': 600, 'margin-right': '0.5rem',
                    color: m.role === 'kp' ? 'var(--accent, #7c6af7)' : 'var(--text-dim, #999)',
                  }}>
                    {m.role === 'kp' ? 'KP' : m.displayName ?? m.role}
                  </span>
                  <span style={{ 'white-space': 'pre-wrap', 'word-break': 'break-word' }}>{m.content}</span>
                  <span style={{ 'font-size': '0.72rem', color: 'var(--text-dim, #666)', 'margin-left': '0.5rem' }}>
                    {new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const MemberRow: Component<{ member: RoomMember }> = (props) => {
  const m = props.member;
  return (
    <div class="bg-surface border border-border rounded-lg px-4 py-3 mb-2">
      <div>
        <span style={{ 'font-weight': 600 }}>QQ {m.qqId}</span>
        {m.isCreator && <span class="bg-accent-dim text-white text-[0.72rem] px-2 py-0.5 rounded-[10px]" style={{ 'margin-left': '0.4rem' }}>创建者</span>}
        {m.readyAt && <span class="bg-accent-dim text-white text-[0.72rem] px-2 py-0.5 rounded-[10px]" style={{ 'margin-left': '0.4rem', background: 'var(--success, #22c55e)', color: '#fff' }}>✅ 已准备</span>}
      </div>
      <div class="text-text-dim" style={{ 'font-size': '0.85rem' }}>
        {m.character
          ? `${m.character.name}（${m.character.occupation ?? '?'}）HP ${m.character.hp ?? '?'} SAN ${m.character.san ?? '?'}`
          : '未选择角色卡'}
      </div>
    </div>
  );
};

export default RoomDetailPage;
