/**
 * Slash Command 静态数据 + 过滤逻辑。
 *
 * 与 extensions/slash-command.ts 分离，因为这些是纯函数，可被测试 import。
 */

import type { Editor } from '@tiptap/core';

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  command: (editor: Editor) => void;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: 'h1', title: '一级标题', description: '大号标题', keywords: ['h1', 'heading', 'title', '标题'], command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', title: '二级标题', description: '中号标题', keywords: ['h2', 'heading', 'subtitle', '标题'], command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', title: '三级标题', description: '小号标题', keywords: ['h3', 'heading', '标题'], command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'h4', title: '四级标题', description: '更小标题', keywords: ['h4', 'heading', '标题'], command: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run() },
  { id: 'paragraph', title: '正文', description: '普通段落', keywords: ['p', 'paragraph', 'text', '正文'], command: (editor) => editor.chain().focus().setParagraph().run() },
  { id: 'bullet', title: '无序列表', description: '· 项目符号', keywords: ['ul', 'bullet', 'list', '列表'], command: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: 'ordered', title: '有序列表', description: '1. 编号列表', keywords: ['ol', 'ordered', 'list', '编号'], command: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: 'task', title: '任务列表', description: '☑ 复选框列表', keywords: ['task', 'todo', 'checklist', '任务'], command: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: 'quote', title: '引用', description: '> 块引用', keywords: ['quote', 'blockquote', '引用'], command: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: 'code', title: '代码块', description: '``` 围栏代码', keywords: ['code', 'pre', '代码'], command: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: 'divider', title: '分隔线', description: '--- 水平线', keywords: ['hr', 'divider', 'line', '分隔'], command: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: 'table', title: '表格', description: '插入 3×3 表格', keywords: ['table', '表格'], command: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

export function filterCommands(query: string): SlashCommandItem[] {
  if (!query) return SLASH_COMMANDS;
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((item) =>
    item.title.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    item.keywords.some((kw) => kw.toLowerCase().includes(q)),
  );
}

export function findCommand(id: string): SlashCommandItem | undefined {
  return SLASH_COMMANDS.find((item) => item.id === id);
}
