/**
 * 统一知识库服务
 *
 * AI KP Pipeline 的单一知识检索入口。
 * 管理 rules / scenario / keeper_secret 三类索引，支持按类型组合查询。
 *
 * 索引文件路径约定：
 *   data/knowledge/indexes/rules.index.json
 *   data/knowledge/indexes/scenario.index.json
 *   data/knowledge/indexes/keeper_secret.index.json
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { KnowledgeIndexer, type IndexType, type SearchOptions } from '../indexing/KnowledgeIndexer';

// ─── 公开类型 ────────────────────────────────────────────────────────────────

export type KnowledgeCategory = 'rules' | 'scenario' | 'keeper_secret';

export interface KnowledgeChunk {
  id: string;
  chunkId: string;
  source: string;
  pageNumber?: number;
  sectionTitle?: string;
  score: number;
  content: string;
  category: KnowledgeCategory;
}

export interface RetrieveOptions {
  /** 每类最多返回几条，默认 5 */
  limitPerCategory?: number;
  /** 最低分数阈值，默认 0.12 */
  minScore?: number;
}

export interface KnowledgeServiceOptions {
  indexDir?: string;
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class KnowledgeService {
  private readonly indexDir: string;
  private readonly indexer = new KnowledgeIndexer({ dimension: 1024 });
  private readonly loaded = new Set<KnowledgeCategory>();

  constructor(options: KnowledgeServiceOptions = {}) {
    this.indexDir = resolve(options.indexDir ?? 'data/knowledge/indexes');
  }

  /**
   * 检索多类知识，返回按分数降序的合并结果。
   *
   * @param query       检索查询文本
   * @param categories  要查询的类别列表
   * @param options     检索参数
   */
  async retrieve(
    query: string,
    categories: KnowledgeCategory[],
    options: RetrieveOptions = {},
  ): Promise<KnowledgeChunk[]> {
    const q = query.trim();
    if (!q || categories.length === 0) return [];

    const limitPer = options.limitPerCategory ?? 5;
    const searchOpts: SearchOptions = {
      minScore: options.minScore ?? 0.12,
      vectorWeight: 0.85,
      keywordWeight: 0.15,
    };

    const results: KnowledgeChunk[] = [];

    for (const cat of categories) {
      if (!this.tryLoadIndex(cat)) continue;

      const indexType = cat as IndexType;
      const hits = await this.indexer.search(indexType, q, limitPer, searchOpts);

      for (const hit of hits) {
        results.push({
          id: hit.id,
          chunkId: hit.chunkId,
          source: hit.source,
          pageNumber: hit.pageNumber,
          sectionTitle: hit.sectionTitle,
          score: hit.score,
          content: hit.content,
          category: cat,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 将检索结果格式化为 Prompt 片段字符串。
   * keeper_secret 类别会加上 [KP ONLY] 标记，提示 AI 不能直接输出。
   */
  formatForPrompt(
    chunks: KnowledgeChunk[],
    options: { maxCharsPerChunk?: number } = {},
  ): string {
    if (chunks.length === 0) return '';

    const maxChars = Math.max(64, options.maxCharsPerChunk ?? 400);
    const lines: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const pageText = c.pageNumber ? ` p.${c.pageNumber}` : '';
      const sectionText = c.sectionTitle ? ` / ${c.sectionTitle}` : '';
      const label = c.category === 'keeper_secret' ? ' [KP ONLY]' : '';
      const snippet = compact(c.content, maxChars);

      lines.push(`[${i + 1}]${label} ${c.source}${pageText}${sectionText}`);
      lines.push(snippet);
    }

    return lines.join('\n');
  }

  /** 是否存在指定类别的索引文件 */
  hasIndex(category: KnowledgeCategory): boolean {
    return existsSync(this.indexFilePath(category));
  }

  /** 已加载的类别列表 */
  loadedCategories(): KnowledgeCategory[] {
    return Array.from(this.loaded);
  }

  // ─── 私有 ──────────────────────────────────────────────────────────────────

  /**
   * 懒加载索引文件，返回 false 表示文件不存在（跳过该类别）。
   */
  private tryLoadIndex(category: KnowledgeCategory): boolean {
    if (this.loaded.has(category)) return true;

    const filePath = this.indexFilePath(category);
    if (!existsSync(filePath)) return false;

    this.indexer.loadFromFile(category as IndexType, filePath);
    this.loaded.add(category);
    return true;
  }

  private indexFilePath(category: KnowledgeCategory): string {
    return resolve(this.indexDir, `${category}.index.json`);
  }
}

function compact(text: string, maxChars: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 1)}…`;
}
