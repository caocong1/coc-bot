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

/** 支持的文件扩展名 */
const SUPPORTED_EXTS = new Set(['.pdf', '.txt', '.md']);

export type KnowledgeCategory = 'rules' | 'scenario' | 'keeper_secret';

interface ImportedFileEntry {
  id: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  fileType: 'pdf' | 'text';
  pages: number;
  textChars: number;
  textPath: string;
  chunkCount: number;
  chunkPath: string;
  category: KnowledgeCategory;
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
): Promise<ImportedFileEntry> {
  const ext = extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  const id = makeEntryId(relPath, stat.size);
  const fileType: 'pdf' | 'text' = ext === '.pdf' ? 'pdf' : 'text';

  console.log(`[import] extracting (${fileType}): ${relPath}`);

  let extractedText: string;
  let pages: number;
  let metadata: ImportedFileEntry['metadata'] = {};

  if (fileType === 'pdf') {
    const result = await pdfExtractor.extract(filePath);
    extractedText = result.text;
    pages = result.pages;
    metadata = result.metadata;
  } else {
    const result = extractTextFile(filePath);
    extractedText = result.text;
    pages = result.pages;
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
    category,
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

  // ── 单文件合并模式（Web 上传触发）──────────────────────────────────────────
  if (options.singleFile) {
    const filePath = resolve(options.singleFile);
    const relPath = basename(filePath);
    let entry: ImportedFileEntry;
    let exitCode = 0;
    try {
      entry = await processFile(filePath, relPath, options.category, outputDir, chunkOutputDir, pdfExtractor, chunkPipeline);
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
      const entry = await processFile(filePath, relPath, options.category, outputDir, chunkOutputDir, pdfExtractor, chunkPipeline);
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
