/**
 * HybridAiClient — 百炼 Coding Plan + DashScope 混合客户端
 *
 * chat() / streamChat() 优先走 opencode serve（Coding Plan），
 * 失败（连接拒绝、额度耗尽、超时等任何错误）时自动回退 DashScope。
 *
 * embed() / generateImage() / optimizeImagePrompt() 的底层 chat 如果走 OpenCode，
 * 则 optimizeImagePrompt() 自动受益；embed 和图片生成始终走 DashScope。
 */

import { DashScopeClient } from './DashScopeClient';
import { OpenCodeClient } from './OpenCodeClient';
import type { VisionMessage, StreamCallbacks } from './DashScopeClient';

export class HybridAiClient extends DashScopeClient {
  private readonly openCode: OpenCodeClient;

  constructor(
    dashApiKey: string,
    opencodeUrl: string,
    opencodeUsername: string,
    opencodePassword: string,
  ) {
    super(dashApiKey);
    this.openCode = new OpenCodeClient(
      opencodeUrl,
      opencodeUsername,
      opencodePassword,
    );
  }

  // ─── chat：优先 OpenCode，回退 DashScope ────────────────────

  override async chat(model: string, messages: VisionMessage[]): Promise<string> {
    try {
      const result = await this.openCode.chat(model, messages);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HybridAI] OpenCode chat 失败，回退 DashScope: ${msg}`);
      return super.chat(model, messages);
    }
  }

  // ─── streamChat：优先 OpenCode，回退 DashScope ──────────────

  override async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    try {
      await this.openCode.streamChat(modelId, messages, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HybridAI] OpenCode streamChat 失败，回退 DashScope: ${msg}`);
      await super.streamChat(modelId, messages, callbacks);
    }
  }

  // embed() 和 generateImage() 继承自 DashScopeClient，无需 override
  // optimizeImagePrompt() 调用 this.chat()，自动走 OpenCode
}
