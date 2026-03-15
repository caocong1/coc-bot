import { createEffect, createResource, createSignal, For, Show, type Component } from 'solid-js';
import { adminApi } from '../../api';
import { ModuleFiles, ModuleForm } from './ScenarioManager';

const ScenarioDetail: Component = () => {
  const moduleId = decodeURIComponent(location.pathname.replace('/admin/scenarios/', '').trim());
  const [detail, { refetch }] = createResource(
    () => moduleId || null,
    (id) => adminApi.getModule(id).catch(() => null),
  );
  const [editing, setEditing] = createSignal(false);
  const [privacyModeDraft, setPrivacyModeDraft] = createSignal<'public' | 'secret'>('public');
  const [privacyNotesDraft, setPrivacyNotesDraft] = createSignal('');
  const [savingRulePack, setSavingRulePack] = createSignal(false);

  createEffect(() => {
    const pack = detail()?.rulePack;
    setPrivacyModeDraft(pack?.playPrivacyMode ?? 'public');
    setPrivacyNotesDraft(pack?.privacyNotes ?? '');
  });

  const goBack = () => {
    location.href = '/admin/scenarios';
  };

  const saveRulePack = async () => {
    if (!moduleId) return;
    setSavingRulePack(true);
    try {
      const pack = detail()?.rulePack;
      await adminApi.updateModuleRulePack(moduleId, {
        ...(pack ?? {}),
        playPrivacyMode: privacyModeDraft(),
        privacyNotes: privacyNotesDraft().trim(),
        reviewStatus: pack?.reviewStatus ?? 'approved',
      });
      await refetch();
    } finally {
      setSavingRulePack(false);
    }
  };

  return (
    <div class="flex flex-col gap-6">
      <div class="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-black/10">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <button
                class="rounded-full border border-border bg-white/[0.04] px-3 py-1 text-sm text-text-dim transition hover:border-text-dim hover:text-text"
                onClick={goBack}
              >
                ← 返回模组列表
              </button>
              <Show when={!detail.loading && detail()}>
                <button
                  class="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm text-accent transition hover:border-accent hover:bg-accent/15"
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing() ? '收起编辑' : '编辑模组'}
                </button>
              </Show>
            </div>
            <Show when={!detail.loading && detail()} fallback={<div class="text-text-dim">正在加载模组详情...</div>}>
              {(mod) => (
                <>
                  <div class="space-y-2">
                    <h1 class="text-3xl font-bold tracking-tight text-text">📖 {mod().name}</h1>
                    <Show when={mod().description}>
                      <p class="max-w-4xl text-sm leading-7 text-text-dim">{mod().description}</p>
                    </Show>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Show when={mod().era}>
                      <span class="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                        {mod().era}
                      </span>
                    </Show>
                    <Show when={mod().allowedOccupations.length > 0}>
                      <span class="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                        职业限制：{mod().allowedOccupations.join('、')}
                      </span>
                    </Show>
                    <Show when={mod().totalPoints != null}>
                      <span class="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                        总点要求：{mod().totalPoints}
                      </span>
                    </Show>
                    <span class="rounded-full border border-border bg-white/[0.04] px-3 py-1 text-xs text-text-dim">
                      {mod().files.filter((file) => file.fileType === 'document').length} 个文档
                    </span>
                    <span class="rounded-full border border-border bg-white/[0.04] px-3 py-1 text-xs text-text-dim">
                      {mod().images.length} 张场景图片
                    </span>
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>
      </div>

      <Show when={!detail.loading && detail()} fallback={<div class="rounded-2xl border border-border bg-surface p-6 text-text-dim">加载中...</div>}>
        {(mod) => (
          <>
            <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <div class="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                <div class="mb-4">
                  <h2 class="text-lg font-semibold text-text">文件与场景图片</h2>
                  <p class="mt-1 text-sm text-text-dim">文档、提取图片、自动补图和手动上传图片都会集中展示在这里。</p>
                </div>
                <Show when={editing()}>
                  <div class="mb-5">
                    <ModuleForm
                      initial={mod()}
                      onSave={async (payload) => {
                        await adminApi.updateModule(moduleId, payload);
                        setEditing(false);
                        await refetch();
                      }}
                      onCancel={() => setEditing(false)}
                    />
                  </div>
                </Show>
                <ModuleFiles moduleId={mod().id} detail={mod()} onRefetch={refetch} />
              </div>

              <div class="space-y-6">
                <div class="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                  <h2 class="text-lg font-semibold text-text">模组资产概览</h2>
                  <div class="mt-4 grid grid-cols-3 gap-3 text-center">
                    <div class="rounded-xl border border-border bg-white/[0.03] p-4">
                      <div class="text-2xl font-bold text-text">{mod().entities.length}</div>
                      <div class="mt-1 text-xs text-text-dim">实体</div>
                    </div>
                    <div class="rounded-xl border border-border bg-white/[0.03] p-4">
                      <div class="text-2xl font-bold text-text">{mod().items.length}</div>
                      <div class="mt-1 text-xs text-text-dim">物品</div>
                    </div>
                    <div class="rounded-xl border border-border bg-white/[0.03] p-4">
                      <div class="text-2xl font-bold text-text">{mod().rulePack ? 1 : 0}</div>
                      <div class="mt-1 text-xs text-text-dim">规则包</div>
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                  <h2 class="text-lg font-semibold text-text">关键实体</h2>
                  <Show
                    when={mod().entities.length > 0}
                    fallback={<p class="mt-3 text-sm text-text-dim">暂无结构化实体。</p>}
                  >
                    <div class="mt-4 flex flex-col gap-3">
                      <For each={mod().entities.slice(0, 10)}>
                        {(entity) => (
                          <div class="rounded-xl border border-border bg-white/[0.03] p-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="font-medium text-text">{entity.name}</div>
                              <span class="rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-text-dim">
                                {entity.reviewStatus}
                              </span>
                            </div>
                            <div class="mt-1 text-xs text-text-dim">{entity.identity || entity.publicImage || '暂无摘要'}</div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                  <h2 class="text-lg font-semibold text-text">关键物品与规则</h2>
                  <div class="mt-4 flex flex-col gap-3">
                    <Show when={mod().items.length > 0} fallback={<p class="text-sm text-text-dim">暂无结构化物品。</p>}>
                      <For each={mod().items.slice(0, 8)}>
                        {(item) => (
                          <div class="rounded-xl border border-border bg-white/[0.03] p-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="font-medium text-text">{item.name}</div>
                              <span class="rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-text-dim">
                                {item.reviewStatus}
                              </span>
                            </div>
                            <div class="mt-1 text-xs text-text-dim">{item.category || item.publicDescription || '暂无摘要'}</div>
                          </div>
                        )}
                      </For>
                    </Show>
                    <Show when={mod().rulePack}>
                      <div class="rounded-xl border border-accent/20 bg-accent/8 p-3 text-sm text-text-dim">
                        <div class="font-medium text-text">规则包摘要</div>
                        <div class="mt-2 flex flex-wrap gap-2 text-xs">
                          <span class={`rounded-full border px-2 py-0.5 ${
                            privacyModeDraft() === 'secret'
                              ? 'border-rose-400/30 bg-rose-400/10 text-rose-200'
                              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                          }`}>
                            {privacyModeDraft() === 'secret' ? '秘密团' : '公开团'}
                          </span>
                          <span class="rounded-full border border-border px-2 py-0.5 text-text-dim">
                            {mod().rulePack?.reviewStatus ?? 'draft'}
                          </span>
                        </div>
                        <div class="mt-2 whitespace-pre-wrap leading-6">
                          {mod().rulePack?.freeText || mod().rulePack?.revelationRules || mod().rulePack?.timeRules || '已存在规则包，但暂未填写摘要。'}
                        </div>
                      </div>
                    </Show>
                    <div class="rounded-xl border border-border bg-white/[0.03] p-3">
                      <div class="font-medium text-text">{mod().rulePack ? '推进模式设置' : '规则包设置'}</div>
                      <p class="mt-2 text-sm text-text-dim">
                        公开团默认在群内公开推进；只有模组明确要求秘密推进时，才应切换为秘密团。
                      </p>
                      <div class="mt-4 space-y-3 rounded-xl border border-border/70 bg-surface/60 p-3">
                        <div>
                          <label class="text-xs font-semibold uppercase tracking-[0.24em] text-text-dim">推进模式</label>
                          <select
                            class="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text"
                            value={privacyModeDraft()}
                            onInput={(event) => setPrivacyModeDraft(event.currentTarget.value === 'secret' ? 'secret' : 'public')}
                          >
                            <option value="public">公开团：默认群内公开推进</option>
                            <option value="secret">秘密团：允许私聊与秘密推进</option>
                          </select>
                        </div>
                        <div>
                          <label class="text-xs font-semibold uppercase tracking-[0.24em] text-text-dim">隐私说明</label>
                          <textarea
                            class="mt-2 min-h-[96px] w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-6 text-text"
                            value={privacyNotesDraft()}
                            onInput={(event) => setPrivacyNotesDraft(event.currentTarget.value)}
                            placeholder="例如：本模组属于秘密团，部分个人线、秘密身份或私下行动需要单独推进。公开团可留空。"
                          />
                        </div>
                        <div class="flex justify-end">
                          <button
                            class="rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent transition hover:border-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={savingRulePack()}
                            onClick={() => void saveRulePack()}
                          >
                            {savingRulePack() ? '保存中...' : mod().rulePack ? '保存推进模式' : '创建规则包'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default ScenarioDetail;
