/**
 * OpenAI Responses API Provider Client
 *
 * 支持 OpenLimits /v1/responses 端点（GPT-5 Codex 系列模型）。
 *
 * 请求格式：
 *   POST /v1/responses
 *   { model, instructions, input: [{type:'message',role:'user',content:[{type:'input_text',text}]}], stream:true, store:false }
 *
 * SSE 事件流：
 *   event: response.output_text.delta → data.delta
 *   event: response.completed → 完成
 */

import type { ProviderWithCredentials } from '../types';
import type { ProviderOptions } from '../types';
import type { BaseProviderClient, StreamChatOptions } from './BaseProviderClient';
import type { VisionMessage, StreamCallbacks } from '../../client/DashScopeClient';

export class OpenResponsesClient implements BaseProviderClient {
  readonly providerType = 'openai-responses';

  constructor(
    private readonly provider: ProviderWithCredentials,
    private readonly baseUrl: string,
    private readonly options: ProviderOptions = {},
  ) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat';
  }

  private get endpoint(): string {
    const base = this.baseUrl.replace(/\/$/, '');
    return `${base}/v1/responses`;
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

    if (this.options.headers) {
      Object.assign(headers, this.options.headers);
    }

    return headers;
  }

  async chat(_opts: { modelId: string; messages: VisionMessage[]; timeoutMs?: number }): Promise<string> {
    // Responses API 不支持非流式，直接用 streamChat
    return new Promise((resolve, reject) => {
      let result = '';
      let settled = false;
      const done = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      this.streamChat(
        { modelId: _opts.modelId, messages: _opts.messages as Array<{ role: string; content: string }> },
        {
          onToken: (t) => { result += t; },
          onDone: () => { done(result || '（无响应）'); },
          onError: (e) => { fail(new Error(e)); },
        },
      ).catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    });
  }

  async streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

    // 转换 messages → input array
    const systemInstructions = opts.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');

    const userContent = opts.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const text = typeof m.content === 'string' ? m.content : '';
        return {
          type: 'message' as const,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'input_text' as const, text }],
        };
      });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: opts.modelId,
          instructions: systemInstructions || 'You are a helpful assistant.',
          input: userContent,
          stream: true,
          store: false,
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
      callbacks.onError(`responses API 失败 (${response.status}): ${body}`);
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
          if (!trimmed) continue;

          // 解析 SSE: event: <name>\ndata: <json>
          let eventName = '';
          let dataStr = trimmed;

          if (trimmed.startsWith('event: ')) {
            const newlineIdx = trimmed.indexOf('\n');
            if (newlineIdx !== -1) {
              eventName = trimmed.slice(7, newlineIdx).trim();
              dataStr = trimmed.slice(newlineIdx + 1).trim();
            } else {
              continue; // 行不完整，等下一块
            }
          } else if (!trimmed.startsWith('data: ')) {
            continue;
          }

          if (!dataStr.startsWith('data: ')) continue;
          const jsonStr = dataStr.slice(6);

          try {
            const data = JSON.parse(jsonStr);

            // text delta 事件
            if (data.type === 'response.output_text.delta') {
              if (data.delta) callbacks.onToken(data.delta);
            }

            // 完成事件
            if (data.type === 'response.completed' || eventName === 'response.done') {
              clearTimeout(timeout);
              callbacks.onDone();
              return;
            }

            // 处理错误
            if (data.type === 'response.failed' || data.error) {
              clearTimeout(timeout);
              const msg = data.error?.message ?? JSON.stringify(data);
              callbacks.onError(`responses API 错误: ${msg}`);
              return;
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    callbacks.onDone();
  }

  async embed(_texts: string[], _opts?: { model?: string; dimensions?: number }): Promise<number[][]> {
    throw new Error('openai-responses provider 不支持 embeddings');
  }

  async generateImage(_prompt: string, _opts?: { size?: string; n?: number }): Promise<string> {
    throw new Error('openai-responses provider 不支持图片生成');
  }
}
