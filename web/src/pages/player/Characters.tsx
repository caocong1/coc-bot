import { createResource, For, Show, type Component } from 'solid-js';
import { playerApi, type CharacterSummary } from '../../api';
import styles from './Player.module.css';

const Characters: Component = () => {
  const [chars, { refetch }] = createResource(() => playerApi.listCharacters().catch(() => []));

  const del = async (id: string, name: string) => {
    if (!confirm(`确定删除角色卡「${name}」？此操作不可撤销。`)) return;
    await playerApi.deleteCharacter(id).catch((e) => alert(String(e)));
    refetch();
  };

  return (
    <div>
      <div class={styles.pageHeader}>
        <a href="/player/characters/new" class={styles.btn}>＋ 新建角色卡</a>
      </div>

      <Show when={!chars.loading} fallback={<p class={styles.dim}>加载中...</p>}>
        <Show when={(chars() ?? []).length > 0} fallback={
          <div class={styles.empty}>
            <p>还没有角色卡</p>
            <a href="/player/characters/new" class={styles.btn} style={{ 'margin-top': '1rem' }}>新建第一张角色卡</a>
          </div>
        }>
          <div class={styles.cardGrid}>
            <For each={chars()}>
              {(c) => <CharCard char={c} onDelete={del} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const CharCard: Component<{ char: CharacterSummary; onDelete: (id: string, name: string) => void }> = (props) => {
  const c = props.char;
  return (
    <div class={`${styles.charCard} ${c.readonly ? styles.readonly : ''}`}>
      <div class={styles.charName}>{c.name}</div>
      <div class={styles.charMeta}>
        {c.occupation && <span>{c.occupation}</span>}
        {c.age && <span>· {c.age}岁</span>}
        {c.readonly && <span class={styles.badge}>跑团中</span>}
      </div>
      <div class={styles.charStats}>
        <StatChip label="HP" value={c.hp} />
        <StatChip label="SAN" value={c.san} />
      </div>
      <div class={styles.charActions}>
        {!c.readonly && (
          <>
            <a href={`/player?edit=${c.id}`} class={styles.btnSm}>编辑</a>
            <button class={styles.btnDanger} onClick={() => props.onDelete(c.id, c.name)}>删除</button>
          </>
        )}
        {c.readonly && <span class={styles.dim} style={{ 'font-size': '0.78rem' }}>跑团中不可编辑</span>}
      </div>
    </div>
  );
};

const StatChip: Component<{ label: string; value: number | null }> = (props) => (
  <div class={styles.statChip}>
    <span class={styles.statLabel}>{props.label}</span>
    <span class={styles.statVal}>{props.value ?? '—'}</span>
  </div>
);

export default Characters;
