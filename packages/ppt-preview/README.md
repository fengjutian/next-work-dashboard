# @next-work-dashboard/ppt-preview

Reusable PPTX panel — generate slides from text and preview existing `.pptx` files.

## Layers

- `core/` — Pure functions: `parsePptxFile` (JSZip + OOXML → slide text) and `generatePptx` (PptxGenJS → file download). No React.
- `react/` — `<PptPreviewPanel />` with internal generate/preview mode toggle. Self-contained; no host adapter required.

## Quick start (prompt-lab host)

```tsx
import { PptPreviewPanel } from "@next-work-dashboard/ppt-preview/react";
import "@next-work-dashboard/ppt-preview/styles.css";

<PptPreviewPanel />
```

## Tools

- **Generate mode** — add/remove slide drafts (title + body), export as `.pptx` via PptxGenJS.
- **Preview mode** — open or drop a `.pptx`, extract text from `ppt/slides/slide*.xml` via JSZip, show each slide as a card with the first text run as title and the rest as body.

## License

MIT
