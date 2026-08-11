/**
 * createMarkdownEditor — 构造一个 Tiptap Editor 实例并接入 markdown-codec。
 *
 * 这是业务层唯一会直接 new Tiptap 的地方。其它地方只看到 `EditorHandle` 接口，
 * 这样后续若要把 Tiptap 替换为其它富文本引擎，只需替换本文件。
 */

import { useEffect, useState } from 'react';
import { Editor } from '@tiptap/core';
import { decodeForEditor, encodeFromEditor, joinSegmentsWithPlaceholders, type DecodedMarkdown } from './markdown-codec';
import { getCommonExtensions } from './extensions';

export interface EditorHandle {
  /** Tiptap Editor 实例。业务层只在 mount/unmount 时使用它。 */
  editor: Editor;
  /** 把磁盘上的 Markdown 文本载入编辑器（自动跑 roundtrip-guard）。 */
  loadFromMarkdown(raw: string): { decoded: DecodedMarkdown; mode: 'visual' | 'source' };
  /** 把编辑器当前内容导出为可写盘的 Markdown 文本（包含 frontmatter 和受保护块）。 */
  exportToMarkdown(): string;
  /** 当前编辑器内文档对应的 DecodedMarkdown（用于外部判断 roundtrip 状态）。 */
  getDecoded(): DecodedMarkdown;
  /** 销毁。 */
  destroy(): void;
}

export interface CreateMarkdownEditorOptions {
  /** 容器元素。 */
  element: HTMLElement;
  /** 占位提示。 */
  placeholder?: string;
  /** 是否可编辑。 */
  editable?: boolean;
  /** 编辑器就绪/更新回调。 */
  onUpdate?: (markdown: string) => void;
  /** 编辑器内容变化（onUpdate 与 onTransaction 的合集）。 */
  onTransaction?: () => void;
}

/**
 * 构造 EditorHandle。会立刻把传入的 raw content 写入编辑器（如果非空）。
 */
export function createMarkdownEditor(options: CreateMarkdownEditorOptions): EditorHandle {
  let decoded: DecodedMarkdown = decodeForEditor('');
  const editor = new Editor({
    element: options.element,
    extensions: getCommonExtensions({ placeholder: options.placeholder, editable: options.editable }),
    content: '',
    editable: options.editable ?? true,
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      options.onUpdate?.(md);
      options.onTransaction?.();
    },
    onTransaction: () => options.onTransaction?.(),
  });

  return {
    editor,
    loadFromMarkdown(raw) {
      decoded = decodeForEditor(raw);
      const placeholderText = joinSegmentsWithPlaceholders(decoded.guardedBody.segments);
      editor.commands.setContent(placeholderText, { contentType: 'markdown' });
      const mode = decoded.protectedBlocks.length === 0 ? 'visual' : 'source';
      return { decoded, mode };
    },
    exportToMarkdown() {
      const body = editor.getMarkdown();
      return encodeFromEditor(body, decoded);
    },
    getDecoded() {
      return decoded;
    },
    destroy() {
      editor.destroy();
    },
  };
}

/**
 * React hook：在组件挂载/卸载时管理 Editor 生命周期。
 * 返回 { containerRef, handle, ready }。
 */
export function useMarkdownEditor(options: Omit<CreateMarkdownEditorOptions, 'element'>) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [handle, setHandle] = useState<EditorHandle | null>(null);

  useEffect(() => {
    if (!container) return;
    const instance = createMarkdownEditor({ ...options, element: container });
    setHandle(instance);
    return () => {
      instance.destroy();
      setHandle(null);
    };
    // options 由调用者通过 useCallback 稳定化；这里只跟 container 绑定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  return { containerRef: setContainer, handle, ready: handle !== null };
}
