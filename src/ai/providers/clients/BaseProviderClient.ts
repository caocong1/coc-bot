/**
 * BaseProviderClient — 所有 Provider Client 的共同基类
 *
 * 定义统一的聊天接口，各 Provider Client 继承并实现具体 HTTP 行为。
 */

import type { VisionMessage, StreamCallbacks } from '../../client/DashScopeClient';

export interface ChatOptions {
  modelId: string;
  messages: VisionMessage[];
  /** 强制非流式返回（部分 provider 必须） */
  forceNoStream?: boolean;
  /** 超时 ms */
  timeoutMs?: number;
}

export interface StreamChatOptions {
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  /** 超时 ms */
  timeoutMs?: number;
}

export interface EmbedOptions {
  model?: string;
  dimensions?: number;
}

export interface ImageGenOptions {
  size?: string;
  n?: number;
}

/** Provider Client 统一接口 */
export interface BaseProviderClient {
  /** 非流式聊天 */
  chat(opts: ChatOptions): Promise<string>;

  /** 流式聊天（不支持则实现为同步返回） */
  streamChat(opts: StreamChatOptions, callbacks: StreamCallbacks): Promise<void>;

  /** 向量化 */
  embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>;

  /** 图片生成（不支持则抛 Error） */
  generateImage(prompt: string, opts?: ImageGenOptions): Promise<string>;

  /** Provider 类型标识 */
  readonly providerType: string;

  /** 是否支持某能力 */
  supportsCapability(cap: 'chat' | 'embed' | 'image'): boolean;
}
