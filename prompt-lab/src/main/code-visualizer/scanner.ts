import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeArchitectureHealth, analyzeDatabaseQueries, analyzeRepositoryFiles, analyzeSecurity, analyzeTypeScriptFiles, buildFieldLineage, buildSmartInsights, diagnoseFrontendBackend, enrichRepositoryArchitecture, normalizeApiPath, parseArchitectureConfig, type RepositoryAnalysis, type RepositorySourceFile } from '../../core/code-visualizer';
import { load as loadYaml } from 'js-yaml';
import { analyzePythonWithAst } from './python-ast';

const INCLUDED = new Set(['.py', '.vue', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.nuxt', 'coverage', 'vendor', 'target']);
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CACHE_VERSION = 2;
interface CachedFile extends RepositorySourceFile { mtimeMs: number; size: number; hash: string }
interface ScanCache { version: number; files: CachedFile[] }

function cacheFile(rootPath: string): string {
  const key = createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 20);
  return path.join(app.getPath('userData'), 'code-visualizer', 'cache', `${key}.json`);
}

async function readCache(rootPath: string): Promise<Map<string, CachedFile>> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(rootPath), 'utf8')) as ScanCache;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.files)) return new Map();
    return new Map(parsed.files.map((entry) => [entry.path, entry]));
  } catch { return new Map(); }
}

export async function scanCodeRepository(rootPath: string): Promise<RepositoryAnalysis> {
  const startedAt = Date.now();
  const previous = await readCache(rootPath);
  const files: CachedFile[] = [];
  const warnings: string[] = [];
  const ignoreRules = await readIgnoreRules(rootPath);
  let changedFiles = 0; let reusedFiles = 0; let skippedFiles = 0; let complete = true;
  await visit(rootPath);
  const seen = new Set(files.map((file) => file.path));
  const removedFiles = [...previous.keys()].filter((file) => !seen.has(file)).length;
  const result = analyzeRepositoryFiles(rootPath, files);
  const pythonAst = await analyzePythonWithAst(files);
  for (const astEndpoint of pythonAst.endpoints) {
    const endpoint = result.endpoints.find((item) => item.method === astEndpoint.method && item.normalizedPath === normalizeApiPath(astEndpoint.path));
    if (endpoint) { endpoint.location = astEndpoint.location; endpoint.contract = astEndpoint.contract; endpoint.handler = astEndpoint.handler; }
  }
  const semantic = analyzeTypeScriptFiles(files);
  result.frontendCalls = semantic.calls;
  for (const endpoint of result.endpoints) endpoint.frontendCalls = semantic.calls.filter((call) => call.method === endpoint.method && call.normalizedPath === endpoint.normalizedPath);
  result.diagnostics = [...diagnoseFrontendBackend(result, semantic.calls), ...semantic.diagnostics];
  enrichRepositoryArchitecture(result);
  result.architectureConfig = await readArchitectureConfig(rootPath);
  result.architectureHealth = analyzeArchitectureHealth(result, result.architectureConfig);
  result.databaseAnalysis = analyzeDatabaseQueries(result, files);
  result.fieldLineage = buildFieldLineage(result);
  result.security = analyzeSecurity(result, files);
  result.smartInsights = buildSmartInsights(result);
  result.scan = { mode: previous.size ? 'incremental' : 'full', changedFiles, reusedFiles, removedFiles, durationMs: Date.now() - startedAt, complete, skippedFiles, analyzerReports: [pythonAst.report, semantic.report] };
  result.warnings.push(...warnings);
  const target = cacheFile(rootPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify({ version: CACHE_VERSION, files } satisfies ScanCache), { encoding: 'utf8', mode: 0o600 });
  return result;

  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_FILES) { complete = false; return; }
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { warnings.push(`无法读取目录：${path.relative(rootPath, directory) || '.'}`); return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { complete = false; break; }
      if (entry.isSymbolicLink() || EXCLUDED.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootPath, absolute).replace(/\\/g, '/');
      if (isIgnored(relative, entry.isDirectory(), ignoreRules)) { skippedFiles += 1; continue; }
      if (entry.isDirectory()) { await visit(absolute); continue; }
      if (!entry.isFile() || !INCLUDED.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_FILE_BYTES) { warnings.push(`已跳过大文件：${relative}`); skippedFiles += 1; continue; }
        const cached = previous.get(relative);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.hash) { files.push(cached); reusedFiles += 1; continue; }
        const content = await fs.readFile(absolute, 'utf8');
        const hash = createHash('sha256').update(content).digest('hex');
        if (cached?.hash === hash) reusedFiles += 1; else changedFiles += 1;
        files.push({ path: relative, content, mtimeMs: stat.mtimeMs, size: stat.size, hash });
      } catch { warnings.push(`无法读取：${relative}`); skippedFiles += 1; }
    }
  }
}

async function readArchitectureConfig(rootPath: string): Promise<ReturnType<typeof parseArchitectureConfig>> {
  try { return parseArchitectureConfig(loadYaml(await fs.readFile(path.join(rootPath, '.code-map.yml'), 'utf8'))); }
  catch { return parseArchitectureConfig({}); }
}

async function readIgnoreRules(rootPath: string): Promise<string[]> {
  const rules: string[] = [];
  for (const name of ['.gitignore', '.code-visualizerignore']) {
    try { rules.push(...(await fs.readFile(path.join(rootPath, name), 'utf8')).split(/\r?\n/)); } catch { /* optional */ }
  }
  return rules.map((rule) => rule.trim()).filter((rule) => rule && !rule.startsWith('#') && !rule.startsWith('!'));
}

function isIgnored(relativePath: string, directory: boolean, rules: string[]): boolean {
  return rules.some((raw) => {
    const rule = raw.replace(/^\//, '').replace(/\/$/, '');
    if (!rule) return false;
    if (!rule.includes('*')) return relativePath === rule || relativePath.startsWith(`${rule}/`) || relativePath.split('/').includes(rule);
    const escaped = rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::ALL::').replace(/\*/g, '[^/]*').replace(/::ALL::/g, '.*');
    return new RegExp(`(?:^|/)${escaped}${directory ? '(?:/|$)' : '$'}`).test(relativePath);
  });
}
