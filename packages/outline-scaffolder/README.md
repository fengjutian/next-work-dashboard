# @next-work-dashboard/outline-scaffolder

Reusable TypeScript core and React host boundary for the next-work outline scaffolder.

## Build and publish

```bash
npm install
npm run build
npm publish --access public
```

The React integration is host-neutral. Electron, filesystem, Git, AI, secret storage,
research, GitHub Pages, image generation, and shell capabilities are supplied through
`OutlineScaffolderAdapter`.

```tsx
import { OutlineScaffolderPanel } from "@next-work-dashboard/outline-scaffolder/react";
import "@next-work-dashboard/outline-scaffolder/styles.css";

<OutlineScaffolderPanel adapter={adapter} />;
```

The package directory has no dependency on the `prompt-lab` source tree and can be
moved to its own Git repository.

## Web

The Web entry connects the panel to an HTTP host endpoint. The endpoint receives
`POST { operation, args }` and returns `{ result }` or `{ error }`.

```tsx
import { WebOutlineScaffolderApp } from "@next-work-dashboard/outline-scaffolder/web";
import "@next-work-dashboard/outline-scaffolder/styles.css";

<WebOutlineScaffolderApp options={{
  http: { endpoint: "/api/outline-scaffolder" },
  ai: { baseUrl: "/api/ai", model: "your-model" },
}} />;
```

Pass `transport` instead of `http` when the Web host uses RPC, a service worker,
OPFS, or another storage backend. Browser clients should proxy AI requests through
a trusted backend instead of persisting provider keys in client storage.

## Tauri

The Tauri entry uses an injected `invoke` function and therefore does not force a
specific Tauri JavaScript API version on consumers.

```tsx
import { invoke } from "@tauri-apps/api/core";
import { TauriOutlineScaffolderApp } from "@next-work-dashboard/outline-scaffolder/tauri";

<TauriOutlineScaffolderApp options={{ invoke }} />;
```

The default Rust command is `outline_scaffolder`. It receives `operation` and
`args`; set `command` to use a different command name. The same operations are
used by Web and Tauri, including `workspace.readTextFile`,
`outlineResearch.search`, `llmChat`, and `shell.openExternal`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
cd example && npm install && npm run build
```

Releases use Changesets. Merges to `main` create a release PR and publish to npm
with provenance after `NPM_TOKEN` is configured in GitHub Actions.
