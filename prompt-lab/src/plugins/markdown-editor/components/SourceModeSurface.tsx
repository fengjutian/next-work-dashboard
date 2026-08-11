/**
 * SourceModeSurface — Monaco-based 源码编辑表面。
 *
 * 复用项目已有的 monaco-setup；line number / 语法高亮 / 查找替换 多光标全部交给 Monaco。
 *
 * 与 MarkdownEditorSurface 一样在父级暴露"保存"动作（Ctrl/Cmd+S）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useDocuments } from '../hooks/useMarkdownDocuments';
import { configureMonaco } from '@/lib/monaco-setup';
import type { MarkdownDocument } from '../types';

configureMonaco();

export interface SourceModeSurfaceProps {
  document: MarkdownDocument;
  onSave(document: MarkdownDocument): void | Promise<void>;
}

export const SourceModeSurface: React.FC<SourceModeSurfaceProps> = ({ document, onSave }) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { updateContent, markDirty } = useDocuments();
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() => {
    if (typeof window === 'undefined') return 'vs';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs';
  });

  // 监听系统主题变化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setTheme(media.matches ? 'vs-dark' : 'vs');
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const handleMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monaco.editor.setModelLanguage(editorInstance.getModel() ?? monaco.editor.createModel('', 'markdown'), 'markdown');
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void onSave(document);
    });
  }, [document, onSave]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      const dirty = value !== document.savedContent;
      updateContent(document.id, value);
      markDirty(document.id, dirty);
    },
    [document.id, document.savedContent, markDirty, updateContent],
  );

  return (
    <div className="h-full" data-document-id={document.id}>
      <MonacoEditor
        path={`markdown-editor://${document.id}`}
        language="markdown"
        value={document.content}
        theme={theme}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          minimap: { enabled: false },
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
};
