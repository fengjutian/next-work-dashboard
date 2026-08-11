/**
 * MarkdownEditorSurface — Tiptap 可视化编辑器表面。
 *
 * 把 Tiptap 挂到容器，并对外暴露命令（通过 ref）。
 */

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Image as ImageIcon, CheckCircle, Info, ShieldAlert as AlertCircle, Loader2 } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useDocuments } from '../hooks/useMarkdownDocuments';
import { useMarkdownEditorSync } from '../hooks/useMarkdownEditorSync';
import { useImageDrop } from '../hooks/useImageDrop';
import { useWikiLinkNavigation } from '../hooks/useWikiLinkNavigation';
import { createMarkdownEditor, type EditorHandle, type CreateMarkdownEditorOptions } from '../editor/createMarkdownEditor';
import type { EditorCommand } from './MarkdownToolbar';
import type { MarkdownDocument } from '../types';
import type { MarkdownEditorPreferences } from '../constants';
import { FindReplacePanel } from './FindReplacePanel';
import type { WikiLinkMatch } from '../editor/wiki-link-parser';

export interface MarkdownEditorSurfaceProps {
  document: MarkdownDocument;
  preferences: MarkdownEditorPreferences;
  theme: string;
  onSave(document: MarkdownDocument): void | Promise<void>;
  onWikiLinkNavigate?(target: string, label: string, match: WikiLinkMatch): void;
}

export interface MarkdownEditorSurfaceHandle {
  runCommand(command: EditorCommand): void;
  getEditor(): EditorHandle | null;
  openFindReplace(): void;
}

export const MarkdownEditorSurface = forwardRef<MarkdownEditorSurfaceHandle, MarkdownEditorSurfaceProps>(({ document, preferences, theme, onSave, onWikiLinkNavigate }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const { updateContent, markDirty } = useDocuments();
  const { save } = useMarkdownEditorSync({ handle, preferences });

  useEffect(() => {
    if (!containerRef.current) return;
    const options: CreateMarkdownEditorOptions = {
      element: containerRef.current,
      placeholder: '开始输入 Markdown…',
      editable: true,
      onUpdate: (markdown) => {
        // Tiptap 已经更新；进一步处理由 useMarkdownEditorSync 接管。
        // 此处仅做"无修改回写为 saved"的快速判断。
        if (markdown === document.savedContent) {
          markDirty(document.id, false);
        }
        updateContent(document.id, markdown);
        markDirty(document.id, true);
      },
    };
    const instance = createMarkdownEditor(options);
    instance.loadFromMarkdown(document.savedContent);
    setHandle(instance);
    return () => {
      instance.destroy();
      setHandle(null);
    };
    // 仅在 document.id 变化时重建编辑器；其他字段变更走 useMarkdownEditorSync。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id]);

  const runCommand = useCallback((command: EditorCommand) => {
    if (!handle) return;
    const editor = handle.editor;
    switch (command.kind) {
      case 'undo':
        editor.chain().focus().undo().run();
        return;
      case 'redo':
        editor.chain().focus().redo().run();
        return;
      case 'heading':
        editor.chain().focus().toggleHeading({ level: command.level }).run();
        return;
      case 'toggleBold':
        editor.chain().focus().toggleBold().run();
        return;
      case 'toggleItalic':
        editor.chain().focus().toggleItalic().run();
        return;
      case 'toggleStrike':
        editor.chain().focus().toggleStrike().run();
        return;
      case 'toggleCode':
        editor.chain().focus().toggleCode().run();
        return;
      case 'toggleBulletList':
        editor.chain().focus().toggleBulletList().run();
        return;
      case 'toggleOrderedList':
        editor.chain().focus().toggleOrderedList().run();
        return;
      case 'toggleTaskList':
        editor.chain().focus().toggleTaskList().run();
        return;
      case 'toggleBlockquote':
        editor.chain().focus().toggleBlockquote().run();
        return;
      case 'toggleCodeBlock':
        editor.chain().focus().toggleCodeBlock().run();
        return;
      case 'insertTable':
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        return;
      case 'setHorizontalRule':
        editor.chain().focus().setHorizontalRule().run();
        return;
      case 'setLink': {
        const previous = editor.getAttributes('link').href;
        if (previous === command.href) {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href: command.href }).run();
        }
        return;
      }
      case 'setImage':
        editor.chain().focus().setImage({ src: command.src }).run();
        return;
      case 'openFindReplace':
        setFindOpen(true);
        return;
      default:
        return;
    }
  }, [handle]);

  useImperativeHandle(ref, () => ({
    runCommand,
    getEditor: () => handle,
    openFindReplace: () => setFindOpen(true),
  }), [runCommand, handle]);

  // Ctrl/Cmd+F 打开查找
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 拖放/粘贴图片
  const imageDrop = useImageDrop({
    editor: handle?.editor ?? null,
    rootPath: document.rootPath,
    documentRelativePath: document.relativePath,
  });
  const { isDragging: isImageDragging, status: imageStatus } = imageDrop;

  // Wiki Link 跳转（Ctrl/Cmd+click）
  useWikiLinkNavigation({
    editor: handle?.editor ?? null,
    onNavigate: (target, label, match) => onWikiLinkNavigate?.(target, label, match),
  });

  return (
    <div
      className={cn(
        'markdown-editor-surface relative h-full overflow-auto',
        theme === 'dark' ? 'bg-[#0d1117] text-foreground' : 'bg-background text-foreground',
      )}
      data-document-id={document.id}
      data-dragging={isImageDragging ? 'true' : undefined}
    >
      <style>{`
        .markdown-editor-surface .md-search-match {
          background-color: rgba(255, 215, 0, 0.4);
          border-radius: 2px;
        }
        .markdown-editor-surface .md-search-match-active {
          background-color: rgba(255, 165, 0, 0.7);
          outline: 1px solid rgba(255, 140, 0, 0.9);
        }
      `}</style>
      <div ref={containerRef} className="prose prose-sm max-w-none px-8 py-6 focus:outline-none dark:prose-invert" style={{ fontSize: `${preferences.fontSize}rem` }} />
      {/* Drop zone overlay — 拖入文件时高亮显示 */}
      {isImageDragging && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/5 transition-colors">
          <div className="flex flex-col items-center gap-2 text-primary">
            <ImageIcon className="h-10 w-10" />
            <div className="text-sm font-medium">放开以插入图片</div>
            <div className="text-xs text-muted-foreground">支持 PNG / JPG / GIF / WebP / SVG</div>
          </div>
        </div>
      )}
      {/* Image status toast */}
      {imageStatus && (
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-md',
            imageStatus.kind === 'uploading' && 'bg-foreground/85 text-background',
            imageStatus.kind === 'success' && 'bg-emerald-600 text-white',
            imageStatus.kind === 'error' && 'bg-rose-600 text-white',
          )}
        >
          {imageStatus.kind === 'uploading' && <Loader2 className="h-3 w-3 animate-spin" />}
          {imageStatus.kind === 'success' && <CheckCircle className="h-3 w-3" />}
          {imageStatus.kind === 'error' && <AlertCircle className="h-3 w-3" />}
          <span>{imageStatus.detail}</span>
        </div>
      )}
      <FindReplacePanel editor={handle?.editor ?? null} open={findOpen} onClose={() => setFindOpen(false)} />
    </div>
  );
});

MarkdownEditorSurface.displayName = 'MarkdownEditorSurface';
