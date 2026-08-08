import type { ToolDefinition } from './types';

function officeApi() {
  if (!window.electronAPI?.office) throw new Error('Office Studio 不可用');
  return window.electronAPI.office;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const candidate = args[key];
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (!value) throw new Error(`缺少参数 ${key}`);
  return value;
}

function output(result: { success: boolean; output?: string; error?: string }): string {
  if (!result.success) throw new Error(result.error || 'Office 操作失败');
  return result.output || '操作成功';
}

export const officeTools: ToolDefinition[] = [
  {
    name: 'office_read',
    description: '使用 OfficeCLI 读取 Word、Excel 或 PowerPoint 文档的结构，返回稳定的 outline 文本。',
    parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Office 文件绝对路径' } }, required: ['filePath'], additionalProperties: false },
    execute: async (args) => output(await officeApi().outline(requiredString(args, 'filePath'))),
  },
  {
    name: 'office_query',
    description: '查询 Office 文档元素。selector 使用 OfficeCLI CSS-like 选择器，例如 *、paragraph 或 shape。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, selector: { type: 'string' } }, required: ['filePath', 'selector'], additionalProperties: false },
    execute: async (args) => output(await officeApi().query(requiredString(args, 'filePath'), requiredString(args, 'selector'))),
  },
  {
    name: 'office_get_element',
    description: '按 DOM 路径读取 Office 文档元素及其属性，返回 JSON。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, path: { type: 'string', description: '例如 /body/p[1] 或 /slide[1]/shape[1]' } }, required: ['filePath', 'path'], additionalProperties: false },
    execute: async (args) => output(await officeApi().get(requiredString(args, 'filePath'), requiredString(args, 'path'), 3)),
  },
  {
    name: 'office_update',
    description: '修改 Office 文档中一个元素的属性。执行前必须由用户确认。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string' }, path: { type: 'string' },
        properties: { type: 'object', description: '属性键值，例如 {"text":"新标题","bold":"true"}', additionalProperties: { type: 'string' } },
      },
      required: ['filePath', 'path', 'properties'], additionalProperties: false,
    },
    execute: async (args) => {
      const filePath = requiredString(args, 'filePath');
      const path = requiredString(args, 'path');
      const properties = args.properties;
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('properties 必须是对象');
      const normalized = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, String(value)]));
      if (!window.confirm(`AI 请求修改 Office 文档\n文件：${filePath}\n元素：${path}\n属性：${JSON.stringify(normalized, null, 2)}`)) throw new Error('用户取消了 Office 写操作');
      return output(await officeApi().set({ filePath, path, properties: normalized }));
    },
  },
];
