/**
 * AIRouter — Feature → Model 路由 + Fallback 策略
 *
 * 职责：
 * 1. 根据 FeatureId 获取对应的 FeatureModelConfig（支持 legacy/providers 两套配置）
 * 2. 路由决策：single → 直接调用 | fallback → 优先 primary，失败走 fallback
 * 3. Capability 校验：feature 需要的 capability 必须被 model 支持
 * 4. Provider-Model 完整性校验
 */

import type { Database } from 'bun:sqlite';
import {
  getConfigSource,
  getFeatureBinding,
  listFeatureBindings,
  getProvider,
  getModel,
  modelBelongsToProvider,
  decryptProviderCredentialsOrNull,
} from '../../storage/ProviderStore';
import { getAISettings } from '../../storage/BotSettingsStore';
import type {
  FeatureId,
  FeatureModelConfig,
  SingleRoutingPolicy,
  FallbackRoutingPolicy,
  RoutingPolicy,
  ModelCapabilities,
} from './types';
import { FEATURE_REQUIREMENTS } from './types';
import { ProviderRegistry } from './ProviderRegistry';
import type { BaseProviderClient, StreamChatOptions } from './clients';
import type { VisionMessage, StreamCallbacks } from '../client/DashScopeClient';

export { FEATURE_REQUIREMENTS };

// ─── Fallback 状态码 ────────────────────────────────────────────────────────

const FALLBACK_ON_STATUS = new Set([0, 408, 429, 500, 502, 503, 504]);

function shouldFallback(status: number, fallbackOnRateLimit: boolean): boolean {
  if (!FALLBACK_ON_STATUS.has(status)) return false;
  if (status === 429 && !fallbackOnRateLimit) return false;
  return true;
}

// ─── Capability 校验 ────────────────────────────────────────────────────────

function validateCapability(
  modelCaps: ModelCapabilities,
  requiredCaps: (keyof ModelCapabilities)[],
): string[] {
  const errors: string[] = [];
  for (const cap of requiredCaps) {
    const val = modelCaps[cap];
    if (val === false || val === undefined) {
      errors.push(`模型不支持 ${cap}（Feature 需要）`);
    }
  }
  return errors;
}

// ─── Legacy → FeatureModelConfig 降级 ──────────────────────────────────────

function legacyToFeatureBinding(feature: FeatureId): FeatureModelConfig | null {
  const legacy = getAISettings({} as Database);
  // 动态获取（避免循环 import）
  const { getAISettings: _getAISettings } = require('../../storage/BotSettingsStore');
  const settings = _getAISettings({} as Database);

  const LEGACY_MAP: Partial<Record<FeatureId, keyof typeof settings>> = {
    'kp.chat': 'chatModel',
    'kp.guardrail': 'guardrailModel',
    'kp.opening': 'openingModel',
    'kp.recap': 'recapModel',
    'image.prompt': 'imagePromptModel',
    'knowledge.embedding': 'embedModel',
  };

  const legacyKey = LEGACY_MAP[feature];
  if (!legacyKey) return null;

  const modelId = settings[legacyKey];
  if (!modelId) return null;

  // legacy 模式下，所有请求都走同一个 provider
  const providerType = settings.provider === 'dashscope' ? 'dashscope' : 'openai-compatible';
  const providerId = settings.provider === 'dashscope' ? 'dashscope-default' : 'openlimits-default';

  return {
    feature,
    routingPolicy: { type: 'single', providerId, modelId },
    fallbackOnRateLimit: false,
    updatedAt: 0,
  };
}

// ─── AIRouter ───────────────────────────────────────────────────────────────

export class AIRouter {
  constructor(
    private readonly db: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  // ─── Feature 配置读取 ─────────────────────────────────────────────────

  /**
   * 获取 Feature 的路由配置。
   * 根据 config_source 走 legacy 或 providers。
   */
  getFeatureBinding(feature: FeatureId): FeatureModelConfig | null {
    const source = getConfigSource(this.db);
    if (source === 'legacy') {
      return legacyToFeatureBinding(feature);
    }
    return getFeatureBinding(this.db, feature);
  }

  /**
   * 列出所有 Feature 绑定
   */
  listFeatureBindings(): FeatureModelConfig[] {
    const source = getConfigSource(this.db);
    if (source === 'legacy') {
      // legacy 模式下合成所有 known features
      const all: FeatureId[] = [
        'kp.chat', 'kp.guardrail', 'kp.opening', 'kp.recap',
        'image.prompt', 'image.generate',
        'knowledge.embedding',
        'fun.jrrp', 'fun.v50', 'fun.gugu',
        'module.extract',
      ];
      return all.map(f => legacyToFeatureBinding(f)).filter((b): b is FeatureModelConfig => b !== null);
    }
    return listFeatureBindings(this.db);
  }

  // ─── 路由执行 ─────────────────────────────────────────────────────────

  /**
   * 执行 chat 请求。
   * 根据 routingPolicy 路由到对应 provider/model。
   */
  async chat(feature: FeatureId, messages: VisionMessage[]): Promise<string> {
    const binding = this.getFeatureBinding(feature);
    if (!binding) throw new Error(`Feature '${feature}' 未配置`);

    const requiredCaps = FEATURE_REQUIREMENTS[feature] ?? [];
    await this.validateFeatureBinding(binding, requiredCaps);

    return this.routeChat(binding.routingPolicy, binding.fallbackOnRateLimit, messages);
  }

  /**
   * 执行流式 chat 请求。
   */
  async streamChat(
    feature: FeatureId,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const binding = this.getFeatureBinding(feature);
    if (!binding) { callbacks.onError(`Feature '${feature}' 未配置`); return; }

    const requiredCaps = FEATURE_REQUIREMENTS[feature] ?? [];
    const errors = this.validateFeatureBinding(binding, requiredCaps);
    if (errors.length > 0) { callbacks.onError(errors[0]); return; }

    await this.routeStreamChat(binding.routingPolicy, binding.fallbackOnRateLimit, messages, callbacks);
  }

  /**
   * 执行 embedding 请求。
   */
  async embed(feature: FeatureId, texts: string[], model?: string): Promise<number[][]> {
    const binding = this.getFeatureBinding(feature);
    if (!binding) throw new Error(`Feature '${feature}' 未配置`);

    const policy = binding.routingPolicy.type === 'fallback'
      ? binding.routingPolicy.primary
      : binding.routingPolicy;
    const client = this.getClientForPolicy(policy);
    if (!client) throw new Error(`无法获取 Provider client`);

    if (!client.supportsCapability('embed')) {
      throw new Error(`Provider 不支持 embedding`);
    }

    return client.embed(texts, { model });
  }

  /**
   * 执行图片生成请求。
   */
  async generateImage(feature: FeatureId, prompt: string): Promise<string> {
    const binding = this.getFeatureBinding(feature);
    if (!binding) throw new Error(`Feature '${feature}' 未配置`);

    const policy = binding.routingPolicy.type === 'fallback'
      ? binding.routingPolicy.primary
      : binding.routingPolicy;
    const client = this.getClientForPolicy(policy);
    if (!client) throw new Error(`无法获取 Provider client`);

    if (!client.supportsCapability('image')) {
      throw new Error(`Provider 不支持图片生成`);
    }

    return client.generateImage(prompt);
  }

  // ─── 路由实现 ─────────────────────────────────────────────────────────

  private async routeChat(
    policy: RoutingPolicy,
    fallbackOnRateLimit: boolean,
    messages: VisionMessage[],
  ): Promise<string> {
    if (policy.type === 'single') {
      return this.doChat(policy.providerId, policy.modelId, messages);
    }

    // fallback
    try {
      return await this.doChat(policy.primary.providerId, policy.primary.modelId, messages);
    } catch (err) {
      const status = this.extractStatus(err);
      if (!shouldFallback(status, policy.fallbackOnRateLimit ?? fallbackOnRateLimit)) throw err;
      console.warn(`[AIRouter] primary 失败 (${status})，切换到 fallback`);
      return this.doChat(policy.fallback.providerId, policy.fallback.modelId, messages);
    }
  }

  private async routeStreamChat(
    policy: RoutingPolicy,
    fallbackOnRateLimit: boolean,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    if (policy.type === 'single') {
      await this.doStreamChat(policy.providerId, policy.modelId, messages, callbacks);
      return;
    }

    try {
      await this.doStreamChat(policy.primary.providerId, policy.primary.modelId, messages, callbacks);
    } catch (err) {
      const status = this.extractStatus(err);
      if (!shouldFallback(status, policy.fallbackOnRateLimit ?? fallbackOnRateLimit)) return;
      console.warn(`[AIRouter] primary stream 失败 (${status})，切换到 fallback`);
      await this.doStreamChat(policy.fallback.providerId, policy.fallback.modelId, messages, callbacks);
    }
  }

  private async doChat(providerId: string, modelId: string, messages: VisionMessage[]): Promise<string> {
    const client = this.registry.getClient(providerId);
    if (!client) throw new Error(`Provider '${providerId}' 未找到或已禁用`);
    return client.chat({ modelId, messages });
  }

  private async doStreamChat(
    providerId: string,
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const client = this.registry.getClient(providerId);
    if (!client) { callbacks.onError(`Provider '${providerId}' 未找到或已禁用`); return; }
    await client.streamChat({ modelId, messages }, callbacks);
  }

  private getClientForPolicy(policy: { providerId: string; modelId: string }): BaseProviderClient | null {
    return this.registry.getClient(policy.providerId);
  }

  // ─── 校验 ─────────────────────────────────────────────────────────────

  validateFeatureBinding(binding: FeatureModelConfig, requiredCaps: (keyof ModelCapabilities)[]): string[] {
    const errors: string[] = [];

    const checkModel = (providerId: string, modelId: string) => {
      const model = getModel(this.db, modelId);
      if (!model) { errors.push(`Model '${modelId}' 不存在`); return; }
      if (!modelBelongsToProvider(this.db, modelId, providerId)) {
        errors.push(`Model '${modelId}' 不属于 Provider '${providerId}'`);
      }
      errors.push(...validateCapability(model.capabilities, requiredCaps));
    };

    if (binding.routingPolicy.type === 'single') {
      checkModel(binding.routingPolicy.providerId, binding.routingPolicy.modelId);
    } else {
      checkModel(binding.routingPolicy.primary.providerId, binding.routingPolicy.primary.modelId);
      checkModel(binding.routingPolicy.fallback.providerId, binding.routingPolicy.fallback.modelId);
    }

    return errors;
  }

  // ─── 工具 ─────────────────────────────────────────────────────────────

  private extractStatus(err: unknown): number {
    if (err instanceof Error) {
      const m = err.message.match(/\((\d+)\)/);
      if (m) return parseInt(m[1]);
    }
    return 0;
  }
}
