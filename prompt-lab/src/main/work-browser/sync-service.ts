import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { detectSyncConflicts, normalizeSyncPath, S3SyncAdapter, WebDavSyncAdapter, type SyncAdapter, type SyncEntry, type SyncFile, type SyncManifestEntry } from '../../core/work-browser/sync';
import { SyncthingFolderAdapter } from './syncthing-sync';
import type { WorkspaceStore } from './workspace-store';

export interface SyncTargetInput {
  id: string;
  kind: 'webdav' | 's3' | 'syncthing';
  config: Record<string, string>;
}

export class WorkBrowserSyncService {
  constructor(private workspaces: WorkspaceStore) {}

  async preview(workspaceId: string, target: SyncTargetInput) {
    const adapter = createAdapter(target);
    const local = await localManifest(this.workspaceRoot(workspaceId));
    const remote = await remoteManifest(adapter, workspaceId);
    return {
      local,
      remote,
      conflicts: detectSyncConflicts([], local, remote),
      upload: local.filter((entry) => !remote.some((candidate) => candidate.path === entry.path && candidate.hash === entry.hash)).map((entry) => entry.path),
      download: remote.filter((entry) => !local.some((candidate) => candidate.path === entry.path && candidate.hash === entry.hash)).map((entry) => entry.path),
    };
  }

  async push(workspaceId: string, target: SyncTargetInput, overwrite = false) {
    const preview = await this.preview(workspaceId, target);
    if (preview.conflicts.length && !overwrite) return { ok: false, conflicts: preview.conflicts, transferred: 0 };
    const adapter = createAdapter(target);
    const root = this.workspaceRoot(workspaceId);
    let transferred = 0;
    for (const relativePath of preview.upload) {
      const data = await fs.readFile(safeResolve(root, relativePath));
      await adapter.put(workspaceId, { path: relativePath, data });
      transferred += 1;
    }
    return { ok: true, conflicts: [], transferred };
  }

  async pull(workspaceId: string, target: SyncTargetInput, overwrite = false) {
    const preview = await this.preview(workspaceId, target);
    if (preview.conflicts.length && !overwrite) return { ok: false, conflicts: preview.conflicts, transferred: 0 };
    const adapter = createAdapter(target);
    const root = this.workspaceRoot(workspaceId);
    let transferred = 0;
    for (const relativePath of preview.download) {
      const file = await adapter.get(workspaceId, relativePath);
      const destination = safeResolve(root, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, file.data);
      await fs.rename(temporary, destination);
      transferred += 1;
    }
    return { ok: true, conflicts: [], transferred };
  }

  private workspaceRoot(workspaceId: string): string {
    const workspace = this.workspaces.getWorkspace(workspaceId as never);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    return path.resolve(workspace.storagePath || path.join(app.getPath('userData'), 'work-browser-documents', workspaceId));
  }
}

function createAdapter(target: SyncTargetInput): SyncAdapter {
  if (target.kind === 'syncthing') return new SyncthingFolderAdapter(required(target.config, 'rootPath'));
  if (target.kind === 'webdav') return new WebDavSyncAdapter({ baseUrl: required(target.config, 'baseUrl'), username: target.config.username, password: target.config.password });
  return new S3SyncAdapter({
    endpoint: required(target.config, 'endpoint'), region: required(target.config, 'region'), bucket: required(target.config, 'bucket'),
    accessKeyId: required(target.config, 'accessKeyId'), secretAccessKey: required(target.config, 'secretAccessKey'), prefix: target.config.prefix,
  });
}

async function localManifest(root: string): Promise<SyncManifestEntry[]> {
  const files: SyncManifestEntry[] = [];
  await walk(root, root, files);
  return files;
}

async function walk(root: string, current: string, output: SyncManifestEntry[]): Promise<void> {
  let entries: Array<import('node:fs').Dirent>;
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, full, output);
    else if (entry.isFile()) {
      const [data, stat] = await Promise.all([fs.readFile(full), fs.stat(full)]);
      output.push({ path: path.relative(root, full).replace(/\\/g, '/'), hash: sha256(data), size: stat.size, modifiedAt: stat.mtimeMs });
    }
  }
}

async function remoteManifest(adapter: SyncAdapter, workspaceId: string): Promise<SyncManifestEntry[]> {
  const entries: SyncEntry[] = await adapter.list(workspaceId);
  return Promise.all(entries.map(async (entry) => {
    const file: SyncFile = await adapter.get(workspaceId, entry.path);
    return { path: entry.path, hash: sha256(file.data), size: entry.size, modifiedAt: entry.modifiedAt || 0 };
  }));
}

function safeResolve(root: string, relativePath: string): string {
  const target = path.resolve(root, normalizeSyncPath(relativePath));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('SYNC_PATH_ESCAPE');
  return target;
}
function sha256(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
function required(config: Record<string, string>, key: string): string { if (!config[key]) throw new Error(`SYNC_CONFIG_REQUIRED:${key}`); return config[key]; }
