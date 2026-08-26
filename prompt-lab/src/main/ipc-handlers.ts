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
import { parseLitterboxUploadUrl } from '@next-work/video-generation/core';
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
import { analyzeStitchFrames, stitchPasses } from '@next-work/video-generation/core';
import type { McpServerConfig } from '../types/mcp';
import { createAgentWorktree, discardAgentWorktree, getAgentWorktreeStatus, getAgentWorktreeConflictVersions, mergeAgentWorktree, previewAgentWorktreeMerge } from './agent/worktree';
import { agentTaskService } from './agent/task-service';
import { deliverAgentPR, pushAgentBranch, createGitHubPR, registerPRProvider, type PRDeliveryConfig } from './pr-delivery';
import type { AgentTaskConfig } from './agent/task-types';
import { loadPackageScripts, runAgentPackageScript } from './agent/script-runner';
import { registerOfficeIpc } from '../plugins/office-studio/backend/office-ipc';
import { registerMarkdownToWordIpc } from '../plugins/markdown-to-word/backend/ipc';
import { registerRssIpc } from '@next-work/rss-reader/main';
import { registerWereadIpc } from '@next-work/weread/main';
import Database from 'better-sqlite3';
import { Notification as ElectronNotification } from 'electron';
import { extractReadability } from '../core/work-browser/parser';
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
  registerMarkdownToWordIpc();
  registerWereadIpc({ ipcMain });
  let rssDatabase: Database.Database | null = null;
  registerRssIpc(
    { ipcMain },
    {
      openDatabase: () => {
        if (!rssDatabase) {
          rssDatabase = new Database(path.join(app.getPath('userData'), 'rss-reader.db'));
        }
        return rssDatabase;
      },
      extractReadability,
      notify: (title, body) => {
        if (ElectronNotification.isSupported()) new ElectronNotification({ title, body }).show();
      },
    },
  );
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
      if (!match) throw new Error('浠呮敮鎸佹煡璇?GitHub 浠撳簱');
      const owner = encodeURIComponent(match[1]);
      const repository = encodeURIComponent(match[2].replace(/\.git$/i, ''));
      const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/actions/workflows/pages.yml/runs?per_page=1`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'next-work-dashboard' },
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 404) return { success: false, error: '鏈壘鍒?Pages workflow锛屾垨浠撳簱涓虹鏈変粨搴撲笖闇€瑕侀壌鏉? };
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
    if (!isEncryptionAvailable()) return { success: false, error: '绯荤粺瀹夊叏瀛樺偍涓嶅彲鐢紝API Key 鏈粠纾佺洏璇诲彇' };
    return { success: true, value: getToken(name) ?? '' };
  });
  ipcMain.handle('outline-secrets:save', (_event, kind: unknown, value: unknown) => {
    const name = kind === 'review' ? 'outline-scaffolder-review' : kind === 'minimax' ? 'outline-scaffolder-minimax' : '';
    if (!name) return { success: false, error: 'INVALID_SECRET_KIND' };
    if (!isEncryptionAvailable()) return { success: false, error: '绯荤粺瀹夊叏瀛樺偍涓嶅彲鐢紝鏃犳硶瀹夊叏淇濆瓨 API Key' };
    const token = String(value ?? '').trim();
    if (!token) return { success: deleteToken(name) };
    return saveToken(name, token, '绔犺妭鏂囨。鐢熸垚鍣?) ? { success: true } : { success: false, error: 'API Key 鍔犲瘑淇濆瓨澶辫触' };
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
          const authors = (item.authorships ?? []).slice(0, 3).map((entry) => entry.author?.display_name).filter(Boolean).join('銆?);
          results.push({ title, url, snippet: [authors, item.publication_year, item.type].filter(Boolean).join(' 路 '), domain: new URL(url).hostname, source: 'openalex' });
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
          const authors = (item.author ?? []).slice(0, 3).map((author) => [author.family, author.given].filter(Boolean).join(' ')).filter(Boolean).join('銆?);
          const year = item.published?.['date-parts']?.[0]?.[0];
          results.push({ title, url, snippet: [authors, year, item.publisher, item.type].filter(Boolean).join(' 路 '), domain: new URL(url).hostname, source: 'crossref' });
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
          label: '娉ㄥ叆閫変腑鎻愮ず璇?,
          enabled: !!params,
          click: () => win.webContents.send('inject-from-context-menu'),
        },
        { type: 'separator' },
        { label: '澶嶅埗', role: 'copy' },
        { label: '绮樿创', role: 'paste' },
      ]).popup();
    });
    win.webContents.once('destroyed', () => {
      workspaceWatchers.get(webContentsId)?.close();
      workspaceWatchers.delete(webContentsId);
    });
  };

  BrowserWindow.getAllWindows().forEach(configureWindow);
  app.on('browser-window-created', (_event, win) => configureWindow(win));

  // 鏆撮湶 webview preload 璺緞缁欐覆鏌撹繘绋?
  ipcMain.handle('get-webview-preload-path', () => {
    return webviewPreloadPath;
  });

  // 鈹€鈹€ 鎻愮ず璇嶆敞鍏?鈹€鈹€
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

  // 鈹€鈹€ 绐楀彛鎺у埗 鈹€鈹€
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

  // 鈹€鈹€ 绐楀彛缃《 鈹€鈹€
  ipcMain.handle('window-toggle-always-on-top', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const ontop = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(ontop);
    return ontop;
  });

  // 鈹€鈹€ 寮€鏈哄惎鍔?鈹€鈹€
  const autoLauncher = new AutoLaunch({ name: 'next-work-dashboard' });
  ipcMain.handle('auto-launch-get', async () => {
    try { return await autoLauncher.isEnabled(); } catch { return false; }
  });
  ipcMain.handle('auto-launch-set', async (_e, enabled: boolean) => {
    if (enabled) await autoLauncher.enable();
    else await autoLauncher.disable();
    return enabled;
  });

  // 鈹€鈹€ 鏁版嵁鎸佷箙鍖栬矾寰?鈹€鈹€
  const dataPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  const dbPath = path.join(app.getPath('userData'), 'next-work-dashboard.db');
  const documentCacheDir = path.join(app.getPath('userData'), 'document-cache');
  const exportDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'conversations');

  // 鈹€鈹€ favicon 鈹€鈹€
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
        return { ok: false, status: 400, error: `UNSUPPORTED_LLM_PROXY_HOST: ${hostname || 'invalid host'}锛堜粎鍏佽鍏綉 HTTPS 鍦板潃锛塦 };
      }
      const apiKey = String(payload.apiKey ?? '').trim();
      if (!apiKey) return { ok: false, status: 401, error: 'MISSING_API_KEY' };
      if (!/^[\x21-\x7E]+$/.test(apiKey)) return { ok: false, status: 400, error: 'INVALID_API_KEY_FORMAT: API Key 鍙兘鍖呭惈 ASCII 瀛楃锛岃鍕垮～鍐欎腑鏂囪鏄庛€佺┖鏍兼垨鍗犱綅鏂囧瓧' };
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
            if (businessCode !== 0) return { ok: false, status: 400, error: `MiniMax 涓氬姟閿欒 ${businessCode}: ${miniMaxData?.base_resp?.status_msg || '璇锋眰鏈垚鍔?}` };
            const choice = miniMaxData?.choices?.[0];
            const content = choice?.message?.content;
            const hasContent = Array.isArray(content) ? content.length > 0 : String(content ?? '').trim().length > 0;
            if (isMiniMaxM3 && !hasContent) {
              const reasoningLength = String(choice?.message?.reasoning_content ?? '').length
                + (choice?.message?.reasoning_details ?? []).reduce((sum, item) => sum + String(item.text ?? '').length, 0);
              const detail = miniMaxData?.output_sensitive
                ? '杈撳嚭瑙﹀彂鍐呭瀹夊叏绛栫暐'
                : choice?.finish_reason === 'length'
                  ? '鎺ㄧ悊杩囩▼鑰楀敖浜嗚緭鍑洪搴?
                  : `鍝嶅簲姝ｆ枃涓虹┖${reasoningLength ? `锛堝凡浜х敓 ${reasoningLength} 瀛楃鎺ㄧ悊鍐呭锛塦 : ''}`;
              return { ok: false, status: 422, error: `MiniMax-M3 鏈繑鍥炴渶缁堟鏂囷細${detail}銆傝缂╃煭寰呭鏍℃枃绔犳垨鏀圭敤 MiniMax-M2.7銆俙 };
            }
            return { ok: true, status: response.status, data };
          }
          const retryable = response.status === 429 || response.status === 529 || (response.status >= 500 && response.status <= 599);
          if (!retryable || attempt === retryDelays.length - 1) {
            const suffix = retryable ? `\n宸茶嚜鍔ㄩ噸璇?${attempt} 娆★紝鏈嶅姟浠嶇劧绻佸繖銆俙 : '';
            return { ok: false, status: response.status, error: `${text.slice(0, 1000)}${suffix}` };
          }
        }
        return { ok: false, status: 503, error: '妯″瀷鏈嶅姟鏆傛椂涓嶅彲鐢? };
      } catch (error) {
        if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
          return { ok: false, status: 408, error: '妯″瀷鐢熸垚瓒呰繃 5 鍒嗛挓锛岃缂╃煭杈撳叆鎴栨洿鎹㈠搷搴旀洿蹇殑妯″瀷' };
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
        if (!apiKey || !model || !prompt) return { success: false, error: '璇峰～鍐?MiniMax API Key銆佹ā鍨嬪拰鎻愮ず璇? };
        if (!/^[\x21-\x7E]+$/.test(apiKey)) return { success: false, error: 'API Key 鏍煎紡鏃犳晥锛氬彧鑳藉寘鍚?ASCII 瀛楃锛岃鍕垮～鍐欎腑鏂囪鏄庛€佺┖鏍兼垨鍗犱綅鏂囧瓧' };
        const allowedModels = new Set(['image-01', 'image-01-live']);
        const allowedRatios = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
        if (!allowedModels.has(model)) return { success: false, error: '涓嶆敮鎸佺殑 MiniMax 鍥惧儚妯″瀷' };
        const aspectRatio = allowedRatios.has(String(payload.aspectRatio)) ? String(payload.aspectRatio) : '1:1';
        if (model === 'image-01-live' && aspectRatio === '21:9') return { success: false, error: 'image-01-live 涓嶆敮鎸?21:9 鐢诲箙' };
        const referenceUrl = String(payload.image?.url || '').trim();
        if (referenceUrl && !/^https:\/\//i.test(referenceUrl)) return { success: false, error: 'MiniMax 鍙傝€冨浘蹇呴』鏄彲鍏綉璁块棶鐨?HTTPS 鍥剧墖閾炬帴' };
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
            const message = data?.base_resp?.status_msg || serviceError || text.slice(0, 1000) || `MiniMax 杩斿洖 HTTP ${response.status}`;
            return { success: false, error: `MiniMax 鍥剧墖鐢熸垚澶辫触${statusCode ? `锛堥敊璇爜 ${statusCode}锛塦 : ''}锛?{message}` };
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
            if (!imageResponse.ok) return { success: false, error: '鍥剧墖宸茬敓鎴愶紝浣嗕笅杞?MiniMax 涓存椂缁撴灉澶辫触' };
            const mime = imageResponse.headers.get('content-type') || 'image/jpeg';
            return { success: true, imageDataUrl: `data:${mime};base64,${Buffer.from(await imageResponse.arrayBuffer()).toString('base64')}` };
          }
          const failedCount = Number(data?.metadata?.failed_count ?? 0);
          const successCount = Number(data?.metadata?.success_count ?? 0);
          const details = [
            data?.base_resp?.status_msg && data.base_resp.status_msg !== 'success' ? data.base_resp.status_msg : '',
            failedCount > 0 ? `澶辫触 ${failedCount} 寮燻 : '',
            Number.isFinite(successCount) ? `鎴愬姛 ${successCount} 寮燻 : '',
            data?.id ? `浠诲姟 ID锛?{data.id}` : '',
          ].filter(Boolean).join('锛?);
          return {
            success: false,
            error: `MiniMax 璇锋眰宸插畬鎴愶紝浣嗘病鏈夎繑鍥炲彲鐢ㄥ浘鐗?{details ? `锛?{details}锛塦 : ''}銆傚彲鑳借鍐呭瀹夊叏绛栫暐鎷︽埅锛涜璋冩暣鎻愮ず璇嶅悗閲嶈瘯锛岃嫢鎸佺画澶辫触鍐嶆鏌ュ椁愰搴︿笌 image-01 鏉冮檺銆俙,
          };
        } finally { clearTimeout(timeout); }
      }
      if (!/^https:\/\//i.test(baseUrl) || !apiKey || !model || !prompt) return { success: false, error: '鍥剧墖鏈嶅姟閰嶇疆鎴栨彁绀鸿瘝涓嶅畬鏁? };
      const endpoint = `${baseUrl}/images/${payload.image ? 'edits' : 'generations'}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600_000);
      let response: Response;
      try {
        if (payload.image) {
          const bytes = Buffer.from(payload.image.dataBase64, 'base64');
          if (bytes.byteLength > 20 * 1024 * 1024) return { success: false, error: '鍙傝€冨浘鐗囦笉鑳借秴杩?20 MB' };
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
      if (!response.ok) return { success: false, error: data?.error?.message || text.slice(0, 1000) || `鍥剧墖鏈嶅姟杩斿洖 ${response.status}` };
      const item = data?.data?.[0];
      if (item?.b64_json) return { success: true, imageDataUrl: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt };
      if (item?.url) {
        const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
        if (!imageResponse.ok) return { success: false, error: '鍥剧墖宸茬敓鎴愶紝浣嗕笅杞界粨鏋滃け璐? };
        const mime = imageResponse.headers.get('content-type') || 'image/png';
        const encoded = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        return { success: true, imageDataUrl: `data:${mime};base64,${encoded}`, revisedPrompt: item.revised_prompt };
      }
      return { success: false, error: '鍥剧墖鏈嶅姟鏈繑鍥炲彲璇嗗埆鐨勭粨鏋? };
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? '鍥剧墖鐢熸垚瓒呮椂锛?0 鍒嗛挓锛? : (error instanceof Error ? error.message : String(error));
      return { success: false, error: message };
    }
  });

  // 鈹€鈹€ Video Generation (MiniMax-H3) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 寮傛涓夋寮忥細submit 鈫?poll 鈫?download銆備笅杞藉悗鐨?MP4 钀藉埌 userData/video-generation/锛?
  // 鍏冩暟鎹蛋 SQLite锛堥伩鍏?50MB+ 瑙嗛濉炶繘 BLOB锛夈€俁enderer 鎸夐渶鎷?blob 鎾斁銆?
  const videoGenDir = path.join(app.getPath('userData'), 'video-generation');
  fs.mkdirSync(videoGenDir, { recursive: true });

  const runVideoFfmpeg = (args: string[]): Promise<void> => new Promise((resolve, reject) => {
    const binary = findMediaBinary('ffmpeg');
    if (!binary) { reject(new Error('鏈壘鍒?FFmpeg锛岃鍏堝湪 AI 瑙嗛闃呰鍣ㄨ缃腑閰嶇疆')); return; }
    execFile(binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`FFmpeg 鎵ц澶辫触锛?{String(stderr || error.message).slice(-1000)}`));
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
    if (!binary) throw new Error('鏈壘鍒?FFprobe锛岃纭瀹冧笌 FFmpeg 浣嶄簬鍚屼竴鐩綍');
    const output = await runVideoBinaryBuffer(binary, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath]);
    const parsed = JSON.parse(output.toString('utf8')) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }>; format?: { duration?: string } };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    if (!video?.width || !video.height) throw new Error('FFprobe 鏈娴嬪埌鏈夋晥瑙嗛娴?);
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
      if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '瑙嗛鏂囦欢涓嶅瓨鍦ㄦ垨宸茶鍒犻櫎' };
      const stat = fs.statSync(filePath);
      if (stat.size > 200 * 1024 * 1024) return { success: false, error: `瑙嗛鏂囦欢 ${(stat.size / 1024 / 1024).toFixed(1)} MB 瓒呰繃 200 MB 鍗曟璇诲彇涓婇檺` };
      const buffer = fs.readFileSync(filePath);
      const mimeType = filePath.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
      // 杞垚 ArrayBuffer锛圛PC structured clone 鍙嬪ソ锛?
      return { success: true, bytes: stat.size, mimeType, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle('video-generation:create', async (_event, payload: import('@next-work/video-generation').VideoGenerationRequest) => {
    try {
      const apiModule = await import('@next-work/video-generation/core');
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
      const message = err instanceof Error && err.name === 'AbortError' ? '鎻愪氦瑙嗛鐢熸垚浠诲姟瓒呮椂锛? 鍒嗛挓锛? : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:query', async (_event, payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => {
    try {
      const apiKey = String(payload?.apiKey || '').trim();
      const taskId = String(payload?.taskId || '').trim();
      const baseUrl = String(payload?.baseUrl || 'https://api.minimaxi.com').replace(/\/+$/, '');
      if (!apiKey) return { success: false, error: '璇峰～鍐?MiniMax API Key' };
      if (!taskId) return { success: false, error: 'taskId 涓嶈兘涓虹┖' };
      const apiModule = await import('@next-work/video-generation/core');
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
        if (!retrieved.videoUrl) return { success: false, error: retrieved.error || '鏃犳硶鑾峰彇瑙嗛涓嬭浇鍦板潃' };
        info.videoUrl = retrieved.videoUrl;
      }
      return { success: true, info };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '鏌ヨ浠诲姟瓒呮椂锛?0 绉掞級' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  // 鍙栨秷 / 鍒犻櫎涓婃父浠诲姟锛圖ELETE /v2/video_generation/{task_id}锛夈€?
  // MiniMax 鏂囨。锛氬彇娑堟帓闃熶腑鐨勪换鍔★紝鎴栧垹闄ゆ垚鍔熷拰澶辫触鐨勪换鍔¤褰曘€?
  // 缁堟€佸凡 succeed / failed / cancelled 鐨勪换鍔′篃浼氳鏈嶅姟绔竻鐞嗚褰曘€?
  ipcMain.handle('video-generation:cancel', async (_event, payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => {
    try {
      const apiKey = String(payload?.apiKey || '').trim();
      const taskId = String(payload?.taskId || '').trim();
      const baseUrl = String(payload?.baseUrl || 'https://api.minimaxi.com').replace(/\/+$/, '');
      if (!apiKey) return { success: false, error: '璇峰～鍐?MiniMax API Key' };
      if (!taskId) return { success: false, error: 'taskId 涓嶈兘涓虹┖' };
      const { buildCancelRequest, usesH3Protocol } = await import('@next-work/video-generation/core');
      if (!usesH3Protocol(payload.model)) {
        return { success: true, baseResp: { statusCode: 0, statusMsg: 'Hailuo v1 涓嶆敮鎸佸彇娑堜笂娓镐换鍔★紝宸插仠姝㈡湰鍦拌疆璇? } };
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
      if (!response.ok) return { success: false, error: `鍙栨秷浠诲姟澶辫触锛圚TTP ${response.status}锛夛細${text.slice(0, 300)}` };
      const statusCode = data?.base_resp?.status_code;
      if (statusCode && statusCode !== 0) {
        return { success: false, baseResp: { statusCode, statusMsg: data?.base_resp?.status_msg }, error: data?.base_resp?.status_msg || `MiniMax 杩斿洖 status_code=${statusCode}` };
      }
      return { success: true, baseResp: { statusCode: 0, statusMsg: data?.base_resp?.status_msg } };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '鍙栨秷浠诲姟瓒呮椂锛?0 绉掞級' : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:download', async (_event, payload: { taskId: string; videoUrl: string; recordId: string }) => {
    try {
      const videoUrl = String(payload?.videoUrl || '').trim();
      const recordId = String(payload?.recordId || '').trim();
      if (!/^https?:\/\//i.test(videoUrl)) return { success: false, error: '鎴愮墖鍦板潃蹇呴』鏄?http(s) URL' };
      if (!recordId) return { success: false, error: 'recordId 涓嶈兘涓虹┖' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300_000);
      let response: Response;
      try {
        response = await fetch(videoUrl, { signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) return { success: false, error: `涓嬭浇鎴愮墖澶辫触锛圚TTP ${response.status}锛塦 };
      const arrayBuffer = await response.arrayBuffer();
      const bytes = arrayBuffer.byteLength;
      if (bytes === 0) return { success: false, error: '鎴愮墖鍐呭涓虹┖' };
      if (bytes > 500 * 1024 * 1024) return { success: false, error: `鎴愮墖 ${(bytes / 1024 / 1024).toFixed(1)} MB 瓒呰繃 500 MB 瀛樺偍涓婇檺` };
      const ext = (response.headers.get('content-type') || '').includes('webm') ? 'webm' : 'mp4';
      const safeName = `${recordId}.${ext}`;
      const filePath = path.join(videoGenDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath, fileName: safeName, bytes, mimeType: ext === 'webm' ? 'video/webm' : 'video/mp4' };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '涓嬭浇鎴愮墖瓒呮椂锛? 鍒嗛挓锛? : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  // 鎶婄敤鎴烽€夌殑鏈湴鍥句紶鍒?litterbox.catbox.moe锛堝厤璁よ瘉锛? 灏忔椂 TTL锛屼笓涓虹煭鏃跺垎浜璁★級锛?
  // 鎷垮埌 HTTPS URL 鍚庡啀鍠傜粰 MiniMax 瑙嗛鐢熸垚 API銆侻iniMax 绔姹傜礌鏉愬繀椤?https 鍙叕缃戣闂€?
  const LITTERBOX_ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php';
  const ALLOWED_REFERENCE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'audio/wav', 'audio/mpeg', 'audio/x-wav']);
  const ALLOWED_REFERENCE_EXT = /\.(png|jpe?g|webp|heic|heif|mp4|mov|wav|mp3)$/i;

  ipcMain.handle('video-generation:upload-reference', async (_event, payload: { name: string; mimeType: string; data: ArrayBuffer; ttlHours?: number }) => {
    try {
      const name = String(payload?.name || 'reference').slice(0, 120);
      const mimeType = String(payload?.mimeType || '').toLowerCase();
      if (!ALLOWED_REFERENCE_MIME.has(mimeType)) {
        return { success: false, error: `涓嶆敮鎸佺殑绱犳潗绫诲瀷锛?{mimeType || '鏈煡'}銆侻iniMax 浠呮帴鏀?PNG/JPEG/WEBP/HEIC 鍥剧墖涓?MP4/MOV 瑙嗛銆乄AV/MP3 闊抽銆俙 };
      }
      if (!ALLOWED_REFERENCE_EXT.test(name)) {
        return { success: false, error: '鏂囦欢鎵╁睍鍚嶉渶涓?png/jpg/jpeg/webp/heic/heif/mp4/mov/wav/mp3 涔嬩竴' };
      }
      const data = payload?.data;
      if (!(data instanceof ArrayBuffer)) return { success: false, error: '绱犳潗鏁版嵁缂哄け' };
      const bytes = Buffer.from(data);
      const imageMax = 30 * 1024 * 1024;
      const videoMax = 50 * 1024 * 1024;
      const audioMax = 15 * 1024 * 1024;
      const isImage = mimeType.startsWith('image/');
      const isVideo = mimeType.startsWith('video/');
      const isAudio = mimeType.startsWith('audio/');
      const cap = isImage ? imageMax : isVideo ? videoMax : isAudio ? audioMax : 0;
      if (!cap) return { success: false, error: '鏃犳硶璇嗗埆鐨勭礌鏉愮被鍒? };
      if (bytes.byteLength === 0) return { success: false, error: '鏂囦欢涓虹┖' };
      if (bytes.byteLength > cap) return { success: false, error: `${name} 瓒呰繃 ${(cap / 1024 / 1024).toFixed(0)} MB 涓婇檺锛堝綋鍓?${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB锛塦 };

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
      if (!response.ok) return { success: false, error: `litterbox 涓婁紶澶辫触锛圚TTP ${response.status}锛夛細${text.slice(0, 300)}` };
      const uploadedUrl = parseLitterboxUploadUrl(text);
      if (!uploadedUrl) {
        return { success: false, error: `litterbox 杩斿洖闈為鏈熷唴瀹癸細${text.slice(0, 300)}` };
      }
      return { success: true, url: uploadedUrl, ttlHours, bytes: bytes.byteLength };
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? '涓婁紶鍙傝€冪礌鏉愯秴鏃讹紙2 鍒嗛挓锛? : (err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('video-generation:read-blob', async (_event, filePath: string) => {
    return readVideoAsBlob(String(filePath || ''));
  });

  ipcMain.handle('video-generation:reveal', async (_event, filePath: string) => {
    try {
      const target = String(filePath || '');
      if (!target || !fs.existsSync(target)) return { success: false, error: '瑙嗛鏂囦欢涓嶅瓨鍦? };
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
      if (!target) return { success: false, error: 'filePath 涓嶈兘涓虹┖' };
      // 瀹夊叏鎶ゆ爮锛氬彧鍏佽鍒犻櫎 userData/video-generation 涓嬬殑鏂囦欢
      const resolved = path.resolve(target);
      const allowedRoot = path.resolve(videoGenDir) + path.sep;
      if (!resolved.startsWith(allowedRoot)) return { success: false, error: '绂佹鍒犻櫎鎻掍欢绠＄悊鐩綍涔嬪鐨勬枃浠? };
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

  // 鈹€鈹€ 閫氱敤 HTTP fetch锛堢粫杩?CORS锛屼緵 AI 宸ュ叿浣跨敤锛?鈹€鈹€
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


  // 鈹€鈹€ JSON 瀛樺偍 鈹€鈹€
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

  // 鈹€鈹€ SQLite 鏁版嵁搴撴寔涔呭寲 鈹€鈹€
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
      if (!fs.existsSync(filePath)) return { success: false, error: '缂撳瓨鏂囦欢涓嶅瓨鍦? };
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

  // 鈹€鈹€ 瀵硅瘽鎹曡幏瀛樺偍 鈹€鈹€
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

      let userMsg = '(鏃犳硶瑙ｆ瀽)';
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
        entryParts.push('', `---`, `### 馃 鐢ㄦ埛 鈥?${time}`, '', userMsg, '', `### 馃 AI 鈥?${time}`, '', payload.responseContent, '');
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

  // 鈹€鈹€ 瀵硅瘽鍘嗗彶绠＄悊 鈹€鈹€
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

  // 鈹€鈹€ 鎵嬪姩璁板繂绠＄悊 鈹€鈹€
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

  // 鈹€鈹€ 鎸夎矾寰勮鍙栨枃浠讹紙渚?AI 宸ュ叿浣跨敤锛?鈹€鈹€
  ipcMain.handle('dialog:readFileBuffer', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: '鏂囦欢涓嶅瓨鍦? };
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

  // 鈹€鈹€ 鏂囦欢瀵硅瘽妗?鈹€鈹€
  ipcMain.handle('dialog:pickFile', async (_event, options?: { accept?: string; multiple?: boolean }) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const filters = options?.accept
        ? [{ name: '鏂囦欢', extensions: options.accept.split(',').map((e) => e.replace(/^\./, '')) }]
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

  // 鈹€鈹€ 浠ｇ爜缂栬緫鍣ㄥ伐浣滃尯锛堢洰褰曟寜闇€璇诲彇锛屼笉閫掑綊鎵弿锛?鈹€鈹€
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
      // 涓嶅己鍒惰鐩栵紱濡傛灉宸插瓨鍦ㄥ垯鎶ラ敊锛堥櫎闈?force锛夈€?
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
      if (!input) return { success: false, error: '鍙厑璁稿鐞嗚棰戠敓鎴愮洰褰曞唴鐨勬枃浠? };
      const safeId = String(payload?.recordId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!safeId) return { success: false, error: 'recordId 涓嶈兘涓虹┖' };
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
      if (!previous || !next) return { success: false, error: '鍙厑璁稿垎鏋愯棰戠敓鎴愮洰褰曞唴鐨勬枃浠? };
      const binary = findMediaBinary('ffmpeg');
      if (!binary) return { success: false, error: '鏈壘鍒?FFmpeg' };
      const frameArgs = (input: string, last: boolean) => ['-hide_banner', '-loglevel', 'error', ...(last ? ['-sseof', '-0.3'] : []), '-i', input, ...(!last ? ['-t', '0.3'] : []), '-frames:v', '2', '-vf', 'fps=8,scale=64:64,format=rgb24', '-f', 'rawvideo', 'pipe:1'];
      const [tailRaw, headRaw] = await Promise.all([runVideoBinaryBuffer(binary, frameArgs(previous, true)), runVideoBinaryBuffer(binary, frameArgs(next, false))]);
      const frameBytes = 64 * 64 * 3;
      const frames = (buffer: Buffer) => { const result: Uint8Array[] = []; for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) result.push(buffer.subarray(offset, offset + frameBytes)); return result; };
      const tail = frames(tailRaw); const head = frames(headRaw);
      if (!tail.length || !head.length) throw new Error('鏃犳硶璇诲彇鎺ョ紳甯?);
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
      if (inputs.length < 3 || inputs.some((item) => !item)) return { success: false, error: '鎷兼帴鑷冲皯闇€瑕?3 涓湁鏁堢殑鐢熸垚瑙嗛' };
      const validInputs = inputs.filter((item): item is string => Boolean(item));
      const safeId = String(payload?.outputId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!safeId) return { success: false, error: 'outputId 涓嶈兘涓虹┖' };
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



  // 鈹€鈹€ Agent tasks 鈹€鈹€

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

  // 鈹€鈹€ Agent worktree conflicts 鈹€鈹€

  ipcMain.handle("workspace:getAgentWorktreeConflictVersions", async (_event, rootPath: string, sessionId: string, filePath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const data = await getAgentWorktreeConflictVersions(root, path.join(app.getPath("userData"), "agent-worktrees"), sessionId, filePath);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 鈹€鈹€ PR delivery 鈹€鈹€

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
      progress('started', `姝ｅ湪鎵ц ${operation}`);
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
          const read = (args: string[]) => runGit(root, args, 2 * 1024 * 1024, signal).catch((error) => `涓嶅彲鐢細${redactGitSecrets(error instanceof Error ? error.message : String(error))}`);
          const [gitVersion, credentialHelper, credentialManagerVersion, userName, userEmail] = await Promise.all([
            read(['--version']),
            read(['config', '--show-origin', '--get-all', 'credential.helper']),
            read(['credential-manager', '--version']),
            read(['config', '--get', 'user.name']),
            read(['config', '--get', 'user.email']),
          ]);
          data = [
            `Git: ${gitVersion || '鏈彂鐜?}`,
            `Credential Helper: ${credentialHelper || '鏈厤缃?}`,
            `Git Credential Manager: ${credentialManagerVersion || '鏈彂鐜?}`,
            `SSH Agent: ${process.env.SSH_AUTH_SOCK ? `宸茶繛鎺?(${process.env.SSH_AUTH_SOCK})` : '鏈彂鐜?SSH_AUTH_SOCK锛沇indows OpenSSH 鍙€氳繃 ssh-agent 鏈嶅姟鎻愪緵'}`,
            `鎻愪氦韬唤: ${userName || '鏈厤缃?} <${userEmail || '鏈厤缃?}>`,
            `HTTPS Proxy: ${process.env.HTTPS_PROXY || process.env.https_proxy || '鏈厤缃?}`,
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
        progress('completed', `${operation} 鎵ц瀹屾垚`);
        return { success: true, data };
      } catch (error) {
        const raw = redactGitSecrets(error instanceof Error ? error.message : String(error));
        if (timedOut) {
          progress('failed', '鎿嶄綔瓒呮椂');
          return { success: false, error: 'GIT_TIMEOUT' };
        }
        if (raw === 'GIT_CANCELLED' || raw.includes('abort') || raw.includes('cancel')) {
          progress('cancelled', '鎿嶄綔宸插彇娑?);
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

  // 鈹€鈹€ 鎵撳紑瀵硅瘽鏂囦欢澶?鈹€鈹€
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

  // 鈹€鈹€ Token 瀹夊叏瀛樺偍 鈹€鈹€
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

  // 鈹€鈹€ Model Context Protocol 鈹€鈹€
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

  // 鈹€鈹€ 缁堢 鈹€鈹€
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

  // 鈹€鈹€ MyCast (灞€鍩熺綉鎵嬫満鎶曞睆 + 鏂囦欢浼犺緭) 鈹€鈹€
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

  // 鈹€鈹€ Voice Engine (鏈湴璇煶杈撳叆) 鈹€鈹€
  setupVoiceIPC();
  startVoiceDaemon().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[voice] daemon warm-start failed:', err);
  });
  app.on('before-quit', () => {
    void shutdownVoiceDaemon();
  });
}
