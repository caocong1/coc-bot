import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
  server: {
    host: true,
    port: 28766,
    proxy: {
      '/api': 'http://localhost:28765',
    },
    allowedHosts: ['home.love2c.cc'],
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'esnext',
  },
});
