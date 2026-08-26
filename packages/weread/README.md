# @next-work/weread

Reusable WeRead (微信读书) reader core and React host boundary for next-work-dashboard.

The package is host-neutral. SQLite persistence, the WeRead HTTP gateway, and AI
providers are supplied through `WereadAdapter`.

```tsx
import { WereadPanel } from '@next-work/weread/react';

<WereadPanel adapter={adapter} />;
```

## Layout

- `src/core/` — pure functions: TF-IDF analysis, reading-activity (localStorage),
  markdown export, types.
- `src/react/` — `WereadPanel` plus the `WereadAdapter` interface that bridges to
  the host (SQLite, electron preload, AI provider).
- `src/styles.css` — CSS variables.
