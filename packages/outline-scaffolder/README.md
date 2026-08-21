# @next-work/outline-scaffolder

Reusable TypeScript core and React host boundary for the next-work outline scaffolder.

## Build and publish

```bash
npm install
npm run build
npm publish --access public
```

The React integration is host-neutral. Electron, filesystem, Git, AI, secret storage,
research, and shell capabilities are supplied through `OutlineScaffolderAdapter`.

```tsx
import { OutlineScaffolderProvider } from "@next-work/outline-scaffolder/react";

<OutlineScaffolderProvider adapter={adapter}>
  <YourOutlineScaffolder />
</OutlineScaffolderProvider>;
```

The package directory has no dependency on the `prompt-lab` source tree and can be
moved to its own Git repository.
