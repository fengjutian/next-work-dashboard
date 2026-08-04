import { BrowserWindow, app, ipcMain, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import AutoLaunch from 'electron-auto-launch';
import { getMainWindow } from './globals';
import { fetchSiteFavicon } from './favicon';
import { saveToken, getToken, deleteToken, listServices, clearAll, isEncryptionAvailable } from '../auth/token-store';
import { createSession, write, resize, destroySession } from '../plugins/terminal/backend/terminal-manager';
import { discoverShellProfiles } from '../plugins/terminal/backend/shell-profiles';
import { resolveSecretReferences } from '../plugins/terminal/backend/environment';
import { resolveNewWorkspacePath, resolveWorkspacePath, authorizeWorkspace } from './workspace-path';
import { decodeWorkspaceText, encodeWorkspaceText, fileWasModified } from './workspace-text';
import {
  applyWorkspaceFileMutations,
  applyWorkspaceTextEdits,
  type WorkspaceFileMutation,
  type WorkspaceTextEdit,
} from './workspace-transaction';
import { redactGitSecrets } from './git-security';
import { parseGitLog } from './git-history';
import { classifyGitError } from './git-diagnostics';
import { parseGitBranches } from './git-overview';
import { findSemanticMatches, type SemanticMatch } from './semantic-search';
import { parseWorkspaceTasks, type WorkspaceTaskDefinition } from './workspace-tasks';
import { WorkspaceTaskRunner } from './task-runner';
import { detectRenameRename, parseUnmergedIndex } from './git-rename-conflict';
import { createTypeScriptSemanticIndex } from './typescript-language-service';
import {
  createKnowledgeDocumentFromTemplate,
  readKnowledgeDocument,
  renameKnowledgeDocumentWithBacklinks,
  scanKnowledgeWorkspace,
  searchKnowledgeWorkspace,
} from './knowledge-workspace';
import {
  clearLanceMemoryIndex,
  replaceLanceMemoryIndex,
  searchLanceMemory,
  type LanceMemoryChunk,
} from './lancedb-memory';
import { mcpManager } from './mcp/mcp-manager';
import type { McpServerConfig } from '../types/mcp';
import { createAgentWorktree, discardAgentWorktree, getAgentWorktreeStatus, getAgentWorktreeConflictVersions, mergeAgentWorktree, previewAgentWorktreeMerge } from './agent-worktree';
import { agentTaskService } from './agent-task-service';
import { deliverAgentPR, pushAgentBranch, createGitHubPR, registerPRProvider, type PRDeliveryConfig } from './pr-delivery';
import type { AgentTaskConfig } from './agent-task-types';

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
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) tasks.push({ name: `npm: ${name}`, command: `npm run ${name}`, detail: command, dependsOn: [], dependsOrder: 'sequence', isBackground: false, problemMatcher: name === 'lint' ? '$eslint-stylish' : undefined });
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
  const mw = getMainWindow();
  if (!mw) return;
  let workspaceWatcher: fs.FSWatcher | null = null;

  // 暴露 webview preload 路径给渲染进程
  ipcMain.handle('get-webview-preload-path', () => {
    return webviewPreloadPath;
  });

  // WebView 右键菜单 (B05)
  mw.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate([
      {
        label: '注入选中提示词',
        enabled: !!params,
        click: () => {
          mw.webContents.send('inject-from-context-menu');
        },
      },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
    ]).popup();
  });

  // ── 提示词注入 ──
  ipcMain.handle('inject-prompt', async (_event, payload: {
    webviewId: number;
    text: string;
    inputSelector: string;
    submitSelector?: string;
    autoSubmit: boolean;
  }) => {
    const webview = mw.webContents;
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
  ipcMain.handle('window-minimize', () => mw.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mw.isMaximized()) mw.unmaximize();
    else mw.maximize();
  });
  ipcMain.handle('window-is-maximized', () => mw.isMaximized());
  ipcMain.handle('window-close', () => mw.close());

  // ── 窗口置顶 ──
  ipcMain.handle('window-toggle-always-on-top', () => {
    const ontop = !mw.isAlwaysOnTop();
    mw.setAlwaysOnTop(ontop);
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
  const exportDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'conversations');

  // ── favicon ──
  ipcMain.handle('fetch-favicon', async (_event, siteUrl: string) => {
    return await fetchSiteFavicon(siteUrl);
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
    const match = file.match(/^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/);
    const filePath = path.join(exportDir, file);
    const stat = fs.statSync(filePath);
    let title: string | undefined;
    let notes: string | undefined;
    try {
      const head = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
      title = head.match(/^# (.+)$/m)?.[1].trim();
      notes = head.match(/^> (.+)$/m)?.[1].trim();
    } catch { /* keep undefined */ }
    return { site: match?.[1] || 'unknown', date: match?.[2] || '', fileName: file,
      path: filePath, size: stat.size, modifiedAt: stat.mtimeMs, title, notes };
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

      const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        list.push(conversationMetadata(file));
      }

      list.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return list;
    } catch {
      return [];
    }
  });

  ipcMain.handle('search-conversations', async (_event, rawQuery: string) => {
    const query = String(rawQuery || '').trim().toLocaleLowerCase();
    if (query.length < 2 || !fs.existsSync(exportDir)) return [];
    const results = [];
    for (const fileName of fs.readdirSync(exportDir).filter((file) => file.endsWith('.md'))) {
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
        properties: ['openFile'],
        filters: filters.length > 0 ? filters : undefined,
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const buf = fs.readFileSync(filePath);
          const name = path.basename(filePath);
          const ext = path.extname(name).toLowerCase();
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
          return {
            path: filePath,
            name,
            size: buf.length,
            content: buf.toString('base64'),
            mimeType: mimeMap[ext] ?? 'application/octet-stream',
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
      return { success: true, data: scanKnowledgeWorkspace(rootPath) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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

  ipcMain.handle('workspace:listTasks', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      return { success: true, data: loadWorkspaceTaskDefinitions(root) };
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

  ipcMain.handle('workspace:gitCommit', async (_event, rootPath: string, message: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const normalizedMessage = message.trim();
      if (!normalizedMessage || normalizedMessage.length > 5000) return { success: false, error: 'INVALID_COMMIT_MESSAGE' };
      const output = execFileSync('git', ['commit', '-m', normalizedMessage], {
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
    _event,
    rootPath: string,
    operation: string,
    payload: Record<string, unknown> = {},
  ) => {
    const root = resolveWorkspacePath(rootPath);
    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const progress = (state: 'started' | 'completed' | 'failed' | 'cancelled', message: string) => {
      mw.webContents.send('workspace:gitProgress', { operationId, operation, state, message });
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

  ipcMain.handle('workspace:watch', async (_event, rootPath: string) => {
    try {
      workspaceWatcher?.close();
      const root = resolveWorkspacePath(rootPath);
      workspaceWatcher = fs.watch(root, { recursive: true }, (eventType, fileName) => {
        if (!fileName) return;
        const relativePath = String(fileName);
        if (relativePath.split(/[\\/]/).some((part) => WORKSPACE_IGNORED_NAMES.has(part))) return;
        mw.webContents.send('workspace:fileChanged', {
          path: relativePath,
          type: eventType === 'rename' ? 'rename' : 'change',
        });
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:unwatch', () => {
    workspaceWatcher?.close();
    workspaceWatcher = null;
  });
  mw.webContents.once('destroyed', () => workspaceWatcher?.close());

  ipcMain.handle('dialog:saveFile', async (_event, content: string, defaultName?: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName ?? 'untitled.txt',
      });
      if (result.canceled || !result.filePath) return { success: false };
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('dialog:writeTextFile', async (_event, filePath: string, content: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return { success: false, error: 'FILE_NOT_FOUND' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true, path: resolved };
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

  ipcMain.handle('terminal:create', async (_event, id: string, cwd?: string, profile?: { name: string; shell: string; args?: string[]; env?: Record<string, string> }) => {
    try {
      const safeProfile = profile ? { ...profile, env: resolveSecretReferences(profile.env ?? {}, (name) => getToken(`terminal-env:${name}`)) } : undefined;
      const session = createSession(id, cwd, safeProfile);
      session.pty.onData((data: string) => {
        mw.webContents.send(`terminal:data:${id}`, data);
      });
      session.pty.onExit(({ exitCode }) => {
        mw.webContents.send(`terminal:exit:${id}`, exitCode);
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
}
