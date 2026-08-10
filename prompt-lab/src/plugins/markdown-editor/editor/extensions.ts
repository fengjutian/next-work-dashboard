/**
 * Tiptap extensions 集合 — 业务层用到的节点/标记/扩展集中配置。
 *
 * 注意：所有 Tiptap 相关包只在这里和 createMarkdownEditor.ts 引用，业务层不直接 import。
 * 这是 markdown-codec 之外的另一层封装，让 Beta API 改动影响面可控。
 */

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from '@tiptap/markdown';
import type { AnyExtension } from '@tiptap/core';

/**
 * 注册在 Tiptap 中的常用语法高亮语言清单。
 * 不一次性加载全部语言，避免首屏体积膨胀。
 */
const SUPPORTED_LANGUAGES: ReadonlyArray<string> = [
  'plaintext',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'json',
  'bash',
  'shell',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'sql',
  'yaml',
  'markdown',
  'html',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  'diff',
  'dockerfile',
  'makefile',
  'ini',
  'toml',
  'xml',
  'graphql',
];

const lowlight = createLowlight(common);

export function getCommonExtensions(options: { placeholder?: string; editable?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // 启用 Markdown 双向转换需要 codeBlock 由低亮接管，故关闭内置的 codeBlock。
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
    }),
    Markdown.configure({
      indentation: { style: 'space', size: 2 },
      markedOptions: { gfm: true, breaks: false },
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? '开始输入 Markdown…' }),
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: true }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
      HTMLAttributes: { class: 'md-code-block' },
    }),
  ];
}

/** 暴露给 UI 的高亮语言清单（用于代码块语言选择器）。 */
export const SUPPORTED_CODE_LANGUAGES = SUPPORTED_LANGUAGES;
