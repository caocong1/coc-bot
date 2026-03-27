/**
 * AIRouterClient — 统一 AI 客户端，封装 AIRouter + ProviderRegistry
 *
 * 实现旧 AIClient 接口（chat/streamChat/embed/generateImage/optimizeImagePrompt），
 * 内部通过 AIRouter 做 Feature 路由。
 *
 * 同时暴露 router 和 registry 实例，供直接访问。
 */

import type { Database } from 'bun:sqlite';
import { AIRouter } from '../providers/AIRouter';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { FeatureId } from '../providers/types';
import type { VisionMessage, StreamCallbacks } from './DashScopeClient';
import type { AIClient } from './AIClient';
import type { EmbedOptions } from '../providers/clients/BaseProviderClient';

// 兼容旧 AIClient 接口（model 参数）
export interface LegacyAIClient {
  chat(model: string, messages: VisionMessage[]): Promise<string>;
  streamChat(modelId: string, messages: Array<{ role: string; content: string }>, callbacks: StreamCallbacks): Promise<void>;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  generateImage(prompt: string, size?: string): Promise<string>;
  optimizeImagePrompt(description: string, model?: string): Promise<string>;
}

/**
 * 基于 AIRouter 的统一客户端。
 * 同时实现旧 AIClient 接口（用于向后兼容）和新 Feature 接口。
 */
export class AIRouterClient implements AIClient, LegacyAIClient {
  readonly db: Database;
  readonly router: AIRouter;
  readonly registry: ProviderRegistry;

  constructor(db: Database) {
    this.db = db;
    this.registry = new ProviderRegistry(db);
    this.router = new AIRouter(db, this.registry);
  }

  // ─── Legacy 接口（向后兼容）────────────────────────────────────────────

  /**
   * 旧接口：使用 kp.chat feature
   */
  async chat(model: string, messages: VisionMessage[]): Promise<string> {
    return this.router.chat('kp.chat', messages);
  }

  /**
   * 旧接口：使用 kp.chat feature
   */
  async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    await this.router.streamChat('kp.chat', messages, callbacks);
  }

  /**
   * 旧接口：使用 knowledge.embedding feature
   */
  async embed(texts: string[], options?: EmbedOptions): Promise<number[][]> {
    return this.router.embed('knowledge.embedding', texts, options?.model);
  }

  /**
   * 旧接口：使用 image.generate feature
   */
  async generateImage(prompt: string, _size?: string): Promise<string> {
    return this.router.generateImage('image.generate', prompt);
  }

  /**
   * 优化图片提示词：使用 image.prompt feature
   */
  async optimizeImagePrompt(description: string, _model?: string): Promise<string> {
    const system = `你是一位专业的 AI 绘图提示词工程师。
用户会给你一段中文的场景描述，你需要将其转化为适合图片生成模型的详细 prompt。

要求：
- 输出英文，约 60-100 词
- 风格明确（克苏鲁/1920s 恐怖氛围、油画/素描质感、阴暗光影等）
- 包含构图、光线、色调、细节描述
- 结尾加 "dark atmosphere, lovecraftian horror, cinematic lighting"
- 只输出 prompt 本身，不要解释`;

    try {
      return await this.router.chat('image.prompt', [
        { role: 'system', content: system },
        { role: 'user', content: description },
      ]);
    } catch {
      return description;
    }
  }

  // ─── 新 Feature 接口（推荐使用）────────────────────────────────────────

  async featureChat(feature: FeatureId, messages: VisionMessage[]): Promise<string> {
    return this.router.chat(feature, messages);
  }

  async featureStreamChat(
    feature: FeatureId,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    await this.router.streamChat(feature, messages, callbacks);
  }

  async featureEmbed(feature: FeatureId, texts: string[], model?: string): Promise<number[][]> {
    return this.router.embed(feature, texts, model);
  }

  async featureGenerateImage(feature: FeatureId, prompt: string): Promise<string> {
    return this.router.generateImage(feature, prompt);
  }
}
