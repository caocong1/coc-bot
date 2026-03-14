/**
 * 测试图片描述生成
 *
 * 用法:
 *   bun run scripts/test-image-caption.ts --file="path/to/module.docx"
 *   bun run scripts/test-image-caption.ts --file="path/to/module.pdf"
 *   bun run scripts/test-image-caption.ts --file="path/to/module.txt"
 *
 * 功能:
 *   - docx: 提取嵌入图片 → AI 视觉识别 + 剧本文本 → 生成 caption
 *   - 所有格式: 分析剧本全文 → 输出 AI 建议补充的场景图
 *
 * 需要环境变量 DASHSCOPE_API_KEY
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import { PdfTextExtractor } from '../src/knowledge/pdf/PdfTextExtractor';

const DASHSCOPE_CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// ─── CLI 参数 ────────────────────────────────────────────────────────────────

const fileArg = process.argv.find(a => a.startsWith('--file='));
if (!fileArg) {
  console.error('用法: bun run scripts/test-image-caption.ts --file=path/to/file');
  process.exit(1);
}
const filePath = fileArg.slice('--file='.length);

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error('缺少环境变量 DASHSCOPE_API_KEY');
  process.exit(1);
}

// ─── AI 调用 ─────────────────────────────────────────────────────────────────

async function dashscopeChat(
  model: string,
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>,
): Promise<string> {
  const res = await fetch(DASHSCOPE_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    console.error(`AI chat failed (${model}, ${res.status}): ${await res.text().catch(() => '')}`);
    return '';
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

// ─── Docx 提取 ──────────────────────────────────────────────────────────────

interface ExtractedImage {
  buffer: Buffer;
  mimeType: string;
  index: number;
}

async function extractDocx(path: string): Promise<{ text: string; html: string; images: ExtractedImage[] }> {
  const mammoth = require('mammoth') as {
    convertToHtml: (input: { path: string }, opts: Record<string, unknown>) => Promise<{ value: string }>;
    extractRawText: (input: { path: string }) => Promise<{ value: string }>;
    images: { imgElement: (fn: (img: { read: () => Promise<Buffer>; contentType: string }) => Promise<Record<string, string>>) => unknown };
  };

  const images: ExtractedImage[] = [];
  let idx = 0;

  const htmlResult = await mammoth.convertToHtml({ path }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const buffer = await image.read();
      images.push({ buffer, mimeType: image.contentType, index: idx++ });
      return { src: `__img_placeholder_${idx - 1}__` };
    }),
  });

  const textResult = await mammoth.extractRawText({ path });
  return { text: textResult.value, html: htmlResult.value, images };
}

function extractImageContexts(html: string, imageCount: number): Map<number, string> {
  const contexts = new Map<number, string>();
  const plain = html
    .replace(/<img[^>]*src="(__img_placeholder_\d+__)"[^>]*\/?>/g, '\n$1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  for (let i = 0; i < imageCount; i++) {
    const marker = `__img_placeholder_${i}__`;
    const pos = plain.indexOf(marker);
    if (pos === -1) continue;
    const before = plain.slice(Math.max(0, pos - 500), pos).trim();
    const after = plain.slice(pos + marker.length, pos + marker.length + 500).trim();
    contexts.set(i, `${before}\n[图片位置]\n${after}`);
  }
  return contexts;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const ext = extname(filePath).toLowerCase();
  let text = '';
  let images: ExtractedImage[] = [];
  let html = '';

  console.log(`\n📂 文件: ${filePath}`);
  console.log(`📋 类型: ${ext}\n`);

  if (ext === '.docx') {
    const result = await extractDocx(filePath);
    text = result.text;
    html = result.html;
    images = result.images;
    console.log(`📝 文本长度: ${text.length} 字符`);
    console.log(`🖼️  提取图片: ${images.length} 张\n`);
  } else if (ext === '.pdf') {
    const extractor = new PdfTextExtractor();
    const result = await extractor.extract(filePath);
    text = result.text;
    console.log(`📝 文本长度: ${text.length} 字符, ${result.pages} 页\n`);
  } else {
    text = readFileSync(filePath, 'utf-8');
    console.log(`📝 文本长度: ${text.length} 字符\n`);
  }

  const captions: string[] = [];

  // ── Step 1: Docx 图片 caption 生成 ──────────────────────────────────────
  if (images.length > 0) {
    console.log('=== 图片描述生成 ===\n');
    const contexts = extractImageContexts(html, images.length);

    for (const img of images) {
      console.log(`--- 图片 #${img.index} (${img.mimeType}) ---`);

      const ctx = contexts.get(img.index) ?? '';
      if (ctx) {
        const ctxPreview = ctx.length > 200 ? ctx.slice(0, 200) + '...' : ctx;
        console.log(`周围文本: ${ctxPreview}`);
      }

      // AI 视觉识别
      const base64 = img.buffer.toString('base64');
      const dataUrl = `data:${img.mimeType};base64,${base64}`;
      const visionDesc = await dashscopeChat('qwen-vl-max', [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: '简短描述这张图片的内容（20字以内），只输出描述。' },
        ],
      }]);
      console.log(`视觉识别: ${visionDesc}`);

      // 结合剧本文本生成 caption
      if (ctx && visionDesc) {
        const caption = await dashscopeChat('qwen3.5-flash', [{
          role: 'user',
          content: `你是 TRPG 模组图片标注助手。根据图片的视觉内容和周围的剧本文本，生成一句简短的中文图片标注（20字以内）。

图片内容：${visionDesc}

图片周围的剧本文本：
${ctx}

请输出标注（只输出标注文字，不要解释）：`,
        }]);
        console.log(`生成标注: ${caption}`);
        captions.push(caption || visionDesc);
      } else {
        captions.push(visionDesc);
      }

      console.log('');
    }
  }

  // ── Step 2: AI 分析剧本，建议补充配图 ──────────────────────────────────
  console.log('=== AI 场景图建议 ===\n');

  const textSnippet = text.slice(0, 8000);
  const captionList = captions.length > 0
    ? captions.map(c => `- ${c}`).join('\n')
    : '（暂无配图）';

  const result = await dashscopeChat('qwen3.5-plus', [{
    role: 'user',
    content: `你是 TRPG 模组图片分析助手。以下是一个克苏鲁跑团模组的文本内容，以及已有的配图列表。

已有配图：
${captionList}

模组文本（节选）：
${textSnippet}

请分析模组文本，找出 2-5 个适合配图但目前没有的重要场景（如：关键地点、重要NPC、氛围场景）。

以 JSON 数组格式输出，每项包含：
- description: 场景的中文描述（用于 AI 生图，30-50字，描述画面内容、氛围、风格）
- label: 图片标注（20字以内，用于展示给玩家）

只输出 JSON 数组，不要解释。如果已有配图已覆盖所有重要场景，输出空数组 []。`,
  }]);

  if (result) {
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]) as Array<{ description: string; label: string }>;
        if (suggestions.length === 0) {
          console.log('AI 认为已有配图已覆盖所有重要场景。');
        } else {
          console.log(`AI 建议生成 ${suggestions.length} 张场景图：\n`);
          for (const s of suggestions) {
            console.log(`  🎨 ${s.label}`);
            console.log(`     ${s.description}\n`);
          }
        }
      }
    } catch (e) {
      console.log(`AI 返回内容解析失败: ${result}`);
    }
  } else {
    console.log('AI 分析未返回结果。');
  }

  console.log('\n✅ 测试完成');
}

await main();
