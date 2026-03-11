/**
 * PDF 文本提取器
 * 
 * 从 PDF 文件中提取文本内容
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

/**
 * PDF 提取结果
 */
export interface PdfExtractionResult {
  text: string;
  pages: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

/**
 * PDF 文本提取器
 */
export class PdfTextExtractor {
  /**
   * 提取 PDF 文本
   */
  async extract(filePath: string): Promise<PdfExtractionResult> {
    const doc = await this.loadDocument(filePath);

    try {
      const pageTexts: string[] = [];
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const text = await this.extractPageText(page);
        pageTexts.push(text);
      }

      const metadata = await this.readMetadata(doc);
      const mergedText = pageTexts
        .map((text, idx) => `--- Page ${idx + 1} ---\n${text}`)
        .join('\n\n')
        .trim();

      return {
        text: mergedText,
        pages: doc.numPages,
        metadata,
      };
    } finally {
      await doc.destroy();
    }
  }
  
  /**
   * 提取指定页面的文本
   */
  async extractPage(filePath: string, pageNumber: number): Promise<string> {
    if (pageNumber < 1) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    const doc = await this.loadDocument(filePath);
    try {
      if (pageNumber > doc.numPages) {
        throw new Error(`Page out of range: ${pageNumber}, total pages: ${doc.numPages}`);
      }
      const page = await doc.getPage(pageNumber);
      return this.extractPageText(page);
    } finally {
      await doc.destroy();
    }
  }

  private async loadDocument(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
    const bytes = readFileSync(resolved);
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
    return task.promise;
  }

  private async extractPageText(page: any): Promise<string> {
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;
    let result = '';

    for (const item of items) {
      if (item.str) result += item.str;
      if (item.hasEOL) result += '\n';
    }

    return result.replace(/\n{3,}/g, '\n\n').trim();
  }

  private async readMetadata(doc: any): Promise<PdfExtractionResult['metadata']> {
    try {
      const meta = await doc.getMetadata();
      const info = (meta.info ?? {}) as Record<string, unknown>;
      return {
        title: typeof info.Title === 'string' ? info.Title : undefined,
        author: typeof info.Author === 'string' ? info.Author : undefined,
        subject: typeof info.Subject === 'string' ? info.Subject : undefined,
      };
    } catch {
      return {};
    }
  }
}
