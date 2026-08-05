import type { ToolDefinition } from './types';

let workspaceRoot: string | null = null;
const readVersions = new Map<string, number>();

export function configureCodeWorkspace(root: string | null): void {
  if (workspaceRoot !== root) readVersions.clear();
  workspaceRoot = root;
}

function requireWorkspace(): string {
  if (!workspaceRoot) throw new Error('请先在代码编程场景中选择本地代码文件夹');
  return workspaceRoot;
}

export const codeWorkspaceTools: ToolDefinition[] = [
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
      const result = await window.electronAPI.workspace.writeTextFile(
        requireWorkspace(),
        path,
        String(args.content),
        { expectedModifiedAt: readVersions.get(path) },
      );
      if (!result.success) {
        if (result.error === 'FILE_MODIFIED_EXTERNALLY') throw new Error(`${path} 在 AI 读取后发生了变化，请重新读取并基于最新内容修改`);
        throw new Error(result.error ?? '无法写入文件');
      }
      if (result.data) readVersions.set(path, result.data.modifiedAt);
      return `已更新 ${path}`;
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
      const root = requireWorkspace();
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
      return `已对 ${path} 应用 ${edits.length} 处修改`;
    },
  },
];
