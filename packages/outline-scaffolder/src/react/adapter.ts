export interface FileMutation {
  path: string;
  content?: string;
  contentBase64?: string;
  operation?: "write" | "delete";
}

export interface OutlineScaffolderAdapter {
  files: {
    openFolder(): Promise<unknown>;
    readText(root: string, path: string): Promise<unknown>;
    writeText(root: string, path: string, content: string): Promise<unknown>;
    readBinary(root: string, path: string): Promise<unknown>;
    writeBinary(root: string, path: string, contentBase64: string): Promise<unknown>;
    listFiles(root: string): Promise<unknown>;
    listDirectory(root: string, path?: string): Promise<unknown>;
    createDirectory(root: string, path: string): Promise<unknown>;
    mutate(root: string, mutations: FileMutation[]): Promise<unknown>;
    reauthorize(root: string): Promise<unknown>;
  };
  git?: {
    status(root: string): Promise<unknown>;
    init(root: string): Promise<unknown>;
    stage(root: string, paths: string[]): Promise<unknown>;
    commit(root: string, message: string): Promise<unknown>;
    operation<T = unknown>(root: string, operation: string, args?: unknown): Promise<T>;
  };
  ai?: {
    chat(request: unknown): Promise<unknown>;
    generateImage?(request: unknown): Promise<unknown>;
  };
  projects?: {
    load(): Promise<unknown>;
    save(projects: unknown): Promise<unknown>;
  };
  secrets?: {
    load(key: string): Promise<unknown>;
    save(key: string, value: string): Promise<unknown>;
  };
  research?: { search(queries: string[]): Promise<unknown> };
  shell?: { openExternal(url: string): Promise<unknown> };
}
