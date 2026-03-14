/**
 * 阿里云百炼客户端
 *
 * 封装 DashScope OpenAI-compatible API 调用，以及专有图片生成 API。
 */

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_ENDPOINT = `${DASHSCOPE_BASE}/chat/completions`;
const DASHSCOPE_EMBED_ENDPOINT = `${DASHSCOPE_BASE}/embeddings`;
/** 图片生成（qwen-image-2.0-pro）专有 API，不走兼容模式 */
const DASHSCOPE_IMAGE_SUBMIT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';

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

/** 多模态消息内容块（用于视觉模型） */
export type MultiModalContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** 视觉聊天消息 */
export interface VisionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MultiModalContent[];
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
   * 非流式聊天（支持多模态 content，用于图片识别）
   *
   * @param model      如 'qwen3.5-plus'（支持视觉）
   * @param messages   支持 content 为字符串或 MultiModalContent[]
   */
  async chat(
    model: string,
    messages: VisionMessage[],
  ): Promise<string> {
    const response = await fetch(DASHSCOPE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`chat 调用失败 (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /**
   * 优化图片生成提示词（中文描述 → 适合 qwen-image-2.0-pro 的 prompt）
   *
   * 先用 qwen3.5-plus 把用户的简短描述扩写成细节丰富、风格明确的英文提示词。
   * 这一步通常能显著提升生成图片质量。
   */
  async optimizeImagePrompt(description: string): Promise<string> {
    const system = `你是一位专业的 AI 绘图提示词工程师。
用户会给你一段中文的场景描述，你需要将其转化为适合图片生成模型的详细 prompt。

要求：
- 输出英文，约 60-100 词
- 风格明确（克苏鲁/1920s 恐怖氛围、油画/素描质感、阴暗光影等）
- 包含构图、光线、色调、细节描述
- 结尾加 "dark atmosphere, lovecraftian horror, cinematic lighting"
- 只输出 prompt 本身，不要解释`;

    try {
      return await this.chat('qwen3.5-plus', [
        { role: 'system', content: system },
        { role: 'user', content: description },
      ]);
    } catch {
      // 优化失败时退回原始描述
      return description;
    }
  }

  /**
   * 图片生成（qwen-image-2.0-pro，异步任务模式）
   *
   * 流程：提交任务 → 轮询直至 SUCCEEDED → 返回图片 URL
   * @param prompt     已优化的英文提示词
   * @param size       图片尺寸，默认 1024*1024
   * @param timeoutMs  最长等待时间（默认 90 秒）
   */
  async generateImage(
    prompt: string,
    size = '1024*1024',
    timeoutMs = 90_000,
  ): Promise<string> {
    // 1. 提交任务
    const submitResp = await fetch(DASHSCOPE_IMAGE_SUBMIT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'qwen-image-2.0-pro',
        input: { prompt },
        parameters: { size, n: 1 },
      }),
    });

    if (!submitResp.ok) {
      const body = await submitResp.text().catch(() => '');
      throw new Error(`图片生成提交失败 (${submitResp.status}): ${body}`);
    }

    const submitJson = await submitResp.json() as {
      output: { task_id: string; task_status: string };
    };
    const taskId = submitJson.output?.task_id;
    if (!taskId) throw new Error('图片生成：未返回 task_id');

    // 2. 轮询结果
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 3000));

      const pollResp = await fetch(`${DASHSCOPE_TASK_URL}/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!pollResp.ok) continue;

      const pollJson = await pollResp.json() as {
        output: {
          task_status: string;
          results?: Array<{ url?: string }>;
          message?: string;
        };
      };

      const status = pollJson.output?.task_status;
      if (status === 'SUCCEEDED') {
        const url = pollJson.output?.results?.[0]?.url;
        if (!url) throw new Error('图片生成成功但未返回 URL');
        return url;
      }
      if (status === 'FAILED') {
        throw new Error(`图片生成失败: ${pollJson.output?.message ?? 'unknown'}`);
      }
      // PENDING / RUNNING → 继续等
    }

    throw new Error(`图片生成超时（>${timeoutMs / 1000}秒）`);
  }

  /**
   * 流式聊天
   */
  async streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
      response = await fetch(DASHSCOPE_ENDPOINT, {
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
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error && err.name === 'AbortError'
        ? '模型调用超时（60秒）'
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
            if (token) {
              callbacks.onToken(token);
            }
          } catch {
            // 跳过格式错误的 JSON
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? '模型响应超时（60秒）'
        : `读取响应流失败: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onError(msg);
      return;
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    callbacks.onDone();
  }
}
