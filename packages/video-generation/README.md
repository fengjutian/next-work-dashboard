# @next-work/video-generation

Reusable TypeScript core and React host boundary for MiniMax (H3 / Hailuo) video generation.

The package is host-neutral. Electron preload/IPC, SQLite storage, and LLM providers are
supplied through `VideoGenerationAdapter`.

```tsx
import { VideoGenerationPanel } from "@next-work/video-generation/react";

<VideoGenerationPanel adapter={adapter} />;
```

The package has no dependency on the `prompt-lab` source tree and can be moved to its
own Git repository.

## Build and test

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Layout

- `src/core/` — pure functions: MiniMax HTTP request construction, storyboard helpers,
  stitch frame analysis, catbox URL parsing, OpenAI-compatible chat provider.
- `src/react/` — `VideoGenerationPanel` plus the `VideoGenerationAdapter` interface that
  bridges to the host (Electron preload, SQLite, LLM, notification, localStorage).
- `src/types.ts` — shared type definitions (request, task info, stored record, etc.).
