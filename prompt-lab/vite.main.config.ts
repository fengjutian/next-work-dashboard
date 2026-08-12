import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      // better-sqlite3 是 native 模块，由 electron-rebuild 单独处理；rollup 不打包它
      // jsdom intentionally stays external: when Rollup bundles it, jsdom's
      // optional `require("canvas")` probe is converted into a hard runtime
      // resolution and Save Page fails on installations without canvas.
      // Native Node resolution preserves jsdom's try/catch fallback.
      // `ws` must also stay external. Bundling turns its guarded optional
      // bufferutil/utf-8-validate probes into hard runtime imports.
      external: ['node-pty', '@lancedb/lancedb', 'better-sqlite3', 'jsdom', 'ws'],
      onwarn(warning, warn) {
        const transformersPureAnnotation = warning.code === 'INVALID_ANNOTATION'
          && warning.id?.includes('@huggingface/transformers/dist/transformers.node.mjs');
        if (!transformersPureAnnotation) warn(warning);
      },
    },
  },
});
