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
];
