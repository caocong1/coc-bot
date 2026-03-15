/**
 * 图片库
 *
 * 统一管理所有图片：
 *  - 从 docx/PDF 提取的内嵌图片
 *  - AI 生成的氛围图
 *
 * 持久化到 data/knowledge/images/library.json，
 * 每张图片有唯一 ID，可按 ID 快速查找。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const LIBRARY_PATH = resolve(PROJECT_ROOT, 'data', 'knowledge', 'images', 'library.json');
const IMAGES_DIR = resolve(PROJECT_ROOT, 'data', 'knowledge', 'images');

export type ImageSource = 'docx' | 'pdf' | 'generated';

export interface ImageEntry {
  /** 全局唯一 ID，如 "img-abc123" */
  id: string;
  /** 来源类型 */
  source: ImageSource;
  /** 本机相对路径（相对项目根目录） */
  relativePath: string;
  /** 图片 MIME 类型 */
  mimeType: string;
  /** 说明文字（KP 编辑，AI KP 参考用） */
  caption: string;
  /** KP 是否允许 AI KP 自动展示 */
  playerVisible: boolean;
  /** 来源文件 ID（docx/pdf 提取时） */
  sourceFileId?: string;
  /** AI 生成时使用的原始提示词（用于重新生成） */
  generatedPrompt?: string;
  /** 优化后的英文提示词（用于重新生成时直接调用） */
  optimizedPrompt?: string;
  /** 创建时间 */
  createdAt: string;
}

interface Library {
  updatedAt: string;
  entries: ImageEntry[];
}

export class ImageLibrary {
  private readonly libraryPath: string;
  private data: Library;

  constructor(libraryPath = LIBRARY_PATH) {
    this.libraryPath = resolve(libraryPath);
    mkdirSync(IMAGES_DIR, { recursive: true });
    this.data = this.load();
  }

  // ─── 读取 ─────────────────────────────────────────────────────────────────

  getAll(): ImageEntry[] {
    this.refresh();
    return this.data.entries;
  }

  getById(id: string): ImageEntry | undefined {
    this.refresh();
    return this.data.entries.find((e) => e.id === id);
  }

  getBySourceFile(fileId: string): ImageEntry[] {
    this.refresh();
    return this.data.entries.filter((e) => e.sourceFileId === fileId);
  }

  // ─── 写入 ─────────────────────────────────────────────────────────────────

  /** 新增或更新一条图片记录（按 id 幂等） */
  upsert(entry: ImageEntry): void {
    this.refresh();
    const idx = this.data.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      this.data.entries[idx] = entry;
    } else {
      this.data.entries.push(entry);
    }
    this.save();
  }

  /** 更新部分字段（caption / playerVisible / optimizedPrompt） */
  patch(id: string, patch: Partial<Pick<ImageEntry, 'caption' | 'playerVisible' | 'optimizedPrompt' | 'generatedPrompt'>>): boolean {
    this.refresh();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return false;
    Object.assign(entry, patch);
    this.save();
    return true;
  }

  /** 删除一条图片记录并返回原条目 */
  remove(id: string): ImageEntry | undefined {
    this.refresh();
    const idx = this.data.entries.findIndex((e) => e.id === id);
    if (idx < 0) return undefined;
    const [entry] = this.data.entries.splice(idx, 1);
    this.save();
    return entry;
  }

  /** 替换某张图片的文件路径（重新生成后更新） */
  replaceFile(id: string, newRelativePath: string): boolean {
    this.refresh();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.relativePath = newRelativePath;
    entry.createdAt = new Date().toISOString();
    this.save();
    return true;
  }

  // ─── 工具 ─────────────────────────────────────────────────────────────────

  /** 生成短 ID：img-{6位hex} */
  static generateId(): string {
    const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    return `img-${hex}`;
  }

  /** 由相对路径得到绝对路径 */
  static absPath(relativePath: string): string {
    return resolve(PROJECT_ROOT, relativePath);
  }

  // ─── 私有 ─────────────────────────────────────────────────────────────────

  private load(): Library {
    if (!existsSync(this.libraryPath)) {
      return { updatedAt: new Date().toISOString(), entries: [] };
    }
    try {
      return JSON.parse(readFileSync(this.libraryPath, 'utf-8')) as Library;
    } catch {
      return { updatedAt: new Date().toISOString(), entries: [] };
    }
  }

  private refresh(): void {
    this.data = this.load();
  }

  private save(): void {
    this.data.updatedAt = new Date().toISOString();
    mkdirSync(IMAGES_DIR, { recursive: true });
    writeFileSync(this.libraryPath, JSON.stringify(this.data, null, 2) + '\n', 'utf-8');
  }
}
