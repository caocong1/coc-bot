import { type Component, type JSX } from 'solid-js';

interface NavItem { label: string; href: string; icon: string; }

interface LayoutProps {
  title: string;
  nav: NavItem[];
  activeKey: string;
  children: JSX.Element;
}

const Layout: Component<LayoutProps> = (props) => (
  <div class="flex min-h-screen">
    {/* 侧边栏 */}
    <nav class="w-56 shrink-0 bg-surface border-r border-border flex flex-col py-6">
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
    <main class="flex-1 flex flex-col overflow-hidden">
      <header class="px-8 py-5 border-b border-border">
        <h1 class="text-xl font-semibold tracking-tight">{props.title}</h1>
      </header>
      <div class="flex-1 px-8 py-6 overflow-y-auto">{props.children}</div>
    </main>
  </div>
);

export default Layout;
