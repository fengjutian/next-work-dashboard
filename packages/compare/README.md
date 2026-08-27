# @next-work-dashboard/compare

Reusable text / file diff & merge panel for the next-work-dashboard
workspace.

Wraps Monaco's diff editor and adds structured comparison modes
(plain, Chinese word-level, paragraph, JSON, YAML, XML, CSV,
Markdown, .env), unified diff / JSON Patch import-export, and
interval-replay navigation.

## Structure

- `core/` — pure libs (no React/Monaco):
  - `text-diff.ts` — Myers line diff + inline word diff + Unified diff
    generator + hunk apply
  - `unified-patch.ts` — `parseUnifiedPatch` / `applyUnifiedPatch`
  - `comparison-modes.ts` — JSON / YAML / XML / CSV / Markdown / .env
    formatters and JSON-Patch helpers
  - `text-diff.worker.ts` — Web Worker entry for large diffs (hosts
    bundle it via Vite `?worker` and expose via the worker adapter)
  - `text-diff-worker-protocol.ts` — request/response types
  - `types.ts` — `CompareDocument`, `FilePickResult`, etc.
- `react/` — host boundary:
  - `ComparePanel.tsx`, `UnifiedDiffView.tsx`
  - `useTextDiffHunks.ts` — hook
  - `diff-worker-client.ts` — adapter for the Web Worker
  - `adapter.ts` / `context.tsx` — `CompareAdapter` + provider

## Usage

```tsx
import {
  ComparePanel, CompareProvider, createDiffClient,
  type CompareAdapter,
} from "@next-work-dashboard/compare/react";
// Host wires the adapter (see "Adapter" below).
import TextDiffWorker from "./text-diff.worker?worker";
// ^ your Vite `?worker` import; the package only needs the resulting
//   Worker constructor + a request/response bridge.

const adapter: CompareAdapter = {
  api: {
    pickFile: (opts) => window.electronAPI.pickFile(opts),
    saveFile: (content, name, opts) => window.electronAPI.saveFile(content, name, opts),
    writeTextFile: (path, content, opts) => window.electronAPI.writeTextFile(path, content, opts),
  },
  store: {
    theme: useStore.getState().theme,
    activeActivity: useStore.getState().activeActivity,
    setActiveActivity: (a) => useStore.getState().setActiveActivity(a),
  },
  monaco: {
    configureMonaco: () => configureMonaco(),
    decodeBase64Utf8: (b) => decodeBase64Utf8(b),
    languageIdFromName: (n) => languageIdFromName(n),
  },
  worker: {
    spawnDiffWorker: () => new TextDiffWorker(),
    requestDiff: (req, signal, timeoutMs) => {
      // Vite-specific worker plumbing.
      ...
    },
  },
  events: {
    onOpenContent: (handler) => {
      const wrap = (e: Event) =>
        handler((e as CustomEvent).detail);
      window.addEventListener("compare:open-content", wrap);
      return () => window.removeEventListener("compare:open-content", wrap);
    },
  },
};

export default function MyCompare() {
  return (
    <CompareProvider adapter={adapter}>
      <ComparePanel />
    </CompareProvider>
  );
}
```

## Adapter

The package is host-agnostic. Hosts provide:

```ts
interface CompareAdapter {
  api: {
    pickFile(opts?): Promise<PickedFileSingle | PickedFileSingle[] | null>;
    saveFile(content, defaultName, opts?): Promise<SaveFileResult>;
    writeTextFile(path, content, opts): Promise<WriteTextFileResult>;
  };
  store: {
    theme: 'light' | 'dark' | 'system';
    activeActivity: string;
    setActiveActivity(activity: string): void;
  };
  monaco: {
    configureMonaco(): void;             // idempotent
    decodeBase64Utf8(base64: string): string;
    languageIdFromName(name: string): string;
  };
  worker: {
    spawnDiffWorker(): Worker;
    requestDiff(request, signal?, timeoutMs?): Promise<TextDiffWorkerResponse>;
  };
  events: {
    onOpenContent(handler): () => void;     // host must bridge `compare:open-content`
  };
}
```
