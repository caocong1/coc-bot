import {
  createResource, createSignal, For, Show, type Component,
} from 'solid-js';
import { adminApi } from '../../api';
import type {
  AIProvider, AIModel, AIFeatureBinding, RoutingPolicy,
  AIProviderPayload, AIModelPayload, AIFeatureBindingPayload, AIModelCapabilities,
} from '../../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 提取 createResource 返回的 { data } */
function unwrap<T>(res: { data: T } | T[] | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res as T[];
  return res.data as T[];
}
function unwrapOne<T>(res: { data: T } | T | undefined): T | undefined {
  if (!res) return undefined;
  if (Array.isArray(res)) return undefined;
  return (res as { data: T }).data;
}

const ALL_FEATURE_LABELS: Record<string, string> = {
  'kp.chat': 'KP 对话 (kp.chat)',
  'kp.guardrail': '护栏检查 (kp.guardrail)',
  'kp.opening': '开场生成 (kp.opening)',
  'kp.recap': '回顾摘要 (kp.recap)',
  'image.prompt': '图片提示词 (image.prompt)',
  'image.generate': '图片生成 (image.generate)',
  'knowledge.embedding': '向量索引 (knowledge.embedding)',
  'fun.jrrp': '人品 (fun.jrrp)',
  'fun.v50': 'V50 (fun.v50)',
  'fun.gugu': '占卜 (fun.gugu)',
  'module.extract': '模组提取 (module.extract)',
};

const CAPABILITY_OPTIONS: Array<{ key: keyof AIModelCapabilities; label: string }> = [
  { key: 'supportsChat', label: '对话' },
  { key: 'supportsVision', label: '视觉' },
  { key: 'supportsImageGeneration', label: '图片生成' },
  { key: 'supportsStreaming', label: '流式' },
  { key: 'supportsEmbeddings', label: 'Embedding' },
];

function getPolicyPrimary(p: RoutingPolicy) {
  return p.type === 'fallback' ? p.primary : (p as { providerId: string; modelId: string });
}
function getPolicyFallback(p: RoutingPolicy) {
  return p.type === 'fallback' ? p.fallback : null;
}
function isFallback(p: RoutingPolicy): p is import('../../api').FallbackRoutingPolicy {
  return p.type === 'fallback';
}

function modelShort(policy: RoutingPolicy): string {
  if (policy.type === 'fallback') {
    return `${policy.primary.modelId.split(':')[1]} → ${policy.fallback.modelId.split(':')[1]}`;
  }
  return policy.modelId.split(':')[1];
}

// ─── Model Card ────────────────────────────────────────────────────────────────

const ModelCard: Component<{
  model: AIModel;
  onDelete: () => void;
}> = (props) => {
  const caps = () => props.model.capabilities ?? ({} as AIModelCapabilities);
  const capList = () =>
    CAPABILITY_OPTIONS.filter(o => caps()[o.key]).map(o => o.label);

  return (
    <div class="border border-border rounded-lg p-3 bg-white/[0.02]">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="font-mono text-sm font-semibold text-accent">{props.model.modelId}</div>
          <div class="text-text-dim text-xs mt-0.5">{props.model.name}</div>
        </div>
        <button
          class="px-2 py-0.5 text-xs text-red-400 border border-red-400/30 rounded hover:bg-red-400/10 transition-all cursor-pointer"
          onClick={props.onDelete}
        >
          删除
        </button>
      </div>
      <Show when={capList().length > 0}>
        <div class="flex flex-wrap gap-1 mt-2">
          <For each={capList()}>
            {(cap) => (
              <span class="px-1.5 py-0.5 text-xs rounded bg-accent/10 text-accent/80 border border-accent/20">
                {cap}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// ─── Provider Card ─────────────────────────────────────────────────────────────

const ProviderCard: Component<{
  provider: AIProvider;
  models: AIModel[];
  onDelete: () => void;
  onAddModel: (data: AIModelPayload) => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [showModelForm, setShowModelForm] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [newModelId, setNewModelId] = createSignal('');
  const [newModelName, setNewModelName] = createSignal('');
  const [caps, setCaps] = createSignal<Record<string, boolean>>({
    supportsChat: true, supportsVision: false, supportsImageGeneration: false,
    supportsStreaming: true, supportsEmbeddings: false,
  });

  const toggleCap = (key: string) =>
    setCaps(prev => ({ ...prev, [key]: !prev[key] }));

  const submitModel = async () => {
    const modelId = newModelId().trim();
    if (!modelId) return;
    setSaving(true);
    try {
      const fullCaps: AIModelCapabilities = {
        supportsChat: caps().supportsChat ?? false,
        supportsVision: caps().supportsVision ?? false,
        supportsImageGeneration: caps().supportsImageGeneration ?? false,
        supportsStreaming: caps().supportsStreaming ?? false,
        supportsEmbeddings: caps().supportsEmbeddings ?? false,
      };
      await props.onAddModel({ modelId, name: newModelName().trim() || modelId, capabilities: fullCaps });
      setNewModelId('');
      setNewModelName('');
      setShowModelForm(false);
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      'dashscope': 'DashScope', 'opencode': 'OpenCode', 'openai-compatible': 'OpenAI 兼容',
      'anthropic': 'Anthropic', 'ollama': 'Ollama',
    };
    return map[type] ?? type;
  };

  return (
    <div class="border border-border rounded-lg overflow-hidden">
      <div
        class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div class="flex items-center gap-3">
          <span class="text-lg">{expanded() ? '▼' : '▶'}</span>
          <div>
            <div class="font-semibold text-sm">{props.provider.name}</div>
            <div class="text-text-dim text-xs font-mono">{props.provider.id}</div>
          </div>
          <span class="px-2 py-0.5 text-xs rounded bg-white/5 text-text-dim border border-border">
            {typeLabel(props.provider.type)}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-text-dim">{props.models.length} 个模型</span>
          <Show when={props.provider.enabled === false}>
            <span class="px-2 py-0.5 text-xs rounded bg-red-400/10 text-red-400 border border-red-400/20">已禁用</span>
          </Show>
          <Show when={props.provider.credentialsEncrypted}>
            <span class="text-xs text-green-400/60" title="已加密存储">🔒</span>
          </Show>
          <button
            class="text-xs text-red-400 hover:underline"
            onClick={(e) => { e.stopPropagation(); props.onDelete(); }}
          >
            删除
          </button>
        </div>
      </div>

      <Show when={expanded()}>
        <div class="border-t border-border px-4 py-4 space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <FieldRow label="类型" value={typeLabel(props.provider.type)} />
            <Show when={props.provider.baseUrl}>
              <FieldRow label="Base URL" value={props.provider.baseUrl!} mono />
            </Show>
            <FieldRow label="鉴权方式" value={props.provider.authType} />
            <Show when={props.provider.credentialsEncrypted}>
              <FieldRow label="凭证" value="🔒 已加密存储" />
            </Show>
          </div>

          {/* Models */}
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold">模型列表</span>
              <button
                class="px-2 py-1 text-xs bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-all cursor-pointer"
                onClick={() => setShowModelForm(v => !v)}
              >
                + 添加模型
              </button>
            </div>

            <Show when={showModelForm()}>
              <div class="mb-3 p-3 border border-accent/30 rounded-lg bg-accent/5 space-y-2">
                <input class="w-full px-3 py-1.5 text-sm bg-surface border border-border rounded text-text placeholder-text-dim/50"
                  placeholder="modelId (如 qwen-plus)" value={newModelId()}
                  onInput={(e) => setNewModelId(e.currentTarget.value)} />
                <input class="w-full px-3 py-1.5 text-sm bg-surface border border-border rounded text-text placeholder-text-dim/50"
                  placeholder="显示名称（可选）" value={newModelName()}
                  onInput={(e) => setNewModelName(e.currentTarget.value)} />
                <div class="flex flex-wrap gap-2">
                  <For each={CAPABILITY_OPTIONS}>
                    {(opt) => (
                      <label class="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={caps()[opt.key] ?? false}
                          onChange={() => toggleCap(opt.key)} class="accent-accent" />
                        {opt.label}
                      </label>
                    )}
                  </For>
                </div>
                <div class="flex gap-2">
                  <button class="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-all cursor-pointer disabled:opacity-50"
                    disabled={saving() || !newModelId().trim()} onClick={submitModel}>
                    {saving() ? '保存中…' : '保存'}
                  </button>
                  <button class="px-3 py-1 text-xs bg-white/5 text-text border border-border rounded hover:bg-white/10 transition-all cursor-pointer"
                    onClick={() => setShowModelForm(false)}>
                    取消
                  </button>
                </div>
              </div>
            </Show>

            <Show when={props.models.length > 0} fallback={<p class="text-text-dim text-xs">暂无模型</p>}>
              <div class="space-y-2">
                <For each={props.models}>
                  {(m) => (
                    <ModelCard model={m}
                      onDelete={async () => {
                        if (!confirm(`确认删除模型 ${m.modelId}？`)) return;
                        await props.onDeleteModel(m.id);
                      }} />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

const FieldRow: Component<{ label: string; value: string; mono?: boolean }> = (props) => (
  <div class="flex flex-col gap-1">
    <span class="text-text-dim text-xs uppercase tracking-wider">{props.label}</span>
    <span class={`text-text text-sm ${props.mono ? 'font-mono text-xs break-all' : ''}`}>{props.value || '—'}</span>
  </div>
);

// ─── Feature Binding Row ───────────────────────────────────────────────────────

const FeatureBindingRow: Component<{
  binding: AIFeatureBinding;
  providers: AIProvider[];
  models: AIModel[];
  onUpdate: (data: AIFeatureBindingPayload) => Promise<void>;
}> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [policyType, setPolicyType] = createSignal<'single' | 'fallback'>(props.binding.routingPolicy.type);
  const [providerId, setProviderId] = createSignal(getPolicyPrimary(props.binding.routingPolicy).providerId);
  const [modelId, setModelId] = createSignal(getPolicyPrimary(props.binding.routingPolicy).modelId);
  const fb = () => getPolicyFallback(props.binding.routingPolicy);
  const [fbProviderId, setFbProviderId] = createSignal(fb()?.providerId ?? '');
  const [fbModelId, setFbModelId] = createSignal(fb()?.modelId ?? '');
  const [fallbackOnRateLimit, setFallbackOnRateLimit] = createSignal(props.binding.fallbackOnRateLimit);

  const providerModels = () => props.models.filter(m => m.providerId === providerId());
  const fbProviderModels = () => props.models.filter(m => m.providerId === fbProviderId());

  const submit = async () => {
    setSaving(true);
    try {
      let policy: RoutingPolicy;
      if (policyType() === 'single') {
        policy = { type: 'single', providerId: providerId(), modelId: modelId() };
      } else {
        if (!fbProviderId() || !fbModelId()) { alert('请填写完整的 Fallback Provider 和 Model'); return; }
        policy = {
          type: 'fallback',
          primary: { providerId: providerId(), modelId: modelId() },
          fallback: { providerId: fbProviderId(), modelId: fbModelId() },
          fallbackOnRateLimit: fallbackOnRateLimit(),
        };
      }
      await props.onUpdate({ routingPolicy: policy, fallbackOnRateLimit: fallbackOnRateLimit() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="border border-border/60 rounded-lg p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm text-accent">
            {ALL_FEATURE_LABELS[props.binding.feature] ?? props.binding.feature}
          </div>
          <Show when={!editing()}>
            <div class="text-text-dim text-xs mt-1 break-all">
              <Show when={isFallback(props.binding.routingPolicy)}>
                <span class="text-yellow-400/70">🔄 </span>
              </Show>
              {modelShort(props.binding.routingPolicy)}
            </div>
          </Show>
        </div>
        <button class="text-xs text-accent hover:underline shrink-0" onClick={() => setEditing(v => !v)}>
          {editing() ? '取消' : '编辑'}
        </button>
      </div>

      <Show when={editing()}>
        <div class="mt-3 space-y-2">
          <div class="flex items-center gap-2">
            <label class="text-xs text-text-dim shrink-0">策略</label>
            <select class="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text"
              value={policyType()} onChange={(e) => setPolicyType(e.currentTarget.value as 'single' | 'fallback')}>
              <option value="single">Single（单一模型）</option>
              <option value="fallback">Fallback（主用 → 备用）</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs text-text-dim shrink-0">主用 Provider</label>
            <select class="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text"
              value={providerId()} onChange={(e) => { setProviderId(e.currentTarget.value); setModelId(''); }}>
              <option value="">— 选择 —</option>
              <For each={props.providers.filter(p => p.enabled !== false)}>
                {(p) => <option value={p.id}>{p.name}</option>}
              </For>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs text-text-dim shrink-0">主用 Model</label>
            <select class="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text"
              value={modelId()} onChange={(e) => setModelId(e.currentTarget.value)}>
              <option value="">— 选择 —</option>
              <For each={providerModels()}>
                {(m) => <option value={m.id}>{m.modelId}</option>}
              </For>
            </select>
          </div>

          <Show when={policyType() === 'fallback'}>
            <div class="border-t border-border/40 pt-2 space-y-2">
              <div class="text-xs text-yellow-400/70 font-semibold">Fallback 备用配置</div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-text-dim shrink-0">备用 Provider</label>
                <select class="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text"
                  value={fbProviderId()} onChange={(e) => { setFbProviderId(e.currentTarget.value); setFbModelId(''); }}>
                  <option value="">— 选择 —</option>
                  <For each={props.providers.filter(p => p.enabled !== false)}>
                    {(p) => <option value={p.id}>{p.name}</option>}
                  </For>
                </select>
              </div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-text-dim shrink-0">备用 Model</label>
                <select class="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text"
                  value={fbModelId()} onChange={(e) => setFbModelId(e.currentTarget.value)}>
                  <option value="">— 选择 —</option>
                  <For each={fbProviderModels()}>
                    {(m) => <option value={m.id}>{m.modelId}</option>}
                  </For>
                </select>
              </div>
              <label class="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={fallbackOnRateLimit()} onChange={(e) => setFallbackOnRateLimit(e.currentTarget.checked)} class="accent-accent" />
                <span>限流时也触发 Fallback（默认仅 5xx/408 触发）</span>
              </label>
            </div>
          </Show>

          <button class="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-all cursor-pointer disabled:opacity-50"
            disabled={saving() || !providerId() || !modelId()} onClick={submit}>
            {saving() ? '保存中…' : '保存'}
          </button>
        </div>
      </Show>
    </div>
  );
};

// ─── Provider Form Modal ───────────────────────────────────────────────────────

const ProviderForm: Component<{
  initial?: AIProvider;
  onSave: (data: AIProviderPayload & { id?: string }) => Promise<void>;
  onClose: () => void;
}> = (props) => {
  const [ptype, setPtype] = createSignal(props.initial?.type ?? 'openai-compatible');
  const [name, setName] = createSignal(props.initial?.name ?? '');
  const [baseUrl, setBaseUrl] = createSignal(props.initial?.baseUrl ?? '');
  const [authType, setAuthType] = createSignal<'bearer' | 'basic' | 'none'>(props.initial?.authType ?? 'bearer');
  const [apiKey, setApiKey] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  const submit = async () => {
    if (!name().trim()) { alert('请填写名称'); return; }
    setSaving(true);
    try {
      const credentials: Record<string, string> = {};
      if (authType() === 'bearer' && apiKey()) credentials.apiKey = apiKey();
      if (authType() === 'basic' && username() && password()) {
        credentials.username = username();
        credentials.password = password();
      }
      await props.onSave({
        type: ptype() as AIProviderPayload['type'],
        name: name(),
        baseUrl: baseUrl() || undefined,
        authType: authType(),
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        providerOptionsJson: '{}',
        id: props.initial?.id,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div class="bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 class="text-base font-semibold mb-4">{props.initial ? '编辑 Provider' : '新建 Provider'}</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">类型</label>
            <select class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text"
              value={ptype()} onChange={(e) => setPtype(e.currentTarget.value as typeof ptype extends () => infer T ? T : never)}>
              <option value="dashscope">DashScope (百炼)</option>
              <option value="opencode">OpenCode (百炼 Coding Plan)</option>
              <option value="openai-compatible">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama (本地)</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">名称</label>
            <input class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text placeholder-text-dim/50"
              placeholder="如：我的 DashScope" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
          <div>
            <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">Base URL（可选）</label>
            <input class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text placeholder-text-dim/50 font-mono"
              placeholder="https://api.openai.com/v1" value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} />
          </div>
          <div>
            <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">鉴权方式</label>
            <select class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text"
              value={authType()} onChange={(e) => setAuthType(e.currentTarget.value as 'bearer' | 'basic' | 'none')}>
              <option value="bearer">Bearer (API Key)</option>
              <option value="basic">Basic (用户名+密码)</option>
              <option value="none">无</option>
            </select>
          </div>
          <Show when={authType() === 'bearer'}>
            <div>
              <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">API Key</label>
              <input type="password" class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text placeholder-text-dim/50 font-mono"
                placeholder="sk-..." value={apiKey()} onInput={(e) => setApiKey(e.currentTarget.value)} />
            </div>
          </Show>
          <Show when={authType() === 'basic'}>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">用户名</label>
                <input class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text"
                  value={username()} onInput={(e) => setUsername(e.currentTarget.value)} />
              </div>
              <div>
                <label class="text-xs text-text-dim uppercase tracking-wider block mb-1">密码</label>
                <input type="password" class="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text"
                  value={password()} onInput={(e) => setPassword(e.currentTarget.value)} />
              </div>
            </div>
          </Show>
        </div>
        <div class="flex gap-2 mt-5">
          <button class="flex-1 px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-all cursor-pointer disabled:opacity-50"
            disabled={saving()} onClick={submit}>
            {saving() ? '保存中…' : '保存'}
          </button>
          <button class="px-4 py-2 text-sm bg-white/5 text-text border border-border rounded-lg hover:bg-white/10 transition-all cursor-pointer"
            onClick={props.onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const AIProviders: Component = () => {
  const [configSource, { refetch: refetchCS }] = createResource(() =>
    adminApi.aiProviders.getConfigSource().catch(() => ({ data: { configSource: 'legacy' } })),
  );
  const [rawProviders, { refetch: refetchProviders }] = createResource(() =>
    adminApi.aiProviders.list().catch(() => ({ data: [] as AIProvider[] })),
  );
  const [rawFeatures, { refetch: refetchFeatures }] = createResource(() =>
    adminApi.aiProviders.listFeatures().catch(() => ({ data: [] as AIFeatureBinding[] })),
  );

  // 加载所有 models
  const [allModels, { refetch: refetchModels }] = createResource(
    () => rawProviders(),
    async (rp) => {
      const ps = unwrap<AIProvider>(rp);
      const result: AIModel[] = [];
      for (const p of ps) {
        const ms = await adminApi.aiProviders.listModels(p.id).catch(() => ({ data: [] })) as { data: AIModel[] };
        result.push(...(ms.data ?? []));
      }
      return result;
    },
  );

  const [showProviderForm, setShowProviderForm] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const providers = () => unwrap<AIProvider>(rawProviders());
  const features = () => unwrap<AIFeatureBinding>(rawFeatures());

  const refetchAll = () => { refetchProviders(); refetchModels(); refetchFeatures(); refetchCS(); };

  const providerModels = (providerId: string) => (allModels() ?? []).filter(m => m.providerId === providerId);

  const setConfigSource = async (src: 'legacy' | 'providers') => {
    if (!confirm(`确认切换到 ${src === 'providers' ? '新版配置系统' : '旧版配置'}？\n切换后需要重启 Bot 使配置生效。`)) return;
    setSaving(true);
    try { await adminApi.aiProviders.setConfigSource(src); refetchCS(); }
    catch (e) { alert(String(e)); }
    finally { setSaving(false); }
  };

  const saveProvider = async (data: AIProviderPayload & { id?: string }) => {
    setSaving(true);
    try {
      if (data.id) {
        const { id, ...rest } = data;
        await adminApi.aiProviders.update(id, rest);
      } else {
        const newId = `${data.type}-${Date.now()}`;
        await adminApi.aiProviders.create({ ...data, id: newId } as AIProviderPayload & { id: string });
      }
      setShowProviderForm(false);
      refetchAll();
    } catch (e) { alert(String(e)); }
    finally { setSaving(false); }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm(`确认删除 Provider ${id}？\n删除后关联的 Feature 绑定将失效。`)) return;
    try { await adminApi.aiProviders.delete(id); refetchAll(); }
    catch (e) { alert(String(e)); }
  };

  const addModel = async (providerId: string, data: AIModelPayload) => {
    await adminApi.aiProviders.createModel(providerId, data);
    refetchModels();
  };

  const deleteModel = async (providerId: string, modelId: string) => {
    await adminApi.aiProviders.deleteModel(providerId, modelId);
    refetchModels();
  };

  const updateFeature = async (feature: string, data: AIFeatureBindingPayload) => {
    const result = await adminApi.aiProviders.updateFeature(feature, data);
    if (result.warning) alert(`⚠️ ${result.warning}`);
    refetchFeatures();
  };

  const isProvidersMode = () => (configSource()?.data?.configSource ?? 'legacy') === 'providers';

  return (
    <div class="space-y-6">
      {/* Config Source Banner */}
      <div class="bg-surface border border-border rounded-lg p-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 class="font-semibold text-sm mb-0.5">配置模式</h2>
            <div class="text-xs text-text-dim">
              当前：
              <span class={isProvidersMode() ? 'text-green-400' : 'text-yellow-400'}>
                {isProvidersMode() ? '🟢 新版（Provider 可配置）' : '🟡 旧版（Legacy）'}
              </span>
            </div>
          </div>
          <Show when={!isProvidersMode()}>
            <button class="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-all cursor-pointer disabled:opacity-50"
              disabled={saving()} onClick={() => setConfigSource('providers')}>
              切换到新版配置系统
            </button>
          </Show>
        </div>
        <Show when={!isProvidersMode()}>
          <div class="mt-3 text-xs text-text-dim border border-yellow-400/20 bg-yellow-400/5 rounded p-2">
            正在使用旧版 Legacy 配置。切换到「新版」后可通过下方界面管理 AI Provider。
          </div>
        </Show>
      </div>

      {/* Providers Section */}
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-base font-semibold">AI Providers</h2>
          <button class="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-all cursor-pointer"
            onClick={() => setShowProviderForm(true)}>
            + 新建 Provider
          </button>
        </div>

        <Show when={!rawProviders.loading} fallback={<p class="text-text-dim text-sm">加载中…</p>}>
          <Show when={providers().length > 0} fallback={
            <div class="border border-dashed border-border rounded-lg p-8 text-center text-text-dim text-sm">
              暂无 Provider，请点击「新建 Provider」添加
            </div>
          }>
            <div class="space-y-3">
              <For each={providers()}>
                {(p) => (
                  <ProviderCard
                    provider={p}
                    models={providerModels(p.id)}
                    onDelete={() => deleteProvider(p.id)}
                    onAddModel={(data) => addModel(p.id, data)}
                    onDeleteModel={(modelId) => deleteModel(p.id, modelId)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Feature Bindings */}
      <div>
        <h2 class="text-base font-semibold mb-3">Feature → Model 路由</h2>
        <p class="text-xs text-text-dim mb-4">指定每个功能使用哪个模型</p>
        <Show when={!rawFeatures.loading} fallback={<p class="text-text-dim text-sm">加载中…</p>}>
          <div class="grid gap-3 sm:grid-cols-2">
            <For each={features()}>
              {(b) => (
                <FeatureBindingRow
                  binding={b}
                  providers={providers()}
                  models={allModels() ?? []}
                  onUpdate={(data) => updateFeature(b.feature, data)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={showProviderForm()}>
        <ProviderForm onSave={saveProvider} onClose={() => setShowProviderForm(false)} />
      </Show>
    </div>
  );
};

export default AIProviders;
