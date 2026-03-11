import { type Component, type JSX } from 'solid-js';
import styles from './Layout.module.css';

interface NavItem { label: string; href: string; icon: string; }

interface LayoutProps {
  title: string;
  nav: NavItem[];
  activeKey: string;
  children: JSX.Element;
}

const Layout: Component<LayoutProps> = (props) => (
  <div class={styles.shell}>
    <nav class={styles.sidebar}>
      <div class={styles.logo}>⚗️ CoC Bot</div>
      <ul class={styles.navList}>
        {props.nav.map((item) => (
          <li>
            <a
              href={item.href}
              class={`${styles.navItem} ${location.pathname === item.href ? styles.active : ''}`}
            >
              <span class={styles.icon}>{item.icon}</span>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
    <main class={styles.main}>
      <header class={styles.header}>
        <h1 class={styles.pageTitle}>{props.title}</h1>
      </header>
      <div class={styles.content}>{props.children}</div>
    </main>
  </div>
);

export default Layout;
