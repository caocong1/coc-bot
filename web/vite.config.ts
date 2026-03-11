import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:28765',
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'esnext',
  },
});
