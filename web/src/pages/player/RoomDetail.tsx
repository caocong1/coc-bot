import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi, type RoomDetail, type RoomMember, type CharacterSummary } from '../../api';
import styles from './Player.module.css';

const STATUS_LABEL: Record<string, string> = {
  waiting: '⏳ 等待中',
  running: '🟢 进行中',
  ended: '⚫ 已结束',
};

const RoomDetailPage: Component<{ id: string }> = (props) => {
  const [room, { refetch }] = createResource(() => playerApi.getRoom(props.id).catch(() => null));
  const [chars] = createResource(() => playerApi.listCharacters().catch(() => []));
  const [starting, setStarting] = createSignal(false);
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
      await playerApi.startRoom(props.id);
      setMsg('✅ 开团指令已发送，请查看 QQ 群！');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
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
    <Show when={!room.loading} fallback={<p class={styles.dim}>加载中...</p>}>
      <Show when={room()} fallback={<p class={styles.errorText}>房间不存在或无权访问</p>}>
        {(r) => (
          <div>
            {/* 头部信息 */}
            <div class={styles.detailHeader}>
              <div>
                <h2 style={{ margin: '0 0 0.25rem' }}>{r().name}</h2>
                <span class={styles.campaignStatus}>{STATUS_LABEL[r().status]}</span>
                {r().scenarioName && <span class={styles.dim} style={{ 'margin-left': '0.75rem' }}>模组：{r().scenarioName}</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button class={styles.btn} onClick={copyInvite}>📋 复制邀请指令</button>
                <Show when={r().isCreator && r().status === 'waiting'}>
                  <button
                    class={styles.btnPrimary}
                    onClick={startRoom}
                    disabled={starting()}
                    style={{ background: 'var(--success)' }}
                  >
                    {starting() ? '开团中...' : '🎲 开始跑团'}
                  </button>
                </Show>
                <Show when={r().isCreator}>
                  <button class={styles.btnDanger} onClick={() => deleteRoom()} disabled={deleting()}>删除</button>
                </Show>
              </div>
            </div>

            {/* 状态消息 */}
            <Show when={msg()}>
              <div class={styles.successBanner}>{msg()}</div>
            </Show>
            <Show when={err()}>
              <div class={styles.errorBanner}>{err()}</div>
            </Show>

            {/* 强制删除确认 */}
            <Show when={showDeleteConfirm()}>
              <div class={styles.confirmBox}>
                <p>⚠️ 跑团正在进行中，确认删除？此操作不可撤销。</p>
                <div style={{ display: 'flex', gap: '0.5rem', 'margin-top': '0.5rem' }}>
                  <button class={styles.btnDanger} onClick={() => deleteRoom(true)}>确认删除</button>
                  <button class={styles.btn} onClick={() => setShowDeleteConfirm(false)}>取消</button>
                </div>
              </div>
            </Show>

            {/* PC 合规性警告 */}
            <Show when={(r().warnings ?? []).length > 0}>
              <div class={styles.warnBanner}>
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
                  <button class={styles.btn} style={{ 'margin-top': '0.75rem', width: '100%' }} onClick={join} disabled={joining()}>
                    {joining() ? '加入中...' : '加入房间'}
                  </button>
                </Show>
              </div>

              {/* 我的 PC 选择 */}
              <div>
                <h3 style={{ margin: '0 0 0.75rem' }}>选择我的 PC</h3>
                <Show when={!chars.loading} fallback={<p class={styles.dim}>加载角色卡...</p>}>
                  <Show when={(chars() ?? []).length > 0} fallback={
                    <p class={styles.dim}>还没有角色卡，<a href="/player/characters/new">去新建</a></p>
                  }>
                    <div class={styles.charSelectList}>
                      <For each={chars()}>
                        {(c) => (
                          <button
                            class={styles.charSelectItem}
                            onClick={() => setCharacter(c.id)}
                          >
                            <div style={{ 'font-weight': 600 }}>{c.name}</div>
                            <div class={styles.dim} style={{ 'font-size': '0.8rem' }}>
                              {c.occupation ?? '未知职业'} · HP {c.hp ?? '?'} · SAN {c.san ?? '?'}
                            </div>
                          </button>
                        )}
                      </For>
                      <button class={styles.charSelectItem} style={{ color: 'var(--text-dim)' }} onClick={() => setCharacter(null)}>
                        取消选择
                      </button>
                    </div>
                  </Show>
                </Show>

                {/* 模组约束说明 */}
                <Show when={r().constraints && (r().constraints.era || (r().constraints.allowedOccupations?.length ?? 0) > 0 || r().constraints.minStats)}>
                  <div class={styles.constraintBox}>
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
          </div>
        )}
      </Show>
    </Show>
  );
};

const MemberRow: Component<{ member: RoomMember }> = (props) => {
  const m = props.member;
  return (
    <div class={styles.memberRow}>
      <div>
        <span style={{ 'font-weight': 600 }}>QQ {m.qqId}</span>
        {m.isCreator && <span class={styles.badge} style={{ 'margin-left': '0.4rem' }}>创建者</span>}
      </div>
      <div class={styles.dim} style={{ 'font-size': '0.85rem' }}>
        {m.character
          ? `${m.character.name}（${m.character.occupation ?? '?'}）HP ${m.character.hp ?? '?'} SAN ${m.character.san ?? '?'}`
          : '未选择角色卡'}
      </div>
    </div>
  );
};

export default RoomDetailPage;
