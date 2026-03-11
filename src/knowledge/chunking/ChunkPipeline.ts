/**
 * 文本切片流水线
 * 
 * 将长文本切分成适合检索的块
 */

/**
 * 文本块
 */
export interface TextChunk {
  id: string;
  content: string;
  source: string; // 来源文件或章节
  pageNumber?: number;
  sectionTitle?: string;
  metadata: Record<string, unknown>;
}

/**
 * 切片选项
 */
export interface ChunkOptions {
  maxChunkSize: number;
  overlapSize: number;
  preserveStructure: boolean; // 是否保留章节结构
}

/**
 * 文本切片流水线
 */
export class ChunkPipeline {
  /**
   * 切分文本
   */
  async chunk(
    text: string,
    source: string,
    options: ChunkOptions = {
      maxChunkSize: 1000,
      overlapSize: 200,
      preserveStructure: true,
    }
  ): Promise<TextChunk[]> {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const paragraphs = this.parseParagraphs(normalized, options.preserveStructure);
    const chunks: TextChunk[] = [];

    let buffer: Paragraph[] = [];
    let chunkIndex = 0;

    const flushChunk = () => {
      const content = this.joinParagraphs(buffer);
      if (!content) return;

      const pages = this.collectPages(buffer);
      const section = this.findSection(buffer);
      chunks.push({
        id: `${this.sourceToId(source)}-chunk-${chunkIndex}`,
        content,
        source,
        pageNumber: pages.length > 0 ? pages[0] : undefined,
        sectionTitle: section,
        metadata: {
          chunkIndex,
          charLength: content.length,
          pages,
          sectionTitle: section,
        },
      });
      chunkIndex += 1;
    };

    for (const paragraph of paragraphs) {
      if (buffer.length === 0) {
        buffer.push(paragraph);
        continue;
      }

      const joined = this.joinParagraphs(buffer);
      const candidateLength = joined.length + 2 + paragraph.text.length;

      if (candidateLength <= options.maxChunkSize) {
        buffer.push(paragraph);
        continue;
      }

      flushChunk();

      const overlapText = options.overlapSize > 0
        ? joined.slice(Math.max(0, joined.length - options.overlapSize)).trim()
        : '';

      buffer = [];
      if (overlapText) {
        buffer.push({
          text: overlapText,
          pageNumber: paragraph.pageNumber,
          sectionTitle: paragraph.sectionTitle,
          isOverlap: true,
        });
      }
      buffer.push(paragraph);
    }

    if (buffer.length > 0) {
      flushChunk();
    }

    return chunks;
  }

  private parseParagraphs(text: string, preserveStructure: boolean): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    const lines = text.split('\n');

    let currentPage: number | undefined;
    let currentSection: string | undefined;
    let paragraphLines: string[] = [];

    const flush = () => {
      const merged = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
      if (!merged) return;
      paragraphs.push({
        text: merged,
        pageNumber: currentPage,
        sectionTitle: currentSection,
      });
      paragraphLines = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      const pageMatch = line.match(/^---\s*Page\s+(\d+)\s*---$/i);
      if (pageMatch) {
        flush();
        currentPage = parseInt(pageMatch[1], 10);
        continue;
      }

      if (!line) {
        flush();
        continue;
      }

      if (preserveStructure && this.isHeading(line)) {
        flush();
        currentSection = line;
        paragraphs.push({
          text: line,
          pageNumber: currentPage,
          sectionTitle: currentSection,
        });
        continue;
      }

      paragraphLines.push(line);
    }

    flush();
    return paragraphs;
  }

  private isHeading(line: string): boolean {
    if (/^#{1,6}\s+/.test(line)) return true;
    if (/^第[一二三四五六七八九十百千0-9]+[章节卷部篇]/.test(line)) return true;
    if (/^\d+(\.\d+){0,3}\s+/.test(line)) return true;
    return false;
  }

  private joinParagraphs(paragraphs: Paragraph[]): string {
    return paragraphs
      .map(p => p.text)
      .join('\n\n')
      .trim();
  }

  private collectPages(paragraphs: Paragraph[]): number[] {
    const pages = new Set<number>();
    for (const p of paragraphs) {
      if (p.pageNumber !== undefined) pages.add(p.pageNumber);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }

  private findSection(paragraphs: Paragraph[]): string | undefined {
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const section = paragraphs[i].sectionTitle;
      if (section) return section;
    }
    return undefined;
  }

  private sourceToId(source: string): string {
    const normalized = source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'source';
  }
}

interface Paragraph {
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  isOverlap?: boolean;
}
