/**
 * AI Provider 配置系统 — 核心类型定义
 */

// ─── FeatureId ──────────────────────────────────────────────────────────────────

export type FeatureId =
  | 'kp.chat'
  | 'kp.guardrail'
  | 'kp.opening'
  | 'kp.recap'
  | 'image.prompt'
  | 'image.generate'
  | 'knowledge.embedding'
  | 'fun.jrrp'
  | 'fun.v50'
  | 'fun.gugu'
  | 'module.extract';

// ─── Feature Capability Matrix ─────────────────────────────────────────────────

export type CapabilityKey = keyof ModelCapabilities;

export const FEATURE_REQUIREMENTS: Record<FeatureId, CapabilityKey[]> = {
  'kp.chat': ['supportsChat'],
  'kp.guardrail': ['supportsChat'],
  'kp.opening': ['supportsChat'],
  'kp.recap': ['supportsChat'],
  'image.prompt': ['supportsChat'],
  'image.generate': ['supportsImageGeneration'],
  'knowledge.embedding': ['supportsEmbeddings'],
  'fun.jrrp': ['supportsChat'],
  'fun.v50': ['supportsChat'],
  'fun.gugu': ['supportsChat'],
  'module.extract': ['supportsChat'],
};

// ─── Model Capabilities ────────────────────────────────────────────────────────

export interface ModelCapabilities {
  supportsChat: boolean;
  supportsVision: boolean;
  supportsImageGeneration: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  contextWindow?: number;
}

// ─── Provider Types ───────────────────────────────────────────────────────────

export type ProviderType = 'openai-compatible' | 'anthropic' | 'ollama' | 'dashscope' | 'opencode';

export type AuthType = 'bearer' | 'basic' | 'none';

export type ConfigSource = 'legacy' | 'providers';

// ─── Provider Options ──────────────────────────────────────────────────────────

export interface ProviderOptions {
  // openai-compatible
  headers?: Record<string, string>;
  organization?: string;
  // anthropic
  anthropicVersion?: string;
  maxRetries?: number;
  // ollama
  keepAlive?: string;
  // dashscope
  workspaceId?: string;
  // opencode
  sessionTimeoutMs?: number;
}

// ─── Provider Credentials ──────────────────────────────────────────────────────

export interface ProviderCredentials {
  apiKey?: string;    // Bearer token
  username?: string; // Basic auth
  password?: string; // Basic auth
}

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  credentialsEncrypted: string | null; // nullable; NULL = 无凭证; 非NULL = AES-256-GCM 密文
  authType: AuthType;
  providerOptionsJson: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Model Config ─────────────────────────────────────────────────────────────

export interface ModelConfig {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  capabilities: ModelCapabilities;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Routing Policy ────────────────────────────────────────────────────────────

export interface SingleRoutingPolicy {
  type: 'single';
  providerId: string;
  modelId: string;
}

export interface FallbackRoutingPolicy {
  type: 'fallback';
  primary: { providerId: string; modelId: string };
  fallback: { providerId: string; modelId: string };
  fallbackOnRateLimit: boolean;
}

export type RoutingPolicy = SingleRoutingPolicy | FallbackRoutingPolicy;

// ─── Feature Model Config ──────────────────────────────────────────────────────

export interface FeatureModelConfig {
  feature: FeatureId;
  routingPolicy: RoutingPolicy;
  fallbackOnRateLimit: boolean;
  updatedAt: number;
}

// ─── Decrypted Credentials (runtime only) ─────────────────────────────────────

export interface DecryptedCredentials {
  apiKey?: string;
  username?: string;
  password?: string;
}

// ─── Provider with Decrypted Credentials (runtime) ────────────────────────────

export interface ProviderWithCredentials extends ProviderConfig {
  credentials: DecryptedCredentials;
}

// ─── Legacy AISettings (for migration) ───────────────────────────────────────

export interface LegacyAISettings {
  provider: 'dashscope' | 'openlimits';
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
  imagePromptModel: string;
  embedModel: string;
}

// ─── API DTOs ─────────────────────────────────────────────────────────────────

export interface CreateProviderRequest {
  type: ProviderType;
  name: string;
  baseUrl?: string;
  credentials?: ProviderCredentials;
  authType?: AuthType;
  providerOptionsJson?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  baseUrl?: string;
  credentials?: ProviderCredentials | null; // null = 清除
  authType?: AuthType;
  providerOptionsJson?: string;
  enabled?: boolean;
}

export interface CreateModelRequest {
  modelId: string;
  name: string;
  capabilities: ModelCapabilities;
}

export interface UpdateModelRequest {
  name?: string;
  capabilities?: ModelCapabilities;
}

export interface UpdateFeatureBindingRequest {
  routingPolicy: RoutingPolicy;
  fallbackOnRateLimit?: boolean;
}

// ─── Migration Result ─────────────────────────────────────────────────────────

export interface MigrationResult {
  providers: ProviderConfig[];
  models: ModelConfig[];
  featureBindings: Record<FeatureId, FeatureModelConfig>;
}
