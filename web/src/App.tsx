import { createSignal, Show, type Component } from 'solid-js';
import PlayerApp from './pages/player/PlayerApp';
import AdminApp from './pages/admin/AdminApp';
import styles from './App.module.css';

const App: Component = () => {
  // 路由：/player → 玩家端，/admin → 管理端，/ → 自动判断
  const path = location.pathname;
  const isAdmin = path.startsWith('/admin');
  const isPlayer = path.startsWith('/player') ||
    new URLSearchParams(location.search).has('token') ||
    !!localStorage.getItem('player_token');

  if (isAdmin) return <AdminApp />;
  if (isPlayer) return <PlayerApp />;

  // 首页 — 选择入口
  return (
    <div class={styles.home}>
      <div class={styles.homeCard}>
        <h1 class={styles.title}>⚗️ CoC Bot 控制台</h1>
        <p class={styles.subtitle}>克苏鲁的呼唤 AI 跑团平台</p>
        <div class={styles.entryBtns}>
          <a href="/player" class={styles.btn}>
            🎲 玩家入口
            <span>查看角色卡、查看团进度</span>
          </a>
          <a href="/admin" class={styles.btnAdmin}>
            🔧 管理入口
            <span>KP 控制台、知识库管理</span>
          </a>
        </div>
        <p class={styles.hint}>玩家请在 QQ 中发送 <code>.web login</code> 获取专属登录链接</p>
      </div>
    </div>
  );
};

export default App;
