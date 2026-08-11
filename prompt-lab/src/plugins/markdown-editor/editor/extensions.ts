/**
 * Tiptap extensions 集合 — 业务层用到的节点/标记/扩展集中配置。
 *
 * 注意：所有 Tiptap 相关包只在这里和 createMarkdownEditor.ts 引用，业务层不直接 import。
 * 这是 markdown-codec 之外的另一层封装，让 Beta API 改动影响面可控。
 */

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import { grammars as commonGrammars } from 'lowlight/lib/common';
import { Markdown } from '@tiptap/markdown';
import type { AnyExtension } from '@tiptap/core';
import { SearchReplaceExtension } from '../extensions/search-replace';
import { SlashCommandExtension } from '../extensions/slash-command';
import { WikiLinkExtension } from '../extensions/wiki-link';

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

const lowlight = createLowlight(commonGrammars);

export function getCommonExtensions(options: { placeholder?: string; editable?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
    }),
    Markdown.configure({
      indentation: { style: 'space', size: 2 },
      markedOptions: { gfm: true, breaks: false },
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? '开始输入 Markdown…' }),
    TableKit.configure({
      table: { resizable: true, allowTableNodeSelection: true, renderWrapper: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: true }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
      HTMLAttributes: { class: 'md-code-block' },
    }),
    SearchReplaceExtension,
    SlashCommandExtension,
    WikiLinkExtension,
  ];
}

export const SUPPORTED_CODE_LANGUAGES = SUPPORTED_LANGUAGES;
