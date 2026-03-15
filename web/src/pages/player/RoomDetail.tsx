import { createEffect, createMemo, createResource, createSignal, For, Show, type Component } from 'solid-js';
import {
  playerApi,
  type CharacterSummary,
  type RoomConstraints,
  type RoomDetail,
  type RoomRelationType,
  type RoomRelationship,
} from '../../api';
import {
  RoomHeaderHero,
  RoomMembersPanel,
  RoomMessagesPanel,
  RoomRelationshipsPanel,
  RoomTabsBar,
  type RoomTab,
  getFitIssuesFromSummary,
} from '../../components/room/RoomDetailShared';

const RoomDetailPage: Component<{ id: string }> = (props) => {
  const [room, { refetch }] = createResource(() => playerApi.getRoom(props.id).catch(() => null));
  const [chars] = createResource(() => playerApi.listCharacters().catch(() => []));
  const [me] = createResource(() => playerApi.getMe().catch(() => null));

  const initialTab = () => {
    const queryTab = new URLSearchParams(location.search).get('tab');
    return queryTab === 'messages' ? 'messages' : 'overview';
  };

  const [activeTab, setActiveTab] = createSignal<RoomTab>(initialTab());
  const [readying, setReadying] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [savingRelation, setSavingRelation] = createSignal(false);
  const [savingConstraints, setSavingConstraints] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [roomTotalPointsText, setRoomTotalPointsText] = createSignal('');
  const [relationTarget, setRelationTarget] = createSignal('');
  const [relationType, setRelationType] = createSignal<RoomRelationType>('acquainted');
  const [relationNotes, setRelationNotes] = createSignal('');

  createEffect(() => {
    const queryTab = new URLSearchParams(location.search).get('tab');
    if (queryTab === 'messages' || queryTab === 'overview') {
      setActiveTab(queryTab);
    }
  });

  createEffect(() => {
    const totalPoints = room()?.constraints?.totalPoints;
    setRoomTotalPointsText(totalPoints != null ? String(totalPoints) : '');
  });

  const hasMessageHistory = createMemo(() => {
    const status = room()?.status;
    return status === 'running' || status === 'ended' || status === 'paused';
  });
  const readyCount = createMemo(() => room()?.members.filter((member) => member.readyAt).length ?? 0);

  createEffect(() => {
    if (!hasMessageHistory() && activeTab() === 'messages') {
      setActiveTab('overview');
    }
  });

  const syncTab = (tab: RoomTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set('id', props.id);
    if (tab === 'messages') params.set('tab', 'messages');
    else params.delete('tab');
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };

  const isMember = createMemo(() => {
    const r = room();
    const qqId = me()?.qqId;
    if (!r || !qqId) return false;
    return r.members.some((member) => member.qqId === qqId);
  });

  const mySelectedCharacterId = createMemo(() => {
    const qqId = me()?.qqId;
    const detail = room();
    if (!qqId || !detail) return null;
    return detail.members.find((member) => member.qqId === qqId)?.character?.id ?? null;
  });

  const selectedCharacter = createMemo(() => {
    const selectedId = mySelectedCharacterId();
    return (chars() ?? []).find((character) => character.id === selectedId) ?? null;
  });

  const selectedCharacterIssues = createMemo(() => {
    const character = selectedCharacter();
    return character ? getCharacterFitIssues(character, room()?.constraints) : [];
  });

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
      const err = e as Error;
      if (err.message?.includes('确认删除')) {
        setShowDeleteConfirm(true);
      } else {
        setErr(err.message);
      }
    } finally {
      setDeleting(false);
    }
  };

  const saveRelationship = async () => {
    const targetQqId = Number(relationTarget().trim());
    if (!Number.isFinite(targetQqId) || targetQqId <= 0) {
      setErr('请输入有效的目标 QQ 号');
      return;
    }
    setSavingRelation(true);
    setErr('');
    setMsg('');
    try {
      await playerApi.setRoomRelationship(props.id, {
        targetQqId,
        relationType: relationType(),
        notes: relationNotes().trim(),
      });
      setMsg('已更新人物关系');
      setRelationNotes('');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRelation(false);
    }
  };

  const clearRelationship = async (relation: RoomRelationship) => {
    const myQqId = me()?.qqId;
    const target = myQqId && relation.userA === myQqId ? relation.userB : relation.userA;
    setSavingRelation(true);
    setErr('');
    setMsg('');
    try {
      await playerApi.deleteRoomRelationship(props.id, target);
      setMsg('已清除人物关系');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRelation(false);
    }
  };

  const saveRoomConstraints = async () => {
    const current = room();
    if (!current) return;
    const raw = roomTotalPointsText().trim();
    const totalPoints = raw ? Number(raw) : null;
    if (raw && (!Number.isFinite(totalPoints) || totalPoints <= 0 || !Number.isInteger(totalPoints))) {
      setErr('总点要求必须是正整数，或留空');
      return;
    }
    setSavingConstraints(true);
    setErr('');
    setMsg('');
    try {
      await playerApi.updateRoomConstraints(props.id, {
        scenarioName: current.scenarioName ?? undefined,
        constraints: {
          ...current.constraints,
          totalPoints,
        },
      });
      setMsg('已更新房间总点要求');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingConstraints(false);
    }
  };

  const canClearRelationship = (relation: RoomRelationship) => {
    const myQqId = me()?.qqId;
    return Boolean(myQqId && (relation.userA === myQqId || relation.userB === myQqId));
  };

  return (
    <Show when={!room.loading} fallback={<p class="text-text-dim">加载中...</p>}>
      <Show when={room()} fallback={<p class="text-danger text-[0.88rem] my-2">房间不存在或无权访问</p>}>
        {(r) => (
          <div>
            <RoomHeaderHero
              name={r().name}
              status={r().status}
              scenarioName={r().scenarioName}
              ingameTime={r().runtime?.ingameTime ?? null}
              memberCount={r().members.length}
              readyCount={readyCount()}
              groupId={r().groupId}
              identityLabel={r().isCreator ? '房主' : '成员'}
              description="一个房间就是一场跑团。你可以在这里完成组队、绑卡、审卡、查看消息历史和设定人物关系，不需要再跳到别的对象里看跑团记录。"
              footerNote="房间本身就是这次跑团的唯一入口。这里的选卡和关系只影响当前房间；角色卡本身仍然可以在别的房间复用。"
              actions={
                <>
                  <Show when={r().status === 'reviewing'}>
                    <button
                      class="inline-block px-5 py-2 bg-accent text-white border border-transparent rounded-md text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85 transition-all duration-200 active:scale-95"
                      onClick={readyRoom}
                      disabled={readying()}
                    >
                      {readying() ? '确认中...' : '✅ 确认准备'}
                    </button>
                    <button
                      class="inline-block px-5 py-2 bg-white/[0.08] text-text border border-white/[0.08] rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                      onClick={cancelReviewRoom}
                      disabled={cancelling()}
                    >
                      {cancelling() ? '取消中...' : '取消审卡'}
                    </button>
                  </Show>
                  <Show when={r().isCreator && (r().status === 'waiting' || r().status === 'reviewing')}>
                    <button class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => deleteRoom()} disabled={deleting()}>
                      删除
                    </button>
                  </Show>
                  <Show when={r().status === 'waiting' && !isMember()}>
                    <button class="inline-block px-5 py-2 bg-white/[0.08] text-text border border-white/[0.08] rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={join} disabled={joining()}>
                      {joining() ? '加入中...' : '加入房间'}
                    </button>
                  </Show>
                </>
              }
            />

            <Show when={msg()}>
              <div class="bg-success/[0.12] border border-success rounded-md px-4 py-3 text-success mb-4">{msg()}</div>
            </Show>
            <Show when={err()}>
              <div class="bg-danger/15 border border-danger rounded-md px-4 py-3 text-danger mb-6">{err()}</div>
            </Show>
            <Show when={showDeleteConfirm()}>
              <div class="bg-danger/10 border border-danger rounded-md px-4 py-3 mb-4 text-[0.88rem]">
                <p>⚠️ 跑团正在进行中，确认删除？此操作不可撤销。</p>
                <div style={{ display: 'flex', gap: '0.5rem', 'margin-top': '0.5rem' }}>
                  <button class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => deleteRoom(true)}>确认删除</button>
                  <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 transition-all duration-200 active:scale-95" onClick={() => setShowDeleteConfirm(false)}>取消</button>
                </div>
              </div>
            </Show>
            <Show when={(r().warnings ?? []).length > 0}>
              <div class="bg-warn/10 border border-warn rounded-md px-4 py-3 mb-4 text-[0.88rem]">
                <strong>⚠️ 合规性提示：</strong>
                <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                  <For each={r().warnings}>{(warning) => <li>{warning}</li>}</For>
                </ul>
              </div>
            </Show>

            <Show when={hasMessageHistory()}>
              <RoomTabsBar activeTab={activeTab()} onChange={syncTab} />
            </Show>

            <Show when={activeTab() === 'overview'}>
              <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-4">
                <RoomMembersPanel members={r().members} constraints={r().constraints} readyCount={readyCount()} />
                <PlayerCharacterPanel
                  room={r()}
                  chars={chars() ?? []}
                  selectedCharacter={selectedCharacter()}
                  selectedCharacterIssues={selectedCharacterIssues()}
                  mySelectedCharacterId={mySelectedCharacterId()}
                  onSelectCharacter={setCharacter}
                  roomTotalPointsText={roomTotalPointsText()}
                  onRoomTotalPointsTextChange={setRoomTotalPointsText}
                  onSaveRoomConstraints={saveRoomConstraints}
                  savingConstraints={savingConstraints()}
                />
              </div>

              <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
                <RoomRelationshipsPanel
                  relationships={r().relationships}
                  relationTarget={relationTarget()}
                  onRelationTargetChange={setRelationTarget}
                  relationType={relationType()}
                  onRelationTypeChange={setRelationType}
                  relationNotes={relationNotes()}
                  onRelationNotesChange={setRelationNotes}
                  onSave={saveRelationship}
                  onClear={clearRelationship}
                  canClear={canClearRelationship}
                  saving={savingRelation()}
                  helperText="开场与中途推进会优先参考这里的已确认人物关系。玩家与房主都可以在房间内维护这些关系。"
                />
                <RoomConceptPanel room={r()} />
              </div>
            </Show>

            <Show when={hasMessageHistory() && activeTab() === 'messages'}>
              <RoomMessagesPanel roomId={props.id} fetchMessages={playerApi.getRoomMessages} />
            </Show>
          </div>
        )}
      </Show>
    </Show>
  );
};

const PlayerCharacterPanel: Component<{
  room: RoomDetail;
  chars: CharacterSummary[];
  selectedCharacter: CharacterSummary | null;
  selectedCharacterIssues: string[];
  mySelectedCharacterId: string | null;
  onSelectCharacter: (characterId: string | null) => void;
  roomTotalPointsText: string;
  onRoomTotalPointsTextChange: (value: string) => void;
  onSaveRoomConstraints: () => void;
  savingConstraints: boolean;
}> = (props) => {
  const hasConstraints = () => Boolean(
    props.room.constraints?.allowedOccupations?.length
    || props.room.constraints?.totalPoints != null,
  );
  return (
    <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 style={{ margin: '0 0 0.2rem' }}>选择我的 PC</h3>
          <div class="text-[0.78rem] text-text-dim">从你已有的角色卡里选一张作为当前房间使用卡。</div>
        </div>
        <a href="/player/characters/new" class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200">
          新建角色卡
        </a>
      </div>
      <div class="mb-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-[0.8rem] text-text-dim shadow-sm shadow-black/10">
        AI KP 会自动审卡；如果下方显示不符合，可以直接点卡片里的“编辑角色卡”自己修改后再回来重选。
      </div>
      <Show when={props.selectedCharacter} fallback={
        <div class="mb-4 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.03] px-4 py-4 text-[0.82rem] text-text-dim shadow-sm shadow-black/10">
          你还没有为当前房间绑定角色卡。先从下方选择一张卡，AI KP 审卡时就会基于它来检查职业与总点要求。
        </div>
      }>
        {(selected) => (
          <div class="mb-4 rounded-[1.35rem] border border-accent/22 bg-[linear-gradient(135deg,rgba(124,106,247,0.14),rgba(255,255,255,0.03))] px-4 py-4 shadow-sm shadow-black/10">
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div class="text-[0.72rem] uppercase tracking-[0.14em] text-accent/90">当前绑定角色卡</div>
                <div class="mt-1 text-lg font-semibold text-text">{selected().name}</div>
                <div class="mt-1 text-[0.82rem] text-text-dim">{selected().occupation ?? '未知职业'} · HP {selected().hp ?? '?'} · SAN {selected().san ?? '?'}</div>
              </div>
              <div class="flex items-center gap-2 flex-wrap justify-end">
                <Show when={props.selectedCharacterIssues.length === 0 && hasConstraints()}>
                  <span class="bg-success/15 border border-success/30 text-success text-[0.72rem] px-2 py-0.5 rounded-[10px]">符合当前房间要求</span>
                </Show>
                <Show when={props.selectedCharacterIssues.length > 0}>
                  <span class="bg-danger/12 border border-danger/30 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">当前卡仍需调整</span>
                </Show>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="bg-white/[0.06] border border-white/[0.08] text-text text-[0.72rem] px-2 py-0.5 rounded-[10px]">主属性 {selected().primaryAttributeTotal ?? '—'}</span>
              <Show when={selected().era}>
                <span class="bg-white/[0.06] border border-white/[0.08] text-text text-[0.72rem] px-2 py-0.5 rounded-[10px]">{selected().era}</span>
              </Show>
              <Show when={selected().readonly}>
                <span class="bg-white/[0.06] border border-white/[0.08] text-text-dim text-[0.72rem] px-2 py-0.5 rounded-[10px]">进行中跑团锁定</span>
              </Show>
            </div>
            <Show when={props.selectedCharacterIssues.length > 0}>
              <div class="mt-3 flex flex-wrap gap-2">
                <For each={props.selectedCharacterIssues}>
                  {(issue) => <span class="bg-danger/10 border border-danger/20 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">{issue}</span>}
                </For>
              </div>
            </Show>
            <div class="mt-4 flex items-center gap-2 flex-wrap">
              <Show when={!selected().readonly} fallback={<span class="text-[0.75rem] text-text-dim">这张卡当前处于锁定状态，暂时不能直接编辑。</span>}>
                <a href={`/player?edit=${selected().id}`} class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200">
                  编辑当前角色卡
                </a>
              </Show>
              <button class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={() => props.onSelectCharacter(null)}>
                取消绑定
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={props.chars.length > 0} fallback={<p class="text-text-dim">还没有角色卡，<a href="/player/characters/new">去新建</a></p>}>
        <div class="flex flex-col gap-2">
          <For each={props.chars}>
            {(character) => {
              const issues = getCharacterFitIssues(character, props.room.constraints);
              const isSelected = props.mySelectedCharacterId === character.id;
              return (
                <div class={`text-left bg-surface border rounded-xl px-4 py-3 cursor-pointer text-text w-full transition-colors shadow-sm shadow-black/10 ${
                  issues.length > 0
                    ? 'border-danger/60 hover:border-danger'
                    : isSelected
                      ? 'border-success hover:border-success'
                      : 'border-border hover:border-accent'
                }`}>
                  <div class="flex items-start justify-between gap-3">
                    <div class="font-semibold">{character.name}</div>
                    <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <Show when={isSelected}>
                        <span class="bg-success/15 border border-success/30 text-success text-[0.72rem] px-2 py-0.5 rounded-[10px]">当前已选</span>
                      </Show>
                      <Show when={issues.length > 0}>
                        <span class="bg-danger/12 border border-danger/30 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">不符合</span>
                      </Show>
                      <Show when={issues.length === 0 && hasConstraints()}>
                        <span class="bg-success/15 border border-success/30 text-success text-[0.72rem] px-2 py-0.5 rounded-[10px]">符合要求</span>
                      </Show>
                    </div>
                  </div>
                  <div class="text-text-dim mt-1 text-[0.8rem]">{character.occupation ?? '未知职业'} · HP {character.hp ?? '?'} · SAN {character.san ?? '?'}</div>
                  <div class="text-text-dim text-[0.78rem]">
                    主属性总点 {character.primaryAttributeTotal ?? '—'}
                    <Show when={character.era}>
                      <span> · {character.era}</span>
                    </Show>
                  </div>
                  <Show when={issues.length > 0}>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <For each={issues}>
                        {(issue) => <span class="bg-danger/10 border border-danger/20 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">{issue}</span>}
                      </For>
                    </div>
                  </Show>
                  <div class="mt-3 flex items-center gap-2 flex-wrap">
                    <button class="inline-block px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => props.onSelectCharacter(character.id)}>
                      {isSelected ? '重新选择当前卡' : '使用这张卡'}
                    </button>
                    <Show when={!character.readonly} fallback={<span class="text-[0.75rem] text-text-dim">该角色卡正在别的进行中跑团里，暂时不能编辑。</span>}>
                      <a href={`/player?edit=${character.id}`} class="inline-block px-3 py-1.5 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200">
                        编辑角色卡
                      </a>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
          <button class="text-left bg-white/[0.04] border border-border rounded-xl px-4 py-3 cursor-pointer text-text w-full hover:border-accent transition-colors" style={{ color: 'var(--text-dim)' }} onClick={() => props.onSelectCharacter(null)}>
            取消选择
          </button>
        </div>
      </Show>

      <Show when={props.room.constraints && (props.room.constraints.era || (props.room.constraints.allowedOccupations?.length ?? 0) > 0 || props.room.constraints.totalPoints != null)}>
        <div class="mt-5 bg-accent/[0.07] border border-accent/25 rounded-2xl px-4 py-4 text-sm flex flex-col gap-2 shadow-sm shadow-black/10">
          <div class="flex items-center justify-between gap-3">
            <strong>本房间筛卡要求</strong>
            <span class="rounded-full border border-accent/20 bg-white/5 px-2.5 py-0.5 text-[0.72rem] text-accent">仅在本房间生效</span>
          </div>
          <div class="text-[0.78rem] text-text-dim">房主可以根据模组微调筛卡条件；这些条件只影响当前房间的审卡，不会修改角色卡本身。</div>
          <Show when={props.room.constraints.era}><div>时代：{props.room.constraints.era}</div></Show>
          <Show when={(props.room.constraints.allowedOccupations?.length ?? 0) > 0}><div>职业：{props.room.constraints.allowedOccupations?.join('、')}</div></Show>
          <Show when={props.room.constraints.totalPoints != null}><div>总点要求：{props.room.constraints.totalPoints}</div></Show>
        </div>
      </Show>

      <Show when={props.room.isCreator}>
        <div class="mt-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-4 flex flex-col gap-3 shadow-sm shadow-black/10">
          <strong>房间总点设置</strong>
          <div class="rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-3 py-2.5 text-[0.78rem] text-text-dim flex flex-col gap-1">
            <span class="font-semibold text-text">设置说明</span>
            <span>主属性总点 = STR + CON + SIZ + DEX + APP + INT + POW + EDU。</span>
            <span>默认继承模组要求；留空则不校验主属性总点，适合更自由的房规或兼容型模组。</span>
          </div>
          <input
            value={props.roomTotalPointsText}
            onInput={(e) => props.onRoomTotalPointsTextChange(e.currentTarget.value)}
            placeholder="默认 460，可留空"
            disabled={props.room.status !== 'waiting' || props.savingConstraints}
            class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text"
          />
          <Show when={props.room.status !== 'waiting'}>
            <div class="text-sm text-text-dim">房间进入审卡后不可再修改总点要求。</div>
          </Show>
          <button
            class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
            onClick={props.onSaveRoomConstraints}
            disabled={props.room.status !== 'waiting' || props.savingConstraints}
          >
            {props.savingConstraints ? '保存中...' : '保存房间要求'}
          </button>
        </div>
      </Show>
    </div>
  );
};

const RoomConceptPanel: Component<{ room: RoomDetail }> = (props) => (
  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 style={{ margin: '0 0 0.2rem' }}>跑团说明</h3>
        <div class="text-[0.78rem] text-text-dim">统一说明这个房间承载哪些信息，避免“房间”和“团记录”分成两个对象。</div>
      </div>
    </div>
    <div class="flex flex-col gap-3 text-[0.86rem] leading-7 text-text-dim">
      <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
        <strong class="text-text">一个房间就是一场跑团。</strong>
        <div class="mt-2">从成员组队、选卡、审卡、开场、进行中到最终消息历史，都应在这个房间里完成，不需要再跳到“我的团”之类的第二个对象里查看。</div>
      </div>
      <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
        <strong class="text-text">当前运行态</strong>
        <div class="mt-2">
          <Show when={props.room.runtime} fallback={<span>这间房还没有开始跑团，因此暂时没有运行中的 session 记录。</span>}>
            {(runtime) => (
              <>
                当前状态：{runtime().status}，消息 {runtime().messageCount} 条，分段 {runtime().segmentCount} 个。
                <Show when={runtime().startedAt}>
                  <span> 开始于 {new Date(runtime().startedAt).toLocaleString('zh-CN')}。</span>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  </div>
);

function getCharacterFitIssues(char: CharacterSummary, constraints?: RoomConstraints): string[] {
  return getFitIssuesFromSummary(char.occupation, char.primaryAttributeTotal, constraints);
}

export default RoomDetailPage;
