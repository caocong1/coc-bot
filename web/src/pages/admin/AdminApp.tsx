import { createSignal, type Component } from 'solid-js';
import Layout from '../../components/Layout';
import Dashboard from './Dashboard';
import Sessions from './Sessions';
import Knowledge from './Knowledge';
import KPStudio from './KPStudio';

const NAV = [
  { label: '总览', href: '/admin', icon: '📊' },
  { label: '跑团管理', href: '/admin/sessions', icon: '🎭' },
  { label: '知识库', href: '/admin/knowledge', icon: '📚' },
  { label: 'KP Studio', href: '/admin/studio', icon: '🎨' },
];

const AdminApp: Component = () => {
  const [authed, setAuthed] = createSignal(!!localStorage.getItem('admin_secret'));
  const [secretInput, setSecretInput] = createSignal('');

  const login = () => {
    localStorage.setItem('admin_secret', secretInput());
    setAuthed(true);
  };

  if (!authed()) {
    return (
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'min-height': '100vh' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', 'border-radius': '12px', padding: '2rem', width: '320px' }}>
          <h2 style={{ 'margin-bottom': '1rem' }}>🔧 管理端登录</h2>
          <input
            type="password"
            placeholder="Admin Secret"
            value={secretInput()}
            onInput={(e) => setSecretInput(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            style={{ width: '100%', padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', 'border-radius': '6px', color: 'var(--text)', 'margin-bottom': '0.75rem' }}
          />
          <button
            onClick={login}
            style={{ width: '100%', padding: '0.6rem', background: 'var(--accent)', border: 'none', 'border-radius': '6px', color: 'white', cursor: 'pointer', 'font-weight': '600' }}
          >
            进入
          </button>
        </div>
      </div>
    );
  }

  const path = location.pathname;
  let page: Component;
  if (path === '/admin/sessions') page = Sessions;
  else if (path === '/admin/knowledge') page = Knowledge;
  else if (path === '/admin/studio') page = KPStudio;
  else page = Dashboard;

  const title = NAV.find((n) => n.href === path)?.label ?? '总览';

  return (
    <Layout title={`管理端 — ${title}`} nav={NAV} activeKey={path}>
      {(() => { const P = page; return <P />; })()}
    </Layout>
  );
};

export default AdminApp;
