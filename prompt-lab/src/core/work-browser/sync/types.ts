export type SyncKind = 'webdav' | 's3' | 'syncthing';

export interface SyncFile {
  path: string;
  data: Uint8Array;
  modifiedAt?: number;
  etag?: string;
}

export interface SyncEntry {
  path: string;
  size: number;
  modifiedAt?: number;
  etag?: string;
}

export interface SyncAdapter {
  readonly kind: SyncKind;
  list(workspaceId: string): Promise<SyncEntry[]>;
  get(workspaceId: string, path: string): Promise<SyncFile>;
  put(workspaceId: string, file: SyncFile): Promise<void>;
  remove(workspaceId: string, path: string): Promise<void>;
}

export interface SyncManifestEntry {
  path: string;
  hash: string;
  size: number;
  modifiedAt: number;
}

export interface SyncConflict {
  path: string;
  local: SyncManifestEntry;
  remote: SyncManifestEntry;
}

export interface IncrementalSyncPlan {
  upload: string[];
  download: string[];
  deleteLocal: string[];
  deleteRemote: string[];
  conflicts: Array<{ path: string; kind: 'both-modified' | 'local-modified-remote-deleted' | 'remote-modified-local-deleted' }>;
}

export function normalizeSyncPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (!normalized.length || normalized.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('INVALID_SYNC_PATH');
  }
  return normalized.join('/');
}

export function detectSyncConflicts(
  base: SyncManifestEntry[],
  local: SyncManifestEntry[],
  remote: SyncManifestEntry[],
): SyncConflict[] {
  const baseMap = new Map(base.map((entry) => [entry.path, entry]));
  const localMap = new Map(local.map((entry) => [entry.path, entry]));
  const remoteMap = new Map(remote.map((entry) => [entry.path, entry]));
  const conflicts: SyncConflict[] = [];
  for (const path of new Set([...localMap.keys(), ...remoteMap.keys()])) {
    const l = localMap.get(path);
    const r = remoteMap.get(path);
    if (!l || !r || l.hash === r.hash) continue;
    const previous = baseMap.get(path)?.hash;
    if (l.hash !== previous && r.hash !== previous) conflicts.push({ path, local: l, remote: r });
  }
  return conflicts;
}

export function buildIncrementalSyncPlan(base: SyncManifestEntry[], local: SyncManifestEntry[], remote: SyncManifestEntry[]): IncrementalSyncPlan {
  const b = new Map(base.map((entry) => [entry.path, entry]));
  const l = new Map(local.map((entry) => [entry.path, entry]));
  const r = new Map(remote.map((entry) => [entry.path, entry]));
  const plan: IncrementalSyncPlan = { upload: [], download: [], deleteLocal: [], deleteRemote: [], conflicts: [] };
  for (const filePath of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const baseEntry = b.get(filePath);
    const localEntry = l.get(filePath);
    const remoteEntry = r.get(filePath);
    if (localEntry && remoteEntry) {
      if (localEntry.hash === remoteEntry.hash) continue;
      const localChanged = !baseEntry || localEntry.hash !== baseEntry.hash;
      const remoteChanged = !baseEntry || remoteEntry.hash !== baseEntry.hash;
      if (localChanged && remoteChanged) plan.conflicts.push({ path: filePath, kind: 'both-modified' });
      else if (localChanged) plan.upload.push(filePath);
      else plan.download.push(filePath);
    } else if (localEntry) {
      if (!baseEntry) plan.upload.push(filePath);
      else if (localEntry.hash === baseEntry.hash) plan.deleteLocal.push(filePath);
      else plan.conflicts.push({ path: filePath, kind: 'local-modified-remote-deleted' });
    } else if (remoteEntry) {
      if (!baseEntry) plan.download.push(filePath);
      else if (remoteEntry.hash === baseEntry.hash) plan.deleteRemote.push(filePath);
      else plan.conflicts.push({ path: filePath, kind: 'remote-modified-local-deleted' });
    }
  }
  return plan;
}
