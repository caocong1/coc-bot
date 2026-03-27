/**
 * AES-256-GCM 凭证加密
 *
 * 使用 ENCRYPTION_KEY 环境变量作为密钥。
 * - 密钥缺失时拒绝启动（process.exit(1)）
 * - 空对象 {} 也会被加密（确保无明文存储）
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// ─── 密钥初始化 ──────────────────────────────────────────────────────────────

let _key: Buffer | null = null;

export function initEncryption(): void {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    console.error('[Encryption] ENCRYPTION_KEY 环境变量未设置，拒绝启动');
    process.exit(1);
  }
  // 允许 base64 或原始 hex 字符串
  let key: Buffer;
  if (raw.length === 64 && /^[a-f0-9]+$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    // 作为密码，derive 32 bytes
    const { createHash } = require('crypto') as typeof import('crypto');
    key = createHash('sha256').update(raw).digest();
  }
  if (key.length !== KEY_LENGTH) {
    console.error(`[Encryption] ENCRYPTION_KEY 长度必须为 ${KEY_LENGTH} 字节（当前: ${key.length}）`);
    process.exit(1);
  }
  _key = key;
}

function getKey(): Buffer {
  if (!_key) {
    // 首次调用前未 init，直接退出
    console.error('[Encryption] Encryption 未初始化（请先调用 initEncryption()）');
    process.exit(1);
  }
  return _key;
}

// ─── 加密 ───────────────────────────────────────────────────────────────────

/**
 * 加密凭证对象（即使为空对象也会加密）。
 * 返回 base64 字符串: iv(12) + ciphertext + authTag(16)
 */
export function encryptCredentials(credentials: object): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

// ─── 解密 ────────────────────────────────────────────────────────────────────

/**
 * 解密 base64 字符串回凭证对象。
 * 若密文损坏/被篡改，抛出 Error。
 */
export function decryptCredentials(encrypted: string): object {
  const key = getKey();
  const buf = Buffer.from(encrypted, 'base64');

  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('加密凭证格式无效（数据太短）');
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('加密凭证解密失败（auth tag 校验失败或数据损坏）');
  }
}

// ─── 凭证回显掩码 ────────────────────────────────────────────────────────────

/**
 * 返回掩码后的凭证描述，用于日志/响应（如 "sk-****abcd"）
 */
export function maskCredentials(credentials: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    if (!v) {
      result[k] = '(未设置)';
    } else if (v.length <= 4) {
      result[k] = '****';
    } else {
      result[k] = `****${v.slice(-4)}`;
    }
  }
  return result;
}
