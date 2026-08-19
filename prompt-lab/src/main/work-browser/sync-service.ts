import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { buildIncrementalSyncPlan, normalizeSyncPath, S3SyncAdapter, WebDavSyncAdapter, type SyncAdapter, type SyncEntry, type SyncFile, type SyncManifestEntry } from '../../core/work-browser/sync';
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
    const base = await this.readBaseline(workspaceId, target.id);
    return { local, remote, base, ...buildIncrementalSyncPlan(base, local, remote) };
  }

  async push(workspaceId: string, target: SyncTargetInput, overwrite = false) {
    const preview = await this.preview(workspaceId, target);
    if (preview.conflicts.length && !overwrite) return { ok: false, conflicts: preview.conflicts, transferred: 0 };
    const adapter = createAdapter(target);
    const root = this.workspaceRoot(workspaceId);
    let transferred = 0;
    const uploads = overwrite ? [...new Set([...preview.upload, ...preview.conflicts.map((item) => item.path).filter((item) => preview.local.some((entry) => entry.path === item))])] : preview.upload;
    const deletions = overwrite ? [...new Set([...preview.deleteRemote, ...preview.conflicts.map((item) => item.path).filter((item) => !preview.local.some((entry) => entry.path === item))])] : preview.deleteRemote;
    for (const relativePath of uploads) {
      const data = await fs.readFile(safeResolve(root, relativePath));
      await adapter.put(workspaceId, { path: relativePath, data });
      transferred += 1;
    }
    for (const relativePath of deletions) { await adapter.remove(workspaceId, relativePath); transferred += 1; }
    await this.updateBaseline(workspaceId, target.id, preview.base, preview.local, uploads, deletions);
    return { ok: true, conflicts: [], transferred };
  }

  async pull(workspaceId: string, target: SyncTargetInput, overwrite = false) {
    const preview = await this.preview(workspaceId, target);
    if (preview.conflicts.length && !overwrite) return { ok: false, conflicts: preview.conflicts, transferred: 0 };
    const adapter = createAdapter(target);
    const root = this.workspaceRoot(workspaceId);
    let transferred = 0;
    const downloads = overwrite ? [...new Set([...preview.download, ...preview.conflicts.map((item) => item.path).filter((item) => preview.remote.some((entry) => entry.path === item))])] : preview.download;
    const deletions = overwrite ? [...new Set([...preview.deleteLocal, ...preview.conflicts.map((item) => item.path).filter((item) => !preview.remote.some((entry) => entry.path === item))])] : preview.deleteLocal;
    const backup = await backupLocal(root, [...downloads, ...deletions]);
    try {
      for (const relativePath of downloads) {
        const file = await adapter.get(workspaceId, relativePath);
        await atomicLocalWrite(safeResolve(root, file.path), file.data);
        transferred += 1;
      }
      for (const relativePath of deletions) { await fs.unlink(safeResolve(root, relativePath)).catch(() => undefined); transferred += 1; }
    } catch (error) {
      await restoreLocal(root, backup);
      throw error;
    }
    await this.updateBaseline(workspaceId, target.id, preview.base, preview.remote, downloads, deletions);
    return { ok: true, conflicts: [], transferred };
  }

  private workspaceRoot(workspaceId: string): string {
    const workspace = this.workspaces.getWorkspace(workspaceId as never);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    return path.resolve(workspace.storagePath || path.join(app.getPath('userData'), 'work-browser-documents', workspaceId));
  }

  private baselinePath(workspaceId: string, targetId: string): string {
    return path.join(app.getPath('userData'), 'work-browser', 'sync-baselines', encodeURIComponent(workspaceId), `${safeId(targetId)}.json`);
  }

  private async readBaseline(workspaceId: string, targetId: string): Promise<SyncManifestEntry[]> {
    try { return JSON.parse(await fs.readFile(this.baselinePath(workspaceId, targetId), 'utf8')) as SyncManifestEntry[]; }
    catch { return []; }
  }

  private async updateBaseline(workspaceId: string, targetId: string, base: SyncManifestEntry[], source: SyncManifestEntry[], applied: string[], deleted: string[]): Promise<void> {
    const map = new Map(base.map((entry) => [entry.path, entry]));
    const sourceMap = new Map(source.map((entry) => [entry.path, entry]));
    applied.forEach((filePath) => { const entry = sourceMap.get(filePath); if (entry) map.set(filePath, entry); });
    deleted.forEach((filePath) => map.delete(filePath));
    const destination = this.baselinePath(workspaceId, targetId);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await atomicLocalWrite(destination, new TextEncoder().encode(JSON.stringify([...map.values()], null, 2)));
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
async function atomicLocalWrite(destination: string, data: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, destination);
}
async function backupLocal(root: string, paths: string[]): Promise<Map<string, Uint8Array | null>> {
  const backup = new Map<string, Uint8Array | null>();
  for (const relativePath of paths) backup.set(relativePath, await fs.readFile(safeResolve(root, relativePath)).catch(() => null));
  return backup;
}
async function restoreLocal(root: string, backup: Map<string, Uint8Array | null>): Promise<void> {
  for (const [relativePath, data] of backup) {
    const destination = safeResolve(root, relativePath);
    if (data === null) await fs.unlink(destination).catch(() => undefined);
    else await atomicLocalWrite(destination, data);
  }
}
function sha256(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
function required(config: Record<string, string>, key: string): string { if (!config[key]) throw new Error(`SYNC_CONFIG_REQUIRED:${key}`); return config[key]; }
function safeId(value: string): string { return value.replace(/[^a-z0-9._-]/gi, '_').slice(0, 100) || 'default'; }
