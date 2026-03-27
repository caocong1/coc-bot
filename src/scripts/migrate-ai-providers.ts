/**
 * AI Provider 配置迁移脚本
 *
 * 将 bot_settings.ai_settings (legacy) 迁移到新的 ai_providers / ai_models / ai_feature_models 表。
 *
 * 迁移规则（参见 plan.v6.md）：
 * - dashscope → dashscope-default provider
 * - openlimits → openlimits-default (openai-compatible)
 * - chatModel/guardrailModel/... → 各 Model 记录
 * - feature bindings 映射到对应 capability
 * - dashscope + OPENCODE_* env → kp.chat 为 fallback policy
 *
 * 幂等：已迁移则跳过。
 */

import { openDatabase } from '../storage/Database';
import { migrateProviderSchema, hasMigrated, createProvider, createModel, setFeatureBinding, getProvider } from '../storage/ProviderStore';
import { initEncryption, encryptCredentials } from '../ai/providers/Encryption';
import type { LegacyAISettings, FeatureId, FeatureModelConfig, SingleRoutingPolicy, FallbackRoutingPolicy } from '../ai/providers/types';

// ─── Legacy 配置降级映射 ────────────────────────────────────────────────────

const LEGACY_FEATURE_MAP: Array<{
  legacyKey: keyof LegacyAISettings;
  feature: FeatureId;
  capability: 'supportsChat' | 'supportsEmbeddings' | 'supportsImageGeneration';
}> = [
  { legacyKey: 'chatModel', feature: 'kp.chat', capability: 'supportsChat' },
  { legacyKey: 'guardrailModel', feature: 'kp.guardrail', capability: 'supportsChat' },
  { legacyKey: 'openingModel', feature: 'kp.opening', capability: 'supportsChat' },
  { legacyKey: 'recapModel', feature: 'kp.recap', capability: 'supportsChat' },
  { legacyKey: 'imagePromptModel', feature: 'image.prompt', capability: 'supportsChat' },
  { legacyKey: 'embedModel', feature: 'knowledge.embedding', capability: 'supportsEmbeddings' },
];

// ─── 迁移函数 ────────────────────────────────────────────────────────────────

export function migrateLegacyToProviders(legacy: LegacyAISettings): {
  providers: Array<{
    id: string;
    type: string;
    name: string;
    baseUrl?: string;
    credentials: Record<string, string>;
    authType: string;
    providerOptionsJson: string;
  }>;
  models: Array<{
    id: string;
    providerId: string;
    modelId: string;
    name: string;
    capabilities: Record<string, boolean>;
  }>;
  featureBindings: Record<FeatureId, FeatureModelConfig>;
} {
  const providers: ReturnType<typeof migrateLegacyToProviders>['providers'] = [];
  const models: ReturnType<typeof migrateLegacyToProviders>['models'] = [];
  const featureBindings: Record<string, FeatureModelConfig> = {};

  // ── 1. 创建 Provider ────────────────────────────────────────────────────
  if (legacy.provider === 'dashscope') {
    const dashCred: Record<string, string> = {};
    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (dashKey) dashCred.apiKey = dashKey;

    providers.push({
      id: 'dashscope-default',
      type: 'dashscope',
      name: 'DashScope (百炼)',
      credentials: dashCred,
      authType: 'bearer',
      providerOptionsJson: '{}',
    });

    // opencode provider
    const opencodeUrl = process.env.OPENCODE_SERVER_URL ?? '';
    const opencodePassword = process.env.OPENCODE_SERVER_PASSWORD ?? '';
    if (opencodeUrl && opencodePassword) {
      const opencodeCred: Record<string, string> = {
        username: process.env.OPENCODE_SERVER_USERNAME ?? 'cocbot',
        password: opencodePassword,
      };
      providers.push({
        id: 'opencode-default',
        type: 'opencode',
        name: 'OpenCode (百炼 Coding Plan)',
        baseUrl: opencodeUrl,
        credentials: opencodeCred,
        authType: 'basic',
        providerOptionsJson: JSON.stringify({ sessionTimeoutMs: 120000 }),
      });
    }
  } else if (legacy.provider === 'openlimits') {
    const olCred: Record<string, string> = {};
    const olKey = process.env.OPENLIMITS_API_KEY;
    if (olKey) olCred.apiKey = olKey;

    providers.push({
      id: 'openlimits-default',
      type: 'openai-compatible',
      name: 'OpenLimits',
      baseUrl: 'https://openlimits.app/v1',
      credentials: olCred,
      authType: 'bearer',
      providerOptionsJson: '{}',
    });
  }

  // ── 2. 创建 Model ────────────────────────────────────────────────────────
  const hasOpenCode = providers.some(p => p.id === 'opencode-default');
  const primaryProvider = hasOpenCode ? 'opencode-default' : `${legacy.provider}-default`;

  for (const mapping of LEGACY_FEATURE_MAP) {
    const modelId = legacy[mapping.legacyKey];
    if (!modelId) continue;

    const capabilities: Record<string, boolean> = {
      supportsChat: mapping.capability === 'supportsChat',
      supportsVision: false,
      supportsImageGeneration: false,
      supportsStreaming: true,
      supportsEmbeddings: mapping.capability === 'supportsEmbeddings',
    };

    // dashscope provider 支持图片生成
    if (legacy.provider === 'dashscope' && mapping.legacyKey === 'imagePromptModel') {
      capabilities.supportsImageGeneration = false;
    }

    const model: typeof models[0] = {
      id: `${primaryProvider}:${modelId}`,
      providerId: primaryProvider,
      modelId,
      name: modelId,
      capabilities,
    };

    models.push(model);

    // ── 3. 创建 Feature Binding ────────────────────────────────────────────
    let policy: SingleRoutingPolicy | FallbackRoutingPolicy;

    if (mapping.feature === 'kp.chat' && hasOpenCode) {
      // kp.chat: fallback 策略，primary=opencode, fallback=dashscope
      const dashModelId = legacy.chatModel;
      policy = {
        type: 'fallback',
        primary: { providerId: 'opencode-default', modelId: `${primaryProvider}:${modelId}` },
        fallback: { providerId: 'dashscope-default', modelId: `dashscope-default:${dashModelId}` },
        fallbackOnRateLimit: false,
      };

      // 同时添加 dashscope fallback model
      if (!models.some(m => m.id === `dashscope-default:${dashModelId}`)) {
        models.push({
          id: `dashscope-default:${dashModelId}`,
          providerId: 'dashscope-default',
          modelId: dashModelId,
          name: dashModelId,
          capabilities: { ...capabilities },
        });
      }
    } else {
      policy = {
        type: 'single',
        providerId: primaryProvider,
        modelId: `${primaryProvider}:${modelId}`,
      };
    }

    featureBindings[mapping.feature] = {
      feature: mapping.feature,
      routingPolicy: policy,
      fallbackOnRateLimit: policy.type === 'fallback' ? policy.fallbackOnRateLimit : false,
      updatedAt: Date.now(),
    };
  }

  // image.generate 绑定到 dashscope（仅 dashscope 支持）
  if (legacy.provider === 'dashscope') {
    featureBindings['image.generate'] = {
      feature: 'image.generate',
      routingPolicy: {
        type: 'single',
        providerId: 'dashscope-default',
        modelId: 'dashscope-default:qwen-image-2.0-pro',
      },
      fallbackOnRateLimit: false,
      updatedAt: Date.now(),
    };

    // 确保 image model 存在
    if (!models.some(m => m.id === 'dashscope-default:qwen-image-2.0-pro')) {
      models.push({
        id: 'dashscope-default:qwen-image-2.0-pro',
        providerId: 'dashscope-default',
        modelId: 'qwen-image-2.0-pro',
        name: 'qwen-image-2.0-pro',
        capabilities: {
          supportsChat: false,
          supportsVision: false,
          supportsImageGeneration: true,
          supportsStreaming: false,
          supportsEmbeddings: false,
        },
      });
    }
  }

  return { providers, models, featureBindings };
}

// ─── 主迁移流程 ──────────────────────────────────────────────────────────────

export function runMigration(): void {
  initEncryption();
  const db = openDatabase();

  // 初始化 schema
  migrateProviderSchema(db);

  // 幂等检查
  if (hasMigrated(db)) {
    console.log('[Migration] 已迁移，跳过');
    return;
  }

  // 读取 legacy 配置
  const rawSettings = db.query<{ value: string }, [string]>(
    "SELECT value FROM bot_settings WHERE key = 'ai_settings'",
  ).get('ai_settings');

  if (!rawSettings) {
    console.log('[Migration] 无 legacy ai_settings，使用默认配置');
    return;
  }

  let legacy: LegacyAISettings;
  try {
    legacy = JSON.parse(rawSettings.value) as LegacyAISettings;
  } catch {
    console.error('[Migration] 解析 ai_settings 失败，跳过');
    return;
  }

  console.log('[Migration] 开始迁移 legacy 配置:', JSON.stringify(legacy, null, 2));

  // 执行迁移
  const { providers, models, featureBindings } = migrateLegacyToProviders(legacy);

  // 写入 providers（幂等：已存在则跳过）
  for (const p of providers) {
    const existing = getProvider(db, p.id);
    if (existing) {
      console.log(`[Migration] Provider 已存在，跳过: ${p.id}`);
    } else {
      const cred = Object.keys(p.credentials).length > 0 ? p.credentials : undefined;
      createProvider(db, {
        id: p.id,
        type: p.type,
        name: p.name,
        baseUrl: p.baseUrl,
        credentials: cred,
        authType: p.authType,
        providerOptionsJson: p.providerOptionsJson,
      });
      console.log(`[Migration] 创建 Provider: ${p.id}`);
    }
  }

  // 写入 models（幂等：已存在则跳过）
  for (const m of models) {
    const existing = db.query<{ id: string }, [string]>(
      'SELECT id FROM ai_models WHERE id = ?',
    ).get(m.id);
    if (existing) {
      console.log(`[Migration] Model 已存在，跳过: ${m.id}`);
    } else {
      createModel(db, {
        id: m.id,
        providerId: m.providerId,
        modelId: m.modelId,
        name: m.name,
        capabilities: m.capabilities,
      });
      console.log(`[Migration] 创建 Model: ${m.id}`);
    }
  }

  // 写入 feature bindings（幂等：覆盖写入）
  for (const [feature, binding] of Object.entries(featureBindings)) {
    setFeatureBinding(db, binding as FeatureModelConfig);
    console.log(`[Migration] 绑定 Feature: ${feature}`);
  }

  console.log('[Migration] 迁移完成');

  // ── 切换 config_source ───────────────────────────────────────────────────
  db.run("UPDATE ai_config SET config_source = 'providers' WHERE id = 1");
  console.log('[Migration] config_source 已切换为 providers');
}

// 直接运行
runMigration();
