# @next-work/outline-scaffolder

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
import { OutlineScaffolderPanel } from "@next-work/outline-scaffolder/react";
import "@next-work/outline-scaffolder/styles.css";

<OutlineScaffolderPanel adapter={adapter} />;
```

The package directory has no dependency on the `prompt-lab` source tree and can be
moved to its own Git repository.

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
