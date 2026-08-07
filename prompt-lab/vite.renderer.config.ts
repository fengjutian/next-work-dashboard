import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
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
