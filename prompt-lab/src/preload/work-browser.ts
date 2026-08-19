/**
 * Work Browser — Preload 桥接
 *
 * 暴露到 window.electronAPI.workBrowser
 * 与 main/work-browser/ipc.ts 一一对应；channel 名必须同步。
 */
import { ipcRenderer } from 'electron';

export const workBrowserBridge = {
  workspace: {
    list: (includeArchived?: boolean) => ipcRenderer.invoke('work-browser:workspace:list', includeArchived),
    get: (id: string) => ipcRenderer.invoke('work-browser:workspace:get', id),
    create: (input: { name: string; description?: string; icon?: string; color?: string; storagePath?: string; privacyMode?: 'normal' | 'local-only' }) =>
      ipcRenderer.invoke('work-browser:workspace:create', input),
    update: (id: string, patch: any) => ipcRenderer.invoke('work-browser:workspace:update', id, patch),
    archive: (id: string) => ipcRenderer.invoke('work-browser:workspace:archive', id),
  },
  tab: {
    list: (workspaceId: string) => ipcRenderer.invoke('work-browser:tab:list', workspaceId),
    create: (input: { workspaceId: string; url: string; title?: string; position?: number }) => ipcRenderer.invoke('work-browser:tab:create', input),
    update: (id: string, patch: any) => ipcRenderer.invoke('work-browser:tab:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('work-browser:tab:delete', id),
  },
  document: {
    list: (workspaceId: string, limit?: number) => ipcRenderer.invoke('work-browser:document:list', workspaceId, limit),
    get: (id: string) => ipcRenderer.invoke('work-browser:document:get', id),
    versions: (id: string) => ipcRenderer.invoke('work-browser:document:versions', id),
    compare: (id: string) => ipcRenderer.invoke('work-browser:document:compare', id),
    save: (input: { workspaceId: string; tabId?: string | null; url: string; html?: string; title?: string }) =>
      ipcRenderer.invoke('work-browser:document:save', input),
  },
  note: {
    list: (workspaceId: string) => ipcRenderer.invoke('work-browser:note:list', workspaceId),
    create: (input: { workspaceId: string; title: string; content: string; documentId?: string; tabId?: string; taskId?: string; tags?: string[] }) =>
      ipcRenderer.invoke('work-browser:note:create', input),
  },
  task: {
    list: (workspaceId: string, status?: string) => ipcRenderer.invoke('work-browser:task:list', workspaceId, status),
    upsert: (task: any) => ipcRenderer.invoke('work-browser:task:upsert', task),
    templates: () => ipcRenderer.invoke('work-browser:task:templates'),
    createFromTemplate: (input: { workspaceId: string; templateId: string; title?: string }) => ipcRenderer.invoke('work-browser:task:create-from-template', input),
    runAuto: (taskId: string) => ipcRenderer.invoke('work-browser:task:run-auto', taskId),
  },
  conversation: {
    list: (workspaceId: string) => ipcRenderer.invoke('work-browser:conversation:list', workspaceId),
    get: (id: string) => ipcRenderer.invoke('work-browser:conversation:get', id),
    upsert: (conv: any) => ipcRenderer.invoke('work-browser:conversation:upsert', conv),
  },
  search: {
    providers: () => ipcRenderer.invoke('work-browser:search:providers'),
    run: (input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }) =>
      ipcRenderer.invoke('work-browser:search:run', input),
    start: (requestId: string, input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }) =>
      ipcRenderer.invoke('work-browser:search:start', requestId, input),
    cancel: (requestId: string) => ipcRenderer.invoke('work-browser:search:cancel', requestId),
    onProgress: (callback: (progress: { requestId: string; results: unknown[]; providers: unknown[]; took: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: { requestId: string; results: unknown[]; providers: unknown[]; took: number }) => callback(progress);
      ipcRenderer.on('work-browser:search:progress', listener);
      return () => ipcRenderer.removeListener('work-browser:search:progress', listener);
    },
    suggest: (text: string) => ipcRenderer.invoke('work-browser:search:suggest', text),
    history: (limit?: number) => ipcRenderer.invoke('work-browser:search:history', limit),
  },
  cleaner: {
    payload: (options?: any) => ipcRenderer.invoke('work-browser:cleaner:payload', options),
    webviewPayload: () => ipcRenderer.invoke('work-browser:cleaner:webview-payload'),
    webviewPreloadPath: () => ipcRenderer.invoke('work-browser:cleaner:webview-preload-path'),
  },
  annotation: {
    list: (documentId: string) => ipcRenderer.invoke('work-browser:annotation:list', documentId),
    listByUrl: (url: string) => ipcRenderer.invoke('work-browser:annotation:list-by-url', url),
    listByWorkspace: (workspaceId: string) => ipcRenderer.invoke('work-browser:annotation:list-by-workspace', workspaceId),
    create: (input: { documentId: string; selector: string; rangeText: string; note: string; color: string }) => ipcRenderer.invoke('work-browser:annotation:create', input),
    remove: (id: string) => ipcRenderer.invoke('work-browser:annotation:delete', id),
  },
  rag: {
    query: (input: { query: string; workspaceId?: string; topK?: number; scope?: 'workspace' | 'library' }) =>
      ipcRenderer.invoke('work-browser:rag:query', input),
  },
  research: {
    run: (input: { topic: string; workspaceId: string; autoSave?: boolean }) =>
      ipcRenderer.invoke('work-browser:research:run', input),
  },
  agent: {
    run: (input: { userMessage: string; workspaceId?: string; systemPrompt?: string; maxSteps?: number; autoApproveDanger?: boolean }) =>
      ipcRenderer.invoke('work-browser:agent:run', input),
  },
  graph: {
    listByDocument: (documentId: string, kinds?: string[]) => ipcRenderer.invoke('work-browser:graph:list-by-document', documentId, kinds),
    listByWorkspace: (workspaceId: string, kind?: string) => ipcRenderer.invoke('work-browser:graph:list-by-workspace', workspaceId, kind),
    recordSavedWith: (workspaceId: string, documentIds: string[]) => ipcRenderer.invoke('work-browser:graph:record-saved-with', workspaceId, documentIds),
    recordEdge: (input: { kind: string; workspaceId: string; fromType: string; fromId: string; toType: string; toId: string; weight?: number; metadata?: Record<string, unknown> }) =>
      ipcRenderer.invoke('work-browser:graph:record-edge', input),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('work-browser:settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('work-browser:settings:set', key, value),
  },
  config: {
    setAI: (input: { baseUrl: string; apiKey: string; model: string; local?: boolean }) =>
      ipcRenderer.invoke('work-browser:config:set-ai', input),
  },
  autoGroup: {
    suggest: (docSummary: { title: string; url: string; capturedAt: number }) =>
      ipcRenderer.invoke('work-browser:auto-group:suggest', docSummary),
  },
};
