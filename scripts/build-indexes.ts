/**
 * Build vector indexes from imported knowledge chunks.
 *
 * Usage:
 *   bun run build-indexes
 *   bun run build-indexes --embed                         # 使用 DashScope text-embedding-v4
 *   bun run build-indexes --manifest=data/knowledge/manifest.json --type=rules --embed
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { DashScopeClient } from '../src/ai/client/DashScopeClient';
import { KnowledgeIndexer, type IndexType } from '../src/knowledge/indexing/KnowledgeIndexer';
import type { TextChunk } from '../src/knowledge/chunking/ChunkPipeline';

interface ManifestFileEntry {
  id: string;
  sourceRelativePath: string;
  chunkPath: string;
}

interface KnowledgeManifest {
  generatedAt: string;
  sourceRoot: string;
  files: ManifestFileEntry[];
}

interface CliOptions {
  manifestPath: string;
  outputPath?: string;
  outputDir: string;
  type: IndexType;
  dimension: number;
  minChunkChars: number;
  embed: boolean;
  embedModel: string;
  embedBatchSize: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: 'data/knowledge/manifest.json',
    outputDir: 'data/knowledge/indexes',
    type: 'rules',
    dimension: 1024,
    minChunkChars: 16,
    embed: false,
    embedModel: 'text-embedding-v4',
    embedBatchSize: 25,
  };

  for (const arg of argv) {
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--out=')) {
      options.outputPath = arg.slice('--out='.length);
    } else if (arg.startsWith('--out-dir=')) {
      options.outputDir = arg.slice('--out-dir='.length);
    } else if (arg.startsWith('--type=')) {
      options.type = arg.slice('--type='.length) as IndexType;
    } else if (arg.startsWith('--dim=')) {
      const parsed = parseInt(arg.slice('--dim='.length), 10);
      if (!Number.isNaN(parsed) && parsed >= 32) options.dimension = parsed;
    } else if (arg.startsWith('--min-chars=')) {
      const parsed = parseInt(arg.slice('--min-chars='.length), 10);
      if (!Number.isNaN(parsed) && parsed >= 1) options.minChunkChars = parsed;
    } else if (arg === '--embed') {
      options.embed = true;
    } else if (arg.startsWith('--embed-model=')) {
      options.embedModel = arg.slice('--embed-model='.length);
      options.embed = true;
    } else if (arg.startsWith('--embed-batch=')) {
      const parsed = parseInt(arg.slice('--embed-batch='.length), 10);
      if (!Number.isNaN(parsed) && parsed >= 1) options.embedBatchSize = parsed;
    }
  }

  return options;
}

function resolveFromProjectOrManifest(value: string, manifestPath: string): string {
  if (isAbsolute(value)) return value;
  const fromProject = resolve(value);
  if (existsSync(fromProject)) return fromProject;
  return resolve(manifestPath, '..', value);
}

function readManifest(filePath: string): KnowledgeManifest {
  if (!existsSync(filePath)) {
    throw new Error(`manifest not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<KnowledgeManifest>;

  if (!Array.isArray(parsed.files)) {
    throw new Error(`invalid manifest format: ${filePath}`);
  }

  return {
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    sourceRoot: typeof parsed.sourceRoot === 'string' ? parsed.sourceRoot : '',
    files: parsed.files
      .filter((x): x is ManifestFileEntry => !!x && typeof x === 'object')
      .filter(
        (x) =>
          typeof x.id === 'string' &&
          typeof x.chunkPath === 'string' &&
          typeof x.sourceRelativePath === 'string',
      ),
  };
}

function readChunks(filePath: string): TextChunk[] {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((x): x is TextChunk => !!x && typeof x === 'object')
    .filter(
      (x) =>
        typeof x.id === 'string' &&
        typeof x.content === 'string' &&
        typeof x.source === 'string',
    );
}

async function embedChunks(
  client: DashScopeClient,
  chunks: TextChunk[],
  model: string,
  batchSize: number,
  dimensions: number,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const texts = chunks.map((c) => c.content);

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batchChunks = chunks.slice(offset, offset + batchSize);
    const batchTexts = texts.slice(offset, offset + batchSize);

    process.stdout.write(
      `  [embed] chunks ${offset + 1}–${Math.min(offset + batchSize, chunks.length)} / ${chunks.length}\r`,
    );

    const embeddings = await client.embed(batchTexts, { model, dimensions });
    for (let i = 0; i < batchChunks.length; i++) {
      result.set(batchChunks[i].id, embeddings[i]);
    }
  }

  if (chunks.length > 0) process.stdout.write('\n');
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(options.manifestPath);
  const outputPath = resolve(
    options.outputPath ?? `${options.outputDir}/${options.type}.index.json`,
  );
  const manifest = readManifest(manifestPath);

  // embedding 模式需要 API Key
  let embedClient: DashScopeClient | undefined;
  if (options.embed) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.error('[build-indexes] --embed 需要环境变量 DASHSCOPE_API_KEY');
      process.exit(1);
    }
    embedClient = new DashScopeClient(apiKey);
    console.log(`[build-indexes] embedding 模型=${options.embedModel} 维度=${options.dimension}`);
  } else {
    console.log('[build-indexes] 使用离线哈希向量（不推荐用于生产，建议加 --embed）');
  }

  const indexer = new KnowledgeIndexer({ dimension: options.dimension });

  console.log(`[build-indexes] manifest=${manifestPath}`);
  console.log(
    `[build-indexes] type=${options.type} dim=${options.dimension} minChars=${options.minChunkChars}`,
  );

  let chunkFileCount = 0;
  let chunkCount = 0;
  let skippedChunkCount = 0;

  for (const entry of manifest.files) {
    const chunkPath = resolveFromProjectOrManifest(entry.chunkPath, manifestPath);
    if (!existsSync(chunkPath)) {
      console.warn(`[build-indexes] missing chunk file: ${entry.chunkPath}`);
      continue;
    }

    const allChunks = readChunks(chunkPath);
    const chunks = allChunks.filter((c) => {
      if (c.content.trim().length < options.minChunkChars) {
        skippedChunkCount += 1;
        return false;
      }
      return true;
    });

    chunkFileCount += 1;
    console.log(`[build-indexes] indexing: ${entry.sourceRelativePath} (${chunks.length} chunks)`);

    // 真实 embedding
    let embeddingMap = new Map<string, number[]>();
    if (embedClient && chunks.length > 0) {
      embeddingMap = await embedChunks(
        embedClient,
        chunks,
        options.embedModel,
        options.embedBatchSize,
        options.dimension,
      );
    }

    for (const chunk of chunks) {
      const embedding = embeddingMap.get(chunk.id);
      await indexer.addChunk(options.type, chunk, embedding);
      chunkCount += 1;
    }
  }

  indexer.saveToFile(options.type, outputPath);

  console.log(`[build-indexes] chunkFiles=${chunkFileCount}`);
  console.log(`[build-indexes] indexedChunks=${chunkCount}`);
  console.log(`[build-indexes] skippedChunks=${skippedChunkCount}`);
  console.log(`[build-indexes] output=${outputPath}`);

  if (chunkCount === 0) {
    console.warn('[build-indexes] no chunks indexed. Did you run bun run import-pdfs first?');
    process.exitCode = 1;
  }
}

await main();
