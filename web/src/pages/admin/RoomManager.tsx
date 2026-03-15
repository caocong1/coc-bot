import { createEffect, createResource, createSignal, For, Show, type Component } from 'solid-js';
import {
  adminApi,
  type AdminRoomDetail,
  type AdminRoomSummary,
  type KpTemplate,
  type RoomRelationType,
  type RoomRelationship,
  type Segment,
  type Clue,
} from '../../api';
import {
  RoomHeaderHero,
  RoomMembersPanel,
  RoomMessagesPanel,
  RoomRelationshipsPanel,
  RoomTabsBar,
  STATUS_LABEL,
  type RoomTab,
} from '../../components/room/RoomDetailShared';

type StatusFilter = 'all' | 'waiting' | 'reviewing' | 'running' | 'ended';

const RoomManager: Component = () => {
  const [rooms, { refetch }] = createResource(() => adminApi.listRooms().catch(() => []));
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal<StatusFilter>('all');

  const filteredRooms = () => {
    const current = filter();
    return (rooms() ?? []).filter((room) => current === 'all' || room.status === current);
  };

  const deleteRoom = async (room: AdminRoomSummary) => {
    if (!confirm(`确认强制删除房间「${room.name}」？此操作不可撤销。`)) return;
    await adminApi.deleteRoom(room.id).catch((e) => alert(String(e)));
    refetch();
  };

  return (
    <Show when={!selectedId()} fallback={<AdminRoomDetailView id={selectedId()!} onBack={() => setSelectedId(null)} onRefreshList={refetch} />}>
      <div>
        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2">
            {(['all', 'waiting', 'reviewing', 'running', 'ended'] as StatusFilter[]).map((value) => (
              <button
                class={filter() === value
                  ? 'px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95'
                  : 'px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95'}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? '全部' : STATUS_LABEL[value]}
              </button>
            ))}
          </div>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetch}>刷新</button>
        </div>

        <Show when={!rooms.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <Show when={filteredRooms().length > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无房间</p>}>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <For each={filteredRooms()}>
                {(room) => (
                  <div class="block bg-surface border border-border rounded-xl p-5 no-underline text-text transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 cursor-pointer" onClick={() => setSelectedId(room.id)}>
                    <div class="flex justify-between mb-2">
                      <span class="text-[0.85rem]">{STATUS_LABEL[room.status] ?? room.status}</span>
                      <span class="text-text-dim text-[0.8rem]">{room.groupId ? `群 #${room.groupId}` : '未绑定群'}</span>
                    </div>
                    <div class="text-base font-semibold mb-1">{room.name}</div>
                    <div class="text-[0.8rem] text-text-dim">
                      {room.scenarioName ? `模组：${room.scenarioName} · ` : ''}
                      {room.memberCount} 人参与 · 创建于 {new Date(room.createdAt).toLocaleDateString()}
                    </div>
                    <div class="mt-4 flex items-center justify-between gap-3">
                      <span class="text-[0.75rem] text-text-dim">创建者 QQ {room.creatorQqId}</span>
                      <button
                        class="px-2.5 py-1 bg-white/[0.07] text-text border border-danger rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-danger/10 transition-all duration-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteRoom(room);
                        }}
                        style={{ color: 'var(--error, #f87171)' }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
};

const AdminRoomDetailView: Component<{ id: string; onBack: () => void; onRefreshList: () => void }> = (props) => {
  const [detail, { refetch }] = createResource(() => adminApi.getRoomDetail(props.id).catch(() => null));
  const [templates] = createResource(() => adminApi.listKpTemplates().catch(() => []));
  const [activeTab, setActiveTab] = createSignal<RoomTab>('overview');
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');
  const [confirming, setConfirming] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [savingRelation, setSavingRelation] = createSignal(false);
  const [relationSource, setRelationSource] = createSignal('');
  const [relationTarget, setRelationTarget] = createSignal('');
  const [relationType, setRelationType] = createSignal<RoomRelationType>('acquainted');
  const [relationNotes, setRelationNotes] = createSignal('');

  const readyCount = () => detail()?.members.filter((member) => member.readyAt).length ?? 0;

  const refreshAll = async () => {
    await refetch();
    props.onRefreshList();
  };

  const confirmRoom = async () => {
    setConfirming(true);
    setErr('');
    try {
      await adminApi.confirmRoom(props.id);
      setMsg('已强制确认开团');
      await refreshAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  const cancelReview = async () => {
    setCancelling(true);
    setErr('');
    try {
      await adminApi.cancelReview(props.id);
      setMsg('已取消审卡');
      await refreshAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const deleteRoom = async () => {
    if (!confirm('确认删除这个房间？该操作不可撤销。')) return;
    setDeleting(true);
    setErr('');
    try {
      await adminApi.deleteRoom(props.id);
      props.onRefreshList();
      props.onBack();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const saveRelationship = async () => {
    const sourceQqId = Number(relationSource().trim());
    const targetQqId = Number(relationTarget().trim());
    if (!Number.isFinite(sourceQqId) || sourceQqId <= 0 || !Number.isFinite(targetQqId) || targetQqId <= 0) {
      setErr('请输入有效的双方 QQ 号');
      return;
    }
    setSavingRelation(true);
    setErr('');
    try {
      await adminApi.setRoomRelationship(props.id, {
        sourceQqId,
        targetQqId,
        relationType: relationType(),
        notes: relationNotes().trim(),
      });
      setMsg('已更新人物关系');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRelation(false);
    }
  };

  const clearRelationship = async (relation: RoomRelationship) => {
    setSavingRelation(true);
    setErr('');
    try {
      await adminApi.deleteRoomRelationship(props.id, relation.userA, relation.userB);
      setMsg('已清除人物关系');
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRelation(false);
    }
  };

  return (
    <div>
      <button class="px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95 mb-4" onClick={props.onBack}>
        ← 返回列表
      </button>

      <Show when={!detail.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
        <Show when={detail()} fallback={<p class="text-text-dim text-[0.9rem]">房间不存在</p>}>
          {(room) => (
            <div>
              <RoomHeaderHero
                name={room().name}
                status={room().status}
                scenarioName={room().scenarioName}
                ingameTime={room().runtime?.ingameTime ?? null}
                memberCount={room().members.length}
                readyCount={readyCount()}
                groupId={room().groupId}
                identityLabel="管理端"
                description="管理端与玩家端现在围绕同一个房间对象工作。你在这里看到的成员、关系、消息历史和运行状态，就是这场跑团本身，而不是另一套平级记录。"
                footerNote="管理区只保留房间控制、KP 设定和运行时调试；开场导演策略已经收敛为系统内部全局逻辑，不再按房间单独配置。"
                actions={(
                  <>
                    <button class="inline-block px-5 py-2 bg-white/[0.08] text-text border border-white/[0.08] rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={refreshAll}>
                      刷新详情
                    </button>
                    <Show when={room().status === 'reviewing'}>
                      <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ background: 'var(--success)' }} onClick={confirmRoom} disabled={confirming()}>
                        {confirming() ? '处理中...' : '强制开团'}
                      </button>
                    </Show>
                  </>
                )}
              />

              <Show when={msg()}>
                <div class="bg-success/[0.12] border border-success rounded-md px-4 py-3 text-success mb-4">{msg()}</div>
              </Show>
              <Show when={err()}>
                <div class="bg-danger/15 border border-danger rounded-md px-4 py-3 text-danger mb-6">{err()}</div>
              </Show>
              <Show when={(room().warnings ?? []).length > 0}>
                <div class="bg-warn/10 border border-warn rounded-md px-4 py-3 mb-4 text-[0.88rem]">
                  <strong>⚠️ 合规性提示：</strong>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    <For each={room().warnings}>{(warning) => <li>{warning}</li>}</For>
                  </ul>
                </div>
              </Show>

              <RoomTabsBar activeTab={activeTab()} onChange={setActiveTab} includeManage />

              <Show when={activeTab() === 'overview'}>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-4">
                  <RoomMembersPanel members={room().members} constraints={room().constraints} readyCount={readyCount()} />
                  <AdminRoomContextPanel room={room()} />
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
                  <RoomRelationshipsPanel
                    relationships={room().relationships}
                    relationSource={relationSource()}
                    onRelationSourceChange={setRelationSource}
                    relationTarget={relationTarget()}
                    onRelationTargetChange={setRelationTarget}
                    relationType={relationType()}
                    onRelationTypeChange={setRelationType}
                    relationNotes={relationNotes()}
                    onRelationNotesChange={setRelationNotes}
                    onSave={saveRelationship}
                    onClear={clearRelationship}
                    canClear={() => true}
                    saving={savingRelation()}
                    helperText="管理员也可以直接维护人物关系。这里的关系与玩家端使用同一份数据，改动会同步反映到开场与推进导演。"
                  />
                  <AdminRoomRuntimePanel room={room()} />
                </div>
              </Show>

              <Show when={activeTab() === 'messages'}>
                <RoomMessagesPanel roomId={props.id} fetchMessages={adminApi.getRoomMessages} />
              </Show>

              <Show when={activeTab() === 'manage'}>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-4">
                  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
                    <div class="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 style={{ margin: '0 0 0.2rem' }}>房间控制</h3>
                        <div class="text-[0.78rem] text-text-dim">用于处理审卡卡住、人工干预开团以及删除房间。</div>
                      </div>
                    </div>
                    <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-4 flex flex-col gap-3">
                      <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ background: 'var(--success)' }} onClick={confirmRoom} disabled={confirming() || room().status !== 'reviewing'}>
                        {confirming() ? '处理中...' : '强制开团'}
                      </button>
                      <button class="inline-block px-5 py-2 bg-white/[0.08] text-text border border-white/[0.08] rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={cancelReview} disabled={cancelling() || room().status !== 'reviewing'}>
                        {cancelling() ? '处理中...' : '取消审卡'}
                      </button>
                      <button class="inline-block px-5 py-2 bg-danger text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={deleteRoom} disabled={deleting()}>
                        {deleting() ? '删除中...' : '删除房间'}
                      </button>
                    </div>
                  </div>

                  <KpSettingsPanel
                    detail={room()}
                    templates={templates() ?? []}
                    onSaved={async () => {
                      setMsg('KP 设定已保存');
                      await refetch();
                    }}
                    onError={(message) => setErr(message)}
                  />

                  <Show when={room().runtime?.groupId}>
                    <SessionPanel groupId={room().runtime!.groupId} />
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
};

const AdminRoomContextPanel: Component<{ room: AdminRoomDetail }> = (props) => (
  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 style={{ margin: '0 0 0.2rem' }}>房间说明</h3>
        <div class="text-[0.78rem] text-text-dim">统一说明“房间即跑团”的对象边界，避免再让玩家和管理员看到两套记录入口。</div>
      </div>
    </div>
    <div class="flex flex-col gap-3 text-[0.86rem] leading-7 text-text-dim">
      <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
        <strong class="text-text">主对象：房间</strong>
        <div class="mt-2">这个房间就是这次跑团本身。玩家端查看消息历史、游戏时间和运行状态，都应该回到这里；`kp_session` 只是内部运行时实现。</div>
      </div>
      <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
        <strong class="text-text">模组与约束</strong>
        <div class="mt-2">
          <div>模组：{props.room.scenarioName ?? '未指定'}</div>
          <div>时代：{props.room.constraints.era ?? '未限制'}</div>
          <div>职业：{props.room.constraints.allowedOccupations?.length ? props.room.constraints.allowedOccupations.join('、') : '不限'}</div>
          <div>总点：{props.room.constraints.totalPoints ?? '不校验'}</div>
        </div>
      </div>
    </div>
  </div>
);

const AdminRoomRuntimePanel: Component<{ room: AdminRoomDetail }> = (props) => (
  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 style={{ margin: '0 0 0.2rem' }}>运行态摘要</h3>
        <div class="text-[0.78rem] text-text-dim">按房间查看当前绑定的 session，而不是跳到另一套 campaign 详情页。</div>
      </div>
    </div>
    <Show when={props.room.runtime} fallback={<p class="text-text-dim text-sm">当前还没有运行中的 session。</p>}>
      {(runtime) => (
        <div class="grid grid-cols-2 gap-3">
          <RuntimeStat label="Session" value={runtime().sessionId} mono />
          <RuntimeStat label="状态" value={runtime().status} />
          <RuntimeStat label="消息数" value={String(runtime().messageCount)} />
          <RuntimeStat label="分段数" value={String(runtime().segmentCount)} />
          <RuntimeStat label="群号" value={String(runtime().groupId)} />
          <RuntimeStat label="游戏时间" value={runtime().ingameTime ?? '未设置'} />
        </div>
      )}
    </Show>
  </div>
);

const RuntimeStat: Component<{ label: string; value: string; mono?: boolean }> = (props) => (
  <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
    <div class="text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">{props.label}</div>
    <div class={`mt-1 text-sm font-semibold text-text break-all ${props.mono ? 'font-mono text-[0.78rem]' : ''}`}>{props.value}</div>
  </div>
);

const KpSettingsPanel: Component<{ detail: AdminRoomDetail; templates: KpTemplate[]; onSaved: () => void; onError: (msg: string) => void }> = (props) => {
  const [kpTemplateId, setKpTemplateId] = createSignal(props.detail.adminPanel.kpTemplateId ?? 'serious');
  const [kpCustomPrompts, setKpCustomPrompts] = createSignal(props.detail.adminPanel.kpCustomPrompts ?? '');
  const [kpSaving, setKpSaving] = createSignal(false);

  createEffect(() => {
    setKpTemplateId(props.detail.adminPanel.kpTemplateId ?? 'serious');
    setKpCustomPrompts(props.detail.adminPanel.kpCustomPrompts ?? '');
  });

  const selectedTemplate = () => props.templates.find((template) => template.id === kpTemplateId());

  const saveKpSettings = async () => {
    setKpSaving(true);
    try {
      await adminApi.updateRoomKpSettings(props.detail.id, {
        templateId: kpTemplateId(),
        customPrompts: kpCustomPrompts(),
      });
      props.onSaved();
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setKpSaving(false);
    }
  };

  return (
    <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
      <h3 style={{ 'font-size': '0.95rem', margin: '0 0 0.75rem' }}>KP 设定</h3>
      <div class="text-text-dim text-[0.82rem] mb-3">这些设置挂在房间上，是下一次开团和继续时读取的房间级 KP 参数。</div>
      <div class="mb-3">
        <label class="text-[0.82rem] text-text-dim block mb-1">人格模板</label>
        <select class="bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] w-full focus:outline-none focus:border-accent" value={kpTemplateId()} onChange={(e) => setKpTemplateId(e.currentTarget.value)}>
          <For each={props.templates}>{(template) => <option value={template.id}>{template.name} — {template.description}</option>}</For>
        </select>
        <Show when={selectedTemplate()}>
          <div class="flex gap-2.5 flex-wrap mt-1.5 text-[0.78rem] text-text-dim">
            <span>基调 {selectedTemplate()!.tone}/10</span>
            <span>灵活度 {selectedTemplate()!.flexibility}/10</span>
            <span>引导度 {selectedTemplate()!.guidance}/10</span>
            <span>致命度 {selectedTemplate()!.lethality}/10</span>
            <span>节奏 {selectedTemplate()!.pacing}/10</span>
          </div>
        </Show>
      </div>
      <div class="mb-3">
        <label class="text-[0.82rem] text-text-dim block mb-1">自定义提示词（可选）</label>
        <textarea
          class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] resize-y min-h-[60px] w-full box-border"
          placeholder="例如：说话带点地方口音、NPC 对话更克制、战斗描写更冷静"
          value={kpCustomPrompts()}
          onInput={(e) => setKpCustomPrompts(e.currentTarget.value)}
          rows={3}
        />
      </div>
      <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={saveKpSettings} disabled={kpSaving()}>
        {kpSaving() ? '保存中...' : '保存 KP 设定'}
      </button>
    </div>
  );
};

const SessionPanel: Component<{ groupId: number }> = (props) => {
  const [clues, { refetch: refetchClues }] = createResource(() => adminApi.listClues(props.groupId).catch(() => []));
  const [segments, { refetch: refetchSegments }] = createResource(() =>
    adminApi.listSegments(props.groupId).catch(() => ({ currentSegmentId: null, segments: [] })),
  );
  const [expandedSegId, setExpandedSegId] = createSignal<string | null>(null);
  const [injectText, setInjectText] = createSignal('');
  const [actionMsg, setActionMsg] = createSignal('');

  const inject = async () => {
    const text = injectText().trim();
    if (!text) return;
    await adminApi.injectInfo(props.groupId, text).catch((e) => alert(String(e)));
    setInjectText('');
  };

  const discoverClue = async (clueId: string) => {
    await adminApi.discoverClue(props.groupId, clueId).catch((e) => alert(String(e)));
    refetchClues();
  };

  const switchSegment = async (segmentId: string) => {
    await adminApi.setSegment(props.groupId, segmentId).catch((e) => alert(String(e)));
    refetchSegments();
  };

  const sessionAction = async (action: 'pause' | 'resume' | 'stop') => {
    setActionMsg('');
    try {
      if (action === 'pause') {
        const result = await adminApi.pauseSession(props.groupId);
        setActionMsg(result.message);
      } else if (action === 'resume') {
        await adminApi.resumeSession(props.groupId);
        setActionMsg('已恢复');
      } else {
        const result = await adminApi.stopSession(props.groupId);
        setActionMsg(result.message);
      }
    } catch (e) {
      setActionMsg(`错误: ${(e as Error).message}`);
    }
  };

  return (
    <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10 xl:col-span-2">
      <div class="flex gap-2 mb-4 items-center">
        <h3 class="m-0 text-[0.95rem] flex-1">Session 控制 (群 #{props.groupId})</h3>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('pause')}>暂停</button>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('resume')}>恢复</button>
        <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => sessionAction('stop')}>停止</button>
      </div>
      <Show when={actionMsg()}>
        <div class="text-text-dim text-[0.82rem] mb-3">{actionMsg()}</div>
      </Show>

      <div class="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <h3>模组分段</h3>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchSegments}>刷新</button>
          </div>
          <Show when={!segments.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <Show when={(segments()?.segments.length ?? 0) > 0} fallback={<p class="text-text-dim text-[0.9rem] p-3">暂无分段</p>}>
              <div class="p-3 flex flex-col gap-2">
                <For each={segments()?.segments}>
                  {(segment: Segment) => {
                    const isCurrent = () => segments()?.currentSegmentId === segment.id;
                    const isExpanded = () => expandedSegId() === segment.id;
                    return (
                      <div class={`border rounded-xl px-4 py-3 ${isCurrent() ? 'border-accent bg-accent/[0.08]' : 'border-border bg-surface'}`}>
                        <div class="flex items-center gap-2">
                          <span class="font-semibold flex-1">{isCurrent() ? '> ' : ''}{segment.seq + 1}. {segment.title}</span>
                          <span class="text-text-dim text-[0.75rem]">{Math.round(segment.charCount / 100) / 10}k</span>
                          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => setExpandedSegId(isExpanded() ? null : segment.id)}>
                            {isExpanded() ? '收起' : '展开'}
                          </button>
                          <Show when={!isCurrent()}>
                            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => switchSegment(segment.id)}>
                              切换
                            </button>
                          </Show>
                        </div>
                        <Show when={segment.summary}>
                          <p class="text-text-dim text-[0.82rem] mt-1 mb-0">{segment.summary}</p>
                        </Show>
                        <Show when={isExpanded()}>
                          <pre class="text-[0.78rem] whitespace-pre-wrap break-all bg-bg p-3 rounded-md max-h-[300px] overflow-y-auto mt-2">{segment.fullText}</pre>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden flex flex-col">
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <h3>线索</h3>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchClues}>刷新</button>
          </div>
          <Show when={!clues.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <Show when={(clues() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem] p-3">暂无线索</p>}>
              <For each={clues()}>
                {(clue: Clue) => (
                  <div class={`px-4 py-3 border-t border-border first:border-t-0 ${clue.isDiscovered ? 'opacity-60' : ''}`}>
                    <div class="font-semibold text-[0.88rem] mb-1">{clue.isDiscovered ? '✅' : '🔒'} {clue.title}</div>
                    <div class="text-[0.82rem] text-text-dim mb-1.5">{clue.keeperContent ?? clue.playerDescription}</div>
                    <Show when={!clue.isDiscovered}>
                      <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => discoverClue(clue.id)}>标记已发现</button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
          <div class="flex gap-2 p-3 border-t border-border">
            <input
              class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
              placeholder="向 KP 注入信息..."
              value={injectText()}
              onInput={(e) => setInjectText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && inject()}
            />
            <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={inject}>注入</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomManager;
