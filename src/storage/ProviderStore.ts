/**
 * AI Provider 数据存储层
 *
 * 封装 ai_config / ai_providers / ai_models / ai_feature_models 表的读写，
 * 以及凭证加密/解密逻辑。
 *
 * 设计原则：
 * - 凭证始终加密存储（ProviderStore 内部处理加密/解密）
 * - 写穿透失效：每次写入后清除相关缓存条目
 * - API 层无感知加密细节
 */

import type { Database } from 'bun:sqlite';
import { encryptCredentials, decryptCredentials, maskCredentials } from '../ai/providers/Encryption';
import type {
  ProviderConfig,
  ModelConfig,
  FeatureModelConfig,
  FeatureId,
  RoutingPolicy,
  DecryptedCredentials,
  ProviderCredentials,
  ProviderOptions,
  ConfigSource,
} from '../ai/providers/types';

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function now(): number {
  return Date.now();
}

// ─── 表初始化 ────────────────────────────────────────────────────────────────

export function migrateProviderSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config_source TEXT NOT NULL DEFAULT 'legacy'
    );

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT,
      credentials_encrypted TEXT,
      auth_type TEXT DEFAULT 'bearer',
      provider_options_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      name TEXT NOT NULL,
      supports_chat INTEGER DEFAULT 1,
      supports_vision INTEGER DEFAULT 0,
      supports_image_generation INTEGER DEFAULT 0,
      supports_streaming INTEGER DEFAULT 1,
      supports_embeddings INTEGER DEFAULT 0,
      context_window INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(provider_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS ai_feature_models (
      feature TEXT PRIMARY KEY,
      routing_policy_type TEXT NOT NULL,
      primary_provider_id TEXT,
      primary_model_id TEXT,
      fallback_provider_id TEXT,
      fallback_model_id TEXT,
      fallback_on_rate_limit INTEGER DEFAULT 0,
      updated_at INTEGER,
      FOREIGN KEY (primary_provider_id) REFERENCES ai_providers(id),
      FOREIGN KEY (primary_model_id) REFERENCES ai_models(id),
      FOREIGN KEY (fallback_provider_id) REFERENCES ai_providers(id),
      FOREIGN KEY (fallback_model_id) REFERENCES ai_models(id)
    );

    INSERT OR IGNORE INTO ai_config (id, config_source) VALUES (1, 'legacy');
  `);
}

// ─── config_source ──────────────────────────────────────────────────────────

export function getConfigSource(db: Database): ConfigSource {
  const row = db.query<{ config_source: string }, []>(
    'SELECT config_source FROM ai_config WHERE id = 1',
  ).get();
  return (row?.config_source ?? 'legacy') as ConfigSource;
}

export function setConfigSource(db: Database, source: ConfigSource): void {
  db.run('UPDATE ai_config SET config_source = ? WHERE id = 1', [source]);
}

// ─── Provider CRUD ──────────────────────────────────────────────────────────

export function listProviders(db: Database): ProviderConfig[] {
  const rows = db.query<{
    id: string; type: string; name: string; base_url: string | null;
    credentials_encrypted: string | null; auth_type: string;
    provider_options_json: string; enabled: number; sort_order: number;
    created_at: number; updated_at: number;
  }, []>('SELECT * FROM ai_providers ORDER BY sort_order, name').all();

  return rows.map(r => ({
    id: r.id,
    type: r.type as ProviderConfig['type'],
    name: r.name,
    baseUrl: r.base_url ?? undefined,
    credentialsEncrypted: r.credentials_encrypted,
    authType: r.auth_type as ProviderConfig['authType'],
    providerOptionsJson: r.provider_options_json,
    enabled: Boolean(r.enabled),
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getProvider(db: Database, id: string): ProviderConfig | null {
  const row = db.query<{
    id: string; type: string; name: string; base_url: string | null;
    credentials_encrypted: string | null; auth_type: string;
    provider_options_json: string; enabled: number; sort_order: number;
    created_at: number; updated_at: number;
  }, [string]>('SELECT * FROM ai_providers WHERE id = ?').get(id);

  if (!row) return null;

  return {
    id: row.id,
    type: row.type as ProviderConfig['type'],
    name: row.name,
    baseUrl: row.base_url ?? undefined,
    credentialsEncrypted: row.credentials_encrypted,
    authType: row.auth_type as ProviderConfig['authType'],
    providerOptionsJson: row.provider_options_json,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 创建 Provider（凭证会被加密）
 */
export function createProvider(
  db: Database,
  data: {
    id: string;
    type: string;
    name: string;
    baseUrl?: string;
    credentials?: ProviderCredentials;
    authType?: string;
    providerOptionsJson?: string;
    sortOrder?: number;
  },
): ProviderConfig {
  const ts = now();
  const credEnc = data.credentials ? encryptCredentials(data.credentials) : null;

  db.run(
    `INSERT INTO ai_providers
      (id, type, name, base_url, credentials_encrypted, auth_type, provider_options_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.type,
      data.name,
      data.baseUrl ?? null,
      credEnc,
      data.authType ?? 'bearer',
      data.providerOptionsJson ?? '{}',
      data.sortOrder ?? 0,
      ts,
      ts,
    ],
  );

  return {
    id: data.id,
    type: data.type as ProviderConfig['type'],
    name: data.name,
    baseUrl: data.baseUrl,
    credentialsEncrypted: credEnc,
    authType: (data.authType ?? 'bearer') as ProviderConfig['authType'],
    providerOptionsJson: data.providerOptionsJson ?? '{}',
    enabled: true,
    sortOrder: data.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * 更新 Provider。
 * - credentials = null → 清除凭证
 * - credentials = undefined → 保留原凭证
 * - credentials = {...} → 更新凭证
 */
export function updateProvider(
  db: Database,
  id: string,
  patch: {
    name?: string;
    baseUrl?: string | null;
    credentials?: ProviderCredentials | null;
    authType?: string;
    providerOptionsJson?: string;
    enabled?: boolean;
  },
): ProviderConfig | null {
  const existing = getProvider(db, id);
  if (!existing) return null;

  // 合并凭证加密
  let credEnc: string | null | undefined = undefined;
  if (patch.credentials === null) {
    credEnc = null; // 清除
  } else if (patch.credentials !== undefined) {
    credEnc = encryptCredentials(patch.credentials); // 更新
  }
  // else: undefined → 保留

  const ts = now();
  db.run(
    `UPDATE ai_providers SET
      name = COALESCE(?, name),
      base_url = COALESCE(?, base_url),
      credentials_encrypted = CASE WHEN ? IS NOT NULL THEN ?
        WHEN ? = 1 THEN NULL ELSE credentials_encrypted END,
      auth_type = COALESCE(?, auth_type),
      provider_options_json = COALESCE(?, provider_options_json),
      enabled = COALESCE(?, enabled),
      updated_at = ?
     WHERE id = ?`,
    [
      patch.name ?? null,
      patch.baseUrl ?? null,
      credEnc === undefined ? 0 : 1,
      credEnc ?? null,
      patch.credentials === null ? 1 : 0,
      patch.authType ?? null,
      patch.providerOptionsJson ?? null,
      patch.enabled ?? null,
      ts,
      id,
    ],
  );

  return getProvider(db, id);
}

/**
 * 删除 Provider（含 cascade 删除子模型）
 */
export function deleteProvider(db: Database, id: string): boolean {
  const changes = db.run('DELETE FROM ai_providers WHERE id = ?', [id]).changes;
  return changes > 0;
}

/**
 * 检查 Provider 是否被 Feature 引用
 */
export function getProviderReferences(db: Database, providerId: string): FeatureId[] {
  const rows = db.query<{ feature: string }, [string, string]>(
    `SELECT DISTINCT feature FROM ai_feature_models
     WHERE primary_provider_id = ? OR fallback_provider_id = ?`,
  ).all(providerId, providerId);
  return rows.map(r => r.feature as FeatureId);
}

// ─── Model CRUD ──────────────────────────────────────────────────────────────

export function listModels(db: Database, providerId?: string): ModelConfig[] {
  const query = providerId
    ? 'SELECT * FROM ai_models WHERE provider_id = ? ORDER BY sort_order, name'
    : 'SELECT * FROM ai_models ORDER BY sort_order, name';
  const rows = providerId
    ? db.query<{
        id: string; provider_id: string; model_id: string; name: string;
        supports_chat: number; supports_vision: number; supports_image_generation: number;
        supports_streaming: number; supports_embeddings: number; context_window: number | null;
        sort_order: number; created_at: number; updated_at: number;
      }, [string]>('SELECT * FROM ai_models WHERE provider_id = ? ORDER BY sort_order, name').all(providerId)
    : db.query<{
        id: string; provider_id: string; model_id: string; name: string;
        supports_chat: number; supports_vision: number; supports_image_generation: number;
        supports_streaming: number; supports_embeddings: number; context_window: number | null;
        sort_order: number; created_at: number; updated_at: number;
      }, []>('SELECT * FROM ai_models ORDER BY sort_order, name').all();

  return rows.map(r => modelRowToConfig(r));
}

export function getModel(db: Database, id: string): ModelConfig | null {
  const row = db.query<{
    id: string; provider_id: string; model_id: string; name: string;
    supports_chat: number; supports_vision: number; supports_image_generation: number;
    supports_streaming: number; supports_embeddings: number; context_window: number | null;
    sort_order: number; created_at: number; updated_at: number;
  }, [string]>('SELECT * FROM ai_models WHERE id = ?').get(id);

  if (!row) return null;
  return modelRowToConfig(row);
}

function modelRowToConfig(r: {
  id: string; provider_id: string; model_id: string; name: string;
  supports_chat: number; supports_vision: number; supports_image_generation: number;
  supports_streaming: number; supports_embeddings: number; context_window: number | null;
  sort_order: number; created_at: number; updated_at: number;
}): ModelConfig {
  return {
    id: r.id,
    providerId: r.provider_id,
    modelId: r.model_id,
    name: r.name,
    capabilities: {
      supportsChat: Boolean(r.supports_chat),
      supportsVision: Boolean(r.supports_vision),
      supportsImageGeneration: Boolean(r.supports_image_generation),
      supportsStreaming: Boolean(r.supports_streaming),
      supportsEmbeddings: Boolean(r.supports_embeddings),
      contextWindow: r.context_window ?? undefined,
    },
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createModel(
  db: Database,
  data: {
    id: string;
    providerId: string;
    modelId: string;
    name: string;
    capabilities: {
      supportsChat?: boolean;
      supportsVision?: boolean;
      supportsImageGeneration?: boolean;
      supportsStreaming?: boolean;
      supportsEmbeddings?: boolean;
      contextWindow?: number;
    };
    sortOrder?: number;
  },
): ModelConfig {
  const ts = now();
  db.run(
    `INSERT INTO ai_models
      (id, provider_id, model_id, name, supports_chat, supports_vision, supports_image_generation,
       supports_streaming, supports_embeddings, context_window, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.providerId,
      data.modelId,
      data.name,
      data.capabilities.supportsChat ?? true ? 1 : 0,
      data.capabilities.supportsVision ?? false ? 1 : 0,
      data.capabilities.supportsImageGeneration ?? false ? 1 : 0,
      data.capabilities.supportsStreaming ?? true ? 1 : 0,
      data.capabilities.supportsEmbeddings ?? false ? 1 : 0,
      data.capabilities.contextWindow ?? null,
      data.sortOrder ?? 0,
      ts,
      ts,
    ],
  );

  return {
    id: data.id,
    providerId: data.providerId,
    modelId: data.modelId,
    name: data.name,
    capabilities: {
      supportsChat: data.capabilities.supportsChat ?? true,
      supportsVision: data.capabilities.supportsVision ?? false,
      supportsImageGeneration: data.capabilities.supportsImageGeneration ?? false,
      supportsStreaming: data.capabilities.supportsStreaming ?? true,
      supportsEmbeddings: data.capabilities.supportsEmbeddings ?? false,
      contextWindow: data.capabilities.contextWindow,
    },
    sortOrder: data.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateModel(
  db: Database,
  id: string,
  patch: {
    name?: string;
    capabilities?: ModelConfig['capabilities'];
  },
): ModelConfig | null {
  const existing = getModel(db, id);
  if (!existing) return null;

  const ts = now();
  const caps = { ...existing.capabilities, ...patch.capabilities };
  db.run(
    `UPDATE ai_models SET
      name = COALESCE(?, name),
      supports_chat = ?,
      supports_vision = ?,
      supports_image_generation = ?,
      supports_streaming = ?,
      supports_embeddings = ?,
      context_window = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      patch.name ?? null,
      caps.supportsChat ? 1 : 0,
      caps.supportsVision ? 1 : 0,
      caps.supportsImageGeneration ? 1 : 0,
      caps.supportsStreaming ? 1 : 0,
      caps.supportsEmbeddings ? 1 : 0,
      caps.contextWindow ?? null,
      ts,
      id,
    ],
  );

  return getModel(db, id);
}

export function deleteModel(db: Database, id: string): boolean {
  const changes = db.run('DELETE FROM ai_models WHERE id = ?', [id]).changes;
  return changes > 0;
}

export function getModelReferences(db: Database, modelId: string): FeatureId[] {
  const rows = db.query<{ feature: string }, [string, string]>(
    `SELECT DISTINCT feature FROM ai_feature_models
     WHERE primary_model_id = ? OR fallback_model_id = ?`,
  ).all(modelId, modelId);
  return rows.map(r => r.feature as FeatureId);
}

// ─── Feature Bindings ─────────────────────────────────────────────────────────

export function getFeatureBinding(db: Database, feature: FeatureId): FeatureModelConfig | null {
  const row = db.query<{
    feature: string; routing_policy_type: string;
    primary_provider_id: string | null; primary_model_id: string | null;
    fallback_provider_id: string | null; fallback_model_id: string | null;
    fallback_on_rate_limit: number; updated_at: number;
  }, [string]>('SELECT * FROM ai_feature_models WHERE feature = ?').get(feature);

  if (!row) return null;
  return routingRowToConfig(row);
}

export function listFeatureBindings(db: Database): FeatureModelConfig[] {
  const rows = db.query<{
    feature: string; routing_policy_type: string;
    primary_provider_id: string | null; primary_model_id: string | null;
    fallback_provider_id: string | null; fallback_model_id: string | null;
    fallback_on_rate_limit: number; updated_at: number;
  }, []>('SELECT * FROM ai_feature_models').all();

  return rows.map(routingRowToConfig);
}

function routingRowToConfig(r: {
  feature: string; routing_policy_type: string;
  primary_provider_id: string | null; primary_model_id: string | null;
  fallback_provider_id: string | null; fallback_model_id: string | null;
  fallback_on_rate_limit: number; updated_at: number;
}): FeatureModelConfig {
  const policy: RoutingPolicy = r.routing_policy_type === 'fallback'
    ? {
        type: 'fallback',
        primary: { providerId: r.primary_provider_id!, modelId: r.primary_model_id! },
        fallback: { providerId: r.fallback_provider_id!, modelId: r.fallback_model_id! },
        fallbackOnRateLimit: Boolean(r.fallback_on_rate_limit),
      }
    : {
        type: 'single',
        providerId: r.primary_provider_id!,
        modelId: r.primary_model_id!,
      };

  return {
    feature: r.feature as FeatureId,
    routingPolicy: policy,
    fallbackOnRateLimit: Boolean(r.fallback_on_rate_limit),
    updatedAt: r.updated_at,
  };
}

export function setFeatureBinding(
  db: Database,
  binding: FeatureModelConfig,
): void {
  const ts = now();
  const policy = binding.routingPolicy;
  const isFallback = policy.type === 'fallback';
  const primaryProviderId = isFallback ? policy.primary.providerId : (policy as { providerId: string }).providerId;
  const primaryModelId = isFallback ? policy.primary.modelId : (policy as { modelId: string }).modelId;
  const fallbackProviderId = isFallback ? policy.fallback.providerId : null;
  const fallbackModelId = isFallback ? policy.fallback.modelId : null;
  const fallbackOnRateLimit = isFallback ? (policy.fallbackOnRateLimit ? 1 : 0) : 0;

  db.run(
    `INSERT INTO ai_feature_models
      (feature, routing_policy_type, primary_provider_id, primary_model_id,
       fallback_provider_id, fallback_model_id, fallback_on_rate_limit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature) DO UPDATE SET
       routing_policy_type = excluded.routing_policy_type,
       primary_provider_id = excluded.primary_provider_id,
       primary_model_id = excluded.primary_model_id,
       fallback_provider_id = excluded.fallback_provider_id,
       fallback_model_id = excluded.fallback_model_id,
       fallback_on_rate_limit = excluded.fallback_on_rate_limit,
       updated_at = excluded.updated_at`,
    [
      binding.feature,
      isFallback ? 'fallback' : 'single',
      primaryProviderId,
      primaryModelId,
      fallbackProviderId,
      fallbackModelId,
      fallbackOnRateLimit,
      ts,
    ],
  );
}

export function deleteFeatureBinding(db: Database, feature: FeatureId): boolean {
  const changes = db.run('DELETE FROM ai_feature_models WHERE feature = ?', [feature]).changes;
  return changes > 0;
}

// ─── 凭证解密 ────────────────────────────────────────────────────────────────

export function decryptProviderCredentials(encrypted: string): DecryptedCredentials {
  const obj = decryptCredentials(encrypted) as Record<string, unknown>;
  return {
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : undefined,
    username: typeof obj.username === 'string' ? obj.username : undefined,
    password: typeof obj.password === 'string' ? obj.password : undefined,
  };
}

export function decryptProviderCredentialsOrNull(encrypted: string | null): DecryptedCredentials | null {
  if (!encrypted) return null;
  return decryptProviderCredentials(encrypted);
}

// ─── Provider + Model 完整性校验 ─────────────────────────────────────────────

/**
 * 校验 Model 属于 Provider
 */
export function modelBelongsToProvider(db: Database, modelId: string, providerId: string): boolean {
  const row = db.query<{ cnt: number }, [string, string]>(
    'SELECT COUNT(*) as cnt FROM ai_models WHERE id = ? AND provider_id = ?',
  ).get(modelId, providerId);
  return (row?.cnt ?? 0) > 0;
}

// ─── 迁移 ───────────────────────────────────────────────────────────────────

export function hasMigrated(db: Database): boolean {
  return getConfigSource(db) === 'providers';
}
