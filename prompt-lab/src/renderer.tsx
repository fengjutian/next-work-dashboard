import React, { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

interface RootErrorBoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends Component<PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[renderer] Uncaught React error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
        <section className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-lg">
          <h1 className="text-lg font-semibold">界面加载失败</h1>
          <p className="mt-2 text-sm text-muted-foreground">应用没有退出。可以重新加载界面；若问题重复出现，请在开发者工具中查看 renderer 日志。</p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{this.state.error.message}</pre>
          <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </section>
      </main>
    );
  }
}

// Vite returns 504 "Outdated Optimize Dep" when a page still references an
// optimization hash that was replaced while the dev server was running. A
// failed React.lazy import would otherwise reject permanently and blank the
// renderer. Reload once so the document receives the current dependency URLs.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();

  const recoveryKey = 'prompt-lab:vite-preload-recovery';
  const lastRecovery = Number(sessionStorage.getItem(recoveryKey) ?? 0);
  const now = Date.now();
  if (now - lastRecovery < 10_000) return;

  sessionStorage.setItem(recoveryKey, String(now));
  window.location.reload();
});

async function bootstrap() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing #root element');
  const root = createRoot(rootElement);
  root.render(
    <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      正在启动 next-work-dashboard…
    </div>,
  );

  const [{ default: App }, plugins] = await Promise.all([
    import('./App'),
    import('./plugins'),
  ]);
  const { initializeUserPlugins, registerBuiltInPlugins, rehydrateUserPlugins } = plugins;
  registerBuiltInPlugins();
  root.render(<React.StrictMode><RootErrorBoundary><App /></RootErrorBoundary></React.StrictMode>);

  // User plugins are not required for the first paint. Loading them in the
  // background prevents slow storage or a malformed legacy migration from
  // holding the entire renderer on a blank document.
  try {
    await initializeUserPlugins();
    rehydrateUserPlugins();
  } catch (error) {
    console.error('[renderer] Failed to initialize user plugins', error);
  }
}

void bootstrap().catch((error: unknown) => {
  console.error('[renderer] Bootstrap failed', error);
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<main style="height:100vh;display:grid;place-items:center;font-family:system-ui;background:#fff;color:#222"><section style="max-width:560px;padding:24px"><h1>应用启动失败</h1><p style="color:#666">${message.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)}</p><button onclick="location.reload()" style="padding:8px 16px">重新加载</button></section></main>`;
  }
});
