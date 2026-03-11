/**
 * 阿里云百炼客户端
 *
 * 封装 DashScope OpenAI-compatible API 调用
 */

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_ENDPOINT = `${DASHSCOPE_BASE}/chat/completions`;
const DASHSCOPE_EMBED_ENDPOINT = `${DASHSCOPE_BASE}/embeddings`;

/** text-embedding-v4 每批最多 25 条 */
const EMBED_BATCH_SIZE = 25;
const DEFAULT_EMBED_MODEL = 'text-embedding-v4';
const DEFAULT_EMBED_DIM = 1024;

/**
 * Embedding 选项
 */
export interface EmbedOptions {
  model?: string;
  dimensions?: number;
}

/**
 * 流式响应回调
 */
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * DashScope 客户端
 */
export class DashScopeClient {
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * 批量文本向量化（text-embedding-v4）
   *
   * @param texts   待向量化的文本列表
   * @param options 模型与维度配置
   * @returns       与 texts 等长的向量数组，顺序对应
   */
  async embed(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];

    const model = options.model ?? DEFAULT_EMBED_MODEL;
    const dimensions = options.dimensions ?? DEFAULT_EMBED_DIM;
    const results: number[][] = new Array(texts.length);

    for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
      const embeddings = await this.embedBatch(batch, model, dimensions);
      for (let i = 0; i < embeddings.length; i++) {
        results[offset + i] = embeddings[i];
      }
    }

    return results;
  }

  private async embedBatch(
    texts: string[],
    model: string,
    dimensions: number,
  ): Promise<number[][]> {
    const response = await fetch(DASHSCOPE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, input: texts, dimensions }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`embedding 调用失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    if (!Array.isArray(json.data)) {
      throw new Error('embedding 响应格式异常：缺少 data 字段');
    }

    // API 不保证顺序，按 index 还原
    const ordered: number[][] = new Array(texts.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }

  /**
   * 流式聊天
   */
  async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const response = await fetch(DASHSCOPE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
      }),
    });
    
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      callbacks.onError(`模型调用失败 (${response.status}): ${body}`);
      return;
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
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
            if (token) {
              callbacks.onToken(token);
            }
          } catch {
            // 跳过格式错误的 JSON
          }
        }
      }
    } catch (err) {
      callbacks.onError(`读取响应流失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      reader.releaseLock();
    }
    
    callbacks.onDone();
  }
}
