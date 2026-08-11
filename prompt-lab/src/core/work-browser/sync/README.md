# Sync 模块（Phase 4 占位）

PRD 第 41 节规划的三阶段同步能力：

- **Phase 1**（当前）：Local Only
- **Phase 2**：Syncthing / WebDAV / S3 / NAS
- **Phase 3**：官方 Sync Service

本目录预留接口骨架，本轮**不实现**。接口稳定后由 Sync module 接管：

```ts
// 预留接口（实现时落地）
export interface SyncTarget {
  id: string;
  kind: 'webdav' | 's3' | 'syncthing' | 'nas';
  config: Record<string, string>;
}

export interface SyncAdapter {
  list(): Promise<string[]>;
  put(workspaceId: WorkspaceId, files: { path: string; data: Uint8Array }[]): Promise<void>;
  pull(workspaceId: WorkspaceId): Promise<{ path: string; data: Uint8Array }[]>;
}
```

后续实现请保留本目录的命名空间。
