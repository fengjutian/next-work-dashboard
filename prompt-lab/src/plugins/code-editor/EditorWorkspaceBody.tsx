import React from 'react';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { Code, X } from '../../components/icons';
import { Button } from '../../components/ui/button';
import type { EditorPreferences, OpenDocument } from './editor-types';

interface Props {
  activeDocument: OpenDocument | null;
  secondaryDocument: OpenDocument | null;
  editorPath?: string;
  dark: boolean;
  preferences: EditorPreferences;
  inlineEdit: { instruction: string; visible: boolean };
  aiEditing: boolean;
  onInlineEditChange: (instruction: string) => void;
  onInlineEditCancel: () => void;
  onInlineEditRun: () => void;
  onMount: OnMount;
  onDocumentChange: (path: string, value: string) => void;
  onCloseSecondary: () => void;
  onOpenWorkspace: () => void;
  onOpenFile: () => void;
}

const optionsFor = (preferences: EditorPreferences, readOnly?: boolean) => ({
  automaticLayout: true,
  glyphMargin: true,
  fontFamily: "'Cascadia Code', 'SF Mono', Consolas, monospace",
  fontSize: preferences.fontSize,
  lineHeight: Math.round(preferences.fontSize * 1.55),
  minimap: { enabled: preferences.minimap },
  padding: { top: 8 },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  tabSize: preferences.tabSize,
  wordWrap: preferences.wordWrap,
  readOnly,
} as const);

export const EditorWorkspaceBody: React.FC<Props> = ({
  activeDocument, secondaryDocument, editorPath, dark, preferences, inlineEdit,
  aiEditing, onInlineEditChange, onInlineEditCancel, onInlineEditRun, onMount,
  onDocumentChange, onCloseSecondary, onOpenWorkspace, onOpenFile,
}) => activeDocument ? (
  <div className="flex min-h-0 flex-1">
    {inlineEdit.visible && <div className="absolute left-1/2 top-1 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-lg">
      <input autoFocus value={inlineEdit.instruction} onChange={(event) => onInlineEditChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onInlineEditRun(); if (event.key === 'Escape') onInlineEditCancel(); }} placeholder="AI 内联修改指令…" className="h-7 w-64 rounded border bg-background px-2 text-xs outline-none" />
      <Button size="sm" className="h-7 px-3 text-xs" disabled={!inlineEdit.instruction.trim() || aiEditing} onClick={onInlineEditRun}>{aiEditing ? '…' : '生成'}</Button>
      <kbd className="text-[10px] text-muted-foreground">Ctrl+K</kbd>
    </div>}
    <div className="min-w-0 flex-1">
      <MonacoEditor path={editorPath} language={activeDocument.language} value={activeDocument.content} theme={dark ? 'vs-dark' : 'light'} onMount={onMount} onChange={(value) => onDocumentChange(activeDocument.path, value ?? '')} options={optionsFor(preferences, activeDocument.readOnly)} />
    </div>
    {secondaryDocument && <div className="relative min-w-0 flex-1 border-l">
      <div className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded bg-background/90 px-1 text-[10px] shadow">
        <span className="max-w-36 truncate">{secondaryDocument.name}</span>
        <button type="button" className="rounded p-1 hover:bg-accent" title="关闭分栏" onClick={onCloseSecondary}><X className="h-3 w-3" /></button>
      </div>
      <MonacoEditor path={`file:///${secondaryDocument.path.replace(/\\/g, '/')}`} language={secondaryDocument.language} value={secondaryDocument.content} theme={dark ? 'vs-dark' : 'light'} onChange={(value) => onDocumentChange(secondaryDocument.path, value ?? '')} options={optionsFor(preferences, secondaryDocument.readOnly)} />
    </div>}
  </div>
) : (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
    <Code className="h-14 w-14 opacity-40" />
    <div className="text-center"><p className="text-sm font-medium text-foreground">代码编辑器</p><p className="mt-1 text-xs">打开文件夹开始浏览项目，或直接打开单个文本文件。</p></div>
    <div className="flex gap-2"><Button variant="outline" size="sm" onClick={onOpenWorkspace}>打开文件夹</Button><Button variant="outline" size="sm" onClick={onOpenFile}>打开文件</Button></div>
  </div>
);
