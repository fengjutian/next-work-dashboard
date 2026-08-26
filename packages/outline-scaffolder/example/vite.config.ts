import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@next-work-dashboard/outline-scaffolder/react", replacement: resolve(__dirname, "../src/react/index.ts") },
      { find: "@next-work-dashboard/outline-scaffolder/styles.css", replacement: resolve(__dirname, "../dist/styles.css") },
    ],
  },
});
