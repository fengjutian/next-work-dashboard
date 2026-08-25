import { BrowserWindow, app, ipcMain, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import AutoLaunch from 'electron-auto-launch';
import { fetchSiteFavicon } from './favicon';
import { saveToken, getToken, deleteToken, listServices, clearAll, isEncryptionAvailable } from '../auth/token-store';
import { createSession, write, resize, destroySession } from '../plugins/terminal/backend/terminal-manager';
import { discoverShellProfiles } from '../plugins/terminal/backend/shell-profiles';
import { resolveSecretReferences } from '../plugins/terminal/backend/environment';
import { resolveNewWorkspacePath, resolveWorkspacePath, authorizeWorkspace } from './workspace/path';
import { decodeWorkspaceText, encodeWorkspaceText, fileWasModified } from './workspace/text';
import {
  applyWorkspaceFileMutations,
  applyWorkspaceTextEdits,
  type WorkspaceFileMutation,
  type WorkspaceTextEdit,
} from './workspace/transaction';
import { redactGitSecrets } from './git/security';
import { parseGitLog } from './git/history';
import { classifyGitError } from './git/diagnostics';
import { parseGitBranches } from './git/overview';
import { findSemanticMatches, type SemanticMatch } from './semantic-search';
import { parseWorkspaceTasks, type WorkspaceTaskDefinition } from './workspace/tasks';
import { WorkspaceTaskRunner } from './task-runner';
import { detectRenameRename, parseUnmergedIndex } from './git/rename-conflict';
import { createTypeScriptSemanticIndex } from './typescript-language-service';
import {
  createKnowledgeDocumentFromTemplate,
  captureKnowledgeWorkspaceState,
  readKnowledgeDocument,
  renameKnowledgeDocumentWithBacklinks,
  scanKnowledgeWorkspaceValidated,
  searchKnowledgeWorkspace,
} from './knowledge-workspace';
import {
  clearLanceMemoryIndex,
  replaceLanceMemoryIndex,
  searchLanceMemory,
  type LanceMemoryChunk,
} from './lancedb-memory';
import { mcpManager } from './mcp/mcp-manager';
import { findMediaBinary } from './ai-video-reader/ipc';
import { analyzeStitchFrames, stitchPasses } from '../plugins/video-generation/core/continuity';
import type { McpServerConfig } from '../types/mcp';
import { createAgentWorktree, discardAgentWorktree, getAgentWorktreeStatus, getAgentWorktreeConflictVersions, mergeAgentWorktree, previewAgentWorktreeMerge } from './agent/worktree';
import { agentTaskService } from './agent/task-service';
import { deliverAgentPR, pushAgentBranch, createGitHubPR, registerPRProvider, type PRDeliveryConfig } from './pr-delivery';
import type { AgentTaskConfig } from './agent/task-types';
import { loadPackageScripts, runAgentPackageScript } from './agent/script-runner';
import { registerOfficeIpc } from '../plugins/office-studio/backend/office-ipc';
import { registerRssIpc } from '../plugins/rss-reader/backend/rss-service';
import { setupMyCastIPC, startDaemon as startMyCastDaemon, shutdownDaemon as shutdownMyCastDaemon } from '../plugins/mycast/backend/mycast-service';
import { setupPhoneIPC, stopPhoneService } from '../plugins/phone/backend/phone-service';
import { setupVoiceIPC, startDaemon as startVoiceDaemon, shutdownDaemon as shutdownVoiceDaemon } from '../plugins/voice-input/backend/voice-engine-service';
import {
  activatePluginVersion,
  cancelPluginInstall,
  fetchMarketplaceCatalog,
  ensurePluginResource,
  getPluginResourceRequirement,
  installMarketplacePlugin,
  installCatalogPlugin,
  installPluginPackage,
  listInstalledPlugins,
  loadCachedCatalog,
  loadPluginDefinitions,
  resolveActivePluginPath,
  rollbackPlugin,
  savePluginDefinitions,
  uninstallPluginVersion,
} from './plugin-marketplace';

const WORKSPACE_IGNORED_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]);
const MAX_EDITOR_FILE_SIZE = 5 * 1024 * 1024;
const MAX_READ_ONLY_FILE_SIZE = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

// --- Git operation queue (per-workspace serial + cancellation) ---
const gitQueues = new Map<string, Promise<void>>();
const gitControllers = new Map<string, AbortController>();
const GIT_NETWORK_TIMEOUT_MS = 120_000;
const GIT_LOCAL_TIMEOUT_MS = 30_000;
const networkOps = new Set(['fetch', 'pull', 'push', 'sync']);
const workspaceTaskRunner = new WorkspaceTaskRunner();

function loadWorkspaceTaskDefinitions(root: string): WorkspaceTaskDefinition[] {
  const tasks: WorkspaceTaskDefinition[] = [];
  const packagePath = path.join(root, 'package.json');
  if (fs.existsSync(packagePath)) {
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) tasks.push({ name: `npm: ${name}`, command: `npm run ${name}`, argv: ['npm', 'run', name], detail: command, dependsOn: [], dependsOrder: 'sequence', isBackground: false, problemMatcher: name === 'lint' ? '$eslint-stylish' : undefined });
  }
  const tasksPath = path.join(root, '.vscode', 'tasks.json');
  if (fs.existsSync(tasksPath)) tasks.push(...parseWorkspaceTasks(JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as Parameters<typeof parseWorkspaceTasks>[0]));
  return tasks;
}

function enqueueGitOp(root: string, fn: () => Promise<unknown>): Promise<unknown> {
  const previous = gitQueues.get(root) ?? Promise.resolve();
  let resolveOp!: (v: unknown) => void;
  const promise = new Promise<unknown>((res) => { resolveOp = res; });
  const next = previous
    .then(() => fn(), () => undefined)
    .then(resolveOp, resolveOp);
  gitQueues.set(root, next.then(() => undefined, () => undefined));
  return promise;
}

function cancelGitOp(_root: string, operationId: string): boolean {
  const ctrl = gitControllers.get(operationId);
  if (!ctrl) return false;
  ctrl.abort();
  gitControllers.delete(operationId);
  return true;
}

function validateGitRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.startsWith('-') || !/^[\w./-]+$/.test(ref) || ref.includes('..')) throw new Error('INVALID_GIT_REF');
  return ref;
}

async function runGit(root: string, args: string[], maxBuffer = 10 * 1024 * 1024, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('GIT_CANCELLED');
  const result = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    signal,
  });
  return redactGitSecrets(result.stdout.trim());
}

async function applyGitPatch(root: string, patchText: string): Promise<string> {
  if (!patchText || patchText.length > 5 * 1024 * 1024) throw new Error('INVALID_GIT_PATCH');
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', '--cached', '--unidiff-zero', '-'], {
      cwd: root, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `git apply exited with ${code}`)));
    child.stdin.end(patchText);
  });
}

export function setupIPC(webviewPreloadPath: string) {
  registerOfficeIpc();
  registerRssIpc();
  const outlineProjectsPath = path.join(app.getPath('userData'), 'outline-scaffolder-projects.json');
  ipcMain.handle('outline-projects:load', () => {
    try {
      if (!fs.existsSync(outlineProjectsPath)) return [];
      const parsed = JSON.parse(fs.readFileSync(outlineProjectsPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  ipcMain.handle('outline-projects:save', (_event, projects: unknown) => {
    try {
      if (!Array.isArray(projects) || projects.length > 100) throw new Error('INVALID_PROJECT_HISTORY');
      fs.mkdirSync(path.dirname(outlineProjectsPath), { recursive: true });
      const temporary = `${outlineProjectsPath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(projects.slice(0, 20), null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, outlineProjectsPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('outline-github:pages-status', async (_event, remoteValue: unknown) => {
    try {
      const remote = String(remoteValue ?? '').trim();
      const match = remote.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
      if (!match) throw new Error('仅支持查询 GitHub 仓库');
      const owner = encodeURIComponent(match[1]);
      const repository = encodeURIComponent(match[2].replace(/\.git$/i, ''));
      const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/actions/workflows/pages.yml/runs?per_page=1`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'next-work-dashboard' },
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 404) return { success: false, error: '未找到 Pages workflow，或仓库为私有仓库且需要鉴权' };
      if (!response.ok) throw new Error(`GitHub API ${response.status}`);
      const payload = await response.json() as { workflow_runs?: Array<{ status?: string; conclusion?: string | null; html_url?: string; updated_at?: string; head_branch?: string }> };
      const run = payload.workflow_runs?.[0];
      if (!run) return { success: true, data: { state: 'not_run' } };
      return { success: true, data: { state: run.status || 'unknown', conclusion: run.conclusion ?? undefined, url: run.html_url, updatedAt: run.updated_at, branch: run.head_branch } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('outline-secrets:load', (_event, kind: unknown) => {
    const name = kind === 'review' ? 'outline-scaffolder-review' : kind === 'minimax' ? 'outline-scaffolder-minimax' : '';
    if (!name) return { success: false, error: 'INVALID_SECRET_KIND' };
    if (!isEncryptionAvailable()) return { success: false, error: '系统安全存储不可用，API Key 未从磁盘读取' };
    return { success: true, value: getToken(name) ?? '' };
  });
  ipcMain.handle('outline-secrets:save', (_event, kind: unknown, value: unknown) => {
    const name = kind === 'review' ? 'outline-scaffolder-review' : kind === 'minimax' ? 'outline-scaffolder-minimax' : '';
    if (!name) return { success: false, error: 'INVALID_SECRET_KIND' };
    if (!isEncryptionAvailable()) return { success: false, error: '系统安全存储不可用，无法安全保存 API Key' };
    const token = String(value ?? '').trim();
    if (!token) return { success: deleteToken(name) };
    return saveToken(name, token, '章节文档生成器') ? { success: true } : { success: false, error: 'API Key 加密保存失败' };
  });
  ipcMain.handle('outline-research:search', async (_event, rawQueries: unknown) => {
    const queries = Array.isArray(rawQueries) ? rawQueries.map((item) => String(item).trim().slice(0, 120)).filter(Boolean).slice(0, 3) : [];
    if (!queries.length) return { results: [], providers: [] };
    const results: Array<{ title: string; url: string; snippet: string; domain: string; source: string }> = [];
    const providers: Array<{ providerId: string; ok: boolean; count: number; error: string | null }> = [];
    const stripHtml = (value: unknown) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const searchMediaWiki = async (host: 'zh.wikipedia.org' | 'zh.wikisource.org', source: string) => {
      let count = 0;
      for (const query of queries) {
        const url = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`;
        const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'next-work-dashboard/1.0 historical-research' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
        for (const item of data.query?.search ?? []) {
          const title = String(item.title || '').trim();
          if (!title) continue;
          results.push({ title, url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, snippet: stripHtml(item.snippet), domain: host, source });
          count += 1;
        }
      }
      providers.push({ providerId: source, ok: true, count, error: null });
    };
    const searchOpenAlex = async () => {
      let count = 0;
      for (const query of queries) {
        const response = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'next-work-dashboard/1.0 historical-research' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { results?: Array<{ display_name?: string; publication_year?: number; doi?: string; id?: string; type?: string; authorships?: Array<{ author?: { display_name?: string } }> }> };
        for (const item of data.results ?? []) {
          const title = String(item.display_name || '').trim();
          const url = String(item.doi || item.id || '').trim();
          if (!title || !/^https?:\/\//i.test(url)) continue;
          const authors = (item.authorships ?? []).slice(0, 3).map((entry) => entry.author?.display_name).filter(Boolean).join('、');
          results.push({ title, url, snippet: [authors, item.publication_year, item.type].filter(Boolean).join(' · '), domain: new URL(url).hostname, source: 'openalex' });
          count += 1;
        }
      }
      providers.push({ providerId: 'openalex', ok: true, count, error: null });
    };
    const searchCrossref = async () => {
      let count = 0;
      for (const query of queries) {
        const response = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query.replace(/\s+site:\S+|\s+OR\s+/gi, ' '))}&rows=5&select=DOI,title,author,published,type,URL,publisher`, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'next-work-dashboard/1.0 (mailto:support@localhost)' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { message?: { items?: Array<{ DOI?: string; title?: string[]; author?: Array<{ given?: string; family?: string }>; published?: { 'date-parts'?: number[][] }; type?: string; URL?: string; publisher?: string }> } };
        for (const item of data.message?.items ?? []) {
          const title = String(item.title?.[0] || '').trim();
          const url = String(item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : '')).trim();
          if (!title || !/^https?:\/\//i.test(url)) continue;
          const authors = (item.author ?? []).slice(0, 3).map((author) => [author.family, author.given].filter(Boolean).join(' ')).filter(Boolean).join('、');
          const year = item.published?.['date-parts']?.[0]?.[0];
          results.push({ title, url, snippet: [authors, year, item.publisher, item.type].filter(Boolean).join(' · '), domain: new URL(url).hostname, source: 'crossref' });
          count += 1;
        }
      }
      providers.push({ providerId: 'crossref', ok: true, count, error: null });
    };
    const tasks = [
      ['wikisource', () => searchMediaWiki('zh.wikisource.org', 'wikisource')],
      ['wikipedia', () => searchMediaWiki('zh.wikipedia.org', 'wikipedia')],
      ['openalex', searchOpenAlex],
      ['crossref', searchCrossref],
    ] as const;
    await Promise.all(tasks.map(async ([id, run]) => {
      try { await run(); } catch (error) { providers.push({ providerId: id, ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }); }
    }));
    return { results, providers };
  });
  ipcMain.handle('plugins:definitions:load', () => loadPluginDefinitions());
  ipcMain.handle('plugins:definitions:save', (_event, definitions: unknown[]) => savePluginDefinitions(definitions));
  ipcMain.handle('plugins:marketplace:cached', () => loadCachedCatalog());
  ipcMain.handle('plugins:marketplace:fetch', (_event, url: string) => fetchMarketplaceCatalog(url));
  ipcMain.handle('plugins:marketplace:install', (_event, entry) => installMarketplacePlugin(entry));
  ipcMain.handle('plugins:packages:install', (event, request) => installPluginPackage(request, (progress) => event.sender.send('plugins:packages:progress', progress)));
  ipcMain.handle('plugins:packages:install-catalog', (event, id: string, version: string, activate?: boolean) => installCatalogPlugin(id, version, activate, (progress) => event.sender.send('plugins:packages:progress', progress)));
  ipcMain.handle('plugins:packages:list', () => listInstalledPlugins());
  ipcMain.handle('plugins:packages:activate', (_event, id: string, version: string) => activatePluginVersion(id, version));
  ipcMain.handle('plugins:packages:rollback', (_event, id: string) => rollbackPlugin(id));
  ipcMain.handle('plugins:packages:uninstall', (_event, id: string, version: string) => uninstallPluginVersion(id, version));
  ipcMain.handle('plugins:packages:resolve', (_event, id: string, relativePath?: string) => resolveActivePluginPath(id, relativePath));
  ipcMain.handle('plugins:packages:cancel', (_event, id: string, version: string) => cancelPluginInstall(id, version));
  ipcMain.handle('plugins:packages:requirement', (_event, id: string) => getPluginResourceRequirement(id));
  ipcMain.handle('plugins:packages:ensure', (event, id: string) => ensurePluginResource(id, (progress) => event.sender.send('plugins:packages:progress', progress)));
  const workspaceWatchers = new Map<number, fs.FSWatcher>();
  const dialogAuthorizedFiles = new Set<string>();

  const configureWindow = (win: BrowserWindow) => {
    const webContentsId = win.webContents.id;
    win.webContents.on('context-menu', (_event, params) => {
      Menu.buildFromTemplate([
        {
          label: '注入选中提示词',
          enabled: !!params,
          click: () => win.webContents.send('inject-from-context-menu'),
        },
        { type: 'separator' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
      ]).popup();
    });
    win.webContents.once('destroyed', () => {
      workspaceWatchers.get(webContentsId)?.close();
      workspaceWatchers.delete(webContentsId);
    });
  };

  BrowserWindow.getAllWindows().forEach(configureWindow);
  app.on('browser-window-created', (_event, win) => configureWindow(win));

  // 暴露 webview preload 路径给渲染进程
  ipcMain.handle('get-webview-preload-path', () => {
    return webviewPreloadPath;
  });

  // ── 提示词注入 ──
  ipcMain.handle('inject-prompt', async (event, payload: {
    webviewId: number;
    text: string;
    inputSelector: string;
    submitSelector?: string;
    autoSubmit: boolean;
  }) => {
    const webview = event.sender;
    if (!webview) return { success: false, error: 'NO_WINDOW' };

    try {
      await webview.executeJavaScript(`
        (function() {
          const input = document.querySelector('${payload.inputSelector}');
          if (!input) return { success: false, error: 'INPUT_NOT_FOUND' };

          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          )?.set;

          if (nativeSetter) {
            nativeSetter.call(input, ${JSON.stringify(payload.text)});
          } else {
            input.value = ${JSON.stringify(payload.text)};
          }

          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          ${
            payload.autoSubmit && payload.submitSelector
              ? `const btn = document.querySelector('${payload.submitSelector}');
                 btn?.click();`
              : ''
          }

          return { success: true };
        })();
      `);

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 窗口控制 ──
  ipcMain.handle('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle('window-is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
  ipcMain.handle('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window-hide', (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle('window-show', (event) => { const win = BrowserWindow.fromWebContents(event.sender); win?.show(); win?.focus(); });

  // ── 窗口置顶 ──
  ipcMain.handle('window-toggle-always-on-top', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const ontop = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(ontop);
    return ontop;
  });

  // ── 开机启动 ──
  const autoLauncher = new AutoLaunch({ name: 'next-work-dashboard' });
  ipcMain.handle('auto-launch-get', async () => {
    try { return await autoLauncher.isEnabled(); } catch { return false; }
  });
  ipcMain.handle('auto-launch-set', async (_e, enabled: boolean) => {
    if (enabled) await autoLauncher.enable();
    else await autoLauncher.disable();
    return enabled;
  });

  // ── 数据持久化路径 ──
  const dataPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  const dbPath = path.join(app.getPath('userData'), 'next-work-dashboard.db');
  const documentCacheDir = path.join(app.getPath('userData'), 'document-cache');
  const exportDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'conversations');

  // ── favicon ──
  ipcMain.handle('fetch-favicon', async (_event, siteUrl: string) => {
    return await fetchSiteFavicon(siteUrl);
  });

  ipcMain.handle('llm:chat', async (_event, payload: { baseUrl: string; apiKey: string; body: Record<string, unknown> }) => {
    try {
      const baseUrl = String(payload.baseUrl || '').replace(/\/+$/, '');
      const base = new URL(baseUrl);
      const isMiniMaxM3 = String(payload.body?.model || '').toLowerCase() === 'minimax-m3'
        && (base.hostname === 'api.minimaxi.com' || base.hostname === 'api.minimax.io');
      const url = new URL(isMiniMaxM3 ? `${base.origin}/v1/text/chatcompletion_v2` : `${baseUrl}/chat/completions`);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const blockedHost = hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname === '0.0.0.0'
        || hostname === '::'
        || hostname === '::1'
        || hostname.startsWith('fc')
        || hostname.startsWith('fd')
        || hostname.startsWith('fe80:')
        || /^127\./.test(hostname)
        || /^10\./.test(hostname)
        || /^169\.254\./.test(hostname)
        || /^192\.168\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
      if (url.protocol !== 'https:' || !hostname || url.username || url.password || blockedHost) {
        return { ok: false, status: 400, error: `UNSUPPORTED_LLM_PROXY_HOST: ${hostname || 'invalid host'}（仅允许公网 HTTPS 地址）` };
      }
      const apiKey = String(payload.apiKey ?? '').trim();
      if (!apiKey) return { ok: false, status: 401, error: 'MISSING_API_KEY' };
      if (!/^[\x21-\x7E]+$/.test(apiKey)) return { ok: false, status: 400, error: 'INVALID_API_KEY_FORMAT: API Key 只能包含 ASCII 字符，请勿填写中文说明、空格或占位文字' };
      const body = { ...payload.body, stream: false, ...(isMiniMaxM3 ? { max_tokens: 32_768 } : {}) };
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 300_000);
      try {
        const retryDelays = [0, 2_000, 5_000, 10_000];
        for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
          if (retryDelays[attempt] > 0) await new Promise<void>((resolve) => setTimeout(resolve, retryDelays[attempt]));
          const response = await fetch(url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
          const text = await response.text();
          let data: unknown;
          try { data = text ? JSON.parse(text) : {}; } catch { data = undefined; }
          if (response.ok) {
            const miniMaxData = data as { base_resp?: { status_code?: number; status_msg?: string }; choices?: Array<{ finish_reason?: string; message?: { content?: unknown; reasoning_content?: unknown; reasoning_details?: Array<{ text?: string }> } }>; output_sensitive?: boolean } | undefined;
            const businessCode = Number(miniMaxData?.base_resp?.status_code || 0);
            if (businessCode !== 0) return { ok: false, status: 400, error: `MiniMax 业务错误 ${businessCode}: ${miniMaxData?.base_resp?.status_msg || '请求未成功'}` };
            const choice = miniMaxData?.choices?.[0];
            const content = choice?.message?.content;
            const hasContent = Array.isArray(content) ? content.length > 0 : String(content ?? '').trim().length > 0;
            if (isMiniMaxM3 && !hasContent) {
              const reasoningLength = String(choice?.message?.reasoning_content ?? '').length
                + (choice?.message?.reasoning_details ?? []).reduce((sum, item) => sum + String(item.text ?? '').length, 0);
              const detail = miniMaxData?.output_sensitive
                ? '输出触发内容安全策略'
                : choice?.finish_reason === 'length'
                  ? '推理过程耗尽了输出额度'
                  : `响应正文为空${reasoningLength ? `（已产生 ${reasoningLength} 字符推理内容）` : ''}`;
              return { ok: false, status: 422, error: `MiniMax-M3 未返回最终正文：${detail}。请缩短待审校文章或改用 MiniMax-M2.7。` };
            }
            return { ok: true, status: response.status, data };
          }
          const retryable = response.status === 429 || response.status === 529 || (response.status >= 500 && response.status <= 599);
          if (!retryable || attempt === retryDelays.length - 1) {
            const suffix = retryable ? `\n已自动重试 ${attempt} 次，服务仍然繁忙。` : '';
            return { ok: false, status: response.status, error: `${text.slice(0, 1000)}${suffix}` };
          }
        }
        return { ok: false, status: 503, error: '模型服务暂时不可用' };
      } catch (error) {
        if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
          return { ok: false, status: 408, error: '模型生成超过 5 分钟，请缩短输入或更换响应更快的模型' };
        }
        throw error;
      } finally { clearTimeout(timeout); }
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('image:generate', async (_event, payload: import('../plugins/style-image/types').StyleImageRequest) => {
    try {
      const baseUrl = String(payload.baseUrl || '').replace(/\/+$/, '');
      const apiKey = String(payload.apiKey || '').trim();
      const model = String(payload.model || '').trim();
      const prompt = String(payload.prompt || '').trim().slice(0, 8000);
      if (payload.provider === 'minimax') {
        if (!apiKey || !model || !prompt) return { success: false, error: '请填写 MiniMax API Key、模型和提示词' };
        if (!/^[\x21-\x7E]+$/.test(apiKey)) return { success: false, error: 'API Key 格式无效：只能包含 ASCII 字符，请勿填写中文说明、空格或占位文字' };
        const allowedModels = new Set(['image-01', 'image-01-live']);
        const allowedRatios = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
        if (!allowedModels.has(model)) return { success: false, error: '不支持的 MiniMax 图像模型' };
        const aspectRatio = allowedRatios.has(String(payload.aspectRatio)) ? String(payload.aspectRatio) : '1:1';
        if (model === 'image-01-live' && aspectRatio === '21:9') return { success: false, error: 'image-01-live 不支持 21:9 画幅' };
        const referenceUrl = String(payload.image?.url || '').trim();
        if (referenceUrl && !/^https:\/\//i.test(referenceUrl)) return { success: false, error: 'MiniMax 参考图必须是可公网访问的 HTTPS 图片链接' };
        const seed = Number.isSafeInteger(payload.seed) && Number(payload.seed) >= 0 ? Number(payload.seed) : undefined;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600_000);
        try {
          const miniMaxHost = (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
          const endpoint = miniMaxHost === 'api.minimaxi.com' ? 'https://api.minimaxi.com/v1/image_generation' : 'https://api.minimax.io/v1/image_generation';
          const response = await fetch(endpoint, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              prompt: prompt.slice(0, 1500),
              aspect_ratio: aspectRatio,
              response_format: 'base64',
              n: 1,
              prompt_optimizer: payload.promptOptimizer === true,
              aigc_watermark: payload.aigcWatermark === true,
              ...(seed === undefined ? {} : { seed }),
              ...(referenceUrl ? { subject_reference: [{ type: 'character', image_file: referenceUrl }] } : {}),
            }),
          });
          const text = await response.text();
          let data: {
            id?: string;
            data?: {
              image_base64?: string[] | string;
              image_urls?: string[] | string;
              images?: Array<{ image_base64?: string; image_url?: string; url?: string }>;
            };
            metadata?: { failed_count?: number | string; success_count?: number | string };
            base_resp?: { status_code?: number | string; status_msg?: string };
            error?: { code?: number | string; message?: string } | string;
          } | null;
          try { data = JSON.parse(text) as typeof data; } catch { data = null; }
          const statusCode = Number(data?.base_resp?.status_code ?? 0);
          const serviceError = typeof data?.error === 'string' ? data.error : data?.error?.message;
          if (!response.ok || (Number.isFinite(statusCode) && statusCode !== 0)) {
            const message = data?.base_resp?.status_msg || serviceError || text.slice(0, 1000) || `MiniMax 返回 HTTP ${response.status}`;
            return { success: false, error: `MiniMax 图片生成失败${statusCode ? `（错误码 ${statusCode}）` : ''}：${message}` };
          }
          const base64Result = data?.data?.image_base64;
          const encoded = (Array.isArray(base64Result) ? base64Result[0] : base64Result)
            || data?.data?.images?.[0]?.image_base64;
          if (encoded) return { success: true, imageDataUrl: `data:image/jpeg;base64,${encoded}` };
          const urlResult = data?.data?.image_urls;
          const imageUrl = (Array.isArray(urlResult) ? urlResult[0] : urlResult)
            || data?.data?.images?.[0]?.image_url
            || data?.data?.images?.[0]?.url;
          if (imageUrl) {
            const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
            if (!imageResponse.ok) return { success: false, error: '图片已生成，但下载 MiniMax 临时结果失败' };
            const mime = imageResponse.headers.get('content-type') || 'image/jpeg';
            return { success: true, imageDataUrl: `data:${mime};base64,${Buffer.from(await imageResponse.arrayBuffer()).toString('base64')}` };
          }
          const failedCount = Number(data?.metadata?.failed_count ?? 0);
          const successCount = Number(data?.metadata?.success_count ?? 0);
          const details = [
            data?.base_resp?.status_msg && data.base_resp.status_msg !== 'success' ? data.base_resp.status_msg : '',
            failedCount > 0 ? `失败 ${failedCount} 张` : '',
            Number.isFinite(successCount) ? `成功 ${successCount} 张` : '',
            data?.id ? `任务 ID：${data.id}` : '',
          ].filter(Boolean).join('；');
          return {
            success: false,
            error: `MiniMax 请求已完成，但没有返回可用图片${details ? `（${details}）` : ''}。可能被内容安全策略拦截；请调整提示词后重试，若持续失败再检查套餐额度与 image-01 权限。`,
          };
        } finally { clearTimeout(timeout); }
      }
      if (!/^https:\/\//i.test(baseUrl) || !apiKey || !model || !prompt) return { success: false, error: '图片服务配置或提示词不完整' };
      const endpoint = `${baseUrl}/images/${payload.image ? 'edits' : 'generations'}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600_000);
      let response: Response;
      try {
        if (payload.image) {
          const bytes = Buffer.from(payload.image.dataBase64, 'base64');
          if (bytes.byteLength > 20 * 1024 * 1024) return { success: false, error: '参考图片不能超过 20 MB' };
          const form = new FormData();
          form.append('model', model); form.append('prompt', prompt); form.append('size', String(payload.size || '1024x1024')); form.append('quality', String(payload.quality || 'medium'));
          form.append('image', new Blob([bytes], { type: payload.image.mimeType || 'image/png' }), payload.image.name || 'reference.png');
          response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}` }, body: form });
        } else {
          response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, prompt, size: payload.size || '1024x1024', quality: payload.quality || 'medium', n: 1 }) });
        }
      } finally { clearTimeout(timeout); }
      const text = await response.text();
      let data: { error?: { message?: string }; data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> } | null;
      try { data = JSON.parse(text) as typeof data; } catch { data = null; }
      if (!response.ok) return { success: false, error: data?.error?.message || text.slice(0, 1000) || `图片服务返回 ${response.status}` };
      const item = data?.data?.[0];
      if (item?.b64_json) return { success: true, imageDataUrl: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt };
      if (item?.url) {
        const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
        if (!imageResponse.ok) return { success: false, error: '图片已生成，但下载结果失败' };
        const mime = imageResponse.headers.get('content-type') || 'image/png';
        const encoded = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        return { success: true, imageDataUrl: `data:${mime};base64,${encoded}`, revisedPrompt: item.revised_prompt };
      }
      return { success: false, error: '图片服务未返回可识别的结果' };
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? '图片生成超时（10 分钟）' : (error instanceof Error ? error.message : String(error));
      return { success: false, error: message };
    }
  });

  // ── Video Generation (MiniMax-H3) ──────────────────────────────
  // 异步三段式：submit → poll → download。下载后的 MP4 落到 userData/video-generation/，
  // 元数据走 SQLite（避免 50MB+ 视频塞进 BLOB）。Renderer 按需拉 blob 播放。
  const videoGenDir = path.join(app.getPath('userData'), 'video-generation');
  fs.mkdirSync(videoGenDir, { recursive: true });

  const runVideoFfmpeg = (args: string[]): Promise<void> => new Promise((resolve, reject) => {
    const binary = findMediaBinary('ffmpeg');
    if (!binary) { reject(new Error('未找到 FFmpeg，请先在 AI 视频阅读器设置中配置')); return; }
    execFile(binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`FFmpeg 执行失败：${String(stderr || error.message).slice(-1000)}`));
      else resolve();
    });
  });

  const runVideoBinaryBuffer = (binary: string, args: string[]): Promise<Buffer> => new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(-1000)));
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });

  interface VideoProbeInfo { width: number; height: number; fps: number; duration: number; hasAudio: boolean }
  const probeVideo = async (filePath: string): Promise<VideoProbeInfo> => {
    const binary = findMediaBinary('ffprobe');
    if (!binary) throw new Error('未找到 FFprobe，请确认它与 FFmpeg 位于同一目录');
    const output = await runVideoBinaryBuffer(binary, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath]);
    const parsed = JSON.parse(output.toString('utf8')) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }>; format?: { duration?: string } };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    if (!video?.width || !video.height) throw new Error('FFprobe 未检测到有效视频流');
    const rate = video.avg_frame_rate || video.r_frame_rate || '25/1';
    const [numerator, denominator] = rate.split('/').map(Number);
    return { width: video.width, height: video.height, fps: denominator ? numerator / denominator : numerator || 25,
      duration: Number(video.duration || parsed.format?.duration || 0), hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === 'audio')) };
  };

  const resolveManagedVideo = (value: unknown): string | null => {
    const resolved = path.resolve(String(value || ''));
    const root = path.resolve(videoGenDir) + path.sep;
    return resolved.startsWith(root) && fs.existsSync(resolved) ? resolved : null;
  };

  const readVideoAsBlob = async (filePath: string): Promise<{ success: boolean; bytes?: number; mimeType?: string; data?: ArrayBuffer; error?: string }> => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '视频文件不存在或已被删除' };
      const stat = fs.statSync(filePath);
      if (stat.size > 200 * 1024 * 1024) return { success: false, error: `视频文件 ${(stat.size / 1024 / 1024).toFixed(1)} MB 超过 200 MB 单次读取上限` };
      const buffer = fs.readFileSync(filePath);
      const mimeType = filePath.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
      // 转成 ArrayBuffer（IPC structured clone 友好）
      return { success: true, bytes: stat.size, mimeType, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle('video-generation:create', async (_event, payload: import('../plugins/video-generation/types').VideoGenerationRequest) => {
    try {
      const apiModule = await import('../plugins/video-generation/core/api');
      const normalized = apiModule.normalizeRequest(payload);
      if (normalized.ok !== true) {
        return { success: false, error: normalized.error };
      }
      const api = normalized.value;
      const { buildCreateRequest, parseSubmitResponse } = apiModule;
      const { endpoint, init } = buildCreateRequest(api);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      let response: Response;
      try {
        response = await fetch(endpoint, { ...init, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      const text = await response.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* keep null */ }
      if (!response.ok) return { success: false, error: apiModule.formatMiniMaxHttpError(response.status, data, text) };
      const submit = parseSubmitResponse(data);
      if (!submit.success || !submit.taskId) return { success: false, error: submit.error, baseResp: submit.baseResp };
      return { success: true, taskId: submit.taskId, baseResp: submit.baseResp };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '提交视频生成任务超时（1 分钟）' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:query', async (_event, payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => {
    try {
      const apiKey = String(payload?.apiKey || '').trim();
      const taskId = String(payload?.taskId || '').trim();
      const baseUrl = String(payload?.baseUrl || 'https://api.minimaxi.com').replace(/\/+$/, '');
      if (!apiKey) return { success: false, error: '请填写 MiniMax API Key' };
      if (!taskId) return { success: false, error: 'taskId 不能为空' };
      const apiModule = await import('../plugins/video-generation/core/api');
      const { endpoint, init } = apiModule.buildQueryRequest(baseUrl, apiKey, taskId, payload.model);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(endpoint, { ...init, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      const text = await response.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* keep null */ }
      if (!response.ok) return { success: false, error: apiModule.formatMiniMaxHttpError(response.status, data, text) };
      const info = apiModule.parseTaskResponse(data, taskId);
      if (info.status === 'succeeded' && !info.videoUrl && info.fileId) {
        const fileRequest = apiModule.buildFileRetrieveRequest(baseUrl, apiKey, info.fileId);
        const fileResponse = await fetch(fileRequest.endpoint, fileRequest.init);
        const fileText = await fileResponse.text();
        let fileData: unknown = null;
        try { fileData = JSON.parse(fileText); } catch { /* keep null */ }
        if (!fileResponse.ok) return { success: false, error: apiModule.formatMiniMaxHttpError(fileResponse.status, fileData, fileText) };
        const retrieved = apiModule.parseFileRetrieveResponse(fileData);
        if (!retrieved.videoUrl) return { success: false, error: retrieved.error || '无法获取视频下载地址' };
        info.videoUrl = retrieved.videoUrl;
      }
      return { success: true, info };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '查询任务超时（30 秒）' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  // 取消 / 删除上游任务（DELETE /v2/video_generation/{task_id}）。
  // MiniMax 文档：取消排队中的任务，或删除成功和失败的任务记录。
  // 终态已 succeed / failed / cancelled 的任务也会被服务端清理记录。
  ipcMain.handle('video-generation:cancel', async (_event, payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => {
    try {
      const apiKey = String(payload?.apiKey || '').trim();
      const taskId = String(payload?.taskId || '').trim();
      const baseUrl = String(payload?.baseUrl || 'https://api.minimaxi.com').replace(/\/+$/, '');
      if (!apiKey) return { success: false, error: '请填写 MiniMax API Key' };
      if (!taskId) return { success: false, error: 'taskId 不能为空' };
      const { buildCancelRequest, usesH3Protocol } = await import('../plugins/video-generation/core/api');
      if (!usesH3Protocol(payload.model)) {
        return { success: true, baseResp: { statusCode: 0, statusMsg: 'Hailuo v1 不支持取消上游任务，已停止本地轮询' } };
      }
      const { endpoint, init } = buildCancelRequest(baseUrl, apiKey, taskId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(endpoint, { ...init, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      const text = await response.text();
      let data: { base_resp?: { status_code?: number; status_msg?: string } } | null = null;
      try { data = JSON.parse(text); } catch { /* keep null */ }
      if (!response.ok) return { success: false, error: `取消任务失败（HTTP ${response.status}）：${text.slice(0, 300)}` };
      const statusCode = data?.base_resp?.status_code;
      if (statusCode && statusCode !== 0) {
        return { success: false, baseResp: { statusCode, statusMsg: data?.base_resp?.status_msg }, error: data?.base_resp?.status_msg || `MiniMax 返回 status_code=${statusCode}` };
      }
      return { success: true, baseResp: { statusCode: 0, statusMsg: data?.base_resp?.status_msg } };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '取消任务超时（30 秒）' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:download', async (_event, payload: { taskId: string; videoUrl: string; recordId: string }) => {
    try {
      const videoUrl = String(payload?.videoUrl || '').trim();
      const recordId = String(payload?.recordId || '').trim();
      if (!/^https?:\/\//i.test(videoUrl)) return { success: false, error: '成片地址必须是 http(s) URL' };
      if (!recordId) return { success: false, error: 'recordId 不能为空' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300_000);
      let response: Response;
      try {
        response = await fetch(videoUrl, { signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) return { success: false, error: `下载成片失败（HTTP ${response.status}）` };
      const arrayBuffer = await response.arrayBuffer();
      const bytes = arrayBuffer.byteLength;
      if (bytes === 0) return { success: false, error: '成片内容为空' };
      if (bytes > 500 * 1024 * 1024) return { success: false, error: `成片 ${(bytes / 1024 / 1024).toFixed(1)} MB 超过 500 MB 存储上限` };
      const ext = (response.headers.get('content-type') || '').includes('webm') ? 'webm' : 'mp4';
      const safeName = `${recordId}.${ext}`;
      const filePath = path.join(videoGenDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath, fileName: safeName, bytes, mimeType: ext === 'webm' ? 'video/webm' : 'video/mp4' };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '下载成片超时（5 分钟）' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  // 把用户选的本地图传到 litterbox.catbox.moe（免认证，1 小时 TTL，专为短时分享设计），
  // 拿到 HTTPS URL 后再喂给 MiniMax 视频生成 API。MiniMax 端要求素材必须 https 可公网访问。
  const LITTERBOX_ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php';
  const ALLOWED_REFERENCE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'audio/wav', 'audio/mpeg', 'audio/x-wav']);
  const ALLOWED_REFERENCE_EXT = /\.(png|jpe?g|webp|heic|heif|mp4|mov|wav|mp3)$/i;

  ipcMain.handle('video-generation:upload-reference', async (_event, payload: { name: string; mimeType: string; data: ArrayBuffer; ttlHours?: number }) => {
    try {
      const name = String(payload?.name || 'reference').slice(0, 120);
      const mimeType = String(payload?.mimeType || '').toLowerCase();
      if (!ALLOWED_REFERENCE_MIME.has(mimeType)) {
        return { success: false, error: `不支持的素材类型：${mimeType || '未知'}。MiniMax 仅接收 PNG/JPEG/WEBP/HEIC 图片与 MP4/MOV 视频、WAV/MP3 音频。` };
      }
      if (!ALLOWED_REFERENCE_EXT.test(name)) {
        return { success: false, error: '文件扩展名需为 png/jpg/jpeg/webp/heic/heif/mp4/mov/wav/mp3 之一' };
      }
      const data = payload?.data;
      if (!(data instanceof ArrayBuffer)) return { success: false, error: '素材数据缺失' };
      const bytes = Buffer.from(data);
      const imageMax = 30 * 1024 * 1024;
      const videoMax = 50 * 1024 * 1024;
      const audioMax = 15 * 1024 * 1024;
      const isImage = mimeType.startsWith('image/');
      const isVideo = mimeType.startsWith('video/');
      const isAudio = mimeType.startsWith('audio/');
      const cap = isImage ? imageMax : isVideo ? videoMax : isAudio ? audioMax : 0;
      if (!cap) return { success: false, error: '无法识别的素材类别' };
      if (bytes.byteLength === 0) return { success: false, error: '文件为空' };
      if (bytes.byteLength > cap) return { success: false, error: `${name} 超过 ${(cap / 1024 / 1024).toFixed(0)} MB 上限（当前 ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB）` };

      const ttlHours = Math.max(1, Math.min(72, Number(payload?.ttlHours) || 1));
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('time', `${ttlHours}h`);
      form.append('fileToUpload', new Blob([bytes], { type: mimeType }), name);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let response: Response;
      try {
        response = await fetch(LITTERBOX_ENDPOINT, { method: 'POST', body: form, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      const text = (await response.text()).trim();
      if (!response.ok) return { success: false, error: `litterbox 上传失败（HTTP ${response.status}）：${text.slice(0, 300)}` };
      if (!/^https:\/\/litterbox\.catbox\.moe\//.test(text)) {
        return { success: false, error: `litterbox 返回非预期内容：${text.slice(0, 300)}` };
      }
      return { success: true, url: text, ttlHours, bytes: bytes.byteLength };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '上传参考素材超时（2 分钟）' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:read-blob', async (_event, filePath: string) => {
    return readVideoAsBlob(String(filePath || ''));
  });

  ipcMain.handle('video-generation:reveal', async (_event, filePath: string) => {
    try {
      const target = String(filePath || '');
      if (!target || !fs.existsSync(target)) return { success: false, error: '视频文件不存在' };
      shell.showItemInFolder(target);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('video-generation:open-folder', async () => {
    try { shell.openPath(videoGenDir); return { success: true, path: videoGenDir }; }
    catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('video-generation:cleanup', async (_event, filePath: string) => {
    try {
      const target = String(filePath || '');
      if (!target) return { success: false, error: 'filePath 不能为空' };
      // 安全护栏：只允许删除 userData/video-generation 下的文件
      const resolved = path.resolve(target);
      const allowedRoot = path.resolve(videoGenDir) + path.sep;
      if (!resolved.startsWith(allowedRoot)) return { success: false, error: '禁止删除插件管理目录之外的文件' };
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('embedding:create', async (_event, payload: {
    baseUrl: string; apiKey: string; model: string; inputs: string[];
  }) => {
    try {
      const baseUrl = String(payload.baseUrl || '').replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(baseUrl)) return { success: false, error: 'INVALID_BASE_URL' };
      const inputs = Array.isArray(payload.inputs)
        ? payload.inputs.slice(0, 64).map((input) => String(input).slice(0, 12000))
        : [];
      if (!inputs.length || !payload.model) return { success: false, error: 'INVALID_REQUEST' };
      let response: Response | null = null;
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          response = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.apiKey}` },
            body: JSON.stringify({ model: payload.model, input: inputs }),
          });
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        } finally { clearTimeout(timeout); }
        if (!response) {
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        if (response.ok || (response.status !== 429 && response.status < 500)) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
      if (!response) return { success: false, error: lastError || 'NO_RESPONSE' };
      if (!response.ok) return { success: false, error: `HTTP_${response.status}: ${(await response.text()).slice(0, 300)}` };
      const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
      const ordered = [...(body.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (ordered.length !== inputs.length || ordered.some((embedding) => !Array.isArray(embedding))) {
        return { success: false, error: 'INVALID_EMBEDDING_RESPONSE' };
      }
      return { success: true, embeddings: ordered };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('memory:index:replace', async (_event, chunks: LanceMemoryChunk[]) => {
    if (!Array.isArray(chunks) || chunks.some((chunk) => !chunk.id || !Array.isArray(chunk.vector))) {
      throw new Error('Invalid LanceDB memory index payload');
    }
    await replaceLanceMemoryIndex(chunks);
  });
  ipcMain.handle('memory:index:search', async (_event, vector: number[], limit: number) => {
    if (!Array.isArray(vector) || vector.some((value) => !Number.isFinite(value))) {
      throw new Error('Invalid LanceDB query vector');
    }
    return searchLanceMemory(vector, limit);
  });
  ipcMain.handle('memory:index:clear', () => clearLanceMemoryIndex());

  // ── 通用 HTTP fetch（绕过 CORS，供 AI 工具使用） ──
  ipcMain.handle('fetch-url', async (_event, url: string, options?: { headers?: Record<string, string> }) => {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...options?.headers,
        },
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text, contentType: resp.headers.get('content-type') || '' };
    } catch (err: any) {
      return { ok: false, status: 0, text: '', error: err.message };
    }
  });

  // 微信读书 Agent API。固定目标域名，避免把带凭据的请求变成通用代理。
  ipcMain.handle('weread:request', async (_event, apiKey: string, payload: Record<string, unknown>) => {
    const key = String(apiKey || '').trim();
    if (!/^wrk-\S{4,}$/.test(key)) return { success: false, error: 'API Key 格式不正确' };
    if (!payload || typeof payload.api_name !== 'string') return { success: false, error: '接口参数不正确' };

    let lastError = '请求微信读书失败';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch('https://i.weread.qq.com/api/agent/gateway', {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, skill_version: '1.0.4' }),
        });
        const text = await response.text();
        if (!response.ok) {
          let detail = text.trim().slice(0, 300);
          try {
            const body = JSON.parse(text) as { errmsg?: string; message?: string };
            detail = body.errmsg || body.message || detail;
          } catch { /* use response text */ }
          lastError = `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`;
          if ((response.status === 429 || response.status === 499 || response.status >= 500) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
            continue;
          }
          return { success: false, error: lastError };
        }
        let data: Record<string, unknown>;
        try { data = JSON.parse(text) as Record<string, unknown>; }
        catch { return { success: false, error: '微信读书返回了无法解析的数据' }; }
        if (typeof data.errcode === 'number' && data.errcode !== 0) {
          return { success: false, error: String(data.errmsg || `微信读书错误 ${data.errcode}`) };
        }
        if (data.upgrade_info) return { success: false, error: String((data.upgrade_info as { message?: string }).message || '微信读书 Skill 需要升级') };
        return { success: true, data };
      } catch (error) {
        lastError = error instanceof Error && error.name === 'AbortError'
          ? '请求微信读书超时（60 秒）'
          : error instanceof Error ? error.message : String(error);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
          continue;
        }
      } finally { clearTimeout(timeout); }
    }
    return { success: false, error: lastError };
  });

  // ── 微信读书 AI 摘要 ──
  ipcMain.handle('weread:ai-summary', async (_event, payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ bookId: string; title: string; author: string; highlights: string[]; reviews: string[] }> }) => {
    const { baseUrl, apiKey, model, books } = payload;
    if (!apiKey || !baseUrl || !model) return { success: false, error: '请先在设置中配置 AI API' };
    if (!books?.length) return { success: false, error: '没有可分析的书籍' };

    const BATCH_SIZE = 3;
    const summaries: Array<{ bookId: string; summary: string; tags: string[] }> = [];

    for (let i = 0; i < books.length; i += BATCH_SIZE) {
      const batch = books.slice(i, i + BATCH_SIZE);
      const booksText = batch.map((book, idx) => {
        const lines = [`${idx + 1}. 《${book.title}》${book.author ? ` — ${book.author}` : ''}`];
        if (book.highlights.length) lines.push(`划线摘录（${book.highlights.length} 条）：${book.highlights.slice(0, 10).join('；')}`);
        if (book.reviews.length) lines.push(`个人想法（${book.reviews.length} 条）：${book.reviews.slice(0, 5).join('；')}`);
        return lines.join('\n');
      }).join('\n\n');

      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      let lastError = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        lastError = ''; // 每次重试前清空，避免上一次失败的错误残留
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);
        try {
          const response = await fetch(url, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: '你是一位专业的阅读分析助手。为每本书生成一段简洁的中文摘要（2-4句）和3-5个标签。返回严格的 JSON 格式：{"books":[{"index":1,"summary":"...","tags":["标签1","标签2"]}]}。摘要要抓住书的主题和用户的关注点。标签要简短准确（2-4字）。' },
                { role: 'user', content: booksText },
              ],
              temperature: 0.4, max_tokens: 2000,
            }),
          });
          const text = await response.text();
          if (!response.ok) {
            let detail = text.slice(0, 300);
            try { detail = JSON.parse(text).error?.message || detail; } catch { /* use raw */ }
            lastError = `AI 请求失败（HTTP ${response.status}）：${detail}`;
            if (attempt < 1 && response.status >= 500) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            return { success: false, error: lastError };
          }
          if (!text.trim()) {
            lastError = 'AI 返回了空响应，请重试';
            if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            break;
          }

          // 解析 HTTP 响应 JSON
          let httpResult: { choices?: Array<{ message?: { content?: string } }> };
          try { httpResult = JSON.parse(text) as typeof httpResult; }
          catch {
            lastError = `AI 返回非 JSON：${text.slice(0, 80)}`;
            if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            break;
          }
          const rawContent = (httpResult.choices?.[0]?.message?.content || '').trim();
          if (!rawContent) {
            lastError = 'AI 返回了空内容';
            if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            break;
          }

          // 清洗 AI 输出：去掉 markdown 代码块，提取 JSON 对象
          let content = rawContent
            .replace(/```(?:json)?\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) content = content.slice(firstBrace, lastBrace + 1);

          let parsed: { books?: Array<{ index: number; summary: string; tags: string[] }> };
          try { parsed = JSON.parse(content) as typeof parsed; }
          catch {
            lastError = `AI 返回 JSON 格式异常：${content.slice(0, 80)}`;
            if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            break;
          }
          const items = parsed.books || (parsed as unknown as Array<{ index: number; summary: string; tags: string[] }>);
          if (!Array.isArray(items)) { lastError = 'AI 返回的 JSON 结构异常（缺少 books 数组）'; break; }
          for (const item of items) {
            const bookIndex = (item.index || 1) - 1;
            if (batch[bookIndex]) {
              summaries.push({ bookId: batch[bookIndex].bookId, summary: item.summary || '', tags: item.tags || [] });
            }
          }
          break; // 本批次成功，退出重试循环
        } catch (err) {
          lastError = err instanceof Error && err.name === 'AbortError' ? 'AI 请求超时' : err instanceof Error ? err.message : String(err);
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        } finally { clearTimeout(timeout); }
      }
      if (lastError) return { success: false, error: lastError, summaries };
    }
    return { success: true, summaries };
  });

  // ── 微信读书 AI 推荐 ──
  ipcMain.handle('weread:ai-recommend', async (_event, payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ title: string; author: string; highlights: string[]; reviews: string[] }> }) => {
    const { baseUrl, apiKey, model, books } = payload;
    if (!apiKey || !baseUrl || !model) return { success: false, error: '请先在设置中配置 AI API' };
    if (!books?.length) return { success: false, error: '没有可分析的书籍' };

    const authors = new Set(books.map((b) => b.author).filter(Boolean));
    const allNotes = books.flatMap((b) => [...b.highlights.slice(0, 8), ...b.reviews.slice(0, 4)]).filter(Boolean);
    // 避免书单过长撑爆 context window：最多取 60 本，优先笔记多的
    const displayBooks = books.length > 60 ? books.slice(0, 60) : books;
    const userText = [
      `我已读的书籍（共 ${books.length} 本，列出前 ${displayBooks.length} 本）：`,
      ...displayBooks.map((b) => `- 《${b.title}》${b.author ? `（${b.author}）` : ''}`),
      '',
      '我的阅读笔记摘要：',
      ...allNotes.slice(0, 20).map((n) => `- ${n}`),
      '',
      `我关注的作者（共 ${authors.size} 位）：${[...authors].slice(0, 30).join('、')}${authors.size > 30 ? ' 等' : ''}`,
      books.length > 60 ? `（另有 ${books.length - 60} 本书未列出）` : '',
    ].join('\n');

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      lastError = '';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetch(url, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是一位专业的阅读推荐顾问。用户提供了完整的阅读历史（所有已读书籍和作者列表），以及部分重点书籍的笔记摘录。请仔细分析用户的阅读品味、关注的主题和偏好的作者，在此基础上推荐值得阅读的书籍。返回严格的 JSON 格式：{"recommendations":[{"type":"same_author","title":"书名","author":"作者","reason":"推荐理由（50字内，具体说明与用户已读书籍或作者的关联）"}]}。type 取值为：same_author（用户已读作者的其他值得读的作品，优先推荐笔记最活跃的作者）、similar（与用户阅读主题高度相近的书籍，可来自不同作者）、opposite（相反视角或对立观点的书籍，帮助用户拓展思维边界）。每类推荐 4-5 本，共 12-15 本。推荐理由要具体、个性化，引用用户实际读过的书或关注的主题。只推荐真实存在的书籍。' },
              { role: 'user', content: userText },
            ],
            temperature: 0.7, max_tokens: 6000,
          }),
        });
        const text = await response.text();
        if (!response.ok) {
          let detail = text.slice(0, 300);
          try { detail = JSON.parse(text).error?.message || detail; } catch { /* use raw */ }
          lastError = `AI 请求失败（HTTP ${response.status}）：${detail}`;
          if (attempt < 1 && response.status >= 500) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          return { success: false, error: lastError };
        }
        if (!text.trim()) {
          lastError = 'AI 返回了空响应，请重试';
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          return { success: false, error: lastError };
        }
        let result: { choices?: Array<{ message?: { content?: string } }> };
        try { result = JSON.parse(text) as typeof result; }
        catch {
          lastError = `AI 返回非 JSON 数据（前 100 字符）：${text.slice(0, 100)}`;
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          return { success: false, error: lastError };
        }
        const rawContent = (result.choices?.[0]?.message?.content || '').trim();
        if (!rawContent) {
          lastError = 'AI 返回了空内容，请重试';
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          return { success: false, error: lastError };
        }
        // 清洗 AI 输出：去掉 markdown 代码块包裹，提取 JSON 对象
        let content = rawContent
          .replace(/```(?:json)?\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          content = content.slice(firstBrace, lastBrace + 1);
        }
        let parsed: { recommendations?: Array<{ type: string; title: string; author: string; reason: string }> };
        try { parsed = JSON.parse(content) as typeof parsed; }
        catch {
          // JSON 可能被截断，尝试修复常见截断模式
          const repaired = content.replace(/,\s*$/, '').replace(/"\s*$/, '"').replace(/\]\s*$/, ']}');
          const fixed = repaired.endsWith('}') ? repaired : repaired + '}';
          try { parsed = JSON.parse(fixed) as typeof parsed; }
          catch {
            lastError = `AI 返回格式异常（JSON 可能被截断），请重试。返回内容前 150 字符：${rawContent.slice(0, 150)}`;
            if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            return { success: false, error: lastError };
          }
        }
        return { success: true, recommendations: parsed.recommendations || [] };
      } catch (err) {
        lastError = err instanceof Error && err.name === 'AbortError' ? 'AI 请求超时' : err instanceof Error ? err.message : String(err);
        if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      } finally { clearTimeout(timeout); }
    }
    return { success: false, error: lastError };
  });

  // ── JSON 存储 ──
  ipcMain.handle('store-save', async (_event, data: string) => {
    try {
      fs.writeFileSync(dataPath, data, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('store-load', async () => {
    try {
      if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        return JSON.parse(raw);
      }
      return null;
    } catch {
      return null;
    }
  });

  // ── SQLite 数据库持久化 ──
  ipcMain.handle('db:load', async () => {
    try {
      if (fs.existsSync(dbPath)) {
        const buf = fs.readFileSync(dbPath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('db:save', async (_event, buffer: ArrayBuffer) => {
    try {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, Buffer.from(buffer));
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  const cachedDocumentPath = (documentId: string) => path.join(documentCacheDir, `${crypto.createHash('sha256').update(documentId).digest('hex')}.pdf`);
  ipcMain.handle('document-cache:save', async (_event, documentId: string, buffer: ArrayBuffer) => {
    try {
      fs.mkdirSync(documentCacheDir, { recursive: true });
      const filePath = cachedDocumentPath(documentId);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return { success: true, filePath };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('document-cache:load', async (_event, documentId: string) => {
    try {
      const filePath = cachedDocumentPath(documentId);
      if (!fs.existsSync(filePath)) return { success: false, error: '缓存文件不存在' };
      const buffer = fs.readFileSync(filePath);
      return { success: true, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), filePath };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('document-cache:delete', async (_event, documentId: string) => {
    try {
      const filePath = cachedDocumentPath(documentId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  // ── 对话捕获存储 ──
  ipcMain.handle('store-conversation', async (_event, payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
    title?: string;
    notes?: string;
    createNew?: boolean;
    contentMode?: 'exchange' | 'document';
  }) => {
    try {
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const date = new Date(payload.timestamp).toISOString().split('T')[0];
      const time = new Date(payload.timestamp).toLocaleTimeString('zh-CN');

      const isNewFile = payload.createNew || !!payload.title;
      const fileName = isNewFile
        ? `${payload.site}-${date}-${payload.timestamp}.md`
        : `${payload.site}-${date}.md`;
      const filePath = path.join(exportDir, fileName);

      let userMsg = '(无法解析)';
      try {
        const body = payload.requestBody as Record<string, unknown>;
        if (body?.messages && Array.isArray(body.messages)) {
          const lastUser = [...body.messages].reverse().find(
            (m: Record<string, unknown>) => m.role === 'user'
          ) as Record<string, unknown> | undefined;
          if (lastUser?.content) {
            userMsg = typeof lastUser.content === 'string'
              ? lastUser.content
              : JSON.stringify(lastUser.content);
          }
        } else if (body?.prompt) {
          userMsg = String(body.prompt);
        } else if (body?.query) {
          userMsg = String(body.query);
        }
      } catch { /* keep default */ }

      const entryParts: string[] = [];

      if (isNewFile && payload.title) {
        entryParts.push(`# ${payload.title}`);
        entryParts.push('');
        if (payload.notes) {
          entryParts.push(`> ${payload.notes}`);
          entryParts.push('');
        }
      }

      if (payload.contentMode === 'document') {
        entryParts.push('', payload.responseContent.trim(), '');
      } else {
        entryParts.push('', `---`, `### 🧑 用户 — ${time}`, '', userMsg, '', `### 🤖 AI — ${time}`, '', payload.responseContent, '');
      }

      const entry = entryParts.join('\n');

      if (isNewFile) {
        fs.writeFileSync(filePath, entry, 'utf-8');
      } else {
        fs.appendFileSync(filePath, entry, 'utf-8');
      }

      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 对话历史管理 ──
  const resolveConversationPath = (filePath: string): string | null => {
    const root = path.resolve(exportDir);
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
  };

  const conversationMetadata = (file: string) => {
    const fileName = path.basename(file);
    const match = fileName.match(/^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/);
    const filePath = path.join(exportDir, file);
    const stat = fs.statSync(filePath);
    let title: string | undefined;
    let notes: string | undefined;
    try {
      const head = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
      title = head.match(/^# (.+)$/m)?.[1].trim();
      notes = head.match(/^> (.+)$/m)?.[1].trim();
    } catch { /* keep undefined */ }
    const relativeFolder = path.dirname(file).replace(/\\/g, '/');
    return { site: match?.[1] || 'unknown', date: match?.[2] || '', fileName,
      path: filePath, size: stat.size, modifiedAt: stat.mtimeMs, title, notes,
      folder: relativeFolder === '.' ? '' : relativeFolder };
  };

  const walkConversationEntries = (directory = exportDir): { files: string[]; folders: string[] } => {
    const files: string[] = [];
    const folders: string[] = [];
    if (!fs.existsSync(directory)) return { files, folders };
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(exportDir, absolutePath);
      if (entry.isDirectory()) {
        folders.push(relativePath.replace(/\\/g, '/'));
        const nested = walkConversationEntries(absolutePath);
        files.push(...nested.files);
        folders.push(...nested.folders);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(relativePath);
      }
    }
    return { files, folders };
  };

  ipcMain.handle('list-conversations', async () => {
    try {
      if (!fs.existsSync(exportDir)) return [];

      const list: Array<{
        site: string;
        date: string;
        fileName: string;
        path: string;
        size: number;
        modifiedAt: number;
        title?: string;
        notes?: string;
      }> = [];

      const files = walkConversationEntries().files;
      for (const file of files) {
        list.push(conversationMetadata(file));
      }

      list.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return list;
    } catch {
      return [];
    }
  });

  ipcMain.handle('list-conversation-folders', async () => {
    try {
      return walkConversationEntries().folders.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
        .map((folder) => ({ name: path.basename(folder), path: folder }));
    } catch { return []; }
  });

  ipcMain.handle('create-conversation-folder', async (_event, rawRelativePath: string) => {
    try {
      const relativePath = String(rawRelativePath || '').trim().replace(/[\\/]+/g, path.sep);
      const segments = relativePath.split(path.sep).filter(Boolean);
      if (!segments.length || segments.some((segment) => segment === '.' || segment === '..'
        || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment))) {
        return { success: false, error: 'INVALID_NAME' };
      }
      const target = path.resolve(exportDir, ...segments);
      const root = path.resolve(exportDir);
      if (!target.startsWith(`${root}${path.sep}`)) return { success: false, error: 'ACCESS_DENIED' };
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.mkdirSync(target, { recursive: true });
      return { success: true, path: segments.join('/') };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('move-conversation', async (_event, filePath: string, rawTargetFolder: string) => {
    try {
      const source = resolveConversationPath(filePath);
      if (!source || !fs.existsSync(source) || path.extname(source).toLowerCase() !== '.md') {
        return { success: false, error: source ? 'NOT_FOUND' : 'ACCESS_DENIED' };
      }
      const targetFolder = String(rawTargetFolder || '').trim().replace(/[\\/]+/g, path.sep);
      const segments = targetFolder ? targetFolder.split(path.sep).filter(Boolean) : [];
      if (segments.some((segment) => segment === '.' || segment === '..')) return { success: false, error: 'INVALID_TARGET' };
      const destinationDirectory = path.resolve(exportDir, ...segments);
      const root = path.resolve(exportDir);
      if (destinationDirectory !== root && !destinationDirectory.startsWith(`${root}${path.sep}`)) {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (!fs.existsSync(destinationDirectory) || !fs.statSync(destinationDirectory).isDirectory()) {
        return { success: false, error: 'TARGET_NOT_FOUND' };
      }
      const target = path.join(destinationDirectory, path.basename(source));
      if (target.toLocaleLowerCase() === source.toLocaleLowerCase()) return { success: true, filePath: source };
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.renameSync(source, target);
      return { success: true, filePath: target };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('search-conversations', async (_event, rawQuery: string) => {
    const query = String(rawQuery || '').trim().toLocaleLowerCase();
    if (query.length < 2 || !fs.existsSync(exportDir)) return [];
    const results = [];
    for (const fileName of walkConversationEntries().files) {
      if (results.length >= 100) break;
      try {
        const file = conversationMetadata(fileName);
        if (file.size > 5 * 1024 * 1024) continue;
        const content = fs.readFileSync(file.path, 'utf-8');
        const lower = content.toLocaleLowerCase();
        const metadata = `${file.fileName}\n${file.title || ''}\n${file.notes || ''}\n${file.site}`.toLocaleLowerCase();
        let matchCount = 0;
        let offset = 0;
        while ((offset = lower.indexOf(query, offset)) !== -1) { matchCount += 1; offset += query.length; }
        if (!matchCount && metadata.includes(query)) matchCount = 1;
        if (!matchCount) continue;
        const snippets = content.split(/\r?\n/).flatMap((line, index) =>
          line.toLocaleLowerCase().includes(query) ? [{ text: line.trim().slice(0, 240), line: index + 1 }] : []
        ).slice(0, 3);
        results.push({ file, matchCount, snippets });
      } catch { /* skip unreadable files */ }
    }
    return results.sort((a, b) => b.file.modifiedAt - a.file.modifiedAt);
  });

  ipcMain.handle('read-conversation', async (_event, filePath: string) => {
    try {
      const resolved = resolveConversationPath(filePath);
      if (!resolved) {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'NOT_FOUND' };
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('write-conversation', async (_event, filePath: string, content: string) => {
    try {
      const resolved = resolveConversationPath(filePath);
      if (!resolved || path.extname(resolved).toLowerCase() !== '.md') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'NOT_FOUND' };
      }
      if (typeof content !== 'string') {
        return { success: false, error: 'INVALID_CONTENT' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('rename-conversation', async (_event, filePath: string, requestedName: string) => {
    try {
      const resolved = resolveConversationPath(filePath);
      if (!resolved || !fs.existsSync(resolved)) return { success: false, error: resolved ? 'NOT_FOUND' : 'ACCESS_DENIED' };
      if (typeof requestedName !== 'string') return { success: false, error: 'INVALID_NAME' };
      let fileName = requestedName.trim();
      if (!fileName.toLowerCase().endsWith('.md')) fileName += '.md';
      const stem = fileName.slice(0, -3);
      if (!fileName || fileName.length > 180 || fileName !== path.basename(fileName)
        || !stem || /[<>:"/\\|?*\u0000-\u001f]/.test(fileName) || /[. ]\.md$/i.test(fileName)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) {
        return { success: false, error: 'INVALID_NAME' };
      }
      const target = path.join(path.dirname(resolved), fileName);
      if (target.toLocaleLowerCase() === resolved.toLocaleLowerCase()) return { success: true, filePath: resolved };
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.renameSync(resolved, target);
      return { success: true, filePath: target };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('delete-conversation', async (_event, filePath: string) => {
    try {
      const resolved = resolveConversationPath(filePath);
      if (!resolved) {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('reveal-conversation', async (_event, filePath: string) => {
    const resolved = resolveConversationPath(filePath);
    if (!resolved) return { success: false, error: 'ACCESS_DENIED' };
    if (!fs.existsSync(resolved)) return { success: false, error: 'NOT_FOUND' };
    shell.showItemInFolder(resolved);
    return { success: true };
  });

  // ── 手动记忆管理 ──
  const memoriesDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'memories');
  const memorySettingsPath = path.join(memoriesDir, '.settings.json');

  const readDisabledMemories = (): Set<string> => {
    try {
      const parsed = JSON.parse(fs.readFileSync(memorySettingsPath, 'utf-8')) as { disabled?: unknown };
      return new Set(Array.isArray(parsed.disabled) ? parsed.disabled.filter((item): item is string => typeof item === 'string') : []);
    } catch { return new Set(); }
  };

  const writeDisabledMemories = (disabled: Set<string>) => {
    if (!fs.existsSync(memoriesDir)) fs.mkdirSync(memoriesDir, { recursive: true });
    fs.writeFileSync(memorySettingsPath, JSON.stringify({ disabled: [...disabled].sort() }, null, 2), 'utf-8');
  };

  const resolveMemoryPath = (filePath: string): string | null => {
    const root = path.resolve(memoriesDir);
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return resolved;
    // fallback: treat as fileName relative to memoriesDir
    const base = path.basename(filePath);
    if (base === filePath && base.endsWith('.md')) return path.join(memoriesDir, base);
    return null;
  };

  ipcMain.handle('list-memories', async () => {
    try {
      if (!fs.existsSync(memoriesDir)) return [];
      const disabled = readDisabledMemories();
      const files = fs.readdirSync(memoriesDir).filter((f) => f.endsWith('.md'));
      return files.map((file) => {
        const filePath = path.join(memoriesDir, file);
        const stat = fs.statSync(filePath);
        let title: string | undefined;
        try {
          const head = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
          title = head.match(/^# (.+)$/m)?.[1].trim();
        } catch { /* keep undefined */ }
        return {
          fileName: file, path: filePath, size: stat.size, modifiedAt: stat.mtimeMs,
          title: title || file.replace(/\.md$/, ''), enabled: !disabled.has(file),
        };
      }).sort((a, b) => b.modifiedAt - a.modifiedAt);
    } catch { return []; }
  });

  ipcMain.handle('read-memory', async (_event, filePath: string) => {
    try {
      const resolved = resolveMemoryPath(filePath);
      if (!resolved) return { success: false, error: 'ACCESS_DENIED' };
      if (!fs.existsSync(resolved)) return { success: false, error: 'NOT_FOUND' };
      const content = fs.readFileSync(resolved, 'utf-8');
      return { success: true, content };
    } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('write-memory', async (_event, filePath: string, content: string) => {
    try {
      if (!fs.existsSync(memoriesDir)) fs.mkdirSync(memoriesDir, { recursive: true });
      const resolved = resolveMemoryPath(filePath);
      if (!resolved || path.extname(resolved).toLowerCase() !== '.md') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (typeof content !== 'string') return { success: false, error: 'INVALID_CONTENT' };
      if (path.basename(filePath) === filePath && fs.existsSync(resolved)) {
        return { success: false, error: 'FILE_EXISTS' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true, filePath: resolved };
    } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('delete-memory', async (_event, filePath: string) => {
    try {
      const resolved = resolveMemoryPath(filePath);
      if (!resolved) return { success: false, error: 'ACCESS_DENIED' };
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
      const disabled = readDisabledMemories();
      if (disabled.delete(path.basename(resolved))) writeDisabledMemories(disabled);
      return { success: true };
    } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('set-memory-enabled', async (_event, filePath: string, enabled: boolean) => {
    try {
      const resolved = resolveMemoryPath(filePath);
      if (!resolved) return { success: false, error: 'ACCESS_DENIED' };
      if (!fs.existsSync(resolved)) return { success: false, error: 'NOT_FOUND' };
      if (typeof enabled !== 'boolean') return { success: false, error: 'INVALID_ENABLED_STATE' };
      const disabled = readDisabledMemories();
      if (enabled) disabled.delete(path.basename(resolved));
      else disabled.add(path.basename(resolved));
      writeDisabledMemories(disabled);
      return { success: true };
    } catch (err) { return { success: false, error: String(err) }; }
  });

  // ── 按路径读取文件（供 AI 工具使用） ──
  ipcMain.handle('dialog:readFileBuffer', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: '文件不存在' };
      }
      const buf = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
      };
      return {
        success: true,
        data: buf.toString('base64'),
        mimeType: mimeMap[ext] ?? 'application/octet-stream',
        name: path.basename(resolved),
        size: buf.length,
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message ?? err) };
    }
  });

  // ── 文件对话框 ──
  ipcMain.handle('dialog:pickFile', async (_event, options?: { accept?: string; multiple?: boolean }) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const filters = options?.accept
        ? [{ name: '文件', extensions: options.accept.split(',').map((e) => e.replace(/^\./, '')) }]
        : [];
      const result = await dialog.showOpenDialog(win!, {
        properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: filters.length > 0 ? filters : undefined,
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const buf = fs.readFileSync(filePath);
          const name = path.basename(filePath);
          const ext = path.extname(name).toLowerCase();
          const stat = fs.statSync(filePath);
          const mimeMap: Record<string, string> = {
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xls': 'application/vnd.ms-excel',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.pdf': 'application/pdf',
            '.json': 'application/json',
            '.csv': 'text/csv',
            '.txt': 'text/plain',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
          };
          let decoded: ReturnType<typeof decodeWorkspaceText> | undefined;
          if (buf.length <= MAX_READ_ONLY_FILE_SIZE) {
            try { decoded = decodeWorkspaceText(buf); } catch { /* binary file */ }
          }
          const resolvedPath = path.resolve(filePath);
          dialogAuthorizedFiles.add(resolvedPath);
          return {
            path: resolvedPath,
            name,
            size: buf.length,
            content: buf.toString('base64'),
            mimeType: mimeMap[ext] ?? 'application/octet-stream',
            ...(decoded ? {
              text: decoded.content,
              encoding: decoded.encoding,
              lineEnding: decoded.lineEnding,
              mixedLineEndings: decoded.mixedLineEndings,
              modifiedAt: stat.mtimeMs,
              readOnly: (stat.mode & 0o200) === 0,
            } : {}),
          };
        }),
      );
      return files.length === 1 ? files[0] : files;
    } catch {
      return null;
    }
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const rootPath = result.filePaths[0];
      const files: Array<{ path: string; name: string; size: number }> = [];
      const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            visit(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            files.push({
              path: fullPath,
              name: path.relative(rootPath, fullPath),
              size: stat.size,
            });
          }
        }
      };
      visit(rootPath);
      return { path: rootPath, name: path.basename(rootPath), files };
    } catch (err) {
      return { error: String(err), files: [] };
    }
  });

  // ── 代码编辑器工作区（目录按需读取，不递归扫描） ──
  ipcMain.handle('workspace:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = path.resolve(result.filePaths[0]);
    authorizeWorkspace(rootPath);
    return { path: rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('workspace:reauthorize', async (_event, rootPath: string) => {
    authorizeWorkspace(rootPath);
    return { success: true };
  });

  ipcMain.handle('knowledge:scanWorkspace', async (_event, rootPath: string) => {
    try {
      return { success: true, data: await scanKnowledgeWorkspaceValidated(rootPath) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('knowledge:captureState', async (_event, rootPath: string, documentPaths?: string[]) => {
    try { return { success: true, data: captureKnowledgeWorkspaceState(rootPath, documentPaths) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('knowledge:createFromTemplate', async (
    _event,
    rootPath: string,
    templateId: string,
    values: Record<string, string>,
  ) => {
    try {
      return { success: true, data: createKnowledgeDocumentFromTemplate(rootPath, templateId, values) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('knowledge:readDocument', async (_event, rootPath: string, relativePath: string) => {
    try { return { success: true, data: readKnowledgeDocument(rootPath, relativePath) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('knowledge:searchWorkspace', async (_event, rootPath: string, query: string, limit?: number, filters?: import('../core/knowledge').KnowledgeSearchFilters) => {
    try { return { success: true, data: searchKnowledgeWorkspace(rootPath, query, limit, filters) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('knowledge:renameDocument', async (_event, rootPath: string, relativePath: string, nextRelativePath: string) => {
    try { return { success: true, data: renameKnowledgeDocumentWithBacklinks(rootPath, relativePath, nextRelativePath) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('workspace:listDirectory', async (
    _event,
    rootPath: string,
    relativePath = '',
  ) => {
    try {
      const directory = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(directory);
      if (!stat.isDirectory()) return { success: false, error: 'NOT_A_DIRECTORY' };

      const entries = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name))
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => {
          const entryRelativePath = path.join(relativePath, entry.name);
          if (entry.isDirectory()) {
            return { name: entry.name, path: entryRelativePath, type: 'directory' as const };
          }
          return {
            name: entry.name,
            path: entryRelativePath,
            type: 'file' as const,
            size: fs.statSync(resolveWorkspacePath(rootPath, entryRelativePath)).size,
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:readTextFile', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const filePath = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: 'NOT_A_FILE' };
      if (stat.size > MAX_READ_ONLY_FILE_SIZE) return { success: false, error: 'FILE_TOO_LARGE' };
      const buffer = fs.readFileSync(filePath);
      const decoded = decodeWorkspaceText(buffer);
      return {
        success: true,
        data: {
          ...decoded,
          size: buffer.length,
          modifiedAt: stat.mtimeMs,
          readOnly: stat.size > MAX_EDITOR_FILE_SIZE || (stat.mode & 0o200) === 0,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:writeTextFile', async (
    _event,
    rootPath: string,
    relativePath: string,
    content: string,
    options?: {
      encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';
      lineEnding?: 'LF' | 'CRLF';
      expectedModifiedAt?: number;
      force?: boolean;
    },
  ) => {
    try {
      const filePath = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: 'NOT_A_FILE' };
      if ((stat.mode & 0o200) === 0) return { success: false, error: 'FILE_READ_ONLY' };
      if (
        !options?.force
        && fileWasModified(stat.mtimeMs, options?.expectedModifiedAt)
      ) {
        return { success: false, error: 'FILE_MODIFIED_EXTERNALLY' };
      }
      const buffer = encodeWorkspaceText(content, options);
      fs.writeFileSync(filePath, buffer);
      const modifiedAt = fs.statSync(filePath).mtimeMs;
      return { success: true, data: { size: buffer.length, modifiedAt } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:writeTextFiles', async (
    _event,
    rootPath: string,
    edits: WorkspaceTextEdit[],
  ) => {
    try {
      return { success: true, data: applyWorkspaceTextEdits(rootPath, edits) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:mutateFiles', async (
    _event,
    rootPath: string,
    mutations: WorkspaceFileMutation[],
  ) => {
    try {
      return { success: true, data: applyWorkspaceFileMutations(rootPath, mutations) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:createFile', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const filePath = resolveNewWorkspacePath(rootPath, relativePath);
      if (fs.existsSync(filePath)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.writeFileSync(filePath, '', { encoding: 'utf-8', flag: 'wx' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:createDirectory', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const directory = resolveNewWorkspacePath(rootPath, relativePath);
      if (fs.existsSync(directory)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.mkdirSync(directory);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:renameEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
    nextRelativePath: string,
  ) => {
    try {
      const source = resolveWorkspacePath(rootPath, relativePath);
      const target = resolveNewWorkspacePath(rootPath, nextRelativePath);
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.renameSync(source, target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:deleteEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      if (path.relative(fs.realpathSync(rootPath), target) === '') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true });
      else fs.unlinkSync(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:trashEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      if (path.relative(fs.realpathSync(rootPath), target) === '') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      await shell.trashItem(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:copyEntry', async (
    _event,
    rootPath: string,
    sourcePath: string,
    targetPath: string,
  ) => {
    try {
      const source = resolveWorkspacePath(rootPath, sourcePath);
      const target = resolveNewWorkspacePath(rootPath, targetPath);
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.cpSync(source, target, { recursive: true, errorOnExist: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:revealEntry', async (_event, rootPath: string, relativePath: string) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      shell.showItemInFolder(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:writeBinaryFile', async (
    _event,
    rootPath: string,
    relativePath: string,
    content: string,
    options?: { expectedModifiedAt?: number; force?: boolean },
  ) => {
    try {
      const target = resolveNewWorkspacePath(rootPath, relativePath);
      // 不强制覆盖；如果已存在则报错（除非 force）。
      if (fs.existsSync(target) && !options?.force) {
        return { success: false, error: 'ALREADY_EXISTS' };
      }
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(target, buffer);
      const stat = fs.statSync(target);
      return { success: true, data: { size: stat.size, modifiedAt: stat.mtimeMs } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:readBinaryFile', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      const buffer = fs.readFileSync(target);
      return { success: true, data: { content: buffer.toString('base64') } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:listTasks', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      return { success: true, data: loadWorkspaceTaskDefinitions(root) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:listAgentScripts', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      return { success: true, data: loadPackageScripts(root) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:runAgentScript', async (_event, rootPath: string, script: string, timeoutMs?: number) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const data = await runAgentPackageScript(root, script, { timeoutMs });
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:runTask', async (event, rootPath: string, taskName: string, runId: string, environment?: Record<string, string>) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const resolvedEnv = resolveSecretReferences(environment ?? {}, (name) => getToken(`terminal-env:${name}`));
      const tasks = loadWorkspaceTaskDefinitions(root).map((task) => ({ ...task, env: resolveSecretReferences(task.env ?? {}, (name) => getToken(`terminal-env:${name}`)) }));
      const result = await workspaceTaskRunner.run(runId, tasks, taskName, root, { ...(process.env as Record<string, string>), ...resolvedEnv }, (payload) => event.sender.send('workspace:taskEvent', payload));
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:cancelTask', (_event, runId: string) => ({ success: workspaceTaskRunner.cancel(runId) }));

  ipcMain.handle('workspace:listFiles', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const files: Array<{ name: string; path: string; type: 'file' }> = [];
      const visit = (directory: string) => {
        if (files.length >= 5000) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(fullPath);
          else if (entry.isFile()) {
            files.push({
              name: entry.name,
              path: path.relative(root, fullPath),
              type: 'file',
            });
          }
          if (files.length >= 5000) break;
        }
      };
      visit(root);
      return { success: true, data: files };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:search', async (
    _event,
    rootPath: string,
    query: string,
    options?: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; include?: string; exclude?: string },
  ) => {
    try {
      if (!query || query.length > 500) return { success: true, data: [] };
      const root = resolveWorkspacePath(rootPath);
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = options?.useRegex ? query : escapeRegExp(query);
      const matcher = new RegExp(options?.wholeWord ? `\\b(?:${source})\\b` : source, options?.caseSensitive ? 'g' : 'gi');
      const globMatches = (relativePath: string, pattern: string) => {
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const normalizedPattern = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '/**');
        if (!normalizedPattern) return false;
        const marker = '__DOUBLE_STAR__';
        const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, marker).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replaceAll(marker, '.*');
        return new RegExp(normalizedPattern.includes('/') ? `^${escaped}$` : `(?:^|/)${escaped}(?:$|/)`, 'i').test(normalizedPath);
      };
      const pathMatches = (relativePath: string, filter?: string) => {
        if (!filter?.trim()) return true;
        return filter.split(',').some((part) => globMatches(relativePath, part));
      };
      const ignorePatterns = ['.gitignore', '.ignore'].flatMap((name) => {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) return [];
        return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
      });
      const isIgnored = (relativePath: string, extraPatterns: string[] = []) =>
        [...ignorePatterns, ...extraPatterns].some((pattern) => globMatches(relativePath, pattern));
      const results: Array<{ path: string; line: number; column: number; preview: string }> = [];
      const visit = (directory: string, parentPatterns: string[] = []) => {
        if (results.length >= 500) return;
        // Load .gitignore from current directory
        const dirPatterns: string[] = [];
        for (const name of ['.gitignore', '.ignore']) {
          const file = path.join(directory, name);
          if (directory === root) continue; // already loaded
          if (fs.existsSync(file)) {
            dirPatterns.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!')));
          }
        }
        const mergedPatterns = [...parentPatterns, ...dirPatterns];
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          const relativePath = path.relative(root, fullPath);
          if (isIgnored(relativePath, mergedPatterns)) continue;
          if (entry.isDirectory()) {
            visit(fullPath, mergedPatterns);
          } else if (entry.isFile()) {
            if (!pathMatches(relativePath, options?.include) || (options?.exclude && pathMatches(relativePath, options.exclude))) continue;
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;
            let decoded;
            try {
              decoded = decodeWorkspaceText(fs.readFileSync(fullPath));
            } catch {
              continue;
            }
            const lines = decoded.content.split(/\r?\n/);
            for (let index = 0; index < lines.length && results.length < 500; index += 1) {
              matcher.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = matcher.exec(lines[index])) && results.length < 500) {
                results.push({ path: relativePath, line: index + 1, column: match.index + 1, preview: lines[index].trim().slice(0, 240) });
                if (match[0].length === 0) matcher.lastIndex += 1;
              }
            }
          }
          if (results.length >= 500) break;
        }
      };
      visit(root);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:semanticSearch', async (_event, rootPath: string, symbol: string) => {
    try {
      if (!/^[A-Za-z_$][\w$]*$/.test(symbol.trim())) return { success: false, error: 'INVALID_SYMBOL' };
      const root = resolveWorkspacePath(rootPath);
      const results: SemanticMatch[] = [];
      const visit = (directory: string) => {
        if (results.length >= 1_000) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(fullPath);
          else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|py|go|rs|java|vue|svelte)$/i.test(entry.name)) {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;
            try {
              const content = decodeWorkspaceText(fs.readFileSync(fullPath)).content;
              results.push(...findSemanticMatches(path.relative(root, fullPath), content, symbol));
            } catch { /* skip binary or unsupported text */ }
          }
          if (results.length >= 1_000) break;
        }
      };
      visit(root);
      const order = { definition: 0, import: 1, reference: 2 } as const;
      results.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path) || a.line - b.line);
      return { success: true, data: results.slice(0, 1_000) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:languageSemanticSearch', async (_event, rootPath: string, relativePath: string, line: number, column: number) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const target = resolveWorkspacePath(rootPath, relativePath);
      if (!/\.[cm]?[jt]sx?$/i.test(target)) return { success: false, error: 'LANGUAGE_SERVICE_UNSUPPORTED' };
      const files: Record<string, string> = {};
      const visit = (directory: string) => {
        if (Object.keys(files).length >= 2_000) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(fullPath);
          else if (entry.isFile() && /\.[cm]?[jt]sx?$/i.test(entry.name) && fs.statSync(fullPath).size <= 1024 * 1024) {
            try { files[fullPath.replace(/\\/g, '/')] = decodeWorkspaceText(fs.readFileSync(fullPath)).content; } catch { /* skip unreadable source */ }
          }
        }
      };
      visit(root);
      const index = createTypeScriptSemanticIndex(files);
      const data = index.search(target.replace(/\\/g, '/'), Number(line) || 1, Number(column) || 1).map((item) => ({ ...item, path: path.relative(root, item.path).replace(/\\/g, '/') }));
      index.dispose();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitStatus', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
      const entries = output.split('\0').filter(Boolean).map((record) => ({
        status: record.slice(0, 2),
        path: record.slice(3).replace(/^.* -> /, ''),
      }));
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('video-generation:extract-last-frame', async (_event, payload: { filePath: string; recordId: string }) => {
    try {
      const input = resolveManagedVideo(payload?.filePath);
      if (!input) return { success: false, error: '只允许处理视频生成目录内的文件' };
      const safeId = String(payload?.recordId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!safeId) return { success: false, error: 'recordId 不能为空' };
      const output = path.join(videoGenDir, `${safeId}-last-frame.jpg`);
      await runVideoFfmpeg(['-sseof', '-0.08', '-i', input, '-frames:v', '1', '-q:v', '2', output]);
      const bytes = fs.readFileSync(output);
      return { success: true, filePath: output, name: `${safeId}-last-frame.jpg`, mimeType: 'image/jpeg', data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('video-generation:inspect-stitch', async (_event, payload: { previousPath: string; nextPath: string; threshold?: number }) => {
    try {
      const previous = resolveManagedVideo(payload?.previousPath);
      const next = resolveManagedVideo(payload?.nextPath);
      if (!previous || !next) return { success: false, error: '只允许分析视频生成目录内的文件' };
      const binary = findMediaBinary('ffmpeg');
      if (!binary) return { success: false, error: '未找到 FFmpeg' };
      const frameArgs = (input: string, last: boolean) => ['-hide_banner', '-loglevel', 'error', ...(last ? ['-sseof', '-0.3'] : []), '-i', input, ...(!last ? ['-t', '0.3'] : []), '-frames:v', '2', '-vf', 'fps=8,scale=64:64,format=rgb24', '-f', 'rawvideo', 'pipe:1'];
      const [tailRaw, headRaw] = await Promise.all([runVideoBinaryBuffer(binary, frameArgs(previous, true)), runVideoBinaryBuffer(binary, frameArgs(next, false))]);
      const frameBytes = 64 * 64 * 3;
      const frames = (buffer: Buffer) => { const result: Uint8Array[] = []; for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) result.push(buffer.subarray(offset, offset + frameBytes)); return result; };
      const tail = frames(tailRaw); const head = frames(headRaw);
      if (!tail.length || !head.length) throw new Error('无法读取接缝帧');
      const metrics = analyzeStitchFrames(tail[Math.max(0, tail.length - 2)], tail[tail.length - 1], head[0], head[Math.min(1, head.length - 1)], 64, 64);
      const threshold = Math.max(0.4, Math.min(0.95, Number(payload?.threshold) || 0.65));
      return { success: true, score: metrics.score, passed: stitchPasses(metrics.score, threshold), threshold, metrics };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('video-generation:concat', async (_event, payload: { filePaths: string[]; outputId: string }) => {
    let listPath = '';
    const normalizedPaths: string[] = [];
    try {
      const inputs = Array.isArray(payload?.filePaths) ? payload.filePaths.map(resolveManagedVideo) : [];
      if (inputs.length < 3 || inputs.some((item) => !item)) return { success: false, error: '拼接至少需要 3 个有效的生成视频' };
      const validInputs = inputs.filter((item): item is string => Boolean(item));
      const safeId = String(payload?.outputId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!safeId) return { success: false, error: 'outputId 不能为空' };
      const probes = await Promise.all(validInputs.map(probeVideo));
      const target = probes[0];
      const width = Math.max(2, target.width - (target.width % 2));
      const height = Math.max(2, target.height - (target.height % 2));
      const fps = Math.max(1, Math.min(60, Math.round(target.fps || 25)));
      for (let index = 0; index < validInputs.length; index += 1) {
        const output = path.join(videoGenDir, `${safeId}-normalized-${index}.mp4`);
        const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`;
        const fadeOut = Math.max(0, probes[index].duration - 0.08).toFixed(3);
        if (probes[index].hasAudio) {
          await runVideoFfmpeg(['-i', validInputs[index], '-vf', videoFilter, '-af', `aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.08,afade=t=out:st=${fadeOut}:d=0.08`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', output]);
        } else {
          await runVideoFfmpeg(['-i', validInputs[index], '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', videoFilter, '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', output]);
        }
        normalizedPaths.push(output);
      }
      listPath = path.join(videoGenDir, `${safeId}-concat.txt`);
      const escapePath = (item: string) => item.replace(/'/g, `'\\''`);
      fs.writeFileSync(listPath, normalizedPaths.map((item) => `file '${escapePath(item)}'`).join('\n'), 'utf8');
      const output = path.join(videoGenDir, `${safeId}-complete.mp4`);
      await runVideoFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', output]);
      const stat = fs.statSync(output);
      return { success: true, filePath: output, fileName: path.basename(output), bytes: stat.size };
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
    finally {
      if (listPath && fs.existsSync(listPath)) fs.unlinkSync(listPath);
      normalizedPaths.forEach((item) => { if (fs.existsSync(item)) fs.unlinkSync(item); });
    }
  });

  ipcMain.handle('workspace:gitGraphMetadata', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const output = execFileSync('git', ['log', '--format=@@%aN', '--numstat', '--no-renames', '-n', '1000'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      const files = new Map<string, { churn: number; lastModifiedAt?: number; authors: Map<string, number> }>(); let author = 'Unknown';
      for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('@@')) { author = line.slice(2).trim() || 'Unknown'; continue; }
        const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/); if (!match) continue;
        const entry = files.get(match[3]) ?? { churn: 0, authors: new Map<string, number>() };
        entry.churn += (Number(match[1]) || 0) + (Number(match[2]) || 0); entry.authors.set(author, (entry.authors.get(author) ?? 0) + 1); files.set(match[3], entry);
      }
      return { success: true, data: [...files].map(([filePath, value]) => ({ path: filePath, churn: value.churn, authors: [...value.authors].map(([name, commits]) => ({ name, commits })).sort((a, b) => b.commits - a.commits).slice(0, 5) })) };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('workspace:gitGraphChangedFiles', async (_event, rootPath: string, base: string) => {
    try {
      const root = resolveWorkspacePath(rootPath); const safeBase = String(base || 'HEAD~1').trim();
      if (!/^[\w./~^@{}+-]{1,200}$/.test(safeBase)) throw new Error('INVALID_GIT_BASE');
      const output = execFileSync('git', ['diff', '--name-only', '--no-renames', `${safeBase}...HEAD`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      return { success: true, data: output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('workspace:createAgentWorktree', async (_event, rootPath: string, sessionId: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const storageRoot = path.join(app.getPath('userData'), 'agent-worktrees');
      const data = await createAgentWorktree(root, storageRoot, sessionId);
      authorizeWorkspace(data.path);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:getAgentWorktreeStatus', async (_event, rootPath: string, sessionId: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const data = await getAgentWorktreeStatus(root, path.join(app.getPath('userData'), 'agent-worktrees'), sessionId);
      if (data) authorizeWorkspace(data.path);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:discardAgentWorktree', async (_event, rootPath: string, sessionId: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      await discardAgentWorktree(root, path.join(app.getPath('userData'), 'agent-worktrees'), sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });


  ipcMain.handle('workspace:previewAgentWorktreeMerge', async (_event, rootPath: string, sessionId: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const data = await previewAgentWorktreeMerge(root, path.join(app.getPath('userData'), 'agent-worktrees'), sessionId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });



  // ── Agent tasks ──

  ipcMain.handle("agent-task:create", async (_event, config: AgentTaskConfig) => {
    try {
      const record = agentTaskService.create(config);
      return { success: true, data: record };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("agent-task:get", async (_event, taskId: string) => {
    const record = agentTaskService.get(taskId);
    return { success: true, data: record ?? null };
  });

  ipcMain.handle("agent-task:list", async (_event, sessionId?: string) => {
    const records = agentTaskService.list(sessionId || undefined);
    return { success: true, data: records };
  });

  ipcMain.handle("agent-task:cancel", async (_event, taskId: string) => {
    const ok = agentTaskService.cancel(taskId);
    return { success: ok, error: ok ? undefined : "TASK_NOT_CANCELLABLE" };
  });

  ipcMain.handle("agent-task:retry", async (_event, taskId: string) => {
    try {
      const record = agentTaskService.retry(taskId);
      if (!record) return { success: false, error: "TASK_NOT_RETRYABLE" };
      return { success: true, data: record };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("agent-task:snapshot", async () => {
    return { success: true, data: agentTaskService.snapshot() };
  });

  ipcMain.handle("agent-task:restore", async (_event, tasks: AgentTaskConfig[]) => {
    try {
      const count = agentTaskService.restore(tasks as any);
      return { success: true, data: count };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on("agent-task:subscribe", (event, taskId: string) => {
    const unsubscribe = agentTaskService.subscribe(taskId, (taskEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send("agent-task:event", taskEvent);
    });
    event.sender.once("destroyed", unsubscribe);
  });

  // ── Agent worktree conflicts ──

  ipcMain.handle("workspace:getAgentWorktreeConflictVersions", async (_event, rootPath: string, sessionId: string, filePath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const data = await getAgentWorktreeConflictVersions(root, path.join(app.getPath("userData"), "agent-worktrees"), sessionId, filePath);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ── PR delivery ──

  ipcMain.handle("agent:deliverPR", async (_event, rootPath: string, branch: string, config: PRDeliveryConfig, title: string, body: string, token?: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const githubToken = token || process.env.GITHUB_TOKEN || "";
      if (!githubToken) return { success: false, error: "GitHub token not configured" };
      const result = await deliverAgentPR(root, branch, config, title, body, githubToken);
      return { success: result.pushed && !result.error, data: result, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });


    ipcMain.handle('workspace:mergeAgentWorktree', async (_event, rootPath: string, sessionId: string, message: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const safeMessage = message.trim().slice(0, 200) || `Merge Agent ${sessionId}`;
      const data = await mergeAgentWorktree(root, path.join(app.getPath('userData'), 'agent-worktrees'), sessionId, safeMessage);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitShowHead', async (_event, rootPath: string, relativePath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const absolutePath = resolveWorkspacePath(rootPath, relativePath);
      const safeRelativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      const content = execFileSync('git', ['show', `HEAD:${safeRelativePath}`], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
      });
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitStage', async (_event, rootPath: string, relativePaths: string[]) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const paths = relativePaths.map((relativePath) => path.relative(root, resolveWorkspacePath(rootPath, relativePath)));
      if (paths.length === 0) return { success: true };
      execFileSync('git', ['add', '--', ...paths], { cwd: root, windowsHide: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitUnstage', async (_event, rootPath: string, relativePaths: string[]) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const paths = relativePaths.map((relativePath) => path.relative(root, resolveWorkspacePath(rootPath, relativePath)));
      if (paths.length === 0) return { success: true };
      execFileSync('git', ['restore', '--staged', '--', ...paths], { cwd: root, windowsHide: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitCommit', async (_event, rootPath: string, message: string, relativePaths?: string[]) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const normalizedMessage = message.trim();
      if (!normalizedMessage || normalizedMessage.length > 5000) return { success: false, error: 'INVALID_COMMIT_MESSAGE' };
      const paths = relativePaths?.map((relativePath) => path.relative(root, resolveWorkspacePath(rootPath, relativePath)));
      const output = execFileSync('git', ['commit', ...(paths?.length ? ['--only'] : []), '-m', normalizedMessage, ...(paths?.length ? ['--', ...paths] : [])], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
      return { success: true, data: output.trim() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:cancelGitOperation', async (_event, rootPath: string, operationId: string) => {
    return { success: cancelGitOp(rootPath, operationId) };
  });

  ipcMain.handle('workspace:gitOperation', async (
    event,
    rootPath: string,
    operation: string,
    payload: Record<string, unknown> = {},
  ) => {
    const root = resolveWorkspacePath(rootPath);
    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const progress = (state: 'started' | 'completed' | 'failed' | 'cancelled', message: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('workspace:gitProgress', { operationId, operation, state, message });
      }
    };

    const timeoutMs = networkOps.has(operation) ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS;
    const controller = new AbortController();
    gitControllers.set(operationId, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    return enqueueGitOp(root, async () => {
      const signal = controller.signal;
      progress('started', `正在执行 ${operation}`);
      try {
        if (signal.aborted) throw new Error('GIT_CANCELLED');
        let data: unknown;
        if (operation === 'overview') {
          const [branchResult, branches, remotes, tags, ab, upstream] = await Promise.all([
            runGit(root, ['branch', '--show-current'], 2 * 1024 * 1024, signal),
            runGit(root, ['for-each-ref', '--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)', 'refs/heads', 'refs/remotes'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['remote', '-v'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['tag', '--sort=-creatordate'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], 2 * 1024 * 1024, signal).catch(() => ''),
          ]);
          const branch = branchResult;
          const [ahead, behind] = ab.split('\t').map(Number);
          data = {
            branch,
            upstream: upstream || undefined,
            ahead: Number.isFinite(ahead) ? ahead : 0,
            behind: Number.isFinite(behind) ? behind : 0,
            branches: parseGitBranches(branches),
            remotes: remotes.split(/\r?\n/).filter(Boolean),
            tags: tags.split(/\r?\n/).filter(Boolean),
          };
        } else if (operation === 'diagnostics') {
          const read = (args: string[]) => runGit(root, args, 2 * 1024 * 1024, signal).catch((error) => `不可用：${redactGitSecrets(error instanceof Error ? error.message : String(error))}`);
          const [gitVersion, credentialHelper, credentialManagerVersion, userName, userEmail] = await Promise.all([
            read(['--version']),
            read(['config', '--show-origin', '--get-all', 'credential.helper']),
            read(['credential-manager', '--version']),
            read(['config', '--get', 'user.name']),
            read(['config', '--get', 'user.email']),
          ]);
          data = [
            `Git: ${gitVersion || '未发现'}`,
            `Credential Helper: ${credentialHelper || '未配置'}`,
            `Git Credential Manager: ${credentialManagerVersion || '未发现'}`,
            `SSH Agent: ${process.env.SSH_AUTH_SOCK ? `已连接 (${process.env.SSH_AUTH_SOCK})` : '未发现 SSH_AUTH_SOCK；Windows OpenSSH 可通过 ssh-agent 服务提供'}`,
            `提交身份: ${userName || '未配置'} <${userEmail || '未配置'}>`,
            `HTTPS Proxy: ${process.env.HTTPS_PROXY || process.env.https_proxy || '未配置'}`,
          ].join('\n');
        } else if (operation === 'createBranch') {
          data = await runGit(root, ['switch', '-c', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else if (operation === 'deleteBranch') {
          const name = validateGitRef(String(payload.name ?? ''));
          data = await runGit(root, ['branch', '-d', name], 2 * 1024 * 1024, signal);
        } else if (operation === 'renameBranch') {
          const from = validateGitRef(String(payload.from ?? ''));
          const to = validateGitRef(String(payload.to ?? ''));
          data = await runGit(root, ['branch', '-m', from, to], 2 * 1024 * 1024, signal);
        } else if (operation === 'switchBranch') {
          const name = validateGitRef(String(payload.name ?? ''));
          data = await runGit(root, payload.track ? ['switch', '--track', name] : ['switch', name], 2 * 1024 * 1024, signal);
        } else if (operation === 'fetch') {
          data = await runGit(root, ['fetch', '--all', '--prune'], 20 * 1024 * 1024, signal);
        } else if (operation === 'pull') {
          const strategy = (['ff-only', 'merge', 'rebase'] as const).includes(payload.strategy as 'ff-only') ? payload.strategy : 'ff-only';
          const args = strategy === 'rebase' ? ['pull', '--rebase'] : strategy === 'merge' ? ['pull', '--no-ff'] : ['pull', '--ff-only'];
          data = await runGit(root, args, 20 * 1024 * 1024, signal);
        } else if (operation === 'push') {
          const remote = validateGitRef(String(payload.remote ?? 'origin'));
          const args = ['push'];
          if (payload.forceWithLease) args.push('--force-with-lease');
          if (payload.setUpstream) args.push('--set-upstream', remote, 'HEAD');
          data = await runGit(root, args, 20 * 1024 * 1024, signal);
        } else if (operation === 'sync') {
          const strategy = (['ff-only', 'merge', 'rebase'] as const).includes(payload.strategy as 'ff-only') ? payload.strategy : 'ff-only';
          const pullArgs = strategy === 'rebase' ? ['pull', '--rebase'] : strategy === 'merge' ? ['pull', '--no-ff'] : ['pull', '--ff-only'];
          const pull = await runGit(root, pullArgs, 20 * 1024 * 1024, signal);
          const push = await runGit(root, ['push'], 20 * 1024 * 1024, signal);
          data = `${pull}\n${push}`.trim();
        } else if (operation === 'log') {
          const limit = Math.max(1, Math.min(100, Number(payload.limit) || 50));
          const skip = Math.max(0, Number(payload.skip) || 0);
          const args = ['log', '--all', `--max-count=${limit}`, `--skip=${skip}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%aI%x1f%G?%x1f%GS%x1f%s%x1e'];
          const author = String(payload.author ?? '').trim().slice(0, 200);
          const query = String(payload.query ?? '').trim().slice(0, 200);
          const since = String(payload.since ?? '').trim().slice(0, 32);
          const until = String(payload.until ?? '').trim().slice(0, 32);
          if (author) args.push(`--author=${author}`);
          if (query) args.push(`--grep=${query}`, '--regexp-ignore-case');
          if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) args.push(`--since=${since}`);
          if (until && /^\d{4}-\d{2}-\d{2}$/.test(until)) args.push(`--until=${until}`);
          if (payload.path) args.push('--', path.relative(root, resolveWorkspacePath(rootPath, String(payload.path))));
          const output = await runGit(root, args, 20 * 1024 * 1024, signal);
          data = parseGitLog(output);
        } else if (operation === 'showCommit') {
          const hash = validateGitRef(String(payload.hash ?? ''));
          data = await runGit(root, ['show', '--format=fuller', '--stat', '--patch', hash], 30 * 1024 * 1024, signal);
        } else if (operation === 'compareCommits') {
          const from = validateGitRef(String(payload.from ?? ''));
          const to = validateGitRef(String(payload.to ?? ''));
          data = await runGit(root, ['diff', '--stat', '--patch', `${from}..${to}`], 30 * 1024 * 1024, signal);
        } else if (operation === 'fileDiff') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? '')));
          const staged = payload.staged ? ['--cached'] : [];
          data = await runGit(root, ['diff', '--no-ext-diff', '--unified=3', ...staged, '--', relativePath], 20 * 1024 * 1024, signal);
        } else if (operation === 'stagePatch') {
          data = await applyGitPatch(root, String(payload.patch ?? ''));
        } else if (operation === 'conflictVersions') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? ''))).replace(/\\/g, '/');
          const [statusOutput, indexOutput] = await Promise.all([runGit(root, ['status', '--porcelain=v1', '--untracked-files=no'], 2 * 1024 * 1024, signal), runGit(root, ['ls-files', '-u'], 5 * 1024 * 1024, signal)]);
          const statuses = statusOutput.split(/\r?\n/).filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3).trim().replace(/\\/g, '/') }));
          const renameGroup = detectRenameRename(statuses, parseUnmergedIndex(indexOutput), relativePath);
          const paths = renameGroup ? { base: renameGroup.basePath, ours: renameGroup.oursPath, theirs: renameGroup.theirsPath } : { base: relativePath, ours: relativePath, theirs: relativePath };
          const readStage = (stage: number, stagePath: string) => runGit(root, ['show', `:${stage}:${stagePath}`], 20 * 1024 * 1024, signal).catch(() => '');
          const [base, ours, theirs] = await Promise.all([readStage(1, paths.base), readStage(2, paths.ours), readStage(3, paths.theirs)]);
          data = { base, ours, theirs, conflictType: renameGroup?.type, paths };
        } else if (operation === 'resolveConflict') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? '')));
          const strategy = payload.strategy === 'theirs' ? '--theirs' : '--ours';
          await runGit(root, ['checkout', strategy, '--', relativePath], 2 * 1024 * 1024, signal);
          data = await runGit(root, ['add', '--', relativePath], 2 * 1024 * 1024, signal);
        } else if (operation === 'stageConflictResult') {
          const resultPath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.resultPath ?? '')));
          const obsoletePaths = Array.isArray(payload.obsoletePaths) ? payload.obsoletePaths.map((item) => path.relative(root, resolveWorkspacePath(rootPath, String(item)))) : [];
          if (obsoletePaths.length) await runGit(root, ['rm', '--ignore-unmatch', '--', ...obsoletePaths], 2 * 1024 * 1024, signal);
          data = await runGit(root, ['add', '--', resultPath], 2 * 1024 * 1024, signal);
        } else if (operation === 'continueOperation' || operation === 'abortOperation') {
          const kind = String(payload.kind ?? '');
          if (!['merge', 'rebase', 'cherry-pick'].includes(kind)) throw new Error('INVALID_GIT_SEQUENCE');
          const action = operation === 'continueOperation' ? '--continue' : '--abort';
          data = await runGit(root, [kind, action], 20 * 1024 * 1024, signal);
        } else if (operation === 'stashList') {
          const output = await runGit(root, ['stash', 'list', '--format=%gd%x1f%H%x1f%cr%x1f%s'], 2 * 1024 * 1024, signal);
          data = output.split(/\r?\n/).filter(Boolean).map((line) => {
            const [ref, hash, date, subject] = line.split('\x1f'); return { ref, hash, date, subject };
          });
        } else if (operation === 'stashShow') {
          const ref = String(payload.ref ?? 'stash@{0}').trim();
          data = await runGit(root, ['stash', 'show', '-p', ref], 20 * 1024 * 1024, signal);
        } else if (operation === 'stashPush') {
          const message = String(payload.message ?? '').trim();
          data = await runGit(root, message ? ['stash', 'push', '-u', '-m', message] : ['stash', 'push', '-u'], 2 * 1024 * 1024, signal);
        } else if (operation === 'stashApply' || operation === 'stashPop' || operation === 'stashDrop') {
          const ref = String(payload.ref ?? 'stash@{0}').trim();
          if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('INVALID_STASH_REF');
          data = await runGit(root, ['stash', operation.slice(5).toLowerCase(), ref], 2 * 1024 * 1024, signal);
        } else if (operation === 'createTag') {
          const name = validateGitRef(String(payload.name ?? ''));
          const message = String(payload.message ?? '').trim();
          data = await runGit(root, message ? ['tag', '-a', name, '-m', message] : ['tag', name], 2 * 1024 * 1024, signal);
        } else if (operation === 'deleteTag') {
          data = await runGit(root, ['tag', '-d', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else if (operation === 'addRemote') {
          const name = validateGitRef(String(payload.name ?? ''));
          const url = String(payload.url ?? '').trim();
          if (!url || /[\r\n]/.test(url)) throw new Error('INVALID_REMOTE_URL');
          data = await runGit(root, ['remote', 'add', name, url], 2 * 1024 * 1024, signal);
        } else if (operation === 'removeRemote') {
          data = await runGit(root, ['remote', 'remove', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else {
          throw new Error('UNSUPPORTED_GIT_OPERATION');
        }
        progress('completed', `${operation} 执行完成`);
        return { success: true, data };
      } catch (error) {
        const raw = redactGitSecrets(error instanceof Error ? error.message : String(error));
        if (timedOut) {
          progress('failed', '操作超时');
          return { success: false, error: 'GIT_TIMEOUT' };
        }
        if (raw === 'GIT_CANCELLED' || raw.includes('abort') || raw.includes('cancel')) {
          progress('cancelled', '操作已取消');
          return { success: false, error: 'GIT_CANCELLED' };
        }
        const message = classifyGitError(raw) ?? raw;
        progress('failed', message);
        return { success: false, error: message };
      } finally {
        clearTimeout(timeout);
        gitControllers.delete(operationId);
      }
    });
  });

  ipcMain.handle('workspace:watch', async (event, rootPath: string) => {
    try {
      const webContentsId = event.sender.id;
      workspaceWatchers.get(webContentsId)?.close();
      const root = resolveWorkspacePath(rootPath);
      const watcher = fs.watch(root, { recursive: true }, (eventType, fileName) => {
        if (!fileName) return;
        const relativePath = String(fileName);
        if (relativePath.split(/[\\/]/).some((part) => WORKSPACE_IGNORED_NAMES.has(part))) return;
        if (!event.sender.isDestroyed()) {
          event.sender.send('workspace:fileChanged', {
            path: relativePath,
            type: eventType === 'rename' ? 'rename' : 'change',
          });
        }
      });
      workspaceWatchers.set(webContentsId, watcher);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:unwatch', (event) => {
    workspaceWatchers.get(event.sender.id)?.close();
    workspaceWatchers.delete(event.sender.id);
  });

  ipcMain.handle('dialog:saveFile', async (_event, content: string, defaultName?: string, options?: { encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk'; lineEnding?: 'LF' | 'CRLF' }) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName ?? 'untitled.txt',
      });
      if (result.canceled || !result.filePath) return { success: false };
      const resolved = path.resolve(result.filePath);
      fs.writeFileSync(resolved, encodeWorkspaceText(content, options));
      dialogAuthorizedFiles.add(resolved);
      return { success: true, path: resolved, modifiedAt: fs.statSync(resolved).mtimeMs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('dialog:writeTextFile', async (_event, filePath: string, content: string, options?: { encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk'; lineEnding?: 'LF' | 'CRLF'; expectedModifiedAt?: number; force?: boolean }) => {
    try {
      const resolved = path.resolve(filePath);
      if (!dialogAuthorizedFiles.has(resolved)) return { success: false, error: 'ACCESS_DENIED' };
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return { success: false, error: 'FILE_NOT_FOUND' };
      }
      const stat = fs.statSync(resolved);
      if ((stat.mode & 0o200) === 0) return { success: false, error: 'FILE_READ_ONLY' };
      if (!options?.force && fileWasModified(stat.mtimeMs, options?.expectedModifiedAt)) {
        const current = decodeWorkspaceText(fs.readFileSync(resolved));
        return { success: false, error: 'FILE_MODIFIED_EXTERNALLY', current: { ...current, modifiedAt: stat.mtimeMs } };
      }
      fs.writeFileSync(resolved, encodeWorkspaceText(content, options));
      return { success: true, path: resolved, modifiedAt: fs.statSync(resolved).mtimeMs };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 打开对话文件夹 ──
  ipcMain.handle('open-conversation-folder', async () => {
    try {
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      const shellError = await shell.openPath(exportDir);
      if (shellError) {
        const { exec } = await import('node:child_process');
        const platform = process.platform;
        const cmd = platform === 'win32'
          ? `explorer "${exportDir}"`
          : platform === 'darwin'
            ? `open "${exportDir}"`
            : `xdg-open "${exportDir}"`;
        await new Promise<void>((resolve, reject) => {
          exec(cmd, (err) => (err ? reject(err) : resolve()));
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Token 安全存储 ──
  ipcMain.handle('auth:is-available', async () => isEncryptionAvailable());
  ipcMain.handle('auth:save-token', async (_event, service: string, token: string, label?: string) => {
    return saveToken(service, token, label);
  });
  ipcMain.handle('auth:get-token', async (_event, service: string) => {
    return getToken(service);
  });
  ipcMain.handle('auth:delete-token', async (_event, service: string) => {
    return deleteToken(service);
  });
  ipcMain.handle('auth:list-services', async () => listServices());
  ipcMain.handle('auth:clear-all', async () => clearAll());

  // ── Model Context Protocol ──
  ipcMain.handle('mcp:list-servers', () => mcpManager.listStatuses());
  ipcMain.handle('mcp:save-server', (_event, config: McpServerConfig) => mcpManager.saveConfig(config));
  ipcMain.handle('mcp:remove-server', (_event, serverId: string) => mcpManager.removeConfig(serverId));
  ipcMain.handle('mcp:connect', (_event, serverId: string) => mcpManager.connect(serverId));
  ipcMain.handle('mcp:disconnect', (_event, serverId: string) => mcpManager.disconnect(serverId));
  ipcMain.handle('mcp:list-tools', (_event, serverId?: string) => mcpManager.listTools(serverId));
  ipcMain.handle('mcp:call-tool', (_event, serverId: string, name: string, args: Record<string, unknown>) => (
    mcpManager.callTool(serverId, name, args)
  ));
  ipcMain.handle('mcp:record-denial', (_event, serverId: string, name: string, args: Record<string, unknown>) => mcpManager.recordDenial(serverId, name, args));
  ipcMain.handle('mcp:list-audit', (_event, limit?: number) => mcpManager.listAudit(limit));
  ipcMain.handle('mcp:clear-audit', () => mcpManager.clearAudit());
  void mcpManager.connectAutoServers();

  // ── 终端 ──
  ipcMain.handle('terminal:profiles', () => ({ success: true, data: discoverShellProfiles() }));

  ipcMain.handle('terminal:create', async (event, id: string, cwd?: string, profile?: { name: string; shell: string; args?: string[]; env?: Record<string, string> }) => {
    try {
      const safeProfile = profile ? { ...profile, env: resolveSecretReferences(profile.env ?? {}, (name) => getToken(`terminal-env:${name}`)) } : undefined;
      const session = createSession(id, cwd, safeProfile);
      session.pty.onData((data: string) => {
        if (!event.sender.isDestroyed()) event.sender.send(`terminal:data:${id}`, data);
      });
      session.pty.onExit(({ exitCode }) => {
        if (!event.sender.isDestroyed()) event.sender.send(`terminal:exit:${id}`, exitCode);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('terminal:write', async (_event, id: string, data: string) => {
    try { write(id, data); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => {
    try { resize(id, cols, rows); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('terminal:destroy', async (_event, id: string) => {
    try { destroySession(id); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // ── MyCast (局域网手机投屏 + 文件传输) ──
  setupMyCastIPC();
  // Best-effort warm-start the sidecar so the plugin can immediately render status.
  startMyCastDaemon().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[mycast] daemon warm-start failed:', err);
  });
  app.on('before-quit', () => {
    void shutdownMyCastDaemon();
  });

  ipcMain.handle('workspace:gitInit', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const output = execFileSync('git', ['init'], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
      });
      return { success: true, data: output.trim() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  setupPhoneIPC();
  app.on('before-quit', () => { void stopPhoneService(); });

  // ── Voice Engine (本地语音输入) ──
  setupVoiceIPC();
  startVoiceDaemon().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[voice] daemon warm-start failed:', err);
  });
  app.on('before-quit', () => {
    void shutdownVoiceDaemon();
  });
}
