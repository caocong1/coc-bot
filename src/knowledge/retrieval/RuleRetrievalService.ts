import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  KnowledgeIndexer,
  type IndexSearchResult,
  type SearchOptions,
} from '../indexing/KnowledgeIndexer';

export interface RetrievalOptions {
  limit?: number;
  minScore?: number;
}

export interface RetrievalPromptOptions extends RetrievalOptions {
  maxCharsPerChunk?: number;
}

export interface RetrievedRuleChunk {
  id: string;
  chunkId: string;
  source: string;
  pageNumber?: number;
  sectionTitle?: string;
  score: number;
  content: string;
}

interface RuleRetrievalServiceOptions {
  indexPath?: string;
  dimension?: number;
}

export class RuleRetrievalService {
  private readonly indexPath: string;
  private readonly indexer: KnowledgeIndexer;
  private loaded = false;

  constructor(options: RuleRetrievalServiceOptions = {}) {
    this.indexPath = resolve(options.indexPath ?? 'data/knowledge/indexes/rules.index.json');
    this.indexer = new KnowledgeIndexer({ dimension: options.dimension ?? 384 });
  }

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievedRuleChunk[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    this.ensureIndexLoaded();

    const searchOptions: SearchOptions = {
      minScore: options.minScore ?? 0.12,
      vectorWeight: 0.85,
      keywordWeight: 0.15,
    };

    const hits = await this.indexer.search('rules', normalized, options.limit ?? 5, searchOptions);
    return hits.map((hit) => this.toRetrievedChunk(hit));
  }

  async buildPromptContext(query: string, options: RetrievalPromptOptions = {}): Promise<string> {
    const hits = await this.retrieve(query, options);
    return this.formatPromptContext(hits, options.maxCharsPerChunk ?? 320);
  }

  formatPromptContext(hits: RetrievedRuleChunk[], maxCharsPerChunk: number = 320): string {
    if (hits.length === 0) {
      return 'No relevant rule snippets were found in local knowledge indexes.';
    }

    const limitedSize = Math.max(64, maxCharsPerChunk);
    const lines: string[] = ['Retrieved rule snippets (local index):'];

    for (let i = 0; i < hits.length; i++) {
      const item = hits[i];
      const pageText = item.pageNumber ? ` p.${item.pageNumber}` : '';
      const sectionText = item.sectionTitle ? ` / ${item.sectionTitle}` : '';
      const snippet = this.compact(item.content, limitedSize);
      lines.push(`[${i + 1}] ${item.source}${pageText}${sectionText}`);
      lines.push(snippet);
    }

    return lines.join('\n');
  }

  private ensureIndexLoaded(): void {
    if (this.loaded) return;
    if (!existsSync(this.indexPath)) {
      throw new Error(
        `rules index not found: ${this.indexPath}. Run \"bun run build-indexes\" first.`,
      );
    }

    this.indexer.loadFromFile('rules', this.indexPath);
    this.loaded = true;
  }

  private toRetrievedChunk(hit: IndexSearchResult): RetrievedRuleChunk {
    return {
      id: hit.id,
      chunkId: hit.chunkId,
      source: hit.source,
      pageNumber: hit.pageNumber,
      sectionTitle: hit.sectionTitle,
      score: hit.score,
      content: hit.content,
    };
  }

  private compact(text: string, maxChars: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars - 1)}…`;
  }
}

