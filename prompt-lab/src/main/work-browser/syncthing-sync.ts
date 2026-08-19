import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyncAdapter, SyncEntry, SyncFile } from '../../core/work-browser/sync';
import { normalizeSyncPath } from '../../core/work-browser/sync';

/**
 * Syncthing integration intentionally writes a normal folder. Syncthing owns
 * transport, discovery and encryption; Work Browser owns safe file layout.
 */
export class SyncthingFolderAdapter implements SyncAdapter {
  readonly kind = 'syncthing' as const;
  private root: string;

  constructor(rootPath: string) {
    this.root = path.resolve(rootPath);
  }

  async list(workspaceId: string): Promise<SyncEntry[]> {
    const workspaceRoot = this.workspaceRoot(workspaceId);
    const entries: SyncEntry[] = [];
    await walk(workspaceRoot, workspaceRoot, entries);
    return entries;
  }

  async get(workspaceId: string, relativePath: string): Promise<SyncFile> {
    const safe = normalizeSyncPath(relativePath);
    const target = this.resolve(workspaceId, safe);
    const [data, stat] = await Promise.all([fs.readFile(target), fs.stat(target)]);
    return { path: safe, data, modifiedAt: stat.mtimeMs };
  }

  async put(workspaceId: string, file: SyncFile): Promise<void> {
    const target = this.resolve(workspaceId, normalizeSyncPath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, file.data);
    await fs.rename(temporary, target);
  }

  async remove(workspaceId: string, relativePath: string): Promise<void> {
    await fs.unlink(this.resolve(workspaceId, normalizeSyncPath(relativePath)));
  }

  private workspaceRoot(workspaceId: string): string {
    return this.resolve(workspaceId, 'manifest.json').replace(/[\\/]manifest\.json$/, '');
  }

  private resolve(workspaceId: string, relativePath: string): string {
    const workspace = encodeURIComponent(workspaceId);
    const target = path.resolve(this.root, workspace, relativePath);
    const boundary = `${path.resolve(this.root, workspace)}${path.sep}`;
    if (!target.startsWith(boundary)) throw new Error('SYNC_PATH_ESCAPE');
    return target;
  }
}

async function walk(root: string, current: string, output: SyncEntry[]): Promise<void> {
  let entries: Array<import('node:fs').Dirent>;
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, full, output);
    else if (entry.isFile()) {
      const stat = await fs.stat(full);
      output.push({ path: path.relative(root, full).replace(/\\/g, '/'), size: stat.size, modifiedAt: stat.mtimeMs });
    }
  }
}
