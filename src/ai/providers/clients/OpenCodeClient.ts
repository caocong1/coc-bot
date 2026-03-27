/**
 * OpenCode Provider Client
 *
 * 阿里云百炼 Coding Plan (OpenCode serve)。
 * 支持 chat（同步），不支持 embed/image。
 */

import type { ProviderWithCredentials, ProviderOptions } from '../types';
import type { BaseProviderClient, ChatOptions, StreamChatOptions, EmbedOptions, ImageGenOptions } from './BaseProviderClient';
import type { VisionMessage, StreamCallbacks, MultiModalContent } from '../../client/DashScopeClient';

const PROVIDER_ID = 'bailian-coding-plan';
const DEFAULT_TIMEOUT_MS = 120_000;

function mapModel(model: string): string {
  if (model === 'qwen3.5-flash') return 'qwen3.5-plus';
  return model;
}

function extractText(content: string | MultiModalContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text ?? '')
    .join('');
}

function buildPrompt(messages: VisionMessage[]): { system: string; promptText: string } {
  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');
  const system = systemMsg ? extractText(systemMsg.content) : '';

  let promptText: string;
  if (otherMsgs.length === 0) {
    promptText = '';
  } else if (otherMsgs.length === 1 && otherMsgs[0].role === 'user') {
    promptText = extractText(otherMsgs[0].content);
  } else {
    const lines = otherMsgs.map(m => {
      const role = m.role === 'user' ? 'Human' : 'Assistant';
      return `${role}: ${extractText(m.content)}`;
    });
    lines.push('Assistant:');
    promptText = lines.join('\n\n');
  }

  return { system, promptText };
}

interface OcPart {
  type: string;
  text?: string;
}

interface OcMessageResponse {
  info?: Record<string, unknown>;
  parts?: OcPart[];
}

export class OpenCodeClient implements BaseProviderClient {
  readonly providerType = 'opencode';

  constructor(
    private readonly provider: ProviderWithCredentials,
    private readonly baseUrl: string,
    private readonly options: ProviderOptions = {},
  ) {}

  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean {
    return cap === 'chat';
  }

  private get timeoutMs(): number {
    return this.options.sessionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private authHeader(): string {
    const username = this.provider.credentials.username ?? 'cocbot';
    const password = this.provider.credentials.password ?? '';
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  private async apiFetch(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async createSession(signal?: AbortSignal): Promise<string> {
    const res = await this.apiFetch('/session', {}, signal);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenCode session 创建失败 (${res.status}): ${body}`);
    }
    const data = await res.json() as { id: string };
    return data.id;
  }

  private deleteSession(sessionId: string): void {
    fetch(`${this.baseUrl.replace(/\/$/, '')}/session/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader() },
    }).catch(() => {});
  }

  private async callMessage(
    sessionId: string,
    model: string,
    messages: VisionMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const { system, promptText } = buildPrompt(messages);
    const modelId = mapModel(model);
    const body: Record<string, unknown> = {
      model: { providerID: PROVIDER_ID, modelID: modelId },
      parts: [{ type: 'text', text: promptText }],
    };
    if (system) body.system = system;

    const res = await this.apiFetch(`/session/${sessionId}/message`, body, signal);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`OpenCode prompt 失败 (${res.status}): ${errBody}`);
    }

    const data = await res.json() as OcMessageResponse;
    return (data.parts ?? [])
      .filter(p => p.type === 'text')
      .map(p => p.text ?? '')
      .join('')
      .trim();
  }

  async chat(opts: ChatOptions): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);

    let sessionId: string;
    try {
      sessionId = await this.createSession(controller.signal);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    try {
      const result = await this.callMessage(sessionId, opts.modelId, opts.messages, controller.signal);
      clearTimeout(timeout);
      return result;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    } finally {
      this.deleteSession(sessionId);
    }
  }

  async streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);

    let sessionId: string;
    try {
      sessionId = await this.createSession(controller.signal);
    } catch (err) {
      clearTimeout(timeout);
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return;
    }

    try {
      const result = await this.callMessage(sessionId, opts.modelId, opts.messages as VisionMessage[], controller.signal);
      clearTimeout(timeout);
      callbacks.onToken(result);
      callbacks.onDone();
    } catch (err) {
      clearTimeout(timeout);
      callbacks.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.deleteSession(sessionId);
    }
  }

  async embed(_texts: string[], _opts?: EmbedOptions): Promise<number[][]> {
    throw new Error('OpenCode 不支持 embedding');
  }

  async generateImage(_prompt: string, _opts?: ImageGenOptions): Promise<string> {
    throw new Error('OpenCode 不支持图片生成');
  }
}
