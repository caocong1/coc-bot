import { type Component, type JSX, createSignal, Show } from 'solid-js';

interface NavItem { label: string; href: string; icon: string; }

interface LayoutProps {
  title: string;
  nav: NavItem[];
  activeKey: string;
  children: JSX.Element;
}

const Layout: Component<LayoutProps> = (props) => {
  const [sidebarOpen, setSidebarOpen] = createSignal(false);

  return (
    <div class="flex min-h-screen">
      {/* 移动端遮罩层 */}
      <Show when={sidebarOpen()}>
        <div
          class="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      </Show>

      {/* 侧边栏 — 移动端滑入，桌面端固定 */}
      <nav class={`fixed inset-y-0 left-0 z-40 w-56 bg-surface border-r border-border flex flex-col py-6
        transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 md:shrink-0
        ${sidebarOpen() ? 'translate-x-0' : '-translate-x-full'}`}>
        <div class="text-xl font-bold px-5 pb-5 border-b border-border mb-3 tracking-tight">
          ⚗️ CoC Bot
        </div>
        <ul class="flex-1 list-none space-y-0.5 px-2">
          {props.nav.map((item) => {
            const active = location.pathname === item.href;
            return (
              <li>
                <a
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  class={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm no-underline transition-all duration-200
                    ${active
                      ? 'bg-accent/15 text-accent font-medium border-l-2 border-accent'
                      : 'text-text-dim hover:bg-white/5 hover:text-text border-l-2 border-transparent'
                    }`}
                >
                  <span class="text-base w-5 text-center">{item.icon}</span>
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 主内容区 */}
      <main class="flex-1 flex flex-col overflow-hidden min-w-0">
        <header class="px-4 py-3 md:px-8 md:py-5 border-b border-border flex items-center gap-3">
          {/* 汉堡菜单按钮 — 仅移动端显示 */}
          <button
            class="md:hidden shrink-0 w-10 h-10 flex items-center justify-center rounded-lg text-text-dim hover:text-text hover:bg-white/5 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开菜单"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h1 class="text-xl font-semibold tracking-tight">{props.title}</h1>
        </header>
        <div class="flex-1 px-4 py-4 md:px-8 md:py-6 overflow-y-auto">{props.children}</div>
      </main>
    </div>
  );
};

export default Layout;
