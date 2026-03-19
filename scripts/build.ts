/**
 * Build script: type-check → build web frontend
 * Usage: bun run build
 */
import { $ } from 'bun';

console.log('=== Build started ===\n');

// 1. Type-check backend
console.log('[1/2] Type-checking...');
const tsc = await $`bun tsc --noEmit`.nothrow();
if (tsc.exitCode !== 0) {
  console.error('Type-check failed, aborting build.');
  process.exit(1);
}
console.log('Type-check passed.\n');

// 2. Build web frontend → dist/web/
console.log('[2/2] Building web frontend...');
const web = await $`cd web && bun install && bun run build`.nothrow();
if (web.exitCode !== 0) {
  console.error('Web build failed.');
  process.exit(1);
}

console.log('\n=== Build complete ===');
console.log('Run with: bun run start');
