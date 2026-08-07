import type { ToolDefinition } from './types';

let workspaceRoot: string | null = null;
let sourceWorkspaceRoot: string | null = null;
let workspaceSessionId = 'chat';
let isolatedWorkspace: { path: string; branch: string } | null = null;
const readVersions = new Map<string, number>();

export function configureCodeWorkspace(root: string | null, sessionId = 'chat'): void {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'chat';
  if (sourceWorkspaceRoot !== root || workspaceSessionId !== safeSessionId) {
    readVersions.clear();
    isolatedWorkspace = null;
  }
  sourceWorkspaceRoot = root;
  workspaceRoot = root;
  workspaceSessionId = safeSessionId;
}

function requireWorkspace(): string {
  if (!workspaceRoot) throw new Error('请先在代码编程场景中选择本地代码文件夹');
  return workspaceRoot;
}

async function requireIsolatedWorkspace(): Promise<{ root: string; branch: string }> {
  if (isolatedWorkspace) return { root: isolatedWorkspace.path, branch: isolatedWorkspace.branch };
  if (!sourceWorkspaceRoot) throw new Error('请先选择代码工作区');
  const result = await window.electronAPI.workspace.createAgentWorktree(sourceWorkspaceRoot, workspaceSessionId);
  if (!result.success || !result.data) throw new Error(result.error ?? '无法创建隔离 Worktree');
  isolatedWorkspace = { path: result.data.path, branch: result.data.branch };
  workspaceRoot = result.data.path;
  readVersions.clear();
  return { root: result.data.path, branch: result.data.branch };
}

export const codeWorkspaceTools: ToolDefinition[] = [
  {
    name: 'workspace_list_scripts',
    description: '列出当前代码工作区 package.json 中允许 Agent 运行的 npm scripts。',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const result = await window.electronAPI.workspace.listAgentScripts(requireWorkspace());
      if (!result.success) throw new Error(result.error ?? '无法读取项目脚本');
      const scripts = result.data ?? {};
      return Object.entries(scripts).map(([name, command]) => `${name}: ${command}`).join('\n') || '当前项目没有 package.json scripts';
    },
  },
  {
    name: 'workspace_run_script',
    description: '运行当前工作区 package.json 中已经存在的 npm script。不能执行任意 Shell 命令；子进程不会继承 API Key 等敏感环境变量，并受超时和输出上限约束。运行前应先使用 workspace_list_scripts 确认脚本名称。',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'package.json scripts 中的准确名称，例如 lint、test、typecheck' },
        timeoutMs: { type: 'number', description: '可选超时时间，1000 至 600000 毫秒，默认 120000' },
      },
      required: ['script'],
    },
    execute: async (args) => {
      const isolation = await requireIsolatedWorkspace();
      const timeout = Number(args.timeoutMs);
      const result = await window.electronAPI.workspace.runAgentScript(
        isolation.root,
        String(args.script ?? ''),
        Number.isFinite(timeout) ? Math.max(1000, Math.min(600_000, timeout)) : undefined,
      );
      if (!result.success || !result.data) throw new Error(result.error ?? '项目脚本执行失败');
      return [`隔离分支: ${isolation.branch}`, `脚本: ${result.data.script}`, `命令: ${result.data.command}`, `退出码: ${result.data.exitCode}`, result.data.output || '无输出'].join('\n');
    },
  },
  {
    name: 'workspace_list_files',
    description: '列出当前代码工作区中的文件，用于了解项目结构。',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const result = await window.electronAPI.workspace.listFiles(requireWorkspace());
      if (!result.success) throw new Error(result.error ?? '无法列出工作区文件');
      return (result.data ?? []).slice(0, 500).map((entry) => entry.path).join('\n');
    },
  },
  {
    name: 'workspace_read_file',
    description: '读取当前代码工作区内的文本文件。路径必须是相对于工作区根目录的路径。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对于工作区根目录的文件路径' } },
      required: ['path'],
    },
    execute: async (args) => {
      const result = await window.electronAPI.workspace.readTextFile(requireWorkspace(), String(args.path));
      if (!result.success || !result.data) throw new Error(result.error ?? '无法读取文件');
      readVersions.set(String(args.path), result.data.modifiedAt);
      return result.data.content;
    },
  },
  {
    name: 'workspace_write_file',
    description: '修改当前代码工作区内的文本文件。用户要求修改、修复、实现或重构代码时应直接调用，不要再次请求确认。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于工作区根目录的文件路径' },
        content: { type: 'string', description: '完整的新文件内容' },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const path = String(args.path);
      const isolation = await requireIsolatedWorkspace();
      const result = await window.electronAPI.workspace.writeTextFile(
        isolation.root,
        path,
        String(args.content),
        { expectedModifiedAt: readVersions.get(path) },
      );
      if (!result.success) {
        if (result.error === 'FILE_MODIFIED_EXTERNALLY') throw new Error(`${path} 在 AI 读取后发生了变化，请重新读取并基于最新内容修改`);
        throw new Error(result.error ?? '无法写入文件');
      }
      if (result.data) readVersions.set(path, result.data.modifiedAt);
      return `已在隔离分支 ${isolation.branch} 更新 ${path}`;
    },
  },
  {
    name: 'workspace_edit_file',
    description: '对工作区文本文件执行精确的局部替换。用户要求修改代码时优先使用；直接执行，不要再次请求确认。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于工作区根目录的文件路径' },
        edits: {
          type: 'array',
          description: '按顺序执行的文本替换',
          items: {
            type: 'object',
            properties: {
              oldString: { type: 'string', description: '文件中现有的、应当唯一匹配的文本' },
              newString: { type: 'string', description: '替换后的文本' },
            },
            required: ['oldString', 'newString'],
          },
        },
      },
      required: ['path', 'edits'],
    },
    execute: async (args) => {
      const isolation = await requireIsolatedWorkspace();
      const root = isolation.root;
      const path = String(args.path);
      const edits = Array.isArray(args.edits) ? args.edits as Array<{ oldString?: unknown; newString?: unknown }> : [];
      if (!edits.length) throw new Error('没有收到有效的编辑内容');
      const read = await window.electronAPI.workspace.readTextFile(root, path);
      if (!read.success || !read.data) throw new Error(read.error ?? `无法读取 ${path}`);
      let content = read.data.content;
      for (const edit of edits) {
        const oldString = String(edit.oldString ?? '');
        const newString = String(edit.newString ?? '');
        if (!oldString || !content.includes(oldString)) throw new Error(`${path} 中未找到要替换的原文，请重新读取文件`);
        content = content.replace(oldString, newString);
      }
      const written = await window.electronAPI.workspace.writeTextFile(root, path, content, { expectedModifiedAt: read.data.modifiedAt });
      if (!written.success) throw new Error(written.error === 'FILE_MODIFIED_EXTERNALLY' ? `${path} 已被外部修改，请重新读取` : written.error ?? `无法写入 ${path}`);
      if (written.data) readVersions.set(path, written.data.modifiedAt);
      return `已在隔离分支 ${isolation.branch} 对 ${path} 应用 ${edits.length} 处修改`;
    },
  },
];
