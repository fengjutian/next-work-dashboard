import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeVisualizerScanSnapshot, RepositoryAnalysis } from '../../core/code-visualizer';

const MAX_SNAPSHOTS = 20;
function directory(rootPath: string): string { return path.join(app.getPath('userData'), 'code-visualizer', 'snapshots', createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 20)); }

export async function saveSnapshot(result: RepositoryAnalysis): Promise<CodeVisualizerScanSnapshot> {
  const id = `${result.scannedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshot: CodeVisualizerScanSnapshot = { id, rootPath: result.rootPath, scannedAt: result.scannedAt, endpointCount: result.endpoints.length, diagnosticCount: result.diagnostics?.length ?? 0, changedFiles: result.scan?.changedFiles ?? result.filesScanned, mode: result.scan?.mode ?? 'full' };
  const dir = directory(result.rootPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
  const items = [snapshot, ...(await listSnapshots(result.rootPath))].slice(0, MAX_SNAPSHOTS);
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(items, null, 2), { encoding: 'utf8', mode: 0o600 });
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json' && !items.some((item) => `${item.id}.json` === name))) await fs.unlink(path.join(dir, file));
  return snapshot;
}

export async function listSnapshots(rootPath: string): Promise<CodeVisualizerScanSnapshot[]> {
  try { const parsed = JSON.parse(await fs.readFile(path.join(directory(rootPath), 'index.json'), 'utf8')) as CodeVisualizerScanSnapshot[]; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

export async function loadSnapshot(rootPath: string, id: string): Promise<RepositoryAnalysis> {
  if (!/^[\w-]+$/.test(id)) throw new Error('非法快照 ID');
  return JSON.parse(await fs.readFile(path.join(directory(rootPath), `${id}.json`), 'utf8')) as RepositoryAnalysis;
}
