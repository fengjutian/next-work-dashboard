import { ipcRenderer } from 'electron';

export const codeVisualizerBridge = {
  repository: {
    select: () => ipcRenderer.invoke('code-visualizer:repository:select'),
    scan: (rootPath: string) => ipcRenderer.invoke('code-visualizer:repository:scan', rootPath),
  },
  source: {
    read: (rootPath: string, relativePath: string) => ipcRenderer.invoke('code-visualizer:source:read', rootPath, relativePath),
    openExternal: (rootPath: string, relativePath: string, line?: number) => ipcRenderer.invoke('code-visualizer:source:open-external', rootPath, relativePath, line),
  },
  runtime: {
    import: (rootPath: string) => ipcRenderer.invoke('code-visualizer:runtime:import', rootPath),
  },
  openApi: {
    import: (rootPath: string, analysis: unknown) => ipcRenderer.invoke('code-visualizer:openapi:import', rootPath, analysis),
  },
  git: {
    impact: (rootPath: string, base: string, analysis: unknown) => ipcRenderer.invoke('code-visualizer:git:impact', rootPath, base, analysis),
  },
  test: {
    run: (rootPath: string, files: string[]) => ipcRenderer.invoke('code-visualizer:test:run', rootPath, files),
  },
  coverage: {
    import: (rootPath: string) => ipcRenderer.invoke('code-visualizer:coverage:import', rootPath),
  },
  apiDebug: {
    execute: (input: unknown) => ipcRenderer.invoke('code-visualizer:api-debug:execute', input),
  },
  explain: {
    import: (rootPath: string) => ipcRenderer.invoke('code-visualizer:explain:import', rootPath),
  },
  database: {
    connectSqlite: () => ipcRenderer.invoke('code-visualizer:database:connect-sqlite'),
    connectMySql: (input: unknown) => ipcRenderer.invoke('code-visualizer:database:connect-mysql', input),
    explain: (id: string, engine: 'sqlite' | 'mysql', sql: string) => ipcRenderer.invoke('code-visualizer:database:explain', id, engine, sql),
    close: (id: string) => ipcRenderer.invoke('code-visualizer:database:close', id),
  },
  history: {
    list: () => ipcRenderer.invoke('code-visualizer:history:list'),
    open: (rootPath: string) => ipcRenderer.invoke('code-visualizer:history:open', rootPath),
    remove: (rootPath: string) => ipcRenderer.invoke('code-visualizer:history:remove', rootPath),
  },
  snapshot: {
    list: (rootPath: string) => ipcRenderer.invoke('code-visualizer:snapshot:list', rootPath),
    load: (rootPath: string, id: string) => ipcRenderer.invoke('code-visualizer:snapshot:load', rootPath, id),
    diff: (rootPath: string, fromId: string, toId: string) => ipcRenderer.invoke('code-visualizer:snapshot:diff', rootPath, fromId, toId),
  },
};
