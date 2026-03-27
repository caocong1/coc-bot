/**
 * Ollama Provider Client
 *
 * 本地 Ollama 推理服务，支持 chat/embed/image（若 Ollama 支持）。
 */

import type { ProviderWithCredentials } from '../types';
import type { ProviderOptions } from '../types';
import type { BaseProviderClient, ChatOptions, StreamChatOptions, EmbedOptions, ImageGenOptions } from './BaseProviderClient';
import type { VisionMessage, StreamCallbacks } from '../../client/DashScopeClient';

export class OllamaClient implements BaseProviderClient {
  readonly providerType = 'ollama';

  constructor(
    private readonly provider: ProviderWithCredentials,
    private readonly baseUrl: string,
    private readonly options: ProviderOptions = {},
  ) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat' || cap === 'embed';
  }

  private get base(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  private authHeader(): Record<string, string> {
    if (this.provider.credentials.username && this.provider.credentials.password) {
      const creds = Buffer.from(
        `${this.provider.credentials.username}:${this.provider.credentials.password}`,
      ).toString('base64');
      return { Authorization: `Basic ${creds}` };
    }
    return {};
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'Content-Type': 'application/json', ...this.authHeader(), ...extra };
  }

  private keepAlive(): string {
    return this.options.keepAlive ?? '5m';
  }

  async chat(opts: ChatOptions): Promise<string> {
    const body = {
      model: opts.modelId,
      messages: opts.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : (
          (m.content as Array<{ type: string; text?: string; image_url?: { url: string } }>)
            .filter(c => c.type === 'text')
            .map(c => c.text ?? '')
            .join('')
        ),
      })),
      stream: false,
      options: { timeout: opts.timeoutMs ? String(opts.timeoutMs) : undefined },
    };

    const response = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama chat 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as { message: { content: string } };
    return json.message?.content?.trim() ?? '';
  }

  async streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const body = {
      model: opts.modelId,
      messages: opts.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      })),
      stream: true,
      options: { timeout: opts.timeoutMs ? String(opts.timeoutMs) : undefined },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 300_000);

    let response: Response;
    try {
      response = await fetch(`${this.base}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
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
      callbacks.onError(`Ollama chat 失败 (${response.status}): ${body}`);
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
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const token = json.message?.content ?? json.content ?? '';
            if (token) callbacks.onToken(token);
            if (json.done) { callbacks.onDone(); return; }
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
    const response = await fetch(`${this.base}/api/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: opts?.model ?? 'nomic-embed-text', prompt: texts.join('\n') }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama embed 失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as { embedding: number[] };
    return [json.embedding];
  }

  async generateImage(_prompt: string, _opts?: ImageGenOptions): Promise<string> {
    throw new Error('Ollama 不支持图片生成');
  }
}
