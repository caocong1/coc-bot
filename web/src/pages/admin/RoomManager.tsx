import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import {
  adminApi,
  type AdminRoomSummary,
  type AdminRoomDetail,
  type AdminRoomDetailMember,
  type KpTemplate,
  type Message,
  type Segment,
  type Clue,
} from '../../api';

const STATUS_LABEL: Record<string, string> = {
  waiting: '等待中',
  reviewing: '审卡中',
  running: '跑团中',
  paused: '已暂停',
  ended: '已结束',
};

const STATUS_COLOR: Record<string, string> = {
  waiting: 'inherit',
  reviewing: 'var(--warn, #f59e0b)',
  running: 'var(--accent)',
  paused: 'var(--warn, #f59e0b)',
  ended: 'var(--text-dim)',
};

type StatusFilter = 'all' | 'waiting' | 'reviewing' | 'running' | 'ended';

const RoomManager: Component = () => {
  const [rooms, { refetch }] = createResource(() => adminApi.listRooms().catch(() => []));
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal<StatusFilter>('all');

  const filteredRooms = () => {
    const f = filter();
    return (rooms() ?? []).filter((r) => f === 'all' || r.status === f);
  };

  const openDetail = (id: string) => setSelectedId(id);
  const backToList = () => setSelectedId(null);

  const deleteRoom = async (room: AdminRoomSummary) => {
    if (!confirm(`确认强制删除房间「${room.name}」？此操作不可撤销。`)) return;
    await adminApi.deleteRoom(room.id).catch((e) => alert(String(e)));
    refetch();
  };

  return (
    <Show when={!selectedId()} fallback={<RoomDetail id={selectedId()!} onBack={backToList} onRefreshList={refetch} />}>
      <div>
        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2">
            {(['all', 'waiting', 'reviewing', 'running', 'ended'] as StatusFilter[]).map((f) => (
              <button
                class={filter() === f
                  ? 'px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95'
                  : 'px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95'}
                onClick={() => setFilter(f)}
                style={{ 'font-size': '0.8rem' }}
              >
                {f === 'all' ? '全部' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetch}>刷新</button>
        </div>

        <Show when={!rooms.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <Show when={filteredRooms().length > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无房间</p>}>
            <div class="bg-surface border border-border rounded-lg overflow-hidden">
              <div class="grid gap-2 px-4 py-2.5 items-center text-xs bg-white/[0.03] text-text-dim uppercase tracking-wider border-b border-border" style={{ 'grid-template-columns': '1fr 1fr 1.5fr 1fr 0.7fr 0.7fr 1.2fr' }}>
                <span>名称</span>
                <span>ID</span>
                <span>群号</span>
                <span>模组</span>
                <span>成员</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              <For each={filteredRooms()}>
                {(r) => (
                  <div class="grid gap-2 px-4 py-2.5 items-center text-sm border-t border-border/50 hover:bg-white/[0.02] transition-colors cursor-pointer" style={{ 'grid-template-columns': '1fr 1fr 1.5fr 1fr 0.7fr 0.7fr 1.2fr' }} onClick={() => openDetail(r.id)}>
                    <span style={{ 'font-weight': '500' }}>{r.name}</span>
                    <span class="font-mono" style={{ 'font-size': '0.8rem' }}>{r.id}</span>
                    <span class="font-mono">{r.groupId ? `#${r.groupId}` : '—'}</span>
                    <span class="text-text-dim text-[0.9rem]">{r.scenarioName ?? '—'}</span>
                    <span>{r.memberCount} 人</span>
                    <span style={{ color: STATUS_COLOR[r.status] ?? 'inherit' }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <button
                      class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200"
                      style={{ color: 'var(--error, #f87171)', 'border-color': 'var(--error, #f87171)' }}
                      onClick={(e) => { e.stopPropagation(); deleteRoom(r); }}
                    >
                      删除
                    </button>
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

// ─── 房间详情 ────────────────────────────────────────────────────────────────

const RoomDetail: Component<{ id: string; onBack: () => void; onRefreshList: () => void }> = (props) => {
  const [detail, { refetch }] = createResource(() => adminApi.getRoomDetail(props.id).catch(() => null));
  const [templates] = createResource(() => adminApi.listKpTemplates().catch(() => []));
  const [confirming, setConfirming] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [err, setErr] = createSignal('');
  const [kpTemplateId, setKpTemplateId] = createSignal('');
  const [kpCustomPrompts, setKpCustomPrompts] = createSignal('');
  const [kpSaving, setKpSaving] = createSignal(false);
  const [kpInited, setKpInited] = createSignal(false);

  const confirmRoom = async () => {
    setConfirming(true);
    setErr('');
    try {
      await adminApi.confirmRoom(props.id);
      setMsg('已强制确认开团');
      await refetch();
      props.onRefreshList();
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
      await refetch();
      props.onRefreshList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <button class="px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95 mb-4" onClick={props.onBack}>
        &larr; 返回列表
      </button>

      <Show when={!detail.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
        <Show when={detail()} fallback={<p class="text-text-dim text-[0.9rem]">房间不存在</p>}>
          {(d) => {
            const status = () => d().status;
            return (
              <div>
                {/* 头部 */}
                <div class="flex justify-between items-center mb-4">
                  <div>
                    <h2 style={{ margin: '0 0 0.25rem' }}>{d().name}</h2>
                    <span style={{ color: STATUS_COLOR[status()], 'font-weight': 600 }}>
                      {STATUS_LABEL[status()]}
                    </span>
                    <span class="text-text-dim text-[0.9rem] ml-3">ID: {d().id}</span>
                    {d().groupId && <span class="text-text-dim text-[0.9rem] ml-3">群号: #{d().groupId}</span>}
                    {d().scenarioName && <span class="text-text-dim text-[0.9rem] ml-3">模组: {d().scenarioName}</span>}
                  </div>
                  <div class="flex gap-2">
                    <Show when={status() === 'reviewing'}>
                      <button class="px-2.5 py-1 bg-success text-[#1a1a1a] border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={confirmRoom} disabled={confirming()}>
                        {confirming() ? '...' : '强制开团'}
                      </button>
                      <button class="px-2.5 py-1 bg-warn text-[#1a1a1a] border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={cancelReview} disabled={cancelling()}>
                        {cancelling() ? '...' : '取消审卡'}
                      </button>
                    </Show>
                    <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetch}>刷新</button>
                  </div>
                </div>

                {/* 消息 */}
                <Show when={msg()}>
                  <div style={{ background: 'rgba(82,196,140,0.12)', border: '1px solid var(--success)', 'border-radius': '6px', padding: '0.5rem 0.75rem', 'margin-bottom': '0.75rem', 'font-size': '0.85rem' }}>
                    {msg()}
                  </div>
                </Show>
                <Show when={err()}>
                  <div class="bg-danger/[0.12] border border-danger rounded-md px-3.5 py-2.5 text-danger text-sm mb-3">{err()}</div>
                </Show>

                {/* 警告 */}
                <Show when={d().warnings.length > 0}>
                  <div class="bg-danger/[0.12] border border-danger rounded-md px-3.5 py-2.5 text-danger text-sm mb-3" style={{ background: 'rgba(245,158,11,0.12)', 'border-color': 'var(--warn, #f59e0b)', color: 'var(--warn, #f59e0b)' }}>
                    <strong>合规性警告：</strong>
                    <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                      <For each={d().warnings}>{(w) => <li>{w}</li>}</For>
                    </ul>
                  </div>
                </Show>

                {/* 约束 */}
                <Show when={d().constraints && (d().constraints.era || (d().constraints.allowedOccupations?.length ?? 0) > 0 || d().constraints.minStats)}>
                  <div style={{ background: 'rgba(124,106,247,0.06)', border: '1px solid rgba(124,106,247,0.2)', 'border-radius': '6px', padding: '0.6rem 0.75rem', 'font-size': '0.82rem', 'margin-bottom': '1rem' }}>
                    <strong>模组约束：</strong>
                    {d().constraints.era && <span style={{ 'margin-left': '0.5rem' }}>时代: {d().constraints.era}</span>}
                    {(d().constraints.allowedOccupations?.length ?? 0) > 0 && <span style={{ 'margin-left': '0.5rem' }}>职业: {d().constraints.allowedOccupations?.join('、')}</span>}
                    {d().constraints.minStats && Object.keys(d().constraints.minStats!).length > 0 && (
                      <span style={{ 'margin-left': '0.5rem' }}>
                        最低属性: {Object.entries(d().constraints.minStats!).map(([k, v]) => `${k}>=${v}`).join(' ')}
                      </span>
                    )}
                  </div>
                </Show>

                {/* KP 设定 */}
                <KpSettingsPanel
                    detail={d()}
                    templates={templates() ?? []}
                    isRunning={status() === 'running'}
                    kpTemplateId={kpTemplateId}
                    setKpTemplateId={setKpTemplateId}
                    kpCustomPrompts={kpCustomPrompts}
                    setKpCustomPrompts={setKpCustomPrompts}
                    kpSaving={kpSaving}
                    setKpSaving={setKpSaving}
                    kpInited={kpInited}
                    setKpInited={setKpInited}
                    onSaved={() => { setMsg('KP 设定已保存'); refetch(); }}
                    onError={(e) => setErr(e)}
                  />

                {/* 成员列表 */}
                <div class="mb-6">
                  <h3 style={{ 'font-size': '0.95rem', 'margin-bottom': '0.5rem' }}>成员 ({d().members.length})</h3>
                  <div class="bg-surface border border-border rounded-lg overflow-hidden">
                    <div class="grid gap-2 px-4 py-2.5 items-center text-xs bg-white/[0.03] text-text-dim uppercase tracking-wider border-b border-border" style={{ 'grid-template-columns': '1fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                      <span>QQ</span>
                      <span>角色</span>
                      <span>职业</span>
                      <span>HP</span>
                      <span>SAN</span>
                      <span>准备</span>
                      <span>加入</span>
                    </div>
                    <For each={d().members}>
                      {(m: AdminRoomDetailMember) => (
                        <div class="grid gap-2 px-4 py-2.5 items-center text-sm border-t border-border/50 hover:bg-white/[0.02] transition-colors" style={{ 'grid-template-columns': '1fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                          <span class="font-mono">{m.qqId}</span>
                          <span style={{ 'font-weight': 500 }}>{m.character?.name ?? '—'}</span>
                          <span class="text-text-dim text-[0.9rem]">{m.character?.occupation ?? '—'}</span>
                          <span>{m.character?.hp ?? '—'}</span>
                          <span>{m.character?.san ?? '—'}</span>
                          <span>{m.readyAt ? '✅' : '⏳'}</span>
                          <span class="text-text-dim" style={{ 'font-size': '0.78rem' }}>
                            {new Date(m.joinedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                {/* running 时嵌入 Session 面板 */}
                <Show when={status() === 'running' && d().session}>
                  <SessionPanel groupId={d().session!.groupId} />
                </Show>

                {/* ended 只读 */}
                <Show when={status() === 'ended' && d().session}>
                  <div class="text-text-dim text-[0.9rem] mt-4">
                    跑团已结束 (Session: {d().session!.id}, {d().session!.messageCount} 条消息)
                  </div>
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </div>
  );
};

// ─── KP 设定面板 ──────────────────────────────────────────────────────────────

const KpSettingsPanel: Component<{
  detail: AdminRoomDetail;
  templates: KpTemplate[];
  isRunning: boolean;
  kpTemplateId: () => string;
  setKpTemplateId: (v: string) => void;
  kpCustomPrompts: () => string;
  setKpCustomPrompts: (v: string) => void;
  kpSaving: () => boolean;
  setKpSaving: (v: boolean) => void;
  kpInited: () => boolean;
  setKpInited: (v: boolean) => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}> = (props) => {
  // 从 detail 初始化（仅一次）
  if (!props.kpInited()) {
    props.setKpTemplateId(props.detail.kpTemplateId ?? 'serious');
    props.setKpCustomPrompts(props.detail.kpCustomPrompts ?? '');
    props.setKpInited(true);
  }

  const selectedTemplate = () => props.templates.find((t) => t.id === props.kpTemplateId());

  const saveKpSettings = async () => {
    props.setKpSaving(true);
    try {
      await adminApi.updateRoomKpSettings(props.detail.id, {
        templateId: props.kpTemplateId(),
        customPrompts: props.kpCustomPrompts(),
      });
      props.onSaved();
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      props.setKpSaving(false);
    }
  };

  return (
    <div class="bg-surface border border-border rounded-lg p-4 mb-4 shadow-sm shadow-black/10">
      <h3 style={{ 'font-size': '0.95rem', 'margin': '0 0 0.75rem' }}>KP 设定</h3>
      {props.isRunning && (
        <div class="text-text-dim text-[0.82rem] mb-3">
          当前跑团进行中，修改将在下次开团时生效
        </div>
      )}

      {/* 模板选择 */}
      <div style={{ 'margin-bottom': '0.75rem' }}>
        <label class="text-[0.82rem] text-text-dim block mb-1">人格模板</label>
        <select
          class="bg-bg border border-border rounded-md text-text px-3 py-2 text-[0.9rem] w-full focus:outline-none focus:border-accent"
          value={props.kpTemplateId()}
          onChange={(e) => props.setKpTemplateId(e.currentTarget.value)}
        >
          <For each={props.templates}>
            {(t) => <option value={t.id}>{t.name} — {t.description}</option>}
          </For>
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

      {/* 自定义提示词 */}
      <div style={{ 'margin-bottom': '0.75rem' }}>
        <label class="text-[0.82rem] text-text-dim block mb-1">自定义提示词（可选，会融合到 KP 人格中）</label>
        <textarea
          class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] resize-y min-h-[60px] w-full box-border"
          placeholder="例如：说话带点东北口音、NPC 对话时多用成语、战斗场景描写要血腥一些..."
          value={props.kpCustomPrompts()}
          onInput={(e) => props.setKpCustomPrompts(e.currentTarget.value)}
          rows={3}
        />
      </div>

      <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={saveKpSettings} disabled={props.kpSaving()}>
        {props.kpSaving() ? '保存中...' : '保存 KP 设定'}
      </button>
    </div>
  );
};

// ─── Session 面板（从 Sessions.tsx 提取）──────────────────────────────────────

const SessionPanel: Component<{ groupId: number }> = (props) => {
  const [clues, { refetch: refetchClues }] = createResource(() => adminApi.listClues(props.groupId).catch(() => []));
  const [segments, { refetch: refetchSegments }] = createResource(() =>
    adminApi.listSegments(props.groupId).catch(() => ({ currentSegmentId: null, segments: [] })),
  );
  const [messages, { refetch: refetchMessages }] = createResource(() =>
    adminApi.getSessionMessages(props.groupId).catch(() => []),
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

  const switchSegment = async (segId: string) => {
    await adminApi.setSegment(props.groupId, segId).catch((e) => alert(String(e)));
    refetchSegments();
  };

  const sessionAction = async (action: 'pause' | 'resume' | 'stop') => {
    setActionMsg('');
    try {
      if (action === 'pause') {
        const r = await adminApi.pauseSession(props.groupId);
        setActionMsg(r.message);
      } else if (action === 'resume') {
        await adminApi.resumeSession(props.groupId);
        setActionMsg('已恢复');
      } else {
        const r = await adminApi.stopSession(props.groupId);
        setActionMsg(r.message);
      }
    } catch (e) {
      setActionMsg(`错误: ${(e as Error).message}`);
    }
  };

  return (
    <div>
      {/* 操作按钮 */}
      <div class="flex gap-2 mb-4 items-center">
        <h3 class="m-0 text-[0.95rem] flex-1">Session 控制 (群 #{props.groupId})</h3>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('pause')}>暂停</button>
        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => sessionAction('resume')}>恢复</button>
        <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" onClick={() => sessionAction('stop')}>停止</button>
      </div>
      <Show when={actionMsg()}>
        <div class="text-text-dim text-[0.82rem] mb-3">{actionMsg()}</div>
      </Show>

      <div class="grid gap-6" style={{ 'grid-template-columns': '1fr 340px', height: 'calc(100vh - 130px)' }}>
        {/* 分段预览 */}
        <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10" style={{ 'grid-column': '1 / -1' }}>
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <h3>模组分段</h3>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchSegments}>刷新</button>
          </div>
          <Show when={!segments.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <Show when={(segments()?.segments.length ?? 0) > 0} fallback={<p class="text-text-dim text-[0.9rem] p-3">暂无分段</p>}>
              <div class="p-3 flex flex-col gap-2">
                <For each={segments()?.segments}>
                  {(seg: Segment) => {
                    const isCurrent = () => segments()?.currentSegmentId === seg.id;
                    const isExpanded = () => expandedSegId() === seg.id;
                    return (
                      <div style={{
                        border: `1px solid ${isCurrent() ? 'var(--accent)' : 'var(--border)'}`,
                        'border-radius': '8px', padding: '0.75rem 1rem',
                        background: isCurrent() ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface)',
                      }}>
                        <div class="flex items-center gap-2">
                          <span class="font-semibold flex-1">
                            {isCurrent() ? '> ' : ''}{seg.seq + 1}. {seg.title}
                          </span>
                          <span class="text-text-dim text-[0.75rem]">{Math.round(seg.charCount / 100) / 10}k</span>
                          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => setExpandedSegId(isExpanded() ? null : seg.id)}>
                            {isExpanded() ? '收起' : '展开'}
                          </button>
                          <Show when={!isCurrent()}>
                            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => switchSegment(seg.id)}>切换</button>
                          </Show>
                        </div>
                        <Show when={seg.summary}>
                          <p class="text-text-dim text-[0.82rem] mt-1 mb-0">{seg.summary}</p>
                        </Show>
                        <Show when={isExpanded()}>
                          <pre class="text-[0.78rem] whitespace-pre-wrap break-all bg-bg p-3 rounded-md max-h-[300px] overflow-y-auto mt-2">{seg.fullText}</pre>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* 消息记录 */}
        <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <h3>消息记录</h3>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchMessages}>刷新</button>
          </div>
          <Show when={!messages.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              <For each={messages() ?? []}>
                {(m) => (
                  <div class={`flex flex-col gap-0.5 p-2 rounded-md bg-white/[0.03] ${m.role === 'kp' ? 'bg-accent/[0.08] border-l-2 border-accent' : m.role === 'dice' ? 'bg-warn/[0.08] border-l-2 border-warn' : m.role === 'system' ? 'bg-white/20' : ''}`}>
                    <span class="text-[0.72rem] text-text-dim">{m.role === 'kp' ? 'KP' : m.displayName ?? m.role}</span>
                    <span class="text-[0.88rem] whitespace-pre-wrap">{m.content}</span>
                  </div>
                )}
              </For>
            </div>
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

        {/* 线索列表 */}
        <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
          <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
            <h3>线索</h3>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={refetchClues}>刷新</button>
          </div>
          <Show when={!clues.loading} fallback={<p class="text-text-dim text-[0.9rem] p-3">加载中...</p>}>
            <Show when={(clues() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem] p-3">暂无线索</p>}>
              <For each={clues()}>
                {(c: Clue) => (
                  <div class={`px-4 py-3 border-t border-border first:border-t-0 ${c.isDiscovered ? 'opacity-60' : ''}`}>
                    <div class="font-semibold text-[0.88rem] mb-1">
                      {c.isDiscovered ? '✅' : '🔒'} {c.title}
                    </div>
                    <div class="text-[0.82rem] text-text-dim mb-1.5">{c.keeperContent ?? c.playerDescription}</div>
                    {!c.isDiscovered && (
                      <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => discoverClue(c.id)}>标记已发现</button>
                    )}
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default RoomManager;
