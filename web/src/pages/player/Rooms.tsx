import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { playerApi, type RoomSummary } from '../../api';
import styles from './Player.module.css';

const STATUS_LABEL: Record<string, string> = {
  waiting: '⏳ 等待中',
  running: '🟢 进行中',
  ended: '⚫ 已结束',
};

const Rooms: Component = () => {
  const [rooms, { refetch }] = createResource(() => playerApi.listRooms().catch(() => []));
  const [showCreate, setShowCreate] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [form, setForm] = createSignal({ name: '', groupId: '', scenarioName: '' });
  const [error, setError] = createSignal('');

  const createRoom = async () => {
    const f = form();
    if (!f.name.trim() || !f.groupId.trim()) {
      setError('房间名和群号不能为空');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await playerApi.createRoom({
        name: f.name.trim(),
        groupId: parseInt(f.groupId),
        scenarioName: f.scenarioName.trim() || undefined,
      });
      setShowCreate(false);
      setForm({ name: '', groupId: '', scenarioName: '' });
      location.href = `/player/rooms?id=${res.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div class={styles.pageHeader}>
        <button class={styles.btn} onClick={() => setShowCreate(!showCreate())}>
          {showCreate() ? '取消' : '＋ 创建房间'}
        </button>
      </div>

      <Show when={showCreate()}>
        <div class={styles.createForm}>
          <h3 style={{ margin: '0 0 1rem' }}>新建跑团房间</h3>
          <label class={styles.formLabel}>房间名称 *</label>
          <input
            class={styles.input}
            placeholder="例：与苏珊共进晚餐"
            value={form().name}
            onInput={(e) => setForm({ ...form(), name: e.currentTarget.value })}
          />
          <label class={styles.formLabel}>QQ 群号 *</label>
          <input
            class={styles.input}
            placeholder="跑团所在群的群号"
            type="number"
            value={form().groupId}
            onInput={(e) => setForm({ ...form(), groupId: e.currentTarget.value })}
          />
          <label class={styles.formLabel}>模组名称（选填）</label>
          <input
            class={styles.input}
            placeholder="留空则不指定模组"
            value={form().scenarioName}
            onInput={(e) => setForm({ ...form(), scenarioName: e.currentTarget.value })}
          />
          <Show when={error()}>
            <p class={styles.errorText}>{error()}</p>
          </Show>
          <button class={styles.btnPrimary} onClick={createRoom} disabled={creating()}>
            {creating() ? '创建中...' : '确认创建'}
          </button>
        </div>
      </Show>

      <Show when={!rooms.loading} fallback={<p class={styles.dim}>加载中...</p>}>
        <Show when={(rooms() ?? []).length > 0} fallback={
          <div class={styles.empty}>
            <p>还没有跑团房间</p>
            <p class={styles.dim} style={{ 'margin-top': '0.5rem' }}>
              点击「创建房间」发起一次跑团，或让 KP 分享房间 ID。
            </p>
          </div>
        }>
          <div class={styles.listSection}>
            <For each={rooms()}>
              {(r) => <RoomCard room={r} onRefetch={refetch} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const RoomCard: Component<{ room: RoomSummary; onRefetch: () => void }> = (props) => {
  const r = props.room;
  return (
    <a href={`/player/rooms?id=${r.id}`} class={styles.campaignCard}>
      <div class={styles.campaignTop}>
        <span class={styles.campaignStatus}>{STATUS_LABEL[r.status] ?? r.status}</span>
        <span class={styles.dim} style={{ 'font-size': '0.8rem' }}>群 #{r.groupId}</span>
      </div>
      <div class={styles.campaignScene}>{r.name}</div>
      <div class={styles.campaignMeta}>
        {r.scenarioName ? `模组：${r.scenarioName} · ` : ''}
        {r.memberCount} 人参与 · 创建于 {new Date(r.createdAt).toLocaleDateString()}
        {r.isCreator && <span class={styles.badge} style={{ 'margin-left': '0.5rem' }}>我创建</span>}
      </div>
    </a>
  );
};

export default Rooms;
