/**
 * DashScope Provider Client
 *
 * 阿里云百炼平台，支持 chat/embed/image。
 * 封装 DashScope OpenAI-compatible API + 专有图片生成 API。
 */

import type { ProviderWithCredentials } from '../types';
import type { BaseProviderClient, ChatOptions, StreamChatOptions, EmbedOptions, ImageGenOptions } from './BaseProviderClient';
import type { VisionMessage, StreamCallbacks } from '../../client/DashScopeClient';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_ENDPOINT = `${DASHSCOPE_BASE}/chat/completions`;
const DASHSCOPE_EMBED_ENDPOINT = `${DASHSCOPE_BASE}/embeddings`;
const DASHSCOPE_IMAGE_SYNC = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const EMBED_BATCH_SIZE = 25;

export class DashScopeClient implements BaseProviderClient {
  readonly providerType = 'dashscope';

  constructor(private readonly provider: ProviderWithCredentials) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat' || cap === 'embed' || cap === 'image';
  }

  private get apiKey(): string {
    return this.provider.credentials.apiKey ?? '';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async chat(opts: ChatOptions): Promise<string> {
    const response = await fetch(DASHSCOPE_ENDPOINT, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`DashScope chat 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  }

  async streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

    let response: Response;
    try {
      response = await fetch(DASHSCOPE_ENDPOINT, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: opts.modelId,
          messages: opts.messages,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    }

    if (!response.ok) {
      clearTimeout(timeout);
      const body = await response.text().catch(() => '');
      callbacks.onError(`chat 失败 (${response.status}): ${body}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) { clearTimeout(timeout); callbacks.onError('响应流为空'); return; }

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
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    } finally { clearTimeout(timeout); reader.releaseLock(); }

    callbacks.onDone();
  }

  async embed(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = opts?.model ?? 'text-embedding-v4';
    const dimensions = opts?.dimensions ?? 1024;
    const results: number[][] = new Array(texts.length);

    for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
      const embeds = await this.embedBatch(batch, model, dimensions);
      for (let i = 0; i < embeds.length; i++) {
        results[offset + i] = embeds[i];
      }
    }

    return results;
  }

  private async embedBatch(texts: string[], model: string, dimensions: number): Promise<number[][]> {
    const response = await fetch(DASHSCOPE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input: texts, dimensions }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`embedding 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    const ordered: number[][] = new Array(texts.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }

  async generateImage(prompt: string, opts?: ImageGenOptions): Promise<string> {
    const size = opts?.size ?? '1024*1024';

    const response = await fetch(DASHSCOPE_IMAGE_SYNC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-image-2.0-pro',
        input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
        parameters: { size, n: opts?.n ?? 1, prompt_extend: false, watermark: false },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`图片生成失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
      code?: string; message?: string;
    };

    const imageUrl = json.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imageUrl) {
      throw new Error(`图片生成失败: ${json.code ?? ''} ${json.message ?? ''}`.trim());
    }
    return imageUrl;
  }
}
