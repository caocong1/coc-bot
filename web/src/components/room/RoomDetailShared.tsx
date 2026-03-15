import { createEffect, createResource, For, Show, type Component, type JSX } from 'solid-js';
import { type Message, type RoomConstraints, type RoomMemberView, type RoomRelationType, type RoomRelationship } from '../../api';

export type RoomTab = 'overview' | 'messages' | 'manage';

export const PRIMARY_ATTRIBUTE_KEYS = ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'] as const;

export const STATUS_LABEL: Record<string, string> = {
  waiting: '⏳ 等待中',
  reviewing: '📋 审卡中',
  running: '🟢 进行中',
  paused: '⏸️ 已暂停',
  ended: '⚫ 已结束',
};

export const STATUS_BADGE_CLASS: Record<string, string> = {
  waiting: 'border-white/[0.12] bg-white/[0.06] text-text',
  reviewing: 'border-warn/30 bg-warn/12 text-warn',
  running: 'border-success/30 bg-success/12 text-success',
  paused: 'border-warn/30 bg-warn/12 text-warn',
  ended: 'border-white/[0.08] bg-white/[0.04] text-text-dim',
};

export function getFitIssuesFromSummary(
  occupation: string | null,
  primaryAttributeTotal: number | null,
  constraints?: RoomConstraints,
): string[] {
  if (!constraints) return [];
  const issues: string[] = [];
  if (constraints.allowedOccupations?.length) {
    if (!occupation) {
      issues.push('职业缺失');
    } else if (!constraints.allowedOccupations.includes(occupation)) {
      issues.push(`职业不符：${occupation}`);
    }
  }
  if (constraints.totalPoints != null) {
    if (primaryAttributeTotal == null) {
      issues.push('主属性总点缺失');
    } else if (primaryAttributeTotal !== constraints.totalPoints) {
      issues.push(`总点不符：${primaryAttributeTotal}/${constraints.totalPoints}`);
    }
  }
  return issues;
}

export function getPrimaryAttributeTotal(attributes?: Record<string, unknown> | null): number | null {
  if (!attributes) return null;
  let hasAny = false;
  const total = PRIMARY_ATTRIBUTE_KEYS.reduce((sum, key) => {
    const value = Number(attributes[key]);
    if (!Number.isNaN(value) && value > 0) hasAny = true;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return hasAny ? total : null;
}

export function getMemberFitIssues(member: RoomMemberView, constraints?: RoomConstraints): string[] {
  if (!member.character) return ['未选择角色卡'];
  const total = getPrimaryAttributeTotal(member.character.attributes);
  return getFitIssuesFromSummary(member.character.occupation, total, constraints);
}

function formatMessageDay(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

type MessageHighlight = {
  icon: string;
  label: string;
  tone: 'warn' | 'success' | 'accent';
};

function detectMessageHighlight(message: Message, isKp: boolean, isSystem: boolean): MessageHighlight | null {
  const content = message.content.trim();
  if (!content) return null;
  if (/(检定|d100|奖励骰|惩罚骰|大成功|大失败|san|理智)/i.test(content)) {
    return { icon: '🎲', label: '检定结果', tone: 'warn' };
  }
  if (isKp && /(线索|证物|笔记|日记|信件|地图|照片|发现了|察觉到)/.test(content)) {
    return { icon: '🧩', label: '线索推进', tone: 'success' };
  }
  if ((isKp || isSystem) && /(分钟后|小时后|次日|翌日|午夜|黎明|黄昏|时间推进|天色|钟声)/.test(content)) {
    return { icon: '⏰', label: '时间推进', tone: 'accent' };
  }
  return null;
}

function getHighlightClasses(highlight: MessageHighlight | null): { badge: string; bubble: string; panel: string } {
  if (!highlight) return { badge: '', bubble: '', panel: '' };
  switch (highlight.tone) {
    case 'warn':
      return {
        badge: 'border-warn/25 bg-warn/12 text-warn',
        bubble: 'border-warn/25 bg-warn/[0.08]',
        panel: 'bg-warn/[0.08] border-b border-warn/20 text-warn',
      };
    case 'success':
      return {
        badge: 'border-success/25 bg-success/12 text-success',
        bubble: 'border-success/25 bg-success/[0.08]',
        panel: 'bg-success/[0.08] border-b border-success/20 text-success',
      };
    default:
      return {
        badge: 'border-accent/25 bg-accent/12 text-accent',
        bubble: 'border-accent/25 bg-accent/[0.08]',
        panel: 'bg-accent/[0.08] border-b border-accent/20 text-accent',
      };
  }
}

type StructuredMessageParts = {
  headline: string;
  meta: string | null;
  detailLines: string[];
  alertLines: string[];
};

function parseHighlightedMessage(content: string, highlight: MessageHighlight | null): StructuredMessageParts {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headline: content, meta: null, detailLines: [], alertLines: [] };
  }

  const alertLines = lines.filter((line) => /^⚠/.test(line));
  const normalLines = lines.filter((line) => !/^⚠/.test(line));
  let headline = normalLines[0] ?? lines[0];
  let meta: string | null = null;
  let detailLines = normalLines.slice(1);

  if (highlight?.tone === 'warn') {
    const rollMatch = headline.match(/^(.*?)(D100=\d+\/\d+\s*(?:大成功|极限成功|困难成功|成功|失败|大失败).*)$/);
    if (rollMatch) {
      headline = rollMatch[1].trim();
      meta = rollMatch[2].trim();
    } else {
      const colonMatch = headline.match(/^([^:：]+)[：:]\s*(.+)$/);
      if (colonMatch) {
        headline = colonMatch[1].trim();
        meta = colonMatch[2].trim();
      }
    }
  } else {
    const colonMatch = headline.match(/^([^:：]+)[：:]\s*(.+)$/);
    if (colonMatch && detailLines.length > 0) {
      headline = colonMatch[1].trim();
      meta = colonMatch[2].trim();
    }
  }

  if (!headline) headline = content;

  return { headline, meta, detailLines, alertLines };
}

export const RoomHeaderHero: Component<{
  name: string;
  status: string;
  scenarioName: string | null;
  ingameTime?: string | null;
  memberCount: number;
  readyCount: number;
  groupId: number | null;
  identityLabel: string;
  description: string;
  footerNote: string;
  actions?: JSX.Element;
}> = (props) => (
  <div class="relative overflow-hidden rounded-[1.75rem] border border-border bg-surface px-5 py-5 mb-5 shadow-lg shadow-black/15">
    <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(124,106,247,0.24),transparent_58%)]" />
    <div class="relative flex justify-between items-start flex-wrap gap-5">
      <div class="flex-1 min-w-[280px]">
        <div class="flex items-center gap-2 flex-wrap mb-3">
          <span class={`inline-flex items-center rounded-full border px-3 py-1 text-[0.78rem] font-semibold ${STATUS_BADGE_CLASS[props.status] ?? STATUS_BADGE_CLASS.waiting}`}>
            {STATUS_LABEL[props.status] ?? props.status}
          </span>
          <Show when={props.scenarioName}>
            <span class="inline-flex items-center rounded-full border border-accent/20 bg-accent/[0.08] px-3 py-1 text-[0.78rem] font-semibold text-accent">
              模组：{props.scenarioName}
            </span>
          </Show>
          <Show when={props.ingameTime}>
            <span class="inline-flex items-center rounded-full border border-success/20 bg-success/[0.08] px-3 py-1 text-[0.78rem] font-semibold text-success">
              游戏时间：{props.ingameTime}
            </span>
          </Show>
        </div>
        <h2 class="m-0 text-[1.75rem] leading-tight tracking-tight">{props.name}</h2>
        <div class="mt-2 text-[0.86rem] text-text-dim max-w-3xl leading-6">{props.description}</div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 mt-4 max-w-3xl">
          <HeroStat label="成员" value={String(props.memberCount)} />
          <HeroStat label="已准备" value={String(props.readyCount)} />
          <HeroStat label="群号" value={props.groupId != null ? String(props.groupId) : '未绑定'} />
          <HeroStat label="身份" value={props.identityLabel} />
        </div>
      </div>
      <div class="w-full max-w-[320px] rounded-3xl border border-white/[0.08] bg-black/10 backdrop-blur-sm px-4 py-4 shadow-sm shadow-black/10">
        <div class="text-[0.78rem] uppercase tracking-[0.16em] text-text-dim mb-3">快捷操作</div>
        <div class="flex gap-2 items-center flex-wrap">{props.actions}</div>
        <div class="mt-3 text-[0.76rem] leading-6 text-text-dim">{props.footerNote}</div>
      </div>
    </div>
  </div>
);

const HeroStat: Component<{ label: string; value: string }> = (props) => (
  <div class="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-3">
    <div class="text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">{props.label}</div>
    <div class="mt-1 text-xl font-bold text-text">{props.value}</div>
  </div>
);

export const RoomTabsBar: Component<{
  activeTab: RoomTab;
  onChange: (tab: RoomTab) => void;
  includeManage?: boolean;
}> = (props) => {
  const tabs: Array<[RoomTab, string]> = [
    ['overview', '🧭 房间信息'],
    ['messages', '💬 消息历史'],
  ];
  if (props.includeManage) tabs.push(['manage', '🛠 管理区']);
  return (
    <div class="mb-6 rounded-2xl border border-border bg-white/[0.03] p-1 shadow-sm shadow-black/10">
      <div class="flex flex-wrap gap-1">
        <For each={tabs}>
          {([tab, label]) => (
            <button
              class={`px-4 py-2.5 text-sm font-semibold rounded-xl cursor-pointer transition-all duration-150 ${
                props.activeTab === tab
                  ? 'bg-accent text-white shadow-sm shadow-accent/30'
                  : 'bg-transparent text-text-dim hover:text-text hover:bg-white/[0.04]'
              }`}
              onClick={() => props.onChange(tab)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};

export const RoomMembersPanel: Component<{
  members: RoomMemberView[];
  constraints?: RoomConstraints;
  readyCount: number;
}> = (props) => (
  <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 style={{ margin: '0 0 0.2rem' }}>成员 ({props.members.length})</h3>
        <div class="text-[0.78rem] text-text-dim">当前房间的参与者与所选角色卡。</div>
      </div>
      <span class="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1 text-[0.72rem] font-semibold text-text-dim">
        已准备 {props.readyCount}
      </span>
    </div>
    <For each={props.members}>
      {(member) => <MemberRow member={member} constraints={props.constraints} />}
    </For>
  </div>
);

const MemberRow: Component<{ member: RoomMemberView; constraints?: RoomConstraints }> = (props) => {
  const m = props.member;
  const avatarText = m.character?.name?.slice(0, 1) || String(m.qqId).slice(-2);
  const issues = () => getMemberFitIssues(m, props.constraints);
  const hasConstraints = () => Boolean(props.constraints?.allowedOccupations?.length || props.constraints?.totalPoints != null);
  const primaryTotal = () => getPrimaryAttributeTotal(m.character?.attributes);
  const cardToneClass = () => {
    if (!m.character) return 'border-white/[0.08] bg-surface';
    if (hasConstraints() && issues().length > 0) return 'border-danger/20 bg-danger/[0.04]';
    if (m.readyAt) return 'border-success/20 bg-success/[0.03]';
    return 'border-white/[0.08] bg-surface';
  };
  return (
    <div class={`border rounded-2xl px-4 py-3 mb-3 shadow-sm shadow-black/10 ${cardToneClass()}`}>
      <div class="flex items-start gap-3">
        <div class={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold ${
          m.isCreator
            ? 'bg-accent/18 border border-accent/25 text-accent'
            : m.readyAt
              ? 'bg-success/12 border border-success/20 text-success'
              : 'bg-white/[0.06] border border-white/[0.08] text-text'
        }`}>
          {avatarText}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span style={{ 'font-weight': 600 }}>QQ {m.qqId}</span>
            {m.isCreator && <span class="bg-accent-dim text-white text-[0.72rem] px-2 py-0.5 rounded-[10px]">创建者</span>}
            {m.readyAt && <span class="bg-success/15 border border-success/25 text-success text-[0.72rem] px-2 py-0.5 rounded-[10px]">✅ 已准备</span>}
            <Show when={hasConstraints() && issues().length === 0}>
              <span class="bg-success/15 border border-success/25 text-success text-[0.72rem] px-2 py-0.5 rounded-[10px]">符合要求</span>
            </Show>
            <Show when={hasConstraints() && issues().length > 0}>
              <span class="bg-danger/12 border border-danger/25 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">需调整</span>
            </Show>
          </div>
          <div class="text-text mt-1 text-[0.92rem] font-semibold">{m.character?.name ?? '未选择角色卡'}</div>
          <div class="text-text-dim text-[0.82rem] mt-1 leading-6">
            {m.character
              ? `${m.character.occupation ?? '未知职业'} · HP ${m.character.hp ?? '?'} · SAN ${m.character.san ?? '?'}`
              : '等待玩家选择角色卡'}
          </div>
          <Show when={m.character}>
            <div class="flex flex-wrap gap-2 mt-2">
              <Show when={m.character?.occupation}>
                <span class="bg-white/[0.06] border border-white/[0.08] text-text text-[0.72rem] px-2 py-0.5 rounded-[10px]">
                  职业 {m.character?.occupation}
                </span>
              </Show>
              <Show when={primaryTotal() != null}>
                <span class="bg-white/[0.06] border border-white/[0.08] text-text text-[0.72rem] px-2 py-0.5 rounded-[10px]">
                  主属性 {primaryTotal()}
                </span>
              </Show>
            </div>
          </Show>
          <Show when={hasConstraints() && issues().length > 0}>
            <div class="flex flex-wrap gap-2 mt-2">
              <For each={issues()}>
                {(issue) => <span class="bg-danger/10 border border-danger/20 text-danger text-[0.72rem] px-2 py-0.5 rounded-[10px]">{issue}</span>}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export const RoomRelationshipsPanel: Component<{
  relationships: RoomRelationship[];
  relationSource?: string;
  onRelationSourceChange?: (value: string) => void;
  relationTarget: string;
  onRelationTargetChange: (value: string) => void;
  relationType: RoomRelationType;
  onRelationTypeChange: (value: RoomRelationType) => void;
  relationNotes: string;
  onRelationNotesChange: (value: string) => void;
  onSave: () => void;
  onClear: (relation: RoomRelationship) => void;
  canClear: (relation: RoomRelationship) => boolean;
  saving: boolean;
  helperText: string;
}> = (props) => {
  const relationships = () => props.relationships ?? [];

  return (
    <div class="rounded-[1.5rem] border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 style={{ margin: '0 0 0.2rem' }}>人物关系</h3>
          <div class="text-[0.78rem] text-text-dim">{props.helperText}</div>
        </div>
        <span class="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1 text-[0.72rem] font-semibold text-text-dim">
          {relationships().length} 条关系
        </span>
      </div>
      <div class="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-4 flex flex-col gap-3">
        <Show when={relationships().length > 0} fallback={<p class="text-text-dim text-sm">还没有显式关系。也可以直接在群里用 <code>.room relation</code> 配。</p>}>
          <div class="flex flex-col gap-2">
            <For each={relationships()}>
              {(relation) => (
                <div class="border border-border rounded-xl px-3 py-3 text-sm bg-surface/80">
                  <div style={{ 'font-weight': 600 }}>QQ {relation.userA} ↔ QQ {relation.userB}</div>
                  <div class="text-text-dim">{relation.relationType}{relation.notes ? ` · ${relation.notes}` : ''}</div>
                  <Show when={props.canClear(relation)}>
                    <div style={{ 'margin-top': '0.5rem' }}>
                      <button
                        class="px-3 py-1.5 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95"
                        onClick={() => props.onClear(relation)}
                        disabled={props.saving}
                      >
                        清除
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="border-t border-border pt-3 flex flex-col gap-2">
          <div class="text-sm" style={{ 'font-weight': 600 }}>新增或覆盖关系</div>
          <Show when={props.onRelationSourceChange}>
            <input
              value={props.relationSource ?? ''}
              onInput={(e) => props.onRelationSourceChange?.(e.currentTarget.value)}
              placeholder="来源 QQ 号"
              class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text"
            />
          </Show>
          <input
            value={props.relationTarget}
            onInput={(e) => props.onRelationTargetChange(e.currentTarget.value)}
            placeholder={props.onRelationSourceChange ? '目标 QQ 号' : '目标 QQ 号'}
            class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text"
          />
          <select
            value={props.relationType}
            onChange={(e) => props.onRelationTypeChange(e.currentTarget.value as RoomRelationType)}
            class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text"
          >
            <option value="heard_of">heard_of</option>
            <option value="acquainted">acquainted</option>
            <option value="close">close</option>
            <option value="bound">bound</option>
            <option value="secret_tie">secret_tie</option>
          </select>
          <textarea
            value={props.relationNotes}
            onInput={(e) => props.onRelationNotesChange(e.currentTarget.value)}
            placeholder="备注，可写旧识来源、共同经历等"
            class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text min-h-[84px]"
          />
          <button
            class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
            onClick={props.onSave}
            disabled={props.saving}
          >
            {props.saving ? '保存中...' : '保存关系'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const RoomMessagesPanel: Component<{
  roomId: string;
  fetchMessages: (roomId: string) => Promise<Message[]>;
  title?: string;
  subtitle?: string;
}> = (props) => {
  const [messages, { refetch }] = createResource(() => props.roomId, (roomId) => props.fetchMessages(roomId).catch(() => []));
  let scrollContainer!: HTMLDivElement;

  const scrollToLatest = () => {
    queueMicrotask(() => {
      scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
    });
  };

  createEffect(() => {
    if (messages.loading) return;
    messages();
    scrollToLatest();
  });

  return (
    <div class="relative overflow-hidden bg-surface border border-border rounded-2xl p-4 shadow-sm shadow-black/10">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/[0.08] to-transparent" />
      <div class="flex justify-between items-center gap-3 mb-4 flex-wrap">
        <div>
          <h3 style={{ margin: 0 }}>{props.title ?? '跑团记录'}</h3>
          <div class="text-[0.8rem] text-text-dim mt-1">
            {props.subtitle ?? '每次进入或刷新都会自动定位到最新消息，长段落也能在这里完整展开阅读。'}
          </div>
          <Show when={!messages.loading && (messages()?.length ?? 0) > 0}>
            <div class="mt-2 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.08] px-3 py-1 text-[0.72rem] text-accent">
              共 {(messages()?.length ?? 0)} 条记录
            </div>
          </Show>
        </div>
        <button
          class="inline-block px-5 py-2 bg-accent text-white border-none rounded-md text-[0.9rem] font-semibold cursor-pointer no-underline hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
          onClick={() => {
            refetch();
            scrollToLatest();
          }}
        >
          刷新并跳到最新
        </button>
      </div>
      <Show when={!messages.loading} fallback={<p class="text-text-dim">加载中...</p>}>
        <Show when={(messages() ?? []).length > 0} fallback={<p class="text-text-dim">暂无消息记录</p>}>
          <div
            ref={scrollContainer}
            class="relative bg-gradient-to-b from-bg to-surface/80 border border-border rounded-2xl px-4 py-5 max-h-[72vh] min-h-[60vh] overflow-y-auto"
          >
            <For each={messages()}>
              {(m: Message, index) => {
                const isKp = m.role === 'kp';
                const isSystem = !isKp && (m.role === 'system' || m.role === 'director');
                const speaker = isKp ? 'KP' : m.displayName ?? m.role;
                const avatarText = isKp ? 'KP' : speaker.slice(0, 1).toUpperCase();
                const highlight = detectMessageHighlight(m, isKp, isSystem);
                const highlightClasses = getHighlightClasses(highlight);
                const structuredMessage = parseHighlightedMessage(m.content, highlight);
                const systemLabel = m.role === 'director' ? '导演提示' : '系统';
                const previous = index() > 0 ? messages()?.[index() - 1] ?? null : null;
                const currentTime = new Date(m.timestamp);
                const previousTime = previous ? new Date(previous.timestamp) : null;
                const showDaySeparator = !previous || formatMessageDay(previous.timestamp) !== formatMessageDay(m.timestamp);
                const gapMinutes = previousTime
                  ? Math.floor((currentTime.getTime() - previousTime.getTime()) / 60000)
                  : 0;
                const showGapSeparator = !showDaySeparator && gapMinutes >= 45;
                const gapLabel = gapMinutes >= 120
                  ? `${Math.floor(gapMinutes / 60)} 小时后`
                  : `${gapMinutes} 分钟后`;
                return (
                  <>
                    <Show when={showDaySeparator}>
                      <div class="relative flex items-center gap-3 my-5">
                        <div class="flex-1 h-px bg-white/[0.08]" />
                        <div class="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[0.72rem] font-semibold tracking-[0.12em] text-text-dim uppercase shadow-sm">
                          {formatMessageDay(m.timestamp)}
                        </div>
                        <div class="flex-1 h-px bg-white/[0.08]" />
                      </div>
                    </Show>
                    <Show when={showGapSeparator}>
                      <div class="flex justify-center mb-4">
                        <div class="rounded-full border border-accent/18 bg-accent/[0.07] px-3 py-1 text-[0.72rem] text-accent shadow-sm">
                          {gapLabel} · {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </Show>
                    <Show
                      when={!isSystem}
                      fallback={(
                        <div class="flex justify-center mb-4">
                          <div class="max-w-[92%] rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-[0.82rem] text-text-dim text-center shadow-sm">
                            <div class="mb-1 text-[0.72rem] uppercase tracking-[0.16em] text-text-dim/80">{systemLabel}</div>
                            <div class="whitespace-pre-wrap break-words leading-6 text-text">{m.content}</div>
                          </div>
                        </div>
                      )}
                    >
                      <div class={`flex mb-4 ${isKp ? 'justify-start' : 'justify-end'}`}>
                        <div class={`max-w-[90%] flex items-end gap-3 ${isKp ? 'flex-row' : 'flex-row-reverse'}`}>
                          <div
                            class={`shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center text-[0.72rem] font-bold shadow-sm ${
                              isKp
                                ? 'bg-accent text-white'
                                : 'bg-white/[0.08] border border-white/[0.1] text-text'
                            }`}
                          >
                            {avatarText}
                          </div>
                          <div class={`flex flex-col ${isKp ? 'items-start' : 'items-end'}`}>
                            <div class={`flex items-center gap-2 mb-1 px-1 ${isKp ? 'justify-start' : 'justify-end'}`}>
                              <span class={`text-[0.78rem] font-semibold ${isKp ? 'text-accent' : 'text-text'}`}>{speaker}</span>
                              <span class="text-[0.72rem] text-text-dim">
                                {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div
                              class={`rounded-[1.25rem] px-4 py-3.5 text-[0.92rem] leading-7 whitespace-pre-wrap break-words shadow-sm ${
                                isKp
                                  ? 'bg-accent/12 border border-accent/25 text-text rounded-tl-md'
                                  : 'bg-white/[0.05] border border-white/[0.08] text-text rounded-tr-md'
                              } ${highlightClasses.bubble}`}
                            >
                              <Show when={highlight}>
                                <div class={`-mx-4 -mt-3.5 mb-3 flex items-center justify-between gap-3 rounded-t-[1.1rem] px-4 py-2.5 text-[0.74rem] font-semibold tracking-[0.08em] ${highlightClasses.panel}`}>
                                  <span class="inline-flex items-center gap-2">
                                    <span class="text-[0.95rem] leading-none">{highlight?.icon}</span>
                                    <span>{highlight?.label}</span>
                                  </span>
                                  <span class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] ${highlightClasses.badge}`}>
                                    重点记录
                                  </span>
                                </div>
                              </Show>
                              <Show
                                when={highlight}
                                fallback={<div class={highlight?.tone === 'warn' ? 'font-medium' : ''}>{m.content}</div>}
                              >
                                <div class="flex flex-col gap-3">
                                  <div class={highlight?.tone === 'warn' ? 'text-[0.98rem] font-semibold leading-7' : 'text-[0.95rem] font-medium leading-7'}>
                                    {structuredMessage.headline}
                                  </div>
                                  <Show when={structuredMessage.meta}>
                                    <div class={`inline-flex max-w-full items-center rounded-xl border px-3 py-2 text-[0.78rem] font-semibold leading-6 ${highlightClasses.badge}`}>
                                      {structuredMessage.meta}
                                    </div>
                                  </Show>
                                  <Show when={structuredMessage.detailLines.length > 0}>
                                    <div class="flex flex-col gap-2">
                                      <For each={structuredMessage.detailLines}>
                                        {(line) => <div class="rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2 text-[0.82rem] leading-6 text-text-dim">{line}</div>}
                                      </For>
                                    </div>
                                  </Show>
                                  <Show when={structuredMessage.alertLines.length > 0}>
                                    <div class="flex flex-col gap-2">
                                      <For each={structuredMessage.alertLines}>
                                        {(line) => <div class="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-[0.8rem] font-medium leading-6 text-danger">{line}</div>}
                                      </For>
                                    </div>
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};
