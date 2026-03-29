import { createSignal, Show, type Component } from 'solid-js';
import Layout from '../../components/Layout';
import Dashboard from './Dashboard';
import Knowledge from './Knowledge';
import ScenarioManager from './ScenarioManager';
import ScenarioDetail from './ScenarioDetail';
import KPStudio from './KPStudio';
import RoomManager from './RoomManager';
import AIProviders from './AIProviders';

const NAV = [
  { label: '总览', href: '/admin', icon: '📊' },
  { label: '房间', href: '/admin/rooms', icon: '🎭' },
  { label: '模组管理', href: '/admin/scenarios', icon: '📖' },
  { label: '规则书', href: '/admin/knowledge', icon: '📚' },
  { label: 'KP Studio', href: '/admin/studio', icon: '🎨' },
  { label: 'AI Provider', href: '/admin/ai-providers', icon: '🤖' },
];

const AdminApp: Component = () => {
  const [authed, setAuthed] = createSignal(!!localStorage.getItem('admin_secret'));
  const [secretInput, setSecretInput] = createSignal('');

  const login = () => {
    localStorage.setItem('admin_secret', secretInput());
    setAuthed(true);
  };

  return (
    <Show
      when={authed()}
      fallback={
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'min-height': '100vh' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', 'border-radius': '12px', padding: '2rem', width: '320px' }}>
            <h2 style={{ 'margin-bottom': '1rem' }}>🔧 管理端登录</h2>
            <input
              type="password"
              placeholder="Admin Secret"
              value={secretInput()}
              onInput={(e) => setSecretInput(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              style={{ width: '100%', padding: '0.6rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', 'border-radius': '6px', color: 'var(--color-text)', 'margin-bottom': '0.75rem' }}
            />
            <button
              onClick={login}
              style={{ width: '100%', padding: '0.6rem', background: 'var(--color-accent)', border: 'none', 'border-radius': '6px', color: 'white', cursor: 'pointer', 'font-weight': '600' }}
            >
              进入
            </button>
          </div>
        </div>
      }
    >
      {(() => {
        const path = location.pathname;
        let page: Component;
        if (path === '/admin/ai-providers') page = AIProviders;
        else if (path === '/admin/rooms') page = RoomManager;
        else if (path.startsWith('/admin/scenarios/')) page = ScenarioDetail;
        else if (path === '/admin/scenarios') page = ScenarioManager;
        else if (path === '/admin/knowledge') page = Knowledge;
        else if (path === '/admin/studio') page = KPStudio;
        else page = Dashboard;

        const title = path.startsWith('/admin/scenarios/')
          ? '模组详情'
          : NAV.find((n) => n.href === path)?.label ?? '总览';

        return (
          <Layout title={`管理端 — ${title}`} nav={NAV} activeKey={path}>
            {(() => { const P = page; return <P />; })()}
          </Layout>
        );
      })()}
    </Show>
  );
};

export default AdminApp;
