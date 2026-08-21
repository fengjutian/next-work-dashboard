import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeUserPlugins, registerBuiltInPlugins, rehydrateUserPlugins } from './plugins';

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
  registerBuiltInPlugins();
  await initializeUserPlugins();
  rehydrateUserPlugins();
  const root = createRoot(document.getElementById('root')!);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

void bootstrap();
