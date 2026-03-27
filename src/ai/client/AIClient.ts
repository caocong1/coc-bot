/**
 * 统一 AI 客户端接口
 *
 * 抽象 DashScopeClient / HybridAiClient / OpenLimitsClient，
 * 解除具体实现与上层的耦合。
 */

import type { EmbedOptions, StreamCallbacks, VisionMessage } from './DashScopeClient';

export interface AIClient {
  chat(model: string, messages: VisionMessage[]): Promise<string>;
  streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void>;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  generateImage(prompt: string, size?: string): Promise<string>;
  optimizeImagePrompt(description: string, model?: string): Promise<string>;
}
