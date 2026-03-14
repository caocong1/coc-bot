/**
 * 模组管理
 *
 * 每个模组是一个独立实体，可挂多个文件（PDF/文本/图片）。
 * 上传的文档自动进入 AI KP 检索索引；图片可手动上传或 AI 生成。
 * KP 决定何时透露哪些信息——无需区分"公开"与"守密人专用"。
 */

import {
  createEffect, createResource, createSignal, For, onCleanup, Show, type Component,
} from 'solid-js';
import { adminApi, type ScenarioModule, type ModuleDetail, type ModuleFile, type CreateModulePayload } from '../../api';

const ERA_LABELS: Record<string, string> = { '1920s': '1920s', '现代': '现代', '其他': '其他' };

// ─── 主页面 ──────────────────────────────────────────────────────────────────

const ScenarioManager: Component = () => {
  const [modules, { refetch }] = createResource(() => adminApi.listModules().catch(() => []));
  const [showCreate, setShowCreate] = createSignal(false);
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

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
            setExpandedId(id);
          }}
          onQuickCreate={async (file) => {
            // 1. 用文件名创建临时模组
            const tempName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
            const { id } = await adminApi.createModule({ name: tempName });
            // 2. 上传文件（后台导入 + AI 自动填充）
            await adminApi.uploadModuleFile(id, file);
            setShowCreate(false);
            await refetch();
            setExpandedId(id);
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
                  expanded={expandedId() === m.id}
                  onToggle={() => toggleExpand(m.id)}
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
  expanded: boolean;
  onToggle: () => void;
  onDeleted: () => void;
}> = (props) => {
  const [detail, { refetch: refetchDetail }] = createResource(
    () => props.expanded ? props.module.id : null,
    (id) => adminApi.getModule(id).catch(() => null),
  );
  const [editing, setEditing] = createSignal(false);
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
      <div
        class="flex justify-between items-center px-4 py-3 border-b border-border bg-white/[0.02] cursor-pointer"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-3">
          <span class="text-[1.05rem] font-bold">📖 {props.module.name}</span>
          <Show when={props.module.era}>
            <span class="inline-block text-[0.72rem] px-2 py-0.5 rounded-[10px] font-semibold bg-success/15 text-success">{ERA_LABELS[props.module.era!] ?? props.module.era}</span>
          </Show>
          <span class="text-text-dim text-[0.78rem]">
            {props.module.fileCount} 个文档 · {props.module.imageCount} 张图片
          </span>
        </div>
        <div class="flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => { props.onToggle(); setEditing(false); }}>
            {props.expanded ? '收起 ▲' : '展开 ▼'}
          </button>
          <button class="px-2.5 py-1 bg-white/[0.07] text-text border border-border rounded-md text-sm cursor-pointer no-underline inline-block hover:bg-white/[0.12] transition-all duration-200" onClick={() => { setEditing(!editing()); if (!props.expanded) props.onToggle(); }}>编辑</button>
          <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95" style={{ padding: '0.25rem 0.6rem', 'font-size': '0.78rem' }} onClick={handleDelete} disabled={deleting()}>删除</button>
        </div>
      </div>

      {/* 简介（未展开时显示） */}
      <Show when={!props.expanded && props.module.description}>
        <div class="px-4 py-2 pb-3 text-text-dim text-[0.85rem]">
          {props.module.description}
        </div>
      </Show>

      {/* 展开详情 */}
      <Show when={props.expanded}>
        <div class="px-4 pb-4">
          {/* 编辑表单 */}
          <Show when={editing()}>
            <ModuleForm
              initial={props.module}
              onSave={async (payload) => {
                await adminApi.updateModule(props.module.id, payload);
                setEditing(false);
                props.onDeleted(); // refetch list
                refetchDetail();
              }}
              onCancel={() => setEditing(false)}
            />
          </Show>

          {/* 只读信息 */}
          <Show when={!editing()}>
            <Show when={props.module.description}>
              <p class="text-[0.88rem] mb-3 text-text-dim">
                {props.module.description}
              </p>
            </Show>
            <Show when={props.module.allowedOccupations.length > 0 || Object.keys(props.module.minStats).length > 0}>
              <div class="flex gap-2 flex-wrap mb-3">
                <Show when={props.module.allowedOccupations.length > 0}>
                  <span class="bg-accent/10 border border-accent/20 rounded-[20px] px-2.5 py-0.5 text-[0.78rem] text-accent">职业：{props.module.allowedOccupations.join('、')}</span>
                </Show>
                <Show when={Object.keys(props.module.minStats).length > 0}>
                  <span class="bg-accent/10 border border-accent/20 rounded-[20px] px-2.5 py-0.5 text-[0.78rem] text-accent">
                    最低属性：{Object.entries(props.module.minStats).map(([k, v]) => `${k}≥${v}`).join(' ')}
                  </span>
                </Show>
              </div>
            </Show>
          </Show>

          {/* 文件 & 图片 */}
          <Show when={!detail.loading && detail()} fallback={<p class="text-text-dim text-[0.9rem] mt-4">加载详情...</p>}>
            {(d) => <ModuleFiles moduleId={props.module.id} detail={d()} onRefetch={refetchDetail} />}
          </Show>
        </div>
      </Show>
    </div>
  );
};

// ─── 文件管理区 ───────────────────────────────────────────────────────────────

const ModuleFiles: Component<{
  moduleId: string;
  detail: ModuleDetail | null;
  onRefetch: () => void;
}> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [uploadLabel, setUploadLabel] = createSignal('');
  const [genDesc, setGenDesc] = createSignal('');
  const [genLabel, setGenLabel] = createSignal('');
  const [generating, setGenerating] = createSignal(false);
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

  const docs = () => props.detail?.files.filter((f) => f.fileType === 'document') ?? [];
  const images = () => props.detail?.files.filter((f) => f.fileType === 'image') ?? [];

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
          <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 mt-2">
            <For each={images()}>
              {(f) => (
                <div class="bg-surface border border-border rounded-lg overflow-hidden flex flex-col shadow-sm shadow-black/10">
                  <img
                    src={adminApi.moduleImageUrl(props.moduleId, f.id)}
                    alt={f.label ?? f.originalName}
                    class="w-full aspect-[4/3] object-cover bg-bg"
                    loading="lazy"
                  />
                  <div class="text-sm font-semibold px-2 pt-1.5 pb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{f.label || f.originalName}</div>
                  <Show when={f.description}>
                    <div class="text-[0.72rem] text-text-dim px-2 pb-1.5 overflow-hidden line-clamp-2">{f.description}</div>
                  </Show>
                  <button class="px-2.5 py-1 bg-danger text-white border-none rounded-md text-sm cursor-pointer transition-all duration-200 active:scale-95 w-full text-[0.75rem]"
                    style={{ padding: '0.2rem 0' }}
                    onClick={() => handleDeleteFile(f.id, f.label ?? f.originalName)}>删除</button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
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

// ─── 模组创建/编辑表单 ────────────────────────────────────────────────────────

const ModuleForm: Component<{
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
  const [occs, setOccs] = createSignal((props.initial?.allowedOccupations ?? []).join('、'));
  const [statsText, setStatsText] = createSignal(
    Object.entries(props.initial?.minStats ?? {}).map(([k, v]) => `${k}:${v}`).join(' '),
  );
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');

  const parseStats = (text: string): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const part of text.split(/[\s,，]+/)) {
      const m = part.match(/^(.+):(\d+)$/);
      if (m) result[m[1]] = parseInt(m[2]);
    }
    return result;
  };

  const handleSave = async () => {
    if (!name().trim()) { setErr('模组名称不能为空'); return; }
    setSaving(true); setErr('');
    try {
      await props.onSave({
        name: name().trim(),
        description: desc().trim() || undefined,
        era: era() || undefined,
        allowedOccupations: occs().trim() ? occs().split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean) : [],
        minStats: statsText().trim() ? parseStats(statsText()) : {},
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

      <div class="grid grid-cols-2 gap-3">
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
          <label class="text-[0.82rem] text-text-dim block mb-1">职业限制（逗号分隔，留空不限）</label>
          <input class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] w-full" value={occs()} onInput={(e) => setOccs(e.currentTarget.value)}
            placeholder="例：侦探、记者、医生" />
        </div>
        <div>
          <label class="text-[0.82rem] text-text-dim block mb-1">最低属性要求（格式：力量:60 智力:70）</label>
          <input class="flex-1 p-2 bg-bg border border-border rounded-md text-text text-[0.88rem] w-full" value={statsText()} onInput={(e) => setStatsText(e.currentTarget.value)}
            placeholder="例：智力:65 教育:70" />
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
