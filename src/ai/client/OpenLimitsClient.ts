/**
 * OpenLimits AI 客户端
 *
 * OpenAI-compatible API，endpoint: https://openlimits.app/v1/chat/completions
 * 认证: Authorization: Bearer <api-key>
 *
 * 支持能力:
 *   - chat() / streamChat() / optimizeImagePrompt()
 *   - embed() / generateImage() → 抛出明确错误
 */

import type { EmbedOptions, StreamCallbacks, VisionMessage } from './DashScopeClient';

const OPENLIMITS_ENDPOINT = 'https://openlimits.app/v1/chat/completions';
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

function normalizeTimeoutMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(10_000, Math.floor(parsed));
}

function formatTimeoutLabel(timeoutMs: number): string {
  if (timeoutMs % 60_000 === 0) return `${timeoutMs / 60_000}分钟`;
  if (timeoutMs % 1_000 === 0) return `${timeoutMs / 1_000}秒`;
  return `${timeoutMs}毫秒`;
}

export class OpenLimitsClient {
  private readonly apiKey: string;
  private readonly streamTimeoutMs: number;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.streamTimeoutMs = normalizeTimeoutMs(
      process.env.DASHSCOPE_STREAM_TIMEOUT_MS,
      DEFAULT_STREAM_TIMEOUT_MS,
    );
  }

  /**
   * 非流式聊天
   */
  async chat(model: string, messages: VisionMessage[]): Promise<string> {
    const response = await fetch(OPENLIMITS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenLimits API error (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /**
   * 流式聊天（OpenAI SSE 格式）
   */
  async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.streamTimeoutMs);

    let response: Response;
    try {
      response = await fetch(OPENLIMITS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: modelId, messages, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error && err.name === 'AbortError'
        ? `模型调用超时（${formatTimeoutLabel(this.streamTimeoutMs)}）`
        : `模型调用失败: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onError(msg);
      return;
    }

    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text().catch(() => '');
      callbacks.onError(`模型调用失败 (${response.status}): ${body}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeout);
      callbacks.onError('响应流为空');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const token = json.choices?.[0]?.delta?.content;
            if (token) callbacks.onToken(token);
          } catch {
            // 跳过格式错误的 JSON
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? `模型响应超时（${formatTimeoutLabel(this.streamTimeoutMs)}）`
        : `读取响应流失败: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onError(msg);
      return;
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    callbacks.onDone();
  }

  /**
   * 图片生成 — OpenLimits 不支持，抛出明确错误
   */
  async generateImage(_prompt: string, _size?: string): Promise<string> {
    throw new Error('当前 AI provider 不支持图片生成（仅 DashScope 支持）');
  }

  /**
   * embedding — OpenLimits 不支持，抛出明确错误
   */
  async embed(_texts: string[], _options?: EmbedOptions): Promise<number[][]> {
    throw new Error('当前 AI provider 不支持 embedding（仅 DashScope 支持）');
  }

  /**
   * 优化图片提示词（复用 chat 方法）
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
      return await this.chat('claude-sonnet-4-6', [
        { role: 'system', content: system },
        { role: 'user', content: description },
      ]);
    } catch {
      return description;
    }
  }
}
