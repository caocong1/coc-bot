/**
 * OpenAI-Compatible Provider Client
 *
 * 支持任意 OpenAI-compatible API（OpenLimits、第三方兼容端点）。
 * 支持 Bearer / Basic 认证、自定义 headers。
 */

import type { ProviderWithCredentials } from '../types';
import type { ProviderOptions } from '../types';
import type { BaseProviderClient, ChatOptions, StreamChatOptions, EmbedOptions, ImageGenOptions } from './BaseProviderClient';
import type { VisionMessage, StreamCallbacks } from '../../client/DashScopeClient';

export class OpenAICompatibleClient implements BaseProviderClient {
  readonly providerType = 'openai-compatible';

  constructor(
    private readonly provider: ProviderWithCredentials,
    private readonly baseUrl: string,
    private readonly options: ProviderOptions = {},
  ) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat' || cap === 'embed';
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.provider.credentials.apiKey) {
      headers['Authorization'] = `Bearer ${this.provider.credentials.apiKey}`;
    } else if (this.provider.credentials.username && this.provider.credentials.password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(
        `${this.provider.credentials.username}:${this.provider.credentials.password}`,
      ).toString('base64');
    }

    // 自定义 headers
    if (this.options.headers) {
      Object.assign(headers, this.options.headers);
    }
    if (this.options.organization) {
      headers['OpenAI-Organization'] = this.options.organization;
    }

    return headers;
  }

  private get endpoint(): string {
    const base = this.baseUrl.replace(/\/$/, '');
    return `${base}/chat/completions`;
  }

  async chat(opts: ChatOptions): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible chat 失败 (${response.status}): ${body}`);
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
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
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
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    callbacks.onDone();
  }

  async embed(_texts: string[], _opts?: EmbedOptions): Promise<number[][]> {
    // OpenAI-compatible endpoint 需要 /embeddings 路径
    const base = this.baseUrl.replace(/\/$/, '');
    const endpoint = `${base}/embeddings`;
    const model = _opts?.model ?? 'text-embedding-3-small';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model,
        input: _texts,
        dimensions: _opts?.dimensions,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`embedding 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    const ordered: number[][] = new Array(_texts.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }

  async generateImage(_prompt: string, _opts?: ImageGenOptions): Promise<string> {
    throw new Error('OpenAI-compatible provider 不支持图片生成');
  }
}
