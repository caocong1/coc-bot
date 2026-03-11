import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { TextChunk } from '../chunking/ChunkPipeline';

export type IndexType =
  | 'rules'
  | 'scenario'
  | 'campaign_memory'
  | 'character_npc'
  | 'keeper_secret'
  | 'player_safe';

export interface IndexItem {
  id: string;
  chunkId: string;
  source: string;
  content: string;
  pageNumber?: number;
  sectionTitle?: string;
  embedding: number[];
  tokenSet: string[];
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  minScore?: number;
  vectorWeight?: number;
  keywordWeight?: number;
}

export interface IndexSearchResult extends IndexItem {
  score: number;
  vectorScore: number;
  keywordScore: number;
}

interface PersistedIndexFileV1 {
  version: 1;
  generatedAt: string;
  type: IndexType;
  dimension: number;
  items: IndexItem[];
}

interface KnowledgeIndexerOptions {
  dimension?: number;
}

const DEFAULT_DIMENSION = 1024;

export class KnowledgeIndexer {
  private readonly indexes: Map<IndexType, IndexItem[]> = new Map();
  private dimension: number;

  constructor(options: KnowledgeIndexerOptions = {}) {
    this.dimension = options.dimension ?? DEFAULT_DIMENSION;
  }

  initializeIndex(type: IndexType): void {
    if (!this.indexes.has(type)) this.indexes.set(type, []);
  }

  getDimension(): number {
    return this.dimension;
  }

  getIndexSize(type: IndexType): number {
    return (this.indexes.get(type) ?? []).length;
  }

  getAll(type: IndexType): IndexItem[] {
    return [...(this.indexes.get(type) ?? [])];
  }

  async addChunk(type: IndexType, chunk: TextChunk, embedding?: number[]): Promise<void> {
    this.initializeIndex(type);
    const tokens = this.tokenize(chunk.content);
    const tokenSet = Array.from(new Set(tokens));
    const vector = embedding && embedding.length === this.dimension
      ? this.normalizeVector([...embedding])
      : this.embedTokens(tokens);

    const items = this.indexes.get(type)!;
    items.push({
      id: `${type}-${chunk.id}`,
      chunkId: chunk.id,
      source: chunk.source,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
      embedding: vector,
      tokenSet,
      metadata: {
        ...chunk.metadata,
        source: chunk.source,
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle,
      },
    });
  }

  async search(
    type: IndexType,
    query: string,
    limit: number = 10,
    options: SearchOptions = {},
  ): Promise<IndexSearchResult[]> {
    const items = this.indexes.get(type) ?? [];
    if (items.length === 0) return [];

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const queryTokens = this.tokenize(normalizedQuery);
    if (queryTokens.length === 0) return [];

    const queryVector = this.embedTokens(queryTokens);
    const querySet = new Set(queryTokens);
    const queryLower = normalizedQuery.toLowerCase();
    const minScore = options.minScore ?? 0;
    const vectorWeight = options.vectorWeight ?? 0.85;
    const keywordWeight = options.keywordWeight ?? 0.15;

    const scored = items
      .map((item) => {
        const vectorScore = this.dot(queryVector, item.embedding);
        const keywordScore = this.keywordScore(querySet, queryLower, item);
        const score = (vectorScore * vectorWeight) + (keywordScore * keywordWeight);
        return { ...item, score, vectorScore, keywordScore };
      })
      .filter((x) => x.score >= minScore)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id.localeCompare(b.id);
      });

    return scored.slice(0, Math.max(1, limit));
  }

  saveToFile(type: IndexType, filePath: string): void {
    const items = this.indexes.get(type) ?? [];
    const outputPath = resolve(filePath);
    mkdirSync(dirname(outputPath), { recursive: true });

    const payload: PersistedIndexFileV1 = {
      version: 1,
      generatedAt: new Date().toISOString(),
      type,
      dimension: this.dimension,
      items,
    };

    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  }

  loadFromFile(type: IndexType, filePath: string): boolean {
    const inputPath = resolve(filePath);
    if (!existsSync(inputPath)) return false;

    const raw = readFileSync(inputPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedIndexFileV1>;

    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      throw new Error(`Unsupported index format: ${inputPath}`);
    }

    if (typeof parsed.dimension === 'number' && parsed.dimension > 0) {
      this.dimension = parsed.dimension;
    }

    const items: IndexItem[] = [];
    for (const item of parsed.items) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.id !== 'string' || typeof item.chunkId !== 'string') continue;
      if (typeof item.source !== 'string' || typeof item.content !== 'string') continue;
      if (!Array.isArray(item.embedding) || item.embedding.length !== this.dimension) continue;

      const tokenSet = Array.isArray(item.tokenSet)
        ? item.tokenSet.filter((x): x is string => typeof x === 'string')
        : this.tokenize(item.content);

      items.push({
        id: item.id,
        chunkId: item.chunkId,
        source: item.source,
        content: item.content,
        pageNumber: typeof item.pageNumber === 'number' ? item.pageNumber : undefined,
        sectionTitle: typeof item.sectionTitle === 'string' ? item.sectionTitle : undefined,
        embedding: this.normalizeVector(item.embedding),
        tokenSet: Array.from(new Set(tokenSet)),
        metadata: (item.metadata && typeof item.metadata === 'object')
          ? item.metadata as Record<string, unknown>
          : {},
      });
    }

    this.indexes.set(type, items);
    return true;
  }

  clearIndex(type: IndexType): void {
    this.indexes.set(type, []);
  }

  private tokenize(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/\r\n/g, '\n')
      .trim();

    if (!normalized) return [];

    const base = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const tokens: string[] = [];

    for (const token of base) {
      if (token.length < 2) continue;

      if (/^[a-z0-9_]+$/i.test(token)) {
        tokens.push(token);
        continue;
      }

      if (token.length <= 4) {
        tokens.push(token);
        continue;
      }

      // For CJK/no-space text, add bigrams so queries can match partial phrases.
      for (let i = 0; i < token.length - 1; i++) {
        tokens.push(token.slice(i, i + 2));
      }
    }

    return tokens;
  }

  private embedTokens(tokens: string[]): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const freq = new Map<string, number>();
    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }

    for (const [token, count] of freq.entries()) {
      const hash = this.fnv1a(token);
      const idx = Math.abs(hash) % this.dimension;
      const sign = (hash & 1) === 0 ? 1 : -1;
      const weight = 1 + Math.log1p(count);
      vector[idx] += sign * weight;
    }

    return this.normalizeVector(vector);
  }

  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + (x * x), 0));
    if (norm <= Number.EPSILON) return vector.fill(0);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / norm;
    }
    return vector;
  }

  private dot(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private keywordScore(querySet: Set<string>, queryLower: string, item: IndexItem): number {
    if (querySet.size === 0) return 0;

    let hit = 0;
    for (const token of item.tokenSet) {
      if (querySet.has(token)) hit += 1;
    }
    const overlap = hit / querySet.size;
    const phrase = item.content.toLowerCase().includes(queryLower) ? 1 : 0;
    return Math.max(overlap, phrase);
  }

  private fnv1a(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash | 0;
  }
}
