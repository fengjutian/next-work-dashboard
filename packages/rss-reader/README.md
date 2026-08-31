# @next-work-dashboard/rss-reader

Reusable RSS reader core, main-process IPC service, and React host boundary for next-work-dashboard.

The package is host-neutral. Electron preload/IPC, SQLite storage (better-sqlite3), the
article readability extractor, and OS-level notifications are supplied through adapters.

```ts
// main process
import { registerRssIpc } from '@next-work-dashboard/rss-reader/main';
import Database from 'better-sqlite3';

registerRssIpc({
  openDatabase: () => new Database('<userData>/rss-reader.db'),
  extractReadability,
  notify: (title, body) => { /* electron Notification */ },
});
```

```tsx
// renderer
import { RssReaderPanel } from '@next-work-dashboard/rss-reader/react';

<RssReaderPanel adapter={adapter} />;
```

### Web

```tsx
import { createWebRssReaderAdapter } from '@next-work-dashboard/rss-reader/web';

const adapter = createWebRssReaderAdapter({
  // Direct requests work only for feeds that allow browser CORS.
  resolveFetchUrl: (url) => `/api/rss-proxy?url=${encodeURIComponent(url)}`,
});
<RssReaderPanel adapter={adapter} />;
```

### Tauri

```tsx
import { invoke } from '@tauri-apps/api/core';
import { createTauriRssReaderAdapter } from '@next-work-dashboard/rss-reader/tauri';

const adapter = createTauriRssReaderAdapter({ invoke });
<RssReaderPanel adapter={adapter} />;
```

The Tauri adapter maps UI operations to `rss_*` Rust commands. Command names can
be overridden through `commands`; this package intentionally does not pin a Tauri version.

## Layout

- `src/core/` — pure functions: RSS/Atom parser, types, recommended feeds.
- `src/main/` — better-sqlite3 persistence and `registerRssIpc()`. Host injects
  `openDatabase`, `extractReadability`, and `notify`.
- `src/react/` — `RssReaderPanel` plus the `RssReaderAdapter` interface that bridges
  to the host (Electron preload bridge, OS file pickers, etc).
- `src/styles.css` — CSS variables and utility classes used by the panel.
