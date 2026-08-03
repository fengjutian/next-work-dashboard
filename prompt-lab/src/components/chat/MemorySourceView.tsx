import React from 'react';
import { XMarkdown } from '@ant-design/x-markdown';
import { FileText, FolderOpen } from '@/components/icons';
import type { MemoryCitation } from '@/core/conversation-memory';

export function MemorySourceList({ sources, onOpen }: {
  sources: MemoryCitation[];
  onOpen: (source: MemoryCitation) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t pt-2">
      <div className="mb-1 text-[10px] font-semibold text-muted-foreground">参考历史（{sources.length}）</div>
      <div className="flex flex-col gap-1">
        {sources.map((source, index) => (
          <button key={`${source.filePath}-${source.startLine}`} onClick={() => onOpen(source)}
            className="flex w-full items-center gap-2 rounded border bg-background px-2 py-1.5 text-left text-[10px] hover:border-primary">
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">[S{index + 1}] {source.title || source.fileName}</span>
            <span className="shrink-0 text-muted-foreground">第 {source.startLine}-{source.endLine} 行</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface MemoryDocumentPreview {
  source: MemoryCitation;
  content: string;
}

export function MemoryDocumentDialog({ preview, onClose }: {
  preview: MemoryDocumentPreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;
  const excerpt = preview.content.split(/\r?\n/)
    .slice(Math.max(0, preview.source.startLine - 1), preview.source.endLine)
    .join('\n');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="flex h-[85vh] w-[86vw] flex-col overflow-hidden rounded-lg bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
          <FileText className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{preview.source.title || preview.source.fileName}</div>
            <div className="truncate text-[10px] text-muted-foreground">{preview.source.filePath} · 命中第 {preview.source.startLine}-{preview.source.endLine} 行</div>
          </div>
          <button className="flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void window.electronAPI.revealConversation(preview.source.filePath)}>
            <FolderOpen className="h-3.5 w-3.5" />显示原文件
          </button>
          <button className="px-2 text-xs text-muted-foreground hover:text-destructive" onClick={onClose}>✕ 关闭</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-md border border-primary/30 bg-primary-light/40 p-3">
            <div className="mb-1 text-[10px] font-semibold text-primary">本次召回片段 · 第 {preview.source.startLine}-{preview.source.endLine} 行</div>
            <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{excerpt || '（原文件对应行已不存在，文件可能已被修改）'}</pre>
          </div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">完整原始文档</div>
          <XMarkdown content={preview.content || '_(空)_'} className="text-sm" />
        </div>
      </div>
    </div>
  );
}
