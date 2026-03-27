/**
 * ProviderRegistry — Provider 实例缓存 + Client 工厂
 *
 * 职责：
 * 1. 从 DB 加载所有 Provider + Model 配置
 * 2. 根据 Provider 类型创建对应的 Client 实例
 * 3. 缓存 Client 实例（keyed by provider.id）
 * 4. 暴露 getProvider / getModel / listProviders 等只读查询
 */

import type { Database } from 'bun:sqlite';
import {
  listProviders,
  listModels,
  decryptProviderCredentialsOrNull,
  getProvider,
  getModel,
} from '../../storage/ProviderStore';
import type { ProviderConfig, ModelConfig, ProviderWithCredentials } from './types';
import { OpenAICompatibleClient, OllamaClient, AnthropicClient, DashScopeClient, OpenCodeClient } from './clients';
import type { BaseProviderClient } from './clients/BaseProviderClient';
import type { ProviderOptions } from './types';

export class ProviderRegistry {
  private clients = new Map<string, BaseProviderClient>();

  constructor(
    private readonly db: Database,
  ) {}

  // ─── Client 工厂 ──────────────────────────────────────────────────────────

  private createClient(provider: ProviderWithCredentials): BaseProviderClient {
    const baseUrl = provider.baseUrl ?? this.defaultBaseUrl(provider.type);
    const opts: ProviderOptions = this.parseOptions(provider.providerOptionsJson);

    switch (provider.type) {
      case 'openai-compatible':
        return new OpenAICompatibleClient(provider, baseUrl, opts);
      case 'ollama':
        return new OllamaClient(provider, baseUrl, opts);
      case 'anthropic':
        return new AnthropicClient(provider, opts);
      case 'dashscope':
        return new DashScopeClient(provider);
      case 'opencode':
        return new OpenCodeClient(provider, baseUrl, opts);
      default:
        throw new Error(`不支持的 Provider 类型: ${(provider as ProviderConfig).type}`);
    }
  }

  private defaultBaseUrl(type: string): string {
    switch (type) {
      case 'openai-compatible': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com';
      case 'ollama': return 'http://localhost:11434';
      default: return '';
    }
  }

  private parseOptions(json: string): ProviderOptions {
    try {
      return JSON.parse(json) as ProviderOptions;
    } catch {
      return {};
    }
  }

  private buildProviderWithCredentials(config: ProviderConfig): ProviderWithCredentials {
    const decrypted = decryptProviderCredentialsOrNull(config.credentialsEncrypted);
    return {
      ...config,
      credentials: decrypted ?? { apiKey: undefined, username: undefined, password: undefined },
    };
  }

  // ─── Client 访问 ─────────────────────────────────────────────────────────

  /**
   * 获取（并缓存）Provider 的 Client 实例。
   * 仅返回 enabled 的 Provider。
   */
  getClient(providerId: string): BaseProviderClient | null {
    const cached = this.clients.get(providerId);
    if (cached) return cached;

    const config = getProvider(this.db, providerId);
    if (!config || !config.enabled) return null;

    const providerWithCreds = this.buildProviderWithCredentials(config);
    const client = this.createClient(providerWithCreds);
    this.clients.set(providerId, client);
    return client;
  }

  /**
   * 清除缓存（配置变更后调用）
   */
  invalidate(providerId?: string): void {
    if (providerId) {
      this.clients.delete(providerId);
    } else {
      this.clients.clear();
    }
  }

  // ─── 只读查询 ────────────────────────────────────────────────────────────

  listProviders(): ProviderConfig[] {
    return listProviders(this.db).filter(p => p.enabled);
  }

  getProvider(id: string): ProviderConfig | null {
    return getProvider(this.db, id);
  }

  listModels(providerId?: string): ModelConfig[] {
    return listModels(this.db, providerId);
  }

  getModel(id: string): ModelConfig | null {
    return getModel(this.db, id);
  }
}
