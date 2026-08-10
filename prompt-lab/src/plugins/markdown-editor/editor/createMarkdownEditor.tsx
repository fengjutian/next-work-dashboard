/**
 * createMarkdownEditor — Tiptap React 编辑器的薄封装。
 *
 * 责任：
 *  1. 用 createExtensions 构造 Tiptap 实例。
 *  2. 在挂载时调用 setContent({ contentType: 'markdown' }) 加载正文。
 *  3. 在内容变化时通过 onChange 把当前 markdown 文本回传。
 *  4. 对外暴露 MarkdownEditorHandle：获取/设置 markdown、聚焦、滚动到大纲。
 *
 * 业务组件用 useImperativeHandle 拿到该 handle 即可，避免直接操作 Tiptap 实例。
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
// 引入 @tiptap/markdown 以加载它对 @tiptap/core 的模块增强（getMarkdown / contentType）
import type {} from '@tiptap/markdown';

import { createExtensions } from './extensions';
import type { EditorMode } from '../types';

export interface MarkdownEditorHandle {
  focus(): void;
  /** 获取当前 markdown 文本（不含 frontmatter） */
  getMarkdown(): string;
  /** 用 markdown 文本覆盖当前内容（不含 frontmatter） */
  setMarkdown(markdown: string): void;
  /** 滚动到指定行（1-based） */
  scrollToLine(line: number): void;
  /** 当前模式 */
  mode: EditorMode;
  /** 当前选区起点在大纲中的近似行号（用于大纲同步） */
  cursorLine(): number;
}

export interface MarkdownEditorProps {
  /** 编辑器初始 markdown 正文（不含 frontmatter） */
  initialMarkdown: string;
  /** 内容变化回调 */
  onChange: (markdown: string) => void;
  /** 选区变化回调（用于大纲联动） */
  onSelectionChange?: (info: { line: number; from: number; to: number }) => void;
  /** 工具栏命令执行入口（由父组件注入，参考 MarkdownToolbar 暴露的命令） */
  registerCommands?: (handler: MarkdownEditorCommands | null) => void;
  /** 只读 */
  readOnly?: boolean;
  /** 编辑器高度策略（默认填满父容器） */
  className?: string;
}

export interface MarkdownEditorCommands {
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrike: () => void;
  toggleCode: () => void;
  toggleHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void;
  setParagraph: () => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  toggleTaskList: () => void;
  toggleBlockquote: () => void;
  toggleCodeBlock: () => void;
  insertHorizontalRule: () => void;
  insertTable: () => void;
  insertLink: (url: string) => void;
  insertImage: (src: string, alt?: string) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
}

function commandsFromEditor(editor: Editor | null): MarkdownEditorCommands | null {
  if (!editor) return null;
  return {
    toggleBold: () => editor.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.chain().focus().toggleItalic().run(),
    toggleStrike: () => editor.chain().focus().toggleStrike().run(),
    toggleCode: () => editor.chain().focus().toggleCode().run(),
    toggleHeading: (level) => editor.chain().focus().toggleHeading({ level }).run(),
    setParagraph: () => editor.chain().focus().setParagraph().run(),
    toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () => editor.chain().focus().toggleOrderedList().run(),
    toggleTaskList: () => editor.chain().focus().toggleTaskList().run(),
    toggleBlockquote: () => editor.chain().focus().toggleBlockquote().run(),
    toggleCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    insertHorizontalRule: () => editor.chain().focus().setHorizontalRule().run(),
    insertTable: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    insertLink: (url) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        editor.chain().focus().insertContent(`[${url}](${url})`).run();
      } else {
        editor.chain().focus().setLink({ href: url }).run();
      }
    },
    insertImage: (src, alt) => editor.chain().focus().setImage({ src, alt }).run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    selectAll: () => editor.chain().focus().selectAll().run(),
  };
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  ({ initialMarkdown, onChange, onSelectionChange, registerCommands, readOnly, className }, ref) => {
    const initialSetRef = useRef(false);
    const editor = useEditor({
      extensions: createExtensions(),
      editable: !readOnly,
      content: '',
      onUpdate: ({ editor: e }) => {
        // 第一次 setContent 是我们手动调用的，不应该触发 onChange
        if (!initialSetRef.current) return;
        const md = e.getMarkdown?.() ?? e.getText();
        onChange(md);
      },
      onSelectionUpdate: ({ editor: e }) => {
        if (!onSelectionChange) return;
        const { from, to } = e.state.selection;
        const line = approximateLine(e, from);
        onSelectionChange({ line, from, to });
      },
    });

    // 初次加载正文
    useEffect(() => {
      if (!editor) return;
      if (initialSetRef.current) return;
      if (typeof editor.commands.setContent !== 'function') return;
      // 使用 queueMicrotask 避免在 effect 中同步触发 onUpdate
      queueMicrotask(() => {
        if (!editor || initialSetRef.current) return;
        editor.commands.setContent(initialMarkdown, { contentType: 'markdown' });
        initialSetRef.current = true;
      });
    }, [editor, initialMarkdown]);

    // 只读状态同步
    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    // 命令句柄暴露
    useEffect(() => {
      if (!registerCommands) return;
      registerCommands(commandsFromEditor(editor));
      return () => registerCommands(null);
    }, [editor, registerCommands]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        getMarkdown: () => {
          if (!editor) return '';
          return editor.getMarkdown?.() ?? editor.getText();
        },
        setMarkdown: (markdown) => {
          if (!editor) return;
          editor.commands.setContent(markdown, { contentType: 'markdown' });
        },
        scrollToLine: (line) => {
          if (!editor) return;
          const doc = editor.state.doc;
          const target = Math.max(1, Math.min(line, doc.childCount));
          // 简化：定位到第 N 个 block 起点
          try {
            const node = doc.child(target - 1);
            if (node) {
              const pos = doc.child(target - 1) ? 0 : 0; // 简化：不计算精确偏移
              const approx = Math.min(editor.state.doc.content.size, (target - 1) * 80);
              editor.commands.focus(approx);
            }
          } catch {
            // ignore
          }
        },
        mode: 'wysiwyg',
        cursorLine: () => {
          if (!editor) return 1;
          return approximateLine(editor, editor.state.selection.from);
        },
      }),
      [editor],
    );

    return (
      <div
        className={
          'markdown-editor-content h-full overflow-y-auto bg-background px-12 py-8 ' +
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none ' +
          (className ?? '')
        }
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);

MarkdownEditor.displayName = 'MarkdownEditor';

function approximateLine(editor: Editor, pos: number): number {
  // 简化版：用 doc.textBetween 取前 pos 个字符再统计换行
  try {
    const text = editor.state.doc.textBetween(0, pos, '\n');
    return text.split('\n').length;
  } catch {
    return 1;
  }
}
