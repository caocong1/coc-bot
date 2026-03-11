const PATCH_FLAG = Symbol.for('coc-bot.console.timestamp.enabled');

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function patchMethod(name: 'log' | 'info' | 'warn' | 'error'): void {
  const original = console[name].bind(console);
  console[name] = ((...args: unknown[]) => {
    original(`[${formatTimestamp(new Date())}]`, ...args);
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

