import { createEffect, createResource, Show, type Component } from 'solid-js';
import Layout from '../../components/Layout';
import Characters from './Characters';
import CharacterForm from './CharacterForm';
import Scenarios from './Scenarios';
import Manual from './Manual';
import Reference from './Reference';
import Rooms from './Rooms';
import RoomDetailPage from './RoomDetail';
import { playerApi } from '../../api';

const NAV = [
  { label: '我的角色卡', href: '/player', icon: '🧑' },
  { label: '房间', href: '/player/rooms', icon: '🎭' },
  { label: '模组列表', href: '/player/scenarios', icon: '📖' },
  { label: '参考资料', href: '/player/reference', icon: '📚' },
  { label: '操作手册', href: '/player/manual', icon: '📋' },
];

const PlayerApp: Component = () => {
  // 从 URL token 参数自动存入 localStorage，保留其余参数（如 room id）
  const urlParams = new URLSearchParams(location.search);
  const urlToken = urlParams.get('token');
  if (urlToken) {
    localStorage.setItem('player_token', urlToken);
    urlParams.delete('token');
    const remaining = urlParams.toString();
    history.replaceState(null, '', location.pathname + (remaining ? '?' + remaining : ''));
  }

  const hasToken = !!localStorage.getItem('player_token');
  if (!hasToken) {
    return (
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'min-height': '100vh', 'text-align': 'center', padding: '2rem' }}>
        <div>
          <p style={{ 'font-size': '1.5rem', 'margin-bottom': '1rem' }}>🔑 需要登录</p>
          <p style={{ color: 'var(--text-dim)' }}>请<strong>私聊机器人</strong>发送 <code style={{ background: 'var(--surface)', padding: '0.1em 0.4em', 'border-radius': '4px' }}>.web login</code> 获取专属链接</p>
        </div>
      </div>
    );
  }

  const [me] = createResource(() => playerApi.getMe().catch(() => null));
  const path = location.pathname;
  const params = new URLSearchParams(location.search);

  let page: Component;
  let title = '我的角色卡';

  if (path === '/player/rooms' && params.has('id')) {
    const roomId = params.get('id')!;
    page = () => <RoomDetailPage id={roomId} />;
    title = '房间';
  } else if (path === '/player/rooms') {
    page = Rooms;
    title = '房间';
  } else if (path === '/player/campaigns') {
    page = () => <LegacyCampaignRedirect sessionId={params.get('id')} />;
    title = '房间';
  } else if (path === '/player/scenarios') {
    page = Scenarios;
    title = '模组列表';
  } else if (path === '/player/reference') {
    page = Reference;
    title = '参考资料';
  } else if (path === '/player/manual') {
    page = Manual;
    title = '操作手册';
  } else if (path === '/player/characters/new') {
    page = () => <CharacterForm />;
    title = '新建角色卡';
  } else if (params.has('edit')) {
    page = () => <CharacterForm editId={params.get('edit')!} />;
    title = '编辑角色卡';
  } else {
    page = Characters;
    title = '我的角色卡';
  }

  return (
    <Layout title={title} nav={NAV} activeKey={path}>
      <Show when={!me.loading}>
        {(() => { const P = page; return <P />; })()}
      </Show>
    </Layout>
  );
};

const LegacyCampaignRedirect: Component<{ sessionId: string | null }> = (props) => {
  const [redirect] = createResource(
    () => props.sessionId,
    async (sessionId) => {
      if (!sessionId) return { roomId: null, archived: false };
      return playerApi.getCampaignRedirect(sessionId).catch(() => ({ roomId: null, archived: true }));
    },
  );

  createEffect(() => {
    if (props.sessionId === null) {
      location.replace('/player/rooms');
      return;
    }
    const result = redirect();
    if (!result) return;
    if (result.roomId) {
      location.replace(`/player/rooms?id=${result.roomId}&tab=messages`);
      return;
    }
    if (result.archived) {
      location.replace('/player/rooms?archived=1');
    }
  });

  return (
    <div class="rounded-xl border border-border bg-surface px-5 py-6 text-sm text-text-dim">
      旧的“我的团”入口已并入房间，正在为你跳转到对应房间的消息历史…
    </div>
  );
};

export default PlayerApp;
