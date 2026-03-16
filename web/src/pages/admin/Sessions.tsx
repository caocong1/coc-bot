import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi, type Clue, type Message, type Segment, type SessionInfo, type TimelineEvent } from '../../api';

const Sessions: Component = () => {
  const groupId = parseInt(new URLSearchParams(location.search).get('group') ?? '0');
  const [sessions] = createResource(() => adminApi.listSessions().catch(() => []));

  // 如果 URL 指定了群，直接进详情
  if (groupId) return <SessionDetail groupId={groupId} />;

  return (
    <div>
      <p class="text-text-dim text-[0.9rem]">从 URL 参数 <code>?group=&lt;群号&gt;</code> 进入详情，或在总览页点击「详情」。</p>
      <Show when={!sessions.loading}>
        <div class="bg-surface border border-border rounded-lg overflow-hidden shadow-sm shadow-black/10" style={{ 'margin-top': '1.5rem' }}>
          <div class="grid gap-2 px-4 py-2.5 items-center text-xs bg-white/[0.03] text-text-dim uppercase tracking-wider border-b border-border" style={{ 'grid-template-columns': '1fr 1fr 1fr auto' }}><span>群号</span><span>状态</span><span>场景</span><span></span></div>
          <For each={sessions()}>
            {(s) => (
              <div class="grid gap-2 px-4 py-2.5 items-center text-sm border-t border-border/50 hover:bg-white/[0.02] transition-colors" style={{ 'grid-template-columns': '1fr 1fr 1fr auto' }}>
                <span class="font-mono">#{s.groupId}</span>
                <span>{s.status}</span>
                <span>{s.currentScene ?? '—'}</span>
                <a href={`?group=${s.groupId}`} class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200">详情</a>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const SessionDetail: Component<{ groupId: number }> = (props) => {
  const [clues, { refetch: refetchClues }] = createResource(() => adminApi.listClues(props.groupId).catch(() => []));
  const [segments, { refetch: refetchSegments }] = createResource(() =>
    adminApi.listSegments(props.groupId).catch(() => ({ currentSegmentId: null, segments: [] })),
  );
  const [timeline, { refetch: refetchTimeline }] = createResource(() =>
    adminApi.getTimeline(props.groupId).catch(() => ({ sessionId: '', ingameTime: null, events: [] })),
  );
  const [expandedSegId, setExpandedSegId] = createSignal<string | null>(null);
  const [injectText, setInjectText] = createSignal('');
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [timeInput, setTimeInput] = createSignal('');
  const [advanceMin, setAdvanceMin] = createSignal(30);

  // SSE 连接
  let es: EventSource | null = null;
  const connectSSE = () => {
    es?.close();
    es = new EventSource(adminApi.messagesStreamUrl(props.groupId));
    es.onmessage = (e) => {
      const m = JSON.parse(e.data) as Message;
      setMessages((prev) => [...prev.slice(-99), m]);
    };
  };
  connectSSE();

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

  const setTime = async () => {
    const v = timeInput().trim();
    if (!v) return;
    await adminApi.adjustTime(props.groupId, { type: 'set', value: v }).catch((e) => alert(String(e)));
    setTimeInput('');
    refetchTimeline();
  };

  const advanceTime = async () => {
    const m = advanceMin();
    if (m <= 0) return;
    await adminApi.adjustTime(props.groupId, { type: 'advance', minutes: m }).catch((e) => alert(String(e)));
    refetchTimeline();
  };

  return (
    <div class="grid grid-cols-[1fr_340px] gap-6 h-[calc(100vh-130px)]">
      {/* 分段预览 */}
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10" style={{ 'grid-column': '1 / -1' }}>
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
          <h3 class="text-[0.9rem] font-semibold">模组分段（AI KP 上下文窗口）</h3>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={refetchSegments}>刷新</button>
        </div>
        <Show
          when={!segments.loading}
          fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}
        >
          <Show
            when={(segments()?.segments.length ?? 0) > 0}
            fallback={<p class="text-text-dim text-[0.9rem]">暂无分段——运行 .campaign load &lt;模组名&gt; 后显示</p>}
          >
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
              <For each={segments()?.segments}>
                {(seg: Segment) => {
                  const isCurrent = () => segments()?.currentSegmentId === seg.id;
                  const isExpanded = () => expandedSegId() === seg.id;
                  return (
                    <div
                      style={{
                        border: `1px solid ${isCurrent() ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        'border-radius': '8px',
                        padding: '0.75rem 1rem',
                        background: isCurrent() ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem', 'margin-bottom': '0.25rem' }}>
                        <span style={{ 'font-weight': '600', 'flex': '1' }}>
                          {isCurrent() ? '▶ ' : ''}{seg.seq + 1}. {seg.title}
                        </span>
                        <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.75rem' }}>{Math.round(seg.charCount / 100) / 10}k 字</span>
                        <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={() => setExpandedSegId(isExpanded() ? null : seg.id)}>
                          {isExpanded() ? '收起' : '展开'}
                        </button>
                        <Show when={!isCurrent()}>
                          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={() => switchSegment(seg.id)}>切换到此段</button>
                        </Show>
                      </div>
                      <Show when={seg.summary}>
                        <p class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.82rem', margin: '0 0 0.25rem' }}>{seg.summary}</p>
                      </Show>
                      <Show when={isExpanded()}>
                        <pre style={{
                          'font-size': '0.78rem', 'white-space': 'pre-wrap', 'word-break': 'break-all',
                          background: 'var(--color-bg)', padding: '0.75rem', 'border-radius': '6px',
                          'max-height': '300px', 'overflow-y': 'auto', margin: 0,
                        }}>{seg.fullText}</pre>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* 消息流 */}
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
          <h3 class="text-[0.9rem] font-semibold">实时消息流</h3>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={connectSSE}>重连</button>
        </div>
        <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <For each={messages()}>
            {(m) => (
              <div class={`flex flex-col gap-0.5 p-2 rounded-md bg-white/[0.03] ${m.role === 'kp' ? 'bg-accent/[0.08] border-l-2 border-accent' : m.role === 'dice' ? 'bg-warn/[0.08] border-l-2 border-warn' : m.role === 'system' ? 'bg-[rgba(80,80,80,0.2)]' : ''}`}>
                <span class="text-[0.72rem] text-text-dim">{m.role === 'kp' ? '🎭 KP' : m.displayName ?? m.role}</span>
                <span class="text-[0.88rem] whitespace-pre-wrap">{m.content}</span>
              </div>
            )}
          </For>
        </div>
        <div class="flex gap-2 p-3 border-t border-border">
          <input
            class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
            placeholder="向 KP 注入信息（不对玩家显示）..."
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
          <h3 class="text-[0.9rem] font-semibold">线索</h3>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={refetchClues}>刷新</button>
        </div>
        <Show when={!clues.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <Show when={(clues() ?? []).length > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无线索</p>}>
            <For each={clues()}>
              {(c) => (
                <div class={`px-4 py-3 border-t border-border first:border-t-0 ${c.isDiscovered ? 'opacity-60' : ''}`}>
                  <div class="font-semibold text-[0.88rem] mb-1">
                    {c.isDiscovered ? '✅' : '🔒'} {c.title}
                  </div>
                  <div class="text-[0.82rem] text-text-dim mb-1.5">{c.keeperContent ?? c.playerDescription}</div>
                  {!c.isDiscovered && (
                    <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={() => discoverClue(c.id)}>标记已发现</button>
                  )}
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      {/* 游戏时间轴 */}
      <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10" style={{ 'grid-column': '1 / -1' }}>
        <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
          <h3 class="text-[0.9rem] font-semibold">游戏时间轴</h3>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={refetchTimeline}>刷新</button>
        </div>
        <Show when={!timeline.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
          <div style={{ 'margin-bottom': '0.75rem' }}>
            <span style={{ 'font-weight': 600, 'font-size': '1.1rem' }}>
              当前时间：{timeline()?.ingameTime ?? '未设定'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap', 'margin-bottom': '1rem' }}>
            <input
              class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
              style={{ width: '200px' }}
              placeholder="YYYY-MM-DDTHH:MM"
              value={timeInput()}
              onInput={(e) => setTimeInput(e.currentTarget.value)}
            />
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={setTime}>设定时间</button>
            <input
              class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]"
              type="number"
              style={{ width: '80px' }}
              min="1"
              value={advanceMin()}
              onInput={(e) => setAdvanceMin(parseInt(e.currentTarget.value) || 0)}
            />
            <span class="text-text-dim text-[0.9rem]" style={{ 'align-self': 'center' }}>分钟</span>
            <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200 active:scale-95" onClick={advanceTime}>推进时间</button>
          </div>
          <Show when={(timeline()?.events.length ?? 0) > 0} fallback={<p class="text-text-dim text-[0.9rem]">暂无时间轴事件</p>}>
            <div style={{ 'max-height': '250px', 'overflow-y': 'auto' }}>
              <For each={timeline()?.events}>
                {(ev: TimelineEvent) => (
                  <div style={{
                    padding: '0.35rem 0', 'border-bottom': '1px solid rgba(255,255,255,0.05)',
                    'font-size': '0.85rem', display: 'flex', gap: '0.75rem',
                  }}>
                    <span class="font-mono" style={{ 'min-width': '140px', color: 'var(--color-accent)' }}>{ev.ingameTime}</span>
                    <span style={{ flex: 1 }}>{ev.description}</span>
                    <span class="text-text-dim text-[0.9rem]" style={{ 'font-size': '0.72rem' }}>
                      {ev.trigger} · {new Date(ev.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default Sessions;
