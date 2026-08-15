import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodeVisualizerProjectHistory, RepositoryAnalysis } from '../../core/code-visualizer';

const MAX_RECENT_PROJECTS = 12;

function historyFile(): string {
  return path.join(app.getPath('userData'), 'code-visualizer', 'projects.json');
}

async function readEntries(): Promise<CodeVisualizerProjectHistory[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(historyFile(), 'utf8')) as CodeVisualizerProjectHistory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeEntries(entries: CodeVisualizerProjectHistory[]): Promise<void> {
  const target = historyFile();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(entries.slice(0, MAX_RECENT_PROJECTS), null, 2), { encoding: 'utf8', mode: 0o600 });
}

export async function listProjectHistory(): Promise<CodeVisualizerProjectHistory[]> {
  const entries = await readEntries();
  return Promise.all(entries.map(async (entry) => {
    try { return { ...entry, available: (await fs.stat(entry.rootPath)).isDirectory() }; }
    catch { return { ...entry, available: false }; }
  }));
}

export async function recordProjectHistory(result: RepositoryAnalysis): Promise<void> {
  const entries = await readEntries();
  const next: CodeVisualizerProjectHistory = {
    rootPath: result.rootPath,
    name: path.basename(result.rootPath),
    lastScannedAt: result.scannedAt,
    endpointCount: result.endpoints.length,
    pythonFiles: result.pythonFiles,
    vueFiles: result.vueFiles,
    available: true,
  };
  await writeEntries([next, ...entries.filter((entry) => path.resolve(entry.rootPath) !== path.resolve(result.rootPath))]);
}

export async function removeProjectHistory(rootPath: string): Promise<void> {
  const entries = await readEntries();
  await writeEntries(entries.filter((entry) => path.resolve(entry.rootPath) !== path.resolve(rootPath)));
}
