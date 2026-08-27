# @next-work/pdf-preview

Reusable PDF preview panel for the next-work-dashboard workspace.

Uses [`pdfjs-dist`](https://github.com/mozilla/pdf.js) under the hood and follows
the same `core + react` host-agnostic pattern as the other `@next-work/*` packages
(`outline-scaffolder`, `rss-reader`, `video-generation`, `weread`).

## Structure

- `core/` — pure functions: `loadPdfDocument`, `renderPageToImage`, `loadPdfFirstPage`, types
- `react/` — host boundary: `PdfPreviewPanel`, `PdfPreviewProvider`, `usePdfPreviewAdapter`
- `styles.css` — host stylesheet (no-op placeholder; uses host Tailwind)

## Usage

```tsx
import { PdfPreviewPanel, PdfPreviewProvider, type PdfPreviewAdapter } from "@next-work/pdf-preview/react";
import "@next-work/pdf-preview/styles.css";
import workerSrc from "@/workers/pdf.worker.ts?worker&url";
import * as pdfjs from "pdfjs-dist";

const adapter: PdfPreviewAdapter = {
  getPdfJs: async () => {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    }
    return pdfjs;
  },
};

export default function MyPdfPreview() {
  return (
    <PdfPreviewProvider adapter={adapter}>
      <PdfPreviewPanel />
    </PdfPreviewProvider>
  );
}
```

## Adapter

```ts
interface PdfPreviewAdapter {
  /** Return a configured pdfjs-dist instance. The host is expected
   *  to set `GlobalWorkerOptions.workerSrc` before returning. */
  getPdfJs(): Promise<PdfJsLib>;
}
```

Hosts must configure the worker source. The package itself never
binds a worker URL — that's a build-time / runtime concern of the host
(Vite `?worker&url` import, a CDN URL, or a bundled file).
