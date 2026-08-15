import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeRepositoryFiles, type RepositoryAnalysis, type RepositorySourceFile } from '../../core/code-visualizer';

const INCLUDED = new Set(['.py', '.vue', '.js', '.jsx', '.ts', '.tsx']);
const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.nuxt', 'coverage']);
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function scanCodeRepository(rootPath: string): Promise<RepositoryAnalysis> {
  const files: RepositorySourceFile[] = [];
  const warnings: string[] = [];
  await visit(rootPath);
  const result = analyzeRepositoryFiles(rootPath, files);
  result.warnings.push(...warnings);
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
        if (stat.size > MAX_FILE_BYTES) { warnings.push(`已跳过大文件：${path.relative(rootPath, absolute)}`); continue; }
        files.push({ path: path.relative(rootPath, absolute).replace(/\\/g, '/'), content: await fs.readFile(absolute, 'utf8') });
      } catch { warnings.push(`无法读取：${path.relative(rootPath, absolute)}`); }
    }
  }
}
