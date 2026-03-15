/**
 * 知识文件导入脚本
 *
 * 支持格式：PDF、.txt、.md
 * 从指定目录扫描所有支持的文件，提取文本并切片，写入 manifest.json
 *
 * Usage:
 *   bun run import-pdfs                        # 扫描项目根目录
 *   bun run import-pdfs --source=./scenarios   # 指定目录
 *   bun run import-pdfs --source=. --max=3     # 最多处理 3 个文件
 */

import { createHash } from 'crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { ChunkPipeline } from '../src/knowledge/chunking/ChunkPipeline';
import { PdfTextExtractor } from '../src/knowledge/pdf/PdfTextExtractor';
import { ImageLibrary, type ImageSource } from '../src/knowledge/images/ImageLibrary';
import { DashScopeClient } from '../src/ai/client/DashScopeClient';

/** 支持的文件扩展名 */
const SUPPORTED_EXTS = new Set(['.pdf', '.txt', '.md', '.docx']);

export type KnowledgeCategory = 'rules' | 'scenario' | 'keeper_secret';

interface ImportedFileEntry {
  id: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  fileType: 'pdf' | 'text' | 'docx';
  pages: number;
  textChars: number;
  textPath: string;
  chunkCount: number;
  chunkPath: string;
  category: KnowledgeCategory;
  /** 是否包含混合内容（docx 中有 === KP ONLY === 标记） */
  hasKeeperContent?: boolean;
  /** 从文档提取的图片 ID 列表（存入 ImageLibrary） */
  imageIds?: string[];
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
  importedAt: string;
}

interface KnowledgeManifest {
  generatedAt: string;
  sourceRoot: string;
  files: ImportedFileEntry[];
}

interface CliOptions {
  sourceDir: string;
  outputDir: string;
  chunkOutputDir: string;
  maxFiles?: number;
  /** 单文件模式：只处理这一个文件并合并到 manifest */
  singleFile?: string;
  /** 可选：将导入产物（尤其图片）关联到外部 source file id */
  sourceFileId?: string;
  category: KnowledgeCategory;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sourceDir: '.',
    outputDir: 'data/knowledge/raw',
    chunkOutputDir: 'data/knowledge/chunks',
    category: 'rules',
  };

  for (const arg of argv) {
    if (arg.startsWith('--source=')) {
      options.sourceDir = arg.slice('--source='.length);
    } else if (arg.startsWith('--file=')) {
      options.singleFile = arg.slice('--file='.length);
    } else if (arg.startsWith('--source-file-id=')) {
      options.sourceFileId = arg.slice('--source-file-id='.length);
    } else if (arg.startsWith('--out=')) {
      options.outputDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--max=')) {
      const parsed = parseInt(arg.slice('--max='.length), 10);
      if (!isNaN(parsed) && parsed > 0) options.maxFiles = parsed;
    } else if (arg.startsWith('--chunks=')) {
      options.chunkOutputDir = arg.slice('--chunks='.length);
    } else if (arg.startsWith('--category=')) {
      const cat = arg.slice('--category='.length);
      if (cat === 'rules' || cat === 'scenario' || cat === 'keeper_secret') {
        options.category = cat;
      }
    }
  }

  return options;
}

function collectFiles(rootDir: string): string[] {
  const skipped = new Set(['node_modules', '.git', 'data', 'tmp', 'temp']);
  const result: string[] = [];

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipped.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTS.has(extname(entry.name).toLowerCase())) {
        result.push(fullPath);
      }
    }
  };

  walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

function toSlug(name: string): string {
  const withoutExt = basename(name, extname(name));
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'file';
}

function makeEntryId(relPath: string, size: number): string {
  const hash = createHash('sha1').update(`${relPath}:${size}`).digest('hex').slice(0, 12);
  return `${toSlug(relPath)}-${hash}`;
}

// ─── KP ONLY 标记正则 ──────────────────────────────────────────────────────────

const KP_ONLY_START_RE = /={3,}\s*KP\s+ONLY\s+START\s*={3,}/i;
const KP_ONLY_END_RE = /={3,}\s*KP\s+ONLY\s+END\s*={3,}/i;

/**
 * 解析含 "=== KP ONLY START ===" 标记的文本，
 * 返回 scenario 段落和 keeper_secret 段落各自的纯文本。
 */
function splitKpOnlyText(fullText: string): { scenarioText: string; keeperText: string; hasSplit: boolean } {
  const lines = fullText.split('\n');
  const scenarioLines: string[] = [];
  const keeperLines: string[] = [];
  let inKeeper = false;
  let hasSplit = false;

  for (const line of lines) {
    if (KP_ONLY_START_RE.test(line)) { inKeeper = true; hasSplit = true; continue; }
    if (KP_ONLY_END_RE.test(line)) { inKeeper = false; continue; }
    if (inKeeper) keeperLines.push(line);
    else scenarioLines.push(line);
  }

  return {
    scenarioText: scenarioLines.join('\n').trim(),
    keeperText: keeperLines.join('\n').trim(),
    hasSplit,
  };
}

// ─── Docx 提取 ────────────────────────────────────────────────────────────────

interface DocxExtractResult {
  text: string;
  html: string;
  images: Array<{ buffer: Buffer; mimeType: string; index: number }>;
}

async function extractDocx(filePath: string): Promise<DocxExtractResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    convertToHtml: (input: { path: string }, opts: Record<string, unknown>) => Promise<{ value: string }>;
    extractRawText: (input: { path: string }) => Promise<{ value: string }>;
    images: { imgElement: (fn: (img: { read: (enc?: string) => Promise<Buffer>; contentType: string }) => Promise<Record<string, string>>) => unknown };
  };

  const extractedImages: Array<{ buffer: Buffer; mimeType: string; index: number }> = [];
  let imgIndex = 0;

  // 提取图片（通过 HTML 转换的 convertImage 钩子），同时保留 HTML 输出用于图文映射
  const htmlResult = await mammoth.convertToHtml({ path: filePath }, {
    convertImage: mammoth.images.imgElement(async (image: { read: (enc?: string) => Promise<Buffer>; contentType: string }) => {
      const buffer = await image.read();
      extractedImages.push({ buffer, mimeType: image.contentType, index: imgIndex++ });
      return { src: `__img_placeholder_${imgIndex - 1}__` };
    }),
  });

  // 提取纯文本（更干净，不含 HTML 标签）
  const textResult = await mammoth.extractRawText({ path: filePath });

  return { text: textResult.value, html: htmlResult.value, images: extractedImages };
}

/** 纯文本文件直接读取，添加伪页标记（每 3000 字符一页）以兼容 ChunkPipeline */
function extractTextFile(filePath: string): { text: string; pages: number } {
  const raw = readFileSync(filePath, 'utf-8');
  const normalized = raw.replace(/\r\n/g, '\n').trim();

  // 为长文本按字符数插入 Page 标记，方便后续知道大致位置
  const PAGE_SIZE = 3000;
  if (normalized.length <= PAGE_SIZE) {
    return { text: `--- Page 1 ---\n${normalized}`, pages: 1 };
  }

  const parts: string[] = [];
  let pageNum = 1;
  for (let i = 0; i < normalized.length; i += PAGE_SIZE) {
    parts.push(`--- Page ${pageNum} ---\n${normalized.slice(i, i + PAGE_SIZE)}`);
    pageNum += 1;
  }

  return { text: parts.join('\n\n'), pages: pageNum - 1 };
}

// ─── 图文映射 & AI 图片描述 ─────────────────────────────────────────────────

const DASHSCOPE_CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 从 mammoth HTML 提取每张图片周围的文本上下文
 */
function extractImageContexts(html: string, imageCount: number): Map<number, string> {
  const contexts = new Map<number, string>();
  // 保留 img placeholder 作为锚点，去掉其他 HTML 标签
  const plainWithPlaceholders = html
    .replace(/<img[^>]*src="(__img_placeholder_\d+__)"[^>]*\/?>/g, '\n$1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  for (let i = 0; i < imageCount; i++) {
    const marker = `__img_placeholder_${i}__`;
    const pos = plainWithPlaceholders.indexOf(marker);
    if (pos === -1) continue;
    const before = plainWithPlaceholders.slice(Math.max(0, pos - 500), pos).trim();
    const after = plainWithPlaceholders.slice(pos + marker.length, pos + marker.length + 500).trim();
    contexts.set(i, `${before}\n[图片位置]\n${after}`);
  }
  return contexts;
}

/**
 * 调用 DashScope chat API（轻量，不依赖 DashScopeClient 类）
 */
async function dashscopeChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>,
): Promise<string> {
  const res = await fetch(DASHSCOPE_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[import] AI chat failed (${model}, ${res.status}): ${body}`);
    return '';
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * 为 docx 嵌入图片生成描述：AI 视觉识别 + 剧本文本上下文
 */
async function generateImageCaption(
  apiKey: string,
  imageBuffer: Buffer,
  mimeType: string,
  surroundingText: string,
): Promise<string> {
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // Step 1: AI 视觉识别图片内容（辅助定位）
  const visionDesc = await dashscopeChat(apiKey, 'qwen-vl-max', [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: '简短描述这张图片的内容（20字以内），只输出描述。' },
    ],
  }]);

  if (!visionDesc) return '';

  // Step 2: 结合剧本文本生成 caption
  const caption = await dashscopeChat(apiKey, 'qwen3.5-flash', [{
    role: 'user',
    content: `你是 TRPG 模组图片标注助手。根据图片的视觉内容和周围的剧本文本，生成一句简短的中文图片标注（20字以内）。

图片内容：${visionDesc}

图片周围的剧本文本：
${surroundingText}

请输出标注（只输出标注文字，不要解释）：`,
  }]);

  return caption || visionDesc;
}

interface ImageSuggestion {
  description: string;
  label: string;
}

/**
 * AI 分析剧本文本，找出适合配图但没有配图的场景，生成图片
 */
async function analyzeAndGenerateSceneImages(
  apiKey: string,
  text: string,
  existingCaptions: string[],
  imageBucketId: string,
  sourceFileId: string,
  imageLibrary: ImageLibrary,
): Promise<string[]> {
  const generatedIds: string[] = [];
  const textSnippet = text.slice(0, 8000);

  const captionList = existingCaptions.length > 0
    ? existingCaptions.map((c, i) => `- ${c}`).join('\n')
    : '（暂无配图）';

  const analysisPrompt = `你是 TRPG 模组图片分析助手。以下是一个克苏鲁跑团模组的文本内容，以及已有的配图列表。

已有配图：
${captionList}

模组文本（节选）：
${textSnippet}

请分析模组文本，找出 2-5 个适合配图但目前没有的重要场景（如：关键地点、重要NPC、氛围场景）。

以 JSON 数组格式输出，每项包含：
- description: 场景的中文描述（用于 AI 生图，30-50字，描述画面内容、氛围、风格）
- label: 图片标注（20字以内，用于展示给玩家）

只输出 JSON 数组，不要解释。如果已有配图已覆盖所有重要场景，输出空数组 []。`;

  const result = await dashscopeChat(apiKey, 'qwen3.5-plus', [
    { role: 'user', content: analysisPrompt },
  ]);

  if (!result) return generatedIds;

  // 解析 JSON
  let suggestions: ImageSuggestion[] = [];
  try {
    // 提取 JSON（可能被 markdown code block 包裹）
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      suggestions = JSON.parse(jsonMatch[0]) as ImageSuggestion[];
    }
  } catch (e) {
    console.error(`[import] 解析 AI 图片建议失败: ${e}`);
    return generatedIds;
  }

  if (suggestions.length === 0) {
    console.log('[import] AI 认为无需补充配图');
    return generatedIds;
  }

  console.log(`[import] AI 建议生成 ${suggestions.length} 张场景图`);

  const client = new DashScopeClient(apiKey);
  const imgDir = resolve(`data/knowledge/images/${imageBucketId}`);
  mkdirSync(imgDir, { recursive: true });

  for (const suggestion of suggestions) {
    try {
      console.log(`[import] 生成图片: ${suggestion.label} — ${suggestion.description}`);

      // 优化提示词 → 生成图片
      const optimizedPrompt = await client.optimizeImagePrompt(suggestion.description);
      const imageUrl = await client.generateImage(optimizedPrompt);

      // 下载图片
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.error(`[import] 下载生成图片失败: ${imgRes.status}`);
        continue;
      }
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      // 保存到文件系统
      const imgId = ImageLibrary.generateId();
      const imgFilename = `${imgId}.jpg`;
      const imgAbsPath = join(imgDir, imgFilename);
      const imgRelPath = `data/knowledge/images/${imageBucketId}/${imgFilename}`;
      writeFileSync(imgAbsPath, imgBuffer);

      // 写入 ImageLibrary
      imageLibrary.upsert({
        id: imgId,
        source: 'generated' as ImageSource,
        relativePath: imgRelPath,
        mimeType: 'image/jpeg',
        caption: suggestion.label,
        playerVisible: true,
        sourceFileId,
        generatedPrompt: suggestion.description,
        optimizedPrompt,
        createdAt: new Date().toISOString(),
      });

      generatedIds.push(imgId);
      console.log(`[import] 图片生成完成: ${imgId} — ${suggestion.label}`);
    } catch (e) {
      console.error(`[import] 生成图片失败 (${suggestion.label}): ${e}`);
    }
  }

  return generatedIds;
}

async function processFile(
  filePath: string,
  relPath: string,
  category: KnowledgeCategory,
  outputDir: string,
  chunkOutputDir: string,
  pdfExtractor: PdfTextExtractor,
  chunkPipeline: ChunkPipeline,
  imageLibrary: ImageLibrary,
  sourceFileIdOverride?: string,
): Promise<ImportedFileEntry> {
  const ext = extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  const id = makeEntryId(relPath, stat.size);
  const fileType: 'pdf' | 'text' | 'docx' = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'text';
  const imageSourceFileId = sourceFileIdOverride ?? id;
  const imageBucketId = imageSourceFileId;

  console.log(`[import] extracting (${fileType}): ${relPath}`);

  let extractedText: string;
  let pages: number;
  let metadata: ImportedFileEntry['metadata'] = {};
  let hasKeeperContent = false;
  const imageIds: string[] = [];

  if (fileType === 'pdf') {
    const result = await pdfExtractor.extract(filePath);
    extractedText = result.text;
    pages = result.pages;
    metadata = result.metadata;
  } else if (fileType === 'docx') {
    const result = await extractDocx(filePath);
    extractedText = result.text;
    pages = Math.ceil(extractedText.length / 3000);

    // 保存提取的图片到图片库
    const imgDir = resolve(`data/knowledge/images/${imageBucketId}`);
    mkdirSync(imgDir, { recursive: true });

    // 建立图文映射（用于 AI 生成 caption）
    const imageContexts = extractImageContexts(result.html, result.images.length);
    const apiKey = process.env.DASHSCOPE_API_KEY;

    for (const img of result.images) {
      const imgExt = img.mimeType.includes('png') ? '.png' : '.jpg';
      const imgId = ImageLibrary.generateId();
      const imgFilename = `${imgId}${imgExt}`;
      const imgAbsPath = join(imgDir, imgFilename);
      const imgRelPath = `data/knowledge/images/${imageBucketId}/${imgFilename}`;

      writeFileSync(imgAbsPath, img.buffer);

      // AI 生成图片描述（基于剧本文本 + 视觉识别辅助）
      let caption = '';
      if (apiKey) {
        const ctx = imageContexts.get(img.index) ?? '';
        caption = await generateImageCaption(apiKey, img.buffer, img.mimeType, ctx);
        if (caption) console.log(`[import] image ${imgId} caption: ${caption}`);
      }

      imageLibrary.upsert({
        id: imgId,
        source: 'docx' as ImageSource,
        relativePath: imgRelPath,
        mimeType: img.mimeType,
        caption,
        playerVisible: !!caption,
        sourceFileId: imageSourceFileId,
        createdAt: new Date().toISOString(),
      });
      imageIds.push(imgId);
    }

    if (result.images.length > 0) {
      console.log(`[import] extracted ${result.images.length} images from ${relPath}`);
    }
  } else {
    const result = extractTextFile(filePath);
    extractedText = result.text;
    pages = result.pages;
  }

  // 检测并处理 KP ONLY 标记（docx 和 txt/md 都支持）
  const { scenarioText, keeperText, hasSplit } = splitKpOnlyText(extractedText);
  if (hasSplit) {
    hasKeeperContent = true;
    console.log(`[import] KP ONLY split: scenario=${scenarioText.length} keeper=${keeperText.length} chars`);

    // 守密人部分单独写 chunks（category 强制为 keeper_secret）
    if (keeperText.length > 0) {
      const keeperChunks = await chunkPipeline.chunk(keeperText, `${relPath}[keeper]`, {
        maxChunkSize: 1200, overlapSize: 200, preserveStructure: true,
      });
      const kpChunkPath = join(chunkOutputDir, `${id}.keeper.chunks.json`);
      writeFileSync(kpChunkPath, JSON.stringify(keeperChunks, null, 2) + '\n', 'utf-8');
    }

    // 公开部分覆盖 extractedText，用于后续主 chunk
    extractedText = scenarioText;
  }

  const textFileName = `${id}.txt`;
  const textFullPath = join(outputDir, textFileName);
  writeFileSync(textFullPath, extractedText, 'utf-8');

  const chunks = await chunkPipeline.chunk(extractedText, relPath, {
    maxChunkSize: 1200,
    overlapSize: 200,
    preserveStructure: true,
  });
  const chunkFileName = `${id}.chunks.json`;
  const chunkFullPath = join(chunkOutputDir, chunkFileName);
  writeFileSync(chunkFullPath, JSON.stringify(chunks, null, 2) + '\n', 'utf-8');

  // AI 分析剧本文本，为缺少配图的场景自动生成图片（所有格式通用）
  const aiApiKey = process.env.DASHSCOPE_API_KEY;
  if (aiApiKey && (category === 'scenario' || hasSplit)) {
    const existingCaptions = imageIds
      .map(imgId => imageLibrary.getById(imgId))
      .filter((img): img is NonNullable<typeof img> => !!img && !!img.caption)
      .map(img => img.caption);

    try {
      const generatedIds = await analyzeAndGenerateSceneImages(
        aiApiKey, extractedText, existingCaptions, imageBucketId, imageSourceFileId, imageLibrary,
      );
      imageIds.push(...generatedIds);
      if (generatedIds.length > 0) {
        console.log(`[import] AI generated ${generatedIds.length} scene images for ${relPath}`);
      }
    } catch (e) {
      console.error(`[import] AI scene image generation failed: ${e}`);
    }
  }

  console.log(`[import] done: ${relPath} pages=${pages} chars=${extractedText.length} chunks=${chunks.length}`);

  return {
    id,
    sourcePath: filePath,
    sourceRelativePath: relPath,
    sourceSizeBytes: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    fileType,
    pages,
    textChars: extractedText.length,
    textPath: relative(resolve('.'), textFullPath).replace(/\\/g, '/'),
    chunkCount: chunks.length,
    chunkPath: relative(resolve('.'), chunkFullPath).replace(/\\/g, '/'),
    category: hasSplit ? 'scenario' : category,
    hasKeeperContent: hasSplit || undefined,
    imageIds: imageIds.length > 0 ? imageIds : undefined,
    metadata,
    importedAt: new Date().toISOString(),
  };
}

function loadManifest(manifestPath: string): KnowledgeManifest {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as KnowledgeManifest;
  } catch {
    return { generatedAt: new Date().toISOString(), sourceRoot: '', files: [] };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolve(options.outputDir);
  const chunkOutputDir = resolve(options.chunkOutputDir);
  const manifestPath = resolve('data/knowledge/manifest.json');

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(chunkOutputDir, { recursive: true });
  mkdirSync(resolve('data/knowledge'), { recursive: true });

  const pdfExtractor = new PdfTextExtractor();
  const chunkPipeline = new ChunkPipeline();
  const imageLibrary = new ImageLibrary();

  // ── 单文件合并模式（Web 上传触发）──────────────────────────────────────────
  if (options.singleFile) {
    const filePath = resolve(options.singleFile);
    // Use parentDir/basename as relPath so same-named files in different modules don't collide
    const parentDir = basename(resolve(filePath, '..'));
    const relPath = parentDir === '.' || parentDir === 'uploads'
      ? basename(filePath)
      : `${parentDir}/${basename(filePath)}`;
    let entry: ImportedFileEntry;
    let exitCode = 0;
    try {
      entry = await processFile(
        filePath,
        relPath,
        options.category,
        outputDir,
        chunkOutputDir,
        pdfExtractor,
        chunkPipeline,
        imageLibrary,
        options.sourceFileId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[import] failed: ${relPath} -> ${message}`);
      process.exitCode = 1;
      return;
    }

    // 合并到现有 manifest（不覆盖其他已有条目）
    const existing = loadManifest(manifestPath);
    const absPath = resolve(filePath);
    const others = existing.files.filter((f) => f.sourceRelativePath !== relPath && resolve(f.sourcePath) !== absPath);
    existing.files = [...others, entry];
    existing.generatedAt = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    console.log(`[import] manifest updated: ${manifestPath} total=${existing.files.length}`);
    process.exitCode = exitCode;
    return;
  }

  // ── 批量模式（扫描目录）────────────────────────────────────────────────────
  const sourceRoot = resolve(options.sourceDir);
  const allFiles = collectFiles(sourceRoot);
  const targetFiles = options.maxFiles ? allFiles.slice(0, options.maxFiles) : allFiles;

  console.log(`[import] source=${sourceRoot}`);
  console.log(`[import] output=${outputDir}`);
  console.log(`[import] chunkOutput=${chunkOutputDir}`);
  console.log(`[import] discovered=${allFiles.length} selected=${targetFiles.length}`);

  const imported: ImportedFileEntry[] = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (const filePath of targetFiles) {
    const relPath = relative(sourceRoot, filePath);
    try {
      const entry = await processFile(
        filePath,
        relPath,
        options.category,
        outputDir,
        chunkOutputDir,
        pdfExtractor,
        chunkPipeline,
        imageLibrary,
      );
      imported.push(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ file: relPath, error: message });
      console.error(`[import] failed: ${relPath} -> ${message}`);
    }
  }

  // 批量模式：保留现有 manifest 中的其他条目，更新本批次文件
  const existing = loadManifest(manifestPath);
  const importedPaths = new Set(imported.map((e) => e.sourceRelativePath));
  const keptOthers = existing.files.filter((f) => !importedPaths.has(f.sourceRelativePath));
  existing.files = [...keptOthers, ...imported];
  existing.generatedAt = new Date().toISOString();
  existing.sourceRoot = sourceRoot;

  writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

  console.log(`[import] manifest written: ${manifestPath}`);
  console.log(`[import] imported=${imported.length} failed=${failed.length} total=${existing.files.length}`);
  if (failed.length > 0) {
    for (const item of failed) {
      console.log(`  - ${item.file}: ${item.error}`);
    }
    process.exitCode = 1;
  }
}

await main();
