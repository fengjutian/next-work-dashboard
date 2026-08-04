export interface EditorNavigationRequest {
  rootPath: string;
  path: string;
  line?: number;
  column?: number;
}

const listeners = new Set<(request: EditorNavigationRequest) => void>();
let pendingRequest: EditorNavigationRequest | null = null;

export function requestEditorNavigation(request: EditorNavigationRequest): void {
  if (listeners.size === 0) pendingRequest = request;
  else {
    pendingRequest = null;
    listeners.forEach((listener) => listener(request));
  }
}

export function subscribeEditorNavigation(listener: (request: EditorNavigationRequest) => void): () => void {
  listeners.add(listener);
  if (pendingRequest) {
    const request = pendingRequest;
    pendingRequest = null;
    queueMicrotask(() => listener(request));
  }
  return () => listeners.delete(listener);
}
