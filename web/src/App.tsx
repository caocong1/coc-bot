import { type Component } from 'solid-js';
import PlayerApp from './pages/player/PlayerApp';
import AdminApp from './pages/admin/AdminApp';

const App: Component = () => {
  const path = location.pathname;
  const isAdmin = path.startsWith('/admin');
  const isPlayer = path.startsWith('/player') ||
    new URLSearchParams(location.search).has('token') ||
    !!localStorage.getItem('player_token');

  if (isAdmin) return <AdminApp />;
  if (isPlayer) return <PlayerApp />;

  // 首页 — 选择入口
  return (
    <div class="flex items-center justify-center min-h-screen p-8">
      <div class="bg-surface border border-border rounded-2xl p-10 max-w-md w-full text-center shadow-xl shadow-black/20">
        <h1 class="text-3xl font-bold mb-2 tracking-tight">⚗️ CoC Bot 控制台</h1>
        <p class="text-text-dim mb-8">克苏鲁的呼唤 AI 跑团平台</p>

        <div class="flex flex-col gap-3 mb-6">
          <a href="/player"
            class="flex flex-col items-center py-4 px-5 rounded-xl no-underline text-lg font-semibold text-white
                   bg-accent hover:bg-accent-light shadow-lg shadow-accent/25 transition-all duration-200
                   hover:-translate-y-0.5 active:scale-[0.98]">
            🎲 玩家入口
            <span class="text-xs font-normal opacity-80 mt-1">查看角色卡、查看团进度</span>
          </a>
          <a href="/admin"
            class="flex flex-col items-center py-4 px-5 rounded-xl no-underline text-lg font-semibold text-white
                   bg-accent-dim hover:bg-accent shadow-lg shadow-accent-dim/25 transition-all duration-200
                   hover:-translate-y-0.5 active:scale-[0.98]">
            🔧 管理入口
            <span class="text-xs font-normal opacity-80 mt-1">KP 控制台、知识库管理</span>
          </a>
        </div>

        <p class="text-xs text-text-dim">
          玩家请在 QQ 中发送 <code class="bg-bg px-1.5 py-0.5 rounded font-mono text-text-dim">.web login</code> 获取专属登录链接
        </p>
      </div>
    </div>
  );
};

export default App;
