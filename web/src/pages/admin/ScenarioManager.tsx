/**
 * 模组管理
 *
 * 每个模组是一个独立实体，可挂多个文件（PDF/文本/图片）。
 * 上传的文档自动进入 AI KP 检索索引；图片可手动上传或 AI 生成。
 * KP 决定何时透露哪些信息——无需区分"公开"与"守密人专用"。
 */

import {
  createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component,
} from 'solid-js';
import {
  adminApi,
  type ScenarioModule,
  type ModuleDetail,
  type ModuleFile,
  type ModuleSceneImage,
  type CreateModulePayload,
} from '../../api';
import { OCCUPATIONS } from '../player/data/occupations';

const ERA_LABELS: Record<string, string> = { '1920s': '1920s', '现代': '现代', '其他': '其他' };

// ─── 主页面 ──────────────────────────────────────────────────────────────────

const ScenarioManager: Component = () => {
  const [modules, { refetch }] = createResource(() => adminApi.listModules().catch(() => []));
  const [showCreate, setShowCreate] = createSignal(false);

  return (
    <div>
      {/* 工具栏 */}
      <div class="flex justify-end mb-6">
        <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={() => setShowCreate(!showCreate())}>
          {showCreate() ? '取消' : '＋ 新建模组'}
        </button>
      </div>

      {/* 创建表单 */}
      <Show when={showCreate()}>
        <ModuleForm
          onSave={async (payload) => {
            const { id } = await adminApi.createModule(payload);
            setShowCreate(false);
            await refetch();
            openModuleDetail(id);
          }}
          onQuickCreate={async (file) => {
            // 1. 用文件名创建临时模组
            const tempName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
            const { id } = await adminApi.createModule({ name: tempName });
            // 2. 上传文件（后台导入 + AI 自动填充）
            await adminApi.uploadModuleFile(id, file);
            setShowCreate(false);
            await refetch();
            openModuleDetail(id);
          }}
          onCancel={() => setShowCreate(false)}
        />
      </Show>

      {/* 模组列表 */}
      <Show when={!modules.loading} fallback={<p class="text-text-dim text-[0.9rem]">加载中...</p>}>
        <Show when={(modules() ?? []).length > 0} fallback={
          <div class="text-center py-16 px-8 text-text-dim">
            <p>暂无模组，点击「新建模组」开始添加</p>
          </div>
        }>
          <div class="flex flex-col gap-3">
            <For each={modules()}>
              {(m) => (
                <ModuleCard
                  module={m}
                  onDeleted={refetch}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

// ─── 模组卡片 ─────────────────────────────────────────────────────────────────

const ModuleCard: Component<{
  module: ScenarioModule;
  onDeleted: () => void;
}> = (props) => {
  const [deleting, setDeleting] = createSignal(false);

  const handleDelete = async () => {
    if (!confirm(`确认删除模组「${props.module.name}」？相关文件将一并删除。`)) return;
    setDeleting(true);
    try {
      await adminApi.deleteModule(props.module.id);
      props.onDeleted();
    } catch (e) {
      alert(String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
      {/* 卡片头部 */}
      <div class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02]">
        <div class="flex items-center gap-3">
          <span class="text-[1.05rem] font-bold">📖 {props.module.name}</span>
          <Show when={props.module.era}>
            <span class="inline-block text-[0.72rem] px-2 py-0.5 rounded-[10px] font-semibold bg-success/15 text-success">{ERA_LABELS[props.module.era!] ?? props.module.era}</span>
          </Show>
          <span class="text-text-dim text-[0.78rem]">
            {props.module.fileCount} 个文档 · {props.module.imageCount} 张图片
          </span>
        </div>
        <div class="flex gap-2 items-center">
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => openModuleDetail(props.module.id)}>详情页</button>
          <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" style={{ padding: '0.25rem 0.6rem', 'font-size': '0.78rem' }} onClick={handleDelete} disabled={deleting()}>删除</button>
        </div>
      </div>

      <div class="px-4 py-3 flex flex-col gap-3">
        <Show when={props.module.description}>
          <p class="text-[0.88rem] text-text-dim leading-6">
            {props.module.description}
          </p>
        </Show>
        <Show when={props.module.allowedOccupations.length > 0 || props.module.totalPoints != null}>
          <div class="flex gap-2 flex-wrap">
            <Show when={props.module.allowedOccupations.length > 0}>
              <span class="bg-accent/10 border border-accent/20 rounded-[20px] px-2.5 py-0.5 text-[0.78rem] text-accent">职业：{props.module.allowedOccupations.join('、')}</span>
            </Show>
            <Show when={props.module.totalPoints != null}>
              <span class="bg-accent/10 border border-accent/20 rounded-[20px] px-2.5 py-0.5 text-[0.78rem] text-accent">
                总点要求：{props.module.totalPoints}
              </span>
            </Show>
          </div>
        </Show>
        <div class="text-[0.78rem] text-text-dim">
          详情、编辑、文件、场景图片与结构化资产都集中在独立详情页中查看。
        </div>
      </div>
    </div>
  );
};

// ─── 文件管理区 ───────────────────────────────────────────────────────────────

export const ModuleFiles: Component<{
  moduleId: string;
  detail: ModuleDetail | null;
  onRefetch: () => void;
}> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [uploadLabel, setUploadLabel] = createSignal('');
  const [genDesc, setGenDesc] = createSignal('');
  const [genLabel, setGenLabel] = createSignal('');
  const [generating, setGenerating] = createSignal(false);
  const [regeneratingImageId, setRegeneratingImageId] = createSignal<string | null>(null);
  const [previewImage, setPreviewImage] = createSignal<ModuleSceneImage | null>(null);
  const [showGenForm, setShowGenForm] = createSignal(false);
  const [err, setErr] = createSignal('');

  if (!props.detail) return <p class="text-text-dim text-[0.9rem]">加载失败</p>;

  // 当有文件处于 pending 状态时，每 2 秒自动轮询刷新
  createEffect(() => {
    const hasPending = (props.detail?.files ?? []).some((f) => f.importStatus === 'pending');
    if (!hasPending) return;
    const timer = setInterval(() => props.onRefetch(), 2000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    if (!previewImage()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  const docs = () => props.detail?.files.filter((f) => f.fileType === 'document') ?? [];
  const images = () => props.detail?.images ?? [];
  const imageSrc = (image: ModuleSceneImage) =>
    adminApi.adminAssetUrl(`${image.url}${image.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(image.createdAt)}`);

  const handleUpload = async (e: Event, isImage = false) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr('');
    try {
      await adminApi.uploadModuleFile(props.moduleId, file, uploadLabel() || undefined);
      setUploadLabel('');
      props.onRefetch();
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!genDesc().trim()) return;
    setGenerating(true);
    setErr('');
    try {
      await adminApi.generateModuleImage(props.moduleId, {
        description: genDesc().trim(),
        label: genLabel().trim() || undefined,
      });
      setGenDesc('');
      setGenLabel('');
      setShowGenForm(false);
      props.onRefetch();
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteFile = async (fileId: string, name: string) => {
    if (!confirm(`删除「${name}」？`)) return;
    try {
      await adminApi.deleteModuleFile(props.moduleId, fileId);
      props.onRefetch();
    } catch (ex) {
      setErr(String(ex));
    }
  };

  const handleRegenerateImage = async (image: ModuleSceneImage) => {
    if (!image.canRegenerate) return;
    setRegeneratingImageId(image.id);
    setErr('');
    try {
      await adminApi.regenerateModuleImage(props.moduleId, image.id);
      props.onRefetch();
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setRegeneratingImageId(null);
    }
  };

  return (
    <div class="mt-4">
      <Show when={err()}>
        <div class="bg-danger/[0.12] border border-danger rounded-md px-3.5 py-2.5 text-danger text-sm mb-3">{err()}</div>
      </Show>

      {/* ── 文档区 ── */}
      <div class="mb-5">
        <div class="flex items-center gap-3 mb-2">
          <h4 class="m-0 text-[0.9rem]">📄 剧本文档</h4>
          <label class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200">
            {uploading() ? '上传中...' : '＋ 上传文档'}
            <input type="file" accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
              disabled={uploading()} onChange={(e) => handleUpload(e)} />
          </label>
        </div>
        <Show when={docs().length > 0} fallback={<p class="text-text-dim text-[0.82rem]">暂无文档</p>}>
          <div class="flex flex-col gap-1.5">
            <For each={docs()}>
              {(f) => <FileRow file={f} onDelete={() => handleDeleteFile(f.id, f.originalName)} />}
            </For>
          </div>
        </Show>
      </div>

      {/* ── 图片区 ── */}
      <div>
        <div class="flex items-center gap-3 mb-2">
          <h4 class="m-0 text-[0.9rem]">🖼️ 场景图片</h4>
          <label class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200">
            ＋ 上传图片
            <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" style={{ display: 'none' }}
              disabled={uploading()} onChange={(e) => handleUpload(e, true)} />
          </label>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => setShowGenForm(!showGenForm())}>
            🎨 AI 生成
          </button>
        </div>

        {/* AI 生成表单 */}
        <Show when={showGenForm()}>
          <div class="bg-bg border border-border rounded-lg p-3 mb-3 flex flex-col gap-2">
            <input class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem]" placeholder="图片标签（如：宴会厅）"
              value={genLabel()} onInput={(e) => setGenLabel(e.currentTarget.value)} />
            <textarea class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] resize-y min-h-[60px]" rows="2"
              placeholder="描述场景（中文）：例：1920年代风格的豪华宴会厅，烛光照亮长桌，墙上挂着油画..."
              value={genDesc()} onInput={(e) => setGenDesc(e.currentTarget.value)} />
            <div class="flex gap-2 mt-2">
              <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={handleGenerate} disabled={generating() || !genDesc().trim()}>
                {generating() ? '生成中...' : '🎨 生成'}
              </button>
              <button class="px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95" onClick={() => setShowGenForm(false)}>取消</button>
            </div>
          </div>
        </Show>

        <Show when={images().length > 0} fallback={<p class="text-text-dim text-[0.82rem]">暂无图片，建议每个场景至少一张</p>}>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 mt-2">
            <For each={images()}>
              {(f) => (
                <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
                  <img
                    src={imageSrc(f)}
                    alt={f.label}
                    class="w-full aspect-[4/3] object-cover bg-bg cursor-zoom-in transition-transform duration-200 hover:scale-[1.02]"
                    loading="lazy"
                    onClick={() => setPreviewImage(f)}
                  />
                  <div class="px-3 pt-2 pb-1 flex items-start justify-between gap-2">
                    <div class="text-sm font-semibold leading-5 whitespace-normal break-words line-clamp-2" title={f.label}>
                      {f.label}
                    </div>
                    <span class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] ${
                      imageSourceTone(f).badgeClass
                    }`}>{imageSourceTone(f).label}</span>
                  </div>
                  <Show when={f.description || f.sourceFileName}>
                    <div class="px-3 pb-2 flex flex-col gap-1.5 text-[0.74rem] text-text-dim leading-5">
                      <Show when={f.sourceFileName}>
                        <div class="rounded-md bg-white/[0.03] px-2 py-1 line-clamp-2 break-words" title={f.sourceFileName ?? undefined}>
                          <span class="mr-1 text-[0.68rem] uppercase tracking-[0.08em] text-text-dim/80">来源</span>
                          {f.sourceFileName}
                        </div>
                      </Show>
                      <Show when={f.description}>
                        <div class="line-clamp-4 break-words whitespace-pre-wrap" title={f.description ?? undefined}>
                          {f.description}
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="border-t border-border/60 px-3 py-2">
                    <Show when={f.canDelete}>
                      <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95 w-full text-[0.75rem]"
                        style={{ padding: '0.2rem 0' }}
                        onClick={() => handleDeleteFile(f.id, f.label)}>删除</button>
                    </Show>
                    <Show when={!f.canDelete && f.canRegenerate}>
                      <div class="flex flex-col gap-2">
                        <button
                          class="px-2.5 py-1 bg-accent text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95 w-full text-[0.75rem] disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ padding: '0.2rem 0' }}
                          disabled={regeneratingImageId() === f.id}
                          onClick={() => void handleRegenerateImage(f)}
                        >
                          {regeneratingImageId() === f.id ? '重新生成中...' : '重新生成'}
                        </button>
                        <div class="text-[0.72rem] text-text-dim">
                          这张图来自文档补图，可直接按当前提示词手动重新生成。
                        </div>
                      </div>
                    </Show>
                    <Show when={!f.canDelete && !f.canRegenerate}>
                      <div class="text-[0.72rem] text-text-dim">文档提取图如需更新，请重新导入原文档。</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={previewImage()}>
        {(image) => (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 md:p-6 backdrop-blur-sm"
            onClick={() => setPreviewImage(null)}
          >
            <div
              class="relative flex max-h-full w-full max-w-[98vw] md:max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl shadow-black/40"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                class="absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-sm text-white transition hover:bg-black/65"
                onClick={() => setPreviewImage(null)}
              >
                关闭
              </button>
              <div class="flex max-h-[85vh] min-h-0 flex-col lg:flex-row">
                <div class="flex min-h-[320px] flex-1 items-center justify-center bg-black/35 p-4">
                  <img
                    src={imageSrc(image())}
                    alt={image().label}
                    class="max-h-[76vh] max-w-full rounded-xl object-contain"
                  />
                </div>
                <div class="w-full border-t border-border/70 p-5 lg:w-[320px] lg:border-l lg:border-t-0">
                  <div class="space-y-3">
                    <div>
                      <div class="text-lg font-semibold text-text">{image().label}</div>
                      <div class={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[0.72rem] ${imageSourceTone(image()).badgeClass}`}>
                        {imageSourceTone(image()).label}
                      </div>
                    </div>
                    <Show when={image().sourceFileName}>
                      <div class="text-sm text-text-dim">
                        <div class="mb-1 text-[0.72rem] uppercase tracking-[0.12em] text-text-dim/80">来源文档</div>
                        <div>{image().sourceFileName}</div>
                      </div>
                    </Show>
                    <Show when={image().description}>
                      <div class="text-sm text-text-dim leading-6">
                        <div class="mb-1 text-[0.72rem] uppercase tracking-[0.12em] text-text-dim/80">说明</div>
                        <div>{image().description}</div>
                      </div>
                    </Show>
                    <div class="text-xs text-text-dim">
                      点击遮罩或按 <kbd class="rounded border border-border bg-bg px-1.5 py-0.5 text-[0.68rem] text-text">Esc</kbd> 可关闭预览。
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

// ─── 文件行 ───────────────────────────────────────────────────────────────────

const FileRow: Component<{ file: ModuleFile; onDelete: () => void }> = (props) => {
  const f = props.file;
  const isPending = f.importStatus === 'pending';
  const isFailed = f.importStatus === 'failed';
  const isDone = f.importStatus === 'done';

  return (
    <div class="flex items-start gap-3 px-3 py-2 bg-bg border border-border rounded-md text-[0.84rem]">
      <div style={{ flex: 1, 'min-width': 0 }}>
        <div class="text-[0.85rem] overflow-hidden text-ellipsis whitespace-nowrap">
          {f.label || f.originalName}
        </div>
        <Show when={isPending}>
          <div class="text-[0.75rem] text-accent mt-0.5 flex items-center gap-1">
            <span class="inline-block animate-spin">⟳</span> 导入中，自动刷新...
          </div>
        </Show>
        <Show when={isFailed}>
          <div class="text-[0.72rem] text-danger mt-0.5" title={f.importError ?? ''}>
            ❌ 导入失败{f.importError ? `：${f.importError}` : ''}
          </div>
        </Show>
        <Show when={isDone}>
          <div class="text-text-dim text-[0.75rem] mt-0.5">
            ✅ {f.charCount > 0 ? `${(f.charCount / 1000).toFixed(0)}K 字` : ''}
            {f.chunkCount > 0 ? ` · ${f.chunkCount} 块` : ''}
          </div>
        </Show>
      </div>
      <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95 shrink-0" style={{ padding: '0.2rem 0.5rem', 'font-size': '0.75rem' }} onClick={props.onDelete}>删除</button>
    </div>
  );
};

function openModuleDetail(id: string): void {
  location.href = `/admin/scenarios/${id}`;
}

function imageSourceTone(image: ModuleSceneImage): { label: string; badgeClass: string } {
  switch (image.source) {
    case 'document_extract':
      return { label: '文档提取', badgeClass: 'border-sky-400/30 bg-sky-400/10 text-sky-300' };
    case 'document_generated':
      return { label: '文档补图', badgeClass: 'border-violet-400/30 bg-violet-400/10 text-violet-300' };
    default:
      return { label: '上传/生成', badgeClass: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' };
  }
}

// ─── 模组创建/编辑表单 ────────────────────────────────────────────────────────

export const ModuleForm: Component<{
  initial?: ScenarioModule;
  onSave: (payload: CreateModulePayload) => Promise<void>;
  onCancel: () => void;
  /** 新建模式下，支持从文件快速创建（创建模组 + 上传文件 + AI 自动填充） */
  onQuickCreate?: (file: File) => Promise<void>;
}> = (props) => {
  const isEdit = !!props.initial;
  const [name, setName] = createSignal(props.initial?.name ?? '');
  const [desc, setDesc] = createSignal(props.initial?.description ?? '');
  const [era, setEra] = createSignal(props.initial?.era ?? '');
  const [selectedOccupations, setSelectedOccupations] = createSignal<string[]>(props.initial?.allowedOccupations ?? []);
  const [occupationQuery, setOccupationQuery] = createSignal('');
  const [totalPointsText, setTotalPointsText] = createSignal(
    props.initial ? (props.initial.totalPoints != null ? String(props.initial.totalPoints) : '') : '460',
  );
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');

  const filteredOccupations = createMemo(() => {
    const currentEra = era();
    const query = occupationQuery().trim().toLowerCase();
    return OCCUPATIONS.filter((occupation) => {
      if (currentEra === '1920s' && occupation.era === 'modern') return false;
      if (currentEra === '现代' && occupation.era === 'classic') return false;
      if (!query) return true;
      return occupation.name.toLowerCase().includes(query)
        || occupation.description.toLowerCase().includes(query);
    });
  });
  const selectedOccupationCount = createMemo(() => selectedOccupations().length);
  const eraOccupationHint = createMemo(() => {
    const currentEra = era();
    if (currentEra === '1920s') return '当前已按 1920s 过滤职业池，现代职业不会显示。';
    if (currentEra === '现代') return '当前已按现代过滤职业池，经典职业不会显示。';
    if (currentEra === '其他') return '“其他”时代不会自动裁剪职业，请只勾选真正需要限制的职业。';
    return '未指定时代时会显示全部标准职业，可按名字或描述搜索。';
  });

  const toggleOccupation = (name: string) => {
    setSelectedOccupations((current) => (
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    ));
  };

  const handleSave = async () => {
    if (!name().trim()) { setErr('模组名称不能为空'); return; }
    const totalPointsRaw = totalPointsText().trim();
    const totalPoints = totalPointsRaw ? Number(totalPointsRaw) : null;
    if (totalPointsRaw && (!Number.isFinite(totalPoints) || totalPoints <= 0 || !Number.isInteger(totalPoints))) {
      setErr('总点要求必须是正整数，或留空');
      return;
    }
    setSaving(true); setErr('');
    try {
      await props.onSave({
        name: name().trim(),
        description: desc().trim() || undefined,
        era: era() || undefined,
        allowedOccupations: selectedOccupations(),
        totalPoints,
      });
    } catch (e) {
      setErr(String(e));
      setSaving(false);
    }
  };

  const handleQuickCreate = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !props.onQuickCreate) return;
    setSaving(true); setErr('');
    try {
      await props.onQuickCreate(file);
    } catch (ex) {
      setErr(String(ex));
      setSaving(false);
    }
    input.value = '';
  };

  return (
    <div class="bg-surface border border-border rounded-lg p-4 mb-4 shadow-sm shadow-black/10">
      <h3 style={{ margin: '0 0 1rem' }}>{isEdit ? '编辑模组' : '新建模组'}</h3>
      <Show when={err()}>
        <div class="bg-danger/[0.12] border border-danger rounded-md px-3.5 py-2.5 text-danger text-sm mb-3">{err()}</div>
      </Show>

      {/* 快速创建：上传剧本文件，AI 自动识别 */}
      <Show when={!isEdit}>
        <div class="p-5 mb-4 border-2 border-dashed border-border rounded-lg text-center bg-surface">
          <p class="m-0 mb-2 text-[0.9rem]">
            上传剧本文件，AI 自动识别模组信息
          </p>
          <label class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" style={{ cursor: saving() ? 'wait' : 'pointer' }}>
            {saving() ? '创建中...' : '📄 上传剧本自动创建'}
            <input type="file" accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
              disabled={saving()} onChange={handleQuickCreate} />
          </label>
          <p class="text-text-dim text-[0.78rem] mt-2 mb-0">
            支持 PDF、DOCX、TXT、MD — 上传后自动填充名称、简介、时代等信息
          </p>
        </div>
        <div class="text-center text-text-dim mb-3 text-[0.82rem]">
          —— 或手动填写 ——
        </div>
      </Show>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="text-[0.82rem] text-text-dim block mb-1">模组名称 *</label>
          <input class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] w-full" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="例：与苏珊共进晚餐" />
        </div>
        <div>
          <label class="text-[0.82rem] text-text-dim block mb-1">时代</label>
          <select class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] w-full" value={era()} onChange={(e) => setEra(e.currentTarget.value)}>
            <option value="">不限</option>
            <option value="1920s">1920s</option>
            <option value="现代">现代</option>
            <option value="其他">其他</option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="text-[0.82rem] text-text-dim block mb-1">简介</label>
          <textarea class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] w-full resize-y min-h-[60px]" rows="2"
            value={desc()} onInput={(e) => setDesc(e.currentTarget.value)}
            placeholder="一段简短的剧情介绍，玩家可见" />
        </div>
        <div>
          <label class="text-[0.82rem] text-text-dim block mb-1">职业限制（从标准职业列表多选，留空不限）</label>
          <div class="bg-bg border border-border rounded-xl p-3 flex flex-col gap-3 shadow-sm shadow-black/10">
            <div class="rounded-lg border border-accent/20 bg-accent/8 px-3 py-2.5 text-[0.78rem] text-text-dim flex flex-col gap-1">
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold text-text">筛卡提示</span>
                <span class="rounded-full border border-accent/20 bg-white/5 px-2.5 py-0.5 text-[0.72rem] text-accent">
                  已选 {selectedOccupationCount()} 项
                </span>
              </div>
              <div>只勾选模组确实需要限制的职业。留空表示任何职业都可参加，开房间后仍可继续审卡筛选。</div>
              <div class="text-accent">{eraOccupationHint()}</div>
            </div>
            <input
              class="flex-1 p-2 bg-surface border border-border rounded-md text-text text-[0.88rem] w-full"
              value={occupationQuery()}
              onInput={(e) => setOccupationQuery(e.currentTarget.value)}
              placeholder="搜索职业名称或描述"
            />
            <Show when={selectedOccupations().length > 0}>
              <div class="flex gap-2 flex-wrap">
                <For each={selectedOccupations()}>
                  {(occupation) => (
                    <button
                      type="button"
                      class="bg-accent/10 border border-accent/20 rounded-[20px] px-2.5 py-0.5 text-[0.78rem] text-accent cursor-pointer"
                      onClick={() => toggleOccupation(occupation)}
                    >
                      {occupation} ×
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class="px-2.5 py-0.5 bg-transparent text-text-dim border border-border rounded-[20px] text-[0.78rem] cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200"
                  onClick={() => setSelectedOccupations([])}
                >
                  清空
                </button>
              </div>
            </Show>
            <div class="max-h-[220px] overflow-y-auto border border-border rounded-md">
              <Show
                when={filteredOccupations().length > 0}
                fallback={
                  <div class="px-3 py-6 text-center text-[0.78rem] text-text-dim">
                    没找到匹配职业。试试更短的关键词，或先切换模组时代。
                  </div>
                }
              >
                <For each={filteredOccupations()}>
                  {(occupation) => {
                    const checked = () => selectedOccupations().includes(occupation.name);
                    return (
                      <label class="flex items-start gap-3 px-3 py-2 border-b border-border/50 last:border-b-0 cursor-pointer hover:bg-white/[0.03]">
                        <input
                          type="checkbox"
                          checked={checked()}
                          onChange={() => toggleOccupation(occupation.name)}
                        />
                        <div class="flex-1 min-w-0">
                          <div class="text-[0.88rem] text-text">{occupation.name}</div>
                          <div class="text-[0.75rem] text-text-dim">
                            {occupation.description}
                          </div>
                        </div>
                      </label>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </div>
        <div>
          <label class="text-[0.82rem] text-text-dim block mb-1">总点要求（默认 460，可留空）</label>
          <div class="bg-bg border border-border rounded-xl p-3 flex flex-col gap-3 shadow-sm shadow-black/10">
            <div class="rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-3 py-2.5 text-[0.78rem] text-text-dim flex flex-col gap-1">
              <span class="font-semibold text-text">审卡规则</span>
              <span>主属性总点 = STR + CON + SIZ + DEX + APP + INT + POW + EDU。</span>
              <span>默认 460；创建房间时会自动继承，房主之后仍可改成别的值，或留空关闭总点校验。</span>
            </div>
            <input
              class="flex-1 p-2 bg-surface border border-border rounded-md text-text text-[0.88rem] w-full"
              value={totalPointsText()}
              onInput={(e) => setTotalPointsText(e.currentTarget.value)}
              placeholder="例：460"
            />
            <div class="text-[0.75rem] text-text-dim">
              建议只在模组确实依赖统一点数强度时填写；偏叙事或兼容型模组可以留空。
            </div>
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button class="px-3 py-1.5 bg-accent text-white border-none rounded-md text-sm cursor-pointer hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-95" onClick={handleSave} disabled={saving()}>
          {saving() ? '保存中...' : '💾 保存'}
        </button>
        <button class="px-3 py-1.5 bg-transparent text-text-dim border border-border rounded-md text-sm cursor-pointer hover:text-text hover:border-text-dim transition-all duration-200 active:scale-95" onClick={props.onCancel}>取消</button>
      </div>
    </div>
  );
};

export default ScenarioManager;
