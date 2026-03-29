import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { format } from 'util';

const PATCH_FLAG = Symbol.for('coc-bot.console.timestamp.enabled');
const LOG_DIR = join(process.cwd(), 'data', 'logs');
let currentDateStr = '';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function writeToLogFile(line: string): void {
  const now = new Date();
  const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  if (ds !== currentDateStr) {
    currentDateStr = ds;
    ensureLogDir();
  }
  try {
    appendFileSync(join(LOG_DIR, `service-${ds}.log`), line + '\n');
  } catch { /* 日志写入失败不应影响主流程 */ }
}

function patchMethod(name: 'log' | 'info' | 'warn' | 'error'): void {
  const original = console[name].bind(console);
  console[name] = ((...args: unknown[]) => {
    const ts = `[${formatTimestamp(new Date())}]`;
    original(ts, ...args);
    const formattedLine = `${ts} ${format(...args)}`;
    writeToLogFile(formattedLine);
  }) as typeof console[typeof name];
}

export function enableTimestampedConsole(): void {
  const marker = globalThis as Record<symbol, boolean | undefined>;
  if (marker[PATCH_FLAG]) return;
  marker[PATCH_FLAG] = true;

  patchMethod('log');
  patchMethod('info');
  patchMethod('warn');
  patchMethod('error');
}
