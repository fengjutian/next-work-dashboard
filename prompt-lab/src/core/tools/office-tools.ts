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
    name: 'office_create',
    description: '创建空白 Word、Excel 或 PowerPoint 文档。此操作会打开保存位置选择窗口。',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['docx', 'xlsx', 'pptx'] } }, required: ['kind'], additionalProperties: false },
    execute: async (args) => {
      const kind = requiredString(args, 'kind');
      if (kind !== 'docx' && kind !== 'xlsx' && kind !== 'pptx') throw new Error('不支持的 Office 文档类型');
      const result = await officeApi().create(kind);
      if (!result.success) throw new Error(result.error === 'CANCELLED' ? '用户取消了创建' : result.error || '创建失败');
      return `已创建：${result.filePath}`;
    },
  },
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
  {
    name: 'office_add',
    description: '向 Office 文档的父级 DOM 路径新增元素。执行前必须由用户确认。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, path: { type: 'string' }, type: { type: 'string' }, properties: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['filePath', 'path', 'type'], additionalProperties: false },
    execute: async (args) => {
      const filePath = requiredString(args, 'filePath'); const path = requiredString(args, 'path'); const type = requiredString(args, 'type');
      const properties = Object.fromEntries(Object.entries((args.properties && typeof args.properties === 'object' && !Array.isArray(args.properties)) ? args.properties : {}).map(([key, value]) => [key, String(value)]));
      if (!Object.keys(properties).length) properties.text = '';
      if (!window.confirm(`AI 请求新增 Office 元素\n文件：${filePath}\n父级：${path}\n类型：${type}`)) throw new Error('用户取消了 Office 写操作');
      return output(await officeApi().add({ filePath, path, type, properties }));
    },
  },
  {
    name: 'office_remove',
    description: '删除 Office 文档中的指定元素。执行前必须由用户确认，且不能删除根节点。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, path: { type: 'string' } }, required: ['filePath', 'path'], additionalProperties: false },
    execute: async (args) => {
      const filePath = requiredString(args, 'filePath'); const path = requiredString(args, 'path');
      if (!window.confirm(`AI 请求删除 Office 元素\n文件：${filePath}\n元素：${path}`)) throw new Error('用户取消了 Office 写操作');
      return output(await officeApi().remove(filePath, path));
    },
  },
  {
    name: 'office_save',
    description: '将 OfficeCLI resident 中的最新修改显式保存到磁盘。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false },
    execute: async (args) => output(await officeApi().save(requiredString(args, 'filePath'))),
  },
  {
    name: 'office_render',
    description: '将 Office 文档渲染为自包含 HTML，供检查文档布局。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false },
    execute: async (args) => {
      const result = await officeApi().render(requiredString(args, 'filePath'));
      if (!result.success) throw new Error(result.error || '渲染失败');
      const html = result.html || '';
      return html.length > 100_000 ? `${html.slice(0, 100_000)}\n<!-- truncated: ${html.length} chars -->` : html;
    },
  },
  {
    name: 'office_merge',
    description: '使用 JSON 数据替换 Office 模板中的 {{key}} 占位符，并打开另存为窗口。',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, data: { type: 'object', additionalProperties: true } }, required: ['filePath', 'data'], additionalProperties: false },
    execute: async (args) => {
      const data = args.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data 必须是 JSON 对象');
      const result = await officeApi().merge(requiredString(args, 'filePath'), data as Record<string, unknown>);
      if (!result.success) throw new Error(result.error === 'CANCELLED' ? '用户取消了模板合并' : result.error || '模板合并失败');
      return `已生成：${result.filePath}`;
    },
  },
];
