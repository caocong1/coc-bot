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

  // 提取图片（通过 HTML 转换的 convertImage 钩子）
  await mammoth.convertToHtml({ path: filePath }, {
    convertImage: mammoth.images.imgElement(async (image: { read: (enc?: string) => Promise<Buffer>; contentType: string }) => {
      const buffer = await image.read();
      extractedImages.push({ buffer, mimeType: image.contentType, index: imgIndex++ });
      return { src: `__img_placeholder_${imgIndex - 1}__` };
    }),
  });

  // 提取纯文本（更干净，不含 HTML 标签）
  const textResult = await mammoth.extractRawText({ path: filePath });

  return { text: textResult.value, images: extractedImages };
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

async function processFile(
  filePath: string,
  relPath: string,
  category: KnowledgeCategory,
  outputDir: string,
  chunkOutputDir: string,
  pdfExtractor: PdfTextExtractor,
  chunkPipeline: ChunkPipeline,
  imageLibrary: ImageLibrary,
): Promise<ImportedFileEntry> {
  const ext = extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  const id = makeEntryId(relPath, stat.size);
  const fileType: 'pdf' | 'text' | 'docx' = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'text';

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
    const imgDir = resolve(`data/knowledge/images/${id}`);
    mkdirSync(imgDir, { recursive: true });

    for (const img of result.images) {
      const imgExt = img.mimeType.includes('png') ? '.png' : '.jpg';
      const imgId = ImageLibrary.generateId();
      const imgFilename = `${imgId}${imgExt}`;
      const imgAbsPath = join(imgDir, imgFilename);
      const imgRelPath = `data/knowledge/images/${id}/${imgFilename}`;

      writeFileSync(imgAbsPath, img.buffer);
      imageLibrary.upsert({
        id: imgId,
        source: 'docx' as ImageSource,
        relativePath: imgRelPath,
        mimeType: img.mimeType,
        caption: '',
        playerVisible: false,
        sourceFileId: id,
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
    const relPath = basename(filePath);
    let entry: ImportedFileEntry;
    let exitCode = 0;
    try {
      entry = await processFile(filePath, relPath, options.category, outputDir, chunkOutputDir, pdfExtractor, chunkPipeline, imageLibrary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[import] failed: ${relPath} -> ${message}`);
      process.exitCode = 1;
      return;
    }

    // 合并到现有 manifest（不覆盖其他已有条目）
    const existing = loadManifest(manifestPath);
    const others = existing.files.filter((f) => f.sourceRelativePath !== relPath);
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
      const entry = await processFile(filePath, relPath, options.category, outputDir, chunkOutputDir, pdfExtractor, chunkPipeline, imageLibrary);
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
