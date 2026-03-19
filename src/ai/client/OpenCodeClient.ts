/**
 * OpenCode serve 客户端
 *
 * POST /session/{id}/message 是同步 API，直接返回完整响应体。
 * 响应格式：{ info: {...}, parts: [{type, text, ...}, ...] }
 * 只取 type==="text" 的 part，拼接其 text 字段。
 */

import type { VisionMessage, StreamCallbacks, MultiModalContent } from './DashScopeClient';

const PROVIDER_ID = 'bailian-coding-plan';
const DEFAULT_CHAT_MODEL = 'qwen3.5-plus';
const DEFAULT_TIMEOUT_MS = 120_000;

function mapModel(model: string): string {
  if (model === 'qwen3.5-flash') return DEFAULT_CHAT_MODEL;
  return model;
}

function extractText(content: string | MultiModalContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text)
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

export class OpenCodeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    username: string,
    password: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    this.timeoutMs = timeoutMs;
  }

  private async apiFetch(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
        ...((options.headers as Record<string, string>) ?? {}),
      },
    });
  }

  private async createSession(signal?: AbortSignal): Promise<string> {
    const res = await this.apiFetch('/session', { method: 'POST', body: JSON.stringify({}) }, signal);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenCode session 创建失败 (${res.status}): ${body}`);
    }
    const data = await res.json() as { id: string };
    return data.id;
  }

  private deleteSession(sessionId: string): void {
    this.apiFetch(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  }

  /**
   * POST /session/{id}/message — 同步调用，返回完整响应体。
   * 从 parts 中提取 type==="text" 的内容（跳过 reasoning/step-start 等）。
   */
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

    const res = await this.apiFetch(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, signal);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`OpenCode prompt 失败 (${res.status}): ${errBody}`);
    }

    const data = await res.json() as OcMessageResponse;
    const text = (data.parts ?? [])
      .filter(p => p.type === 'text')
      .map(p => p.text ?? '')
      .join('');

    return text.trim();
  }

  // ─── 公开接口 ────────────────────────────────────────────────

  async chat(model: string, messages: VisionMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const sessionId = await this.createSession(controller.signal);
    try {
      const result = await this.callMessage(sessionId, model, messages, controller.signal);
      clearTimeout(timeout);
      return result;
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new Error(isAbort ? `OpenCode 调用超时（${this.timeoutMs / 1000}秒）` : String(err instanceof Error ? err.message : err));
    } finally {
      this.deleteSession(sessionId);
    }
  }

  /**
   * 流式聊天（实际上同步获取全文后一次性触发 onToken）。
   * 抛出异常由 HybridAiClient 捕获并回退 DashScope。
   */
  async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const sessionId = await this.createSession(controller.signal);
    try {
      const result = await this.callMessage(sessionId, modelId, messages as VisionMessage[], controller.signal);
      clearTimeout(timeout);
      callbacks.onToken(result);
      callbacks.onDone();
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new Error(isAbort ? `OpenCode 调用超时（${this.timeoutMs / 1000}秒）` : String(err instanceof Error ? err.message : err));
    } finally {
      this.deleteSession(sessionId);
    }
  }
}
