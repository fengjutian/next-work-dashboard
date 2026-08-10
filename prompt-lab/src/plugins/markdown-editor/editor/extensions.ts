/**
 * Tiptap 扩展集合 — 为 markdown-editor 准备的 extension 数组。
 *
 * 关键设计：
 *  1. StarterKit 覆盖 90% 节点/标记（标题、列表、粗体、行内代码、代码块等），
 *     但 StarterKit 自带的 CodeBlock 不带语法高亮，这里关掉，
 *     用 CodeBlockLowlight 替代。
 *  2. P0 暂不注册 FrontmatterNode / WikiLinkNode / UnsupportedBlock：
 *     frontmatter 由 markdown-codec 在 Tiptap 之外处理；
 *     wiki link / MDX / JSX 命中"不支持语法"时直接降级到源码模式。
 *     这避免与 Tiptap markdown Beta 解析器的边界情况正面冲突。
 *  3. 所有扩展锁版本 3.29.x，由 createMarkdownEditor 处统一 verify。
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
import { Markdown } from '@tiptap/markdown';
import { common, createLowlight } from 'lowlight';

import type { Extensions } from '@tiptap/core';

/**
 * 共享的 lowlight 实例。只注册常用语言，避免首屏加载全部 ~190 种。
 * lowlight v3 使用 `common` 提供 36 种常用语法，足以覆盖 Markdown 文档场景。
 */
export const sharedLowlight = createLowlight(common);

/**
 * 创建 Tiptap 扩展数组。
 * `placeholder` 用于空文档时显示提示。
 *
 * 重要：`Markdown` 扩展必须放在数组前面。
 * 它会注册一个全局的 markdown manager，并给 Editor 类型加上
 * `getMarkdown()` / `setContent({ contentType: 'markdown' })` 能力。
 */
export function createExtensions(options: { placeholder?: string } = {}): Extensions {
  return [
    Markdown.configure({
      indentation: { style: 'space', size: 2 },
    }),
    StarterKit.configure({
      // 用 CodeBlockLowlight 替代默认 CodeBlock，关闭 StarterKit 自带版本
      codeBlock: false,
      // 不需要 link 的 openOnClick（编辑器内点击不应直接打开浏览器）
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? '开始输入 Markdown …（使用右上角切换源码）',
      emptyEditorClass: 'markdown-editor-is-empty',
    }),
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: true }),
    CodeBlockLowlight.configure({ lowlight: sharedLowlight, defaultLanguage: 'plaintext' }),
  ];
}
