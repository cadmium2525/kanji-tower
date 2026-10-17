/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 等のサブパスでも動くよう相対パスで出力
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
