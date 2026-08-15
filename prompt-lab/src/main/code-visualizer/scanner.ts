import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeRepositoryFiles, diagnoseFrontendBackend, extractFrontendCalls, type RepositoryAnalysis, type RepositorySourceFile } from '../../core/code-visualizer';

const INCLUDED = new Set(['.py', '.vue', '.js', '.jsx', '.ts', '.tsx']);
const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.nuxt', 'coverage']);
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
interface CachedFile extends RepositorySourceFile { mtimeMs: number; size: number }

function cacheFile(rootPath: string): string {
  const key = createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 20);
  return path.join(app.getPath('userData'), 'code-visualizer', 'cache', `${key}.json`);
}

async function readCache(rootPath: string): Promise<Map<string, CachedFile>> {
  try { const entries = JSON.parse(await fs.readFile(cacheFile(rootPath), 'utf8')) as CachedFile[]; return new Map(entries.map((entry) => [entry.path, entry])); }
  catch { return new Map(); }
}

export async function scanCodeRepository(rootPath: string): Promise<RepositoryAnalysis> {
  const startedAt = Date.now();
  const previous = await readCache(rootPath);
  const files: CachedFile[] = [];
  const warnings: string[] = [];
  let changedFiles = 0;
  let reusedFiles = 0;
  await visit(rootPath);
  const seen = new Set(files.map((file) => file.path));
  const removedFiles = [...previous.keys()].filter((file) => !seen.has(file)).length;
  const result = analyzeRepositoryFiles(rootPath, files);
  const frontendCalls = files.flatMap(extractFrontendCalls);
  result.frontendCalls = frontendCalls;
  result.diagnostics = diagnoseFrontendBackend(result, frontendCalls);
  result.scan = { mode: previous.size ? 'incremental' : 'full', changedFiles, reusedFiles, removedFiles, durationMs: Date.now() - startedAt };
  result.warnings.push(...warnings);
  const target = cacheFile(rootPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(files), { encoding: 'utf8', mode: 0o600 });
  return result;

  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_FILES) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink() || EXCLUDED.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(absolute); continue; }
      if (!entry.isFile() || !INCLUDED.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const stat = await fs.stat(absolute);
        const relative = path.relative(rootPath, absolute).replace(/\\/g, '/');
        if (stat.size > MAX_FILE_BYTES) { warnings.push(`已跳过大文件：${relative}`); continue; }
        const cached = previous.get(relative);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) { files.push(cached); reusedFiles += 1; }
        else { files.push({ path: relative, content: await fs.readFile(absolute, 'utf8'), mtimeMs: stat.mtimeMs, size: stat.size }); changedFiles += 1; }
      } catch { warnings.push(`无法读取：${path.relative(rootPath, absolute)}`); }
    }
  }
}
