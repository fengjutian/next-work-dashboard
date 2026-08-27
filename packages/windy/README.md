# @next-work-dashboard/windy

Reusable Windy weather visualization panel for the next-work-dashboard workspace.

Hosts an Electron `<webview>` running `https://www.windy.com/`. Uses the
webview (not `<iframe>`) so windy.com is not detected as a third-party
embed and the persistent session/partition keeps login state across
reloads.

## Structure

- `react/` — host boundary: `WindyPanel`, `WindyPanelProps`

## Usage

```tsx
import { WindyPanel } from "@next-work-dashboard/windy/react";

export default function WindyView() {
  return <WindyPanel />;
}
```

## Props

```ts
interface WindyPanelProps {
  /** Override the URL the webview loads. Defaults to `https://www.windy.com/`. */
  src?: string;
  /** Override the webview session partition. Defaults to `persist:windy`. */
  partition?: string;
}
```

The package does not depend on `Electron.WebviewTag` types — it uses a
minimal `WindyWebviewElement` interface (`goBack`, `goForward`,
`reload`) that any host can satisfy.
