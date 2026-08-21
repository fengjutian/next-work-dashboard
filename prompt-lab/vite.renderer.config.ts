import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  worker: {
    format: 'es',
  },
  resolve: {
    // Local/file-linked UI packages may have their own development copy of
    // React. Always resolve hooks against the renderer's React instance.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // Keep the linked package out of esbuild's dependency bundle so React
    // deduplication also applies while developing through a `file:` junction.
    exclude: [
      '@next-work/outline-scaffolder',
      '@next-work/outline-scaffolder/react',
      '@next-work/outline-scaffolder/core',
    ],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      onwarn(warning, warn) {
        // Ant Design marks browser components with React's `use client`
        // directive. It has no meaning in this Electron/Vite renderer and
        // Rollup safely removes it, so avoid flooding packaging output with
        // hundreds of misleading "cause errors" warnings.
        const moduleId = warning.id?.replace(/\\/g, '/') ?? '';
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE'
          && warning.message.includes('use client')
          && moduleId.includes('/node_modules/')
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
