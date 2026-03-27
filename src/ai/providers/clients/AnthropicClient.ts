/**
 * Anthropic Provider Client
 *
 * Anthropic Messages API (Claude 系列)。
 * 支持 Bearer 认证、自定义 API version。
 */

import type { ProviderWithCredentials } from '../types';
import type { ProviderOptions } from '../types';
import type { BaseProviderClient, ChatOptions, StreamChatOptions, EmbedOptions, ImageGenOptions } from './BaseProviderClient';
import type { StreamCallbacks } from '../../client/DashScopeClient';

export class AnthropicClient implements BaseProviderClient {
  readonly providerType = 'anthropic';

  private readonly ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

  constructor(
    private readonly provider: ProviderWithCredentials,
    private readonly options: ProviderOptions = {},
  ) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat';
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.provider.credentials.apiKey ?? '',
      'anthropic-version': this.options.anthropicVersion ?? '2023-06-01',
    };
    if (this.provider.credentials.apiKey) {
      // Bearer 兼容
      headers['Authorization'] = `Bearer ${this.provider.credentials.apiKey}`;
    }
    return headers;
  }

  private extractText(content: string | Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>): string {
    if (typeof content === 'string') return content;
    return content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map(c => c.text ?? '')
      .join('');
  }

  async chat(opts: ChatOptions): Promise<string> {
    const system = opts.messages.find(m => m.role === 'system');
    const others = opts.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: opts.modelId,
      messages: others.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: this.extractText(m.content),
      })),
      max_tokens: 4096,
    };

    if (system) {
      body.system = this.extractText(system.content);
    }

    const version = this.options.anthropicVersion ?? '2023-06-01';
    const endpoint = version.startsWith('2023-06-01')
      ? `${this.ANTHROPIC_BASE}/messages`
      : `${this.ANTHROPIC_BASE}/messages`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic chat 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as { content: Array<{ type: string; text?: string }> };
    return json.content?.[0]?.text?.trim() ?? '';
  }

  async streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const system = opts.messages.find(m => m.role === 'system');
    const others = opts.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: opts.modelId,
      messages: others.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: this.extractText(m.content),
      })),
      max_tokens: 4096,
      stream: true,
    };

    if (system) {
      body.system = this.extractText(system.content);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

    try {
      const response = await fetch(`${this.ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-xy-access': 'enable-streaming',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeout);
        const body = await response.text().catch(() => '');
        callbacks.onError(`Anthropic chat 失败 (${response.status}): ${body}`);
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
            if (!line.trim() || !line.startsWith('data: ')) continue;
            if (line.trim() === 'data: [DONE]') continue;
            try {
              const json = JSON.parse(line.slice(6));
              if (json.type === 'content_block_delta') {
                callbacks.onToken(json.delta?.text ?? '');
              } else if (json.type === 'message_delta') {
                callbacks.onDone();
                return;
              }
            } catch { /* skip */ }
          }
        }
      } finally { clearTimeout(timeout); reader.releaseLock(); }
    } catch (err) {
      clearTimeout(timeout);
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    }

    callbacks.onDone();
  }

  async embed(_texts: string[], _opts?: EmbedOptions): Promise<number[][]> {
    throw new Error('Anthropic 不支持 embedding');
  }

  async generateImage(_prompt: string, _opts?: ImageGenOptions): Promise<string> {
    throw new Error('Anthropic 不支持图片生成');
  }
}
