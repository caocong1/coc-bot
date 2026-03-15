import { createEffect, createMemo, createResource, createSignal, For, Show, type Component } from 'solid-js';
import {
  adminApi,
  type AdminRoomDetail,
  type AdminRoomSummary,
  type KpTemplate,
  type RoomRelationship,
  type RoomRelationshipParticipant,
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
  const [relationParticipantIds, setRelationParticipantIds] = createSignal<string[]>([]);
  const [relationLabel, setRelationLabel] = createSignal('');
  const [relationNotes, setRelationNotes] = createSignal('');
  const [editingRelationId, setEditingRelationId] = createSignal<string | null>(null);

  const readyCount = () => detail()?.members.filter((member) => member.readyAt).length ?? 0;
  const boundParticipants = createMemo<RoomRelationshipParticipant[]>(() =>
    (detail()?.members ?? [])
      .filter((member) => member.character)
      .map((member) => ({
        characterId: member.character!.id,
        characterName: member.character!.name,
        qqId: member.qqId,
      })),
  );
  const canEditRelationships = createMemo(() => {
    const status = detail()?.status;
    return status === 'waiting' || status === 'reviewing';
  });

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

  const resetRelationshipForm = () => {
    setEditingRelationId(null);
    setRelationParticipantIds([]);
    setRelationLabel('');
    setRelationNotes('');
  };

  const saveRelationship = async () => {
    setSavingRelation(true);
    setErr('');
    try {
      if (editingRelationId()) {
        await adminApi.updateRoomRelationship(props.id, editingRelationId()!, {
          participantCharacterIds: relationParticipantIds(),
          relationLabel: relationLabel().trim(),
          notes: relationNotes().trim(),
        });
      } else {
        await adminApi.createRoomRelationship(props.id, {
          participantCharacterIds: relationParticipantIds(),
          relationLabel: relationLabel().trim(),
          notes: relationNotes().trim(),
        });
      }
      setMsg(editingRelationId() ? '已更新人物关系' : '已新增人物关系');
      resetRelationshipForm();
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRelation(false);
    }
  };

  const startEditRelationship = (relation: RoomRelationship) => {
    setEditingRelationId(relation.id);
    setRelationParticipantIds(relation.participants.map((participant) => participant.characterId));
    setRelationLabel(relation.relationLabel);
    setRelationNotes(relation.notes);
  };

  const clearRelationship = async (relation: RoomRelationship) => {
    setSavingRelation(true);
    setErr('');
    try {
      await adminApi.deleteRoomRelationship(props.id, relation.id);
      setMsg('已清除人物关系');
      if (editingRelationId() === relation.id) resetRelationshipForm();
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
                actions={room().status === 'reviewing' ? (
                  <button class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ background: 'var(--success)' }} onClick={confirmRoom} disabled={confirming()}>
                    {confirming() ? '处理中...' : '强制开团'}
                  </button>
                ) : undefined}
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
                <div class="grid grid-cols-1 gap-6 mt-4">
                  <RoomMembersPanel members={room().members} constraints={room().constraints} readyCount={readyCount()} />
                </div>
                <div class="grid grid-cols-1 gap-6 mt-6">
                  <RoomRelationshipsPanel
                    relationships={room().relationships}
                    availableParticipants={boundParticipants()}
                    selectedParticipantIds={relationParticipantIds()}
                    onSelectedParticipantIdsChange={setRelationParticipantIds}
                    relationLabel={relationLabel()}
                    onRelationLabelChange={setRelationLabel}
                    relationNotes={relationNotes()}
                    onRelationNotesChange={setRelationNotes}
                    editingRelationId={editingRelationId()}
                    onEdit={startEditRelationship}
                    onCancelEdit={resetRelationshipForm}
                    onSave={saveRelationship}
                    onDelete={clearRelationship}
                    saving={savingRelation()}
                    canEdit={canEditRelationships()}
                    readOnlyReason="跑团开始后人物关系只读；如需干预，请在开团前完成。"
                    helperText="管理员也可以直接维护人物关系。这里的关系与玩家端使用同一份数据，改动会同步反映到开场与推进导演。"
                  />
                </div>
              </Show>

              <Show when={activeTab() === 'messages'}>
                <RoomMessagesPanel roomId={props.id} fetchMessages={adminApi.getRoomMessages} />
              </Show>

              <Show when={activeTab() === 'manage'}>
                <div class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6 mt-4">
                  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
                    <h3 style={{ margin: '0 0 0.9rem' }}>房间控制</h3>
                    <div class="grid grid-cols-2 gap-2.5 mb-4">
                      <AdminMetaChip label="状态" value={STATUS_LABEL[room().status] ?? room().status} />
                      <AdminMetaChip label="群号" value={room().groupId ? `#${room().groupId}` : '未绑定'} />
                      <AdminMetaChip label="成员" value={`${room().members.length} 人`} />
                      <AdminMetaChip label="模组" value={room().scenarioName ?? '未指定'} />
                    </div>
                    <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 flex flex-col gap-3">
                      <AdminActionCard
                        title={confirming() ? '处理中...' : '强制开团'}
                        subtitle="用于卡在审卡中的房间"
                        tone="success"
                        disabled={confirming() || room().status !== 'reviewing'}
                        onClick={confirmRoom}
                      />
                      <AdminActionCard
                        title={cancelling() ? '处理中...' : '取消审卡'}
                        subtitle="把房间退回等待状态"
                        tone="neutral"
                        disabled={cancelling() || room().status !== 'reviewing'}
                        onClick={cancelReview}
                      />
                      <AdminActionCard
                        title={deleting() ? '删除中...' : '删除房间'}
                        subtitle="删除房间与关联记录"
                        tone="danger"
                        disabled={deleting()}
                        onClick={deleteRoom}
                      />
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

const AdminMetaChip: Component<{ label: string; value: string }> = (props) => (
  <div class="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-3">
    <div class="text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">{props.label}</div>
    <div class="mt-1 text-[0.85rem] font-semibold text-text leading-5 break-words">{props.value}</div>
  </div>
);

const AdminActionCard: Component<{
  title: string;
  subtitle: string;
  tone: 'success' | 'neutral' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}> = (props) => {
  const toneClass = () => {
    switch (props.tone) {
      case 'success':
        return 'bg-success text-white hover:opacity-85';
      case 'danger':
        return 'bg-danger text-white hover:opacity-90';
      default:
        return 'bg-white/[0.08] text-text border border-white/[0.08] hover:bg-white/[0.12]';
    }
  };

  return (
    <button
      class={`w-full rounded-2xl px-4 py-3 text-left cursor-pointer transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed ${toneClass()}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <div class="text-[0.9rem] font-semibold">{props.title}</div>
      <div class={`mt-1 text-[0.76rem] leading-5 ${props.tone === 'neutral' ? 'text-text-dim' : 'text-white/80'}`}>{props.subtitle}</div>
    </button>
  );
};

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
      <h3 style={{ 'font-size': '0.95rem', margin: '0 0 0.9rem' }}>KP 设定</h3>
      <div class="space-y-4">
        <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <label class="text-[0.82rem] text-text-dim block mb-1.5">人格模板</label>
          <select class="bg-bg border border-border rounded-xl text-text px-3 py-2.5 text-[0.9rem] w-full focus:outline-none focus:border-accent" value={kpTemplateId()} onChange={(e) => setKpTemplateId(e.currentTarget.value)}>
            <For each={props.templates}>{(template) => <option value={template.id}>{template.name} — {template.description}</option>}</For>
          </select>
          <Show when={selectedTemplate()}>
            <div class="flex gap-2 flex-wrap mt-3">
              <span class="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.76rem] text-text-dim">基调 {selectedTemplate()!.tone}/10</span>
              <span class="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.76rem] text-text-dim">灵活度 {selectedTemplate()!.flexibility}/10</span>
              <span class="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.76rem] text-text-dim">引导度 {selectedTemplate()!.guidance}/10</span>
              <span class="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.76rem] text-text-dim">致命度 {selectedTemplate()!.lethality}/10</span>
              <span class="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.76rem] text-text-dim">节奏 {selectedTemplate()!.pacing}/10</span>
            </div>
          </Show>
        </div>
        <div class="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <label class="text-[0.82rem] text-text-dim block mb-1.5">自定义提示词（可选）</label>
          <textarea
            class="flex-1 p-3 bg-bg border border-border rounded-xl text-text text-[0.88rem] resize-y min-h-[88px] w-full box-border"
            placeholder="例如：说话带点地方口音、NPC 对话更克制、战斗描写更冷静"
            value={kpCustomPrompts()}
            onInput={(e) => setKpCustomPrompts(e.currentTarget.value)}
            rows={4}
          />
        </div>
      </div>
      <div class="mt-4 flex justify-end">
      <button class="px-4 py-2 bg-accent text-white border-none rounded-xl text-sm font-semibold cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={saveKpSettings} disabled={kpSaving()}>
        {kpSaving() ? '保存中...' : '保存 KP 设定'}
      </button>
      </div>
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
      <div class="flex gap-2 mb-4 items-center flex-wrap">
        <h3 class="m-0 text-[0.95rem] flex-1">运行时调试 (群 #{props.groupId})</h3>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('pause')}>暂停</button>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('resume')}>恢复</button>
        <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => sessionAction('stop')}>停止</button>
      </div>
      <Show when={actionMsg()}>
        <div class="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[0.82rem] text-text-dim">{actionMsg()}</div>
      </Show>
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <AdminMetaChip label="分段数" value={String(segments()?.segments.length ?? 0)} />
        <AdminMetaChip label="当前分段" value={segments()?.currentSegmentId ? '已选定' : '未指定'} />
        <AdminMetaChip label="线索数" value={String(clues()?.length ?? 0)} />
        <AdminMetaChip label="已发现" value={String((clues() ?? []).filter((clue) => clue.isDiscovered).length)} />
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <div>
              <h3 class="m-0 text-[0.95rem]">模组分段</h3>
              <div class="text-[0.76rem] text-text-dim mt-1">查看、展开或切换当前使用的模组分段。</div>
            </div>
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
                      <div class={`border rounded-2xl px-4 py-3 shadow-sm shadow-black/10 ${isCurrent() ? 'border-accent/30 bg-accent/[0.08]' : 'border-border bg-surface'}`}>
                        <div class="flex items-center gap-2 flex-wrap">
                          <Show when={isCurrent()}>
                            <span class="inline-flex items-center rounded-full border border-accent/25 bg-accent/12 px-2 py-0.5 text-[0.68rem] font-semibold text-accent">当前分段</span>
                          </Show>
                          <span class="font-semibold flex-1 min-w-[180px]">{segment.seq + 1}. {segment.title}</span>
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
                          <p class="text-text-dim text-[0.82rem] mt-2 mb-0 leading-6">{segment.summary}</p>
                        </Show>
                        <Show when={isExpanded()}>
                          <pre class="text-[0.78rem] whitespace-pre-wrap break-all bg-bg p-3 rounded-xl max-h-[300px] overflow-y-auto mt-3 border border-white/[0.06]">{segment.fullText}</pre>
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
            <div>
              <h3 class="m-0 text-[0.95rem]">线索</h3>
              <div class="text-[0.76rem] text-text-dim mt-1">可手动标记线索发现，或向运行中的 KP 注入补充信息。</div>
            </div>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchClues}>刷新</button>
          </div>
          <Show when={!clues.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <Show when={(clues() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem] p-3">暂无线索</p>}>
              <For each={clues()}>
                {(clue: Clue) => (
                  <div class={`px-4 py-3 border-t border-border first:border-t-0 ${clue.isDiscovered ? 'opacity-75' : ''}`}>
                    <div class="flex items-center gap-2 flex-wrap mb-1.5">
                      <span class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${clue.isDiscovered ? 'border-success/25 bg-success/12 text-success' : 'border-warn/25 bg-warn/12 text-warn'}`}>
                        {clue.isDiscovered ? '已发现' : '待发现'}
                      </span>
                      <div class="font-semibold text-[0.88rem]">{clue.title}</div>
                    </div>
                    <div class="text-[0.82rem] text-text-dim mb-2 leading-6">{clue.keeperContent ?? clue.playerDescription}</div>
                    <Show when={!clue.isDiscovered}>
                      <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => discoverClue(clue.id)}>标记已发现</button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
          <div class="flex gap-2 p-3 border-t border-border bg-white/[0.02]">
            <input
              class="flex-1 p-2.5 bg-bg border border-border rounded-xl text-text text-[0.88rem]"
              placeholder="向 KP 注入信息..."
              value={injectText()}
              onInput={(e) => setInjectText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && inject()}
            />
            <button class="px-3.5 py-2 bg-accent text-white border-none rounded-xl text-sm font-semibold cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={inject}>注入</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomManager;
