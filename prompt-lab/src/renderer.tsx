import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeUserPlugins, registerBuiltInPlugins, rehydrateUserPlugins } from './plugins';

async function bootstrap() {
  registerBuiltInPlugins();
  await initializeUserPlugins();
  rehydrateUserPlugins();
  const root = createRoot(document.getElementById('root')!);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

void bootstrap();
