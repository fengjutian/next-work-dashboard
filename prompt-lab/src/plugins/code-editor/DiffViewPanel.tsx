import React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import type { AiHunk } from './editor-types';

interface DiffViewProps {
  diffView: {
    path: string;
    name: string;
    original: string;
    modified: string;
    language: string;
    source?: 'external' | 'git' | 'merge' | 'ai' | 'search';
  };
  resolvedTheme: string;
  gitHunks: Array<{ label: string; patch: string }>;
  aiHunks: AiHunk[];
  mergeHunks: AiHunk[];
  searchPreviews: Array<{ path: string }>;
  aiProposals: Array<{ path: string }>;
  onClose: () => void;
  onStageGitHunk: (hunk: { label: string; patch: string }) => void;
  onUnstageFile: () => void;
  gitStatusHasStaged: boolean;
  onResolveConflict: (strategy: 'ours' | 'theirs') => void;
  onAcceptAi: () => void;
  onRejectAi: () => void;
  onApplyAiHunk: (index: number, accept: boolean) => void;
  onApplyMergeHunk: (index: number, side: 'ours' | 'theirs') => void;
  onFinishMerge: () => void;
  onAcceptSearch: () => void;
  onRejectSearch: () => void;
}

export const DiffViewPanel: React.FC<DiffViewProps> = ({
  diffView, resolvedTheme, gitHunks, aiHunks, mergeHunks, searchPreviews, aiProposals,
  onClose, onStageGitHunk, onUnstageFile, gitStatusHasStaged,
  onResolveConflict, onAcceptAi, onRejectAi, onApplyAiHunk,
  onApplyMergeHunk, onFinishMerge, onAcceptSearch, onRejectSearch,
}) => (
  <div className="absolute inset-0 z-40 flex flex-col bg-background">
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
      <span className="font-semibold">{diffView.name}</span>
      <span className="text-muted-foreground">{diffView.source === 'ai' ? '修改前 ↔ AI 候选' : diffView.source === 'git' ? 'HEAD ↔ 工作区' : diffView.source === 'merge' ? '当前分支 ↔ 传入分支' : diffView.source === 'search' ? '替换前 ↔ 替换后' : '磁盘版本 ↔ 本地版本'}</span>
      <div className="flex-1" />
      {diffView.source === 'git' && gitHunks.slice(0, 8).map((hunk, index) => <Button key={hunk.label} size="sm" variant="outline" className="h-7 max-w-32 truncate px-2 text-xs" title={hunk.label} onClick={() => void onStageGitHunk(hunk)}>暂存块 {index + 1}</Button>)}
      {diffView.source === 'git' && gitStatusHasStaged && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => void onUnstageFile()}>取消暂存全部</Button>}
      {diffView.source === 'merge' && mergeHunks.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto">
          {mergeHunks.slice(0, 12).map((hunk) => (
            <span key={hunk.index} className="inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-[10px]">
              <button type="button" className="rounded px-1 hover:bg-success/20 hover:text-success" title="接受当前分支版本" onClick={() => onApplyMergeHunk(hunk.index, 'ours')}>我的</button>
              <span className="max-w-32 truncate text-muted-foreground">{hunk.originalLines[0]?.slice(0, 16) || '⋯'} ↔ {hunk.modifiedLines[0]?.slice(0, 16) || '⋯'}</span>
              <button type="button" className="rounded px-1 hover:bg-primary/20 hover:text-primary" title="接受传入分支版本" onClick={() => onApplyMergeHunk(hunk.index, 'theirs')}>传入</button>
            </span>
          ))}
          {mergeHunks.length > 12 && <span className="text-muted-foreground">+{mergeHunks.length - 12}</span>}
        </div>
      )}
      {diffView.source === 'merge' && mergeHunks.length === 0 && <Button size="sm" className="h-7 px-3 text-xs" onClick={() => void onFinishMerge()}>完成合并</Button>}
      {diffView.source === 'ai' && aiHunks.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto">
          {aiHunks.slice(0, 12).map((hunk) => (
            <span key={hunk.index} className="inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-[10px]">
              <button type="button" className="rounded px-1 hover:bg-success/20 hover:text-success" title={`接受：${hunk.modifiedLines.slice(0, 2).join(' / ')}`} onClick={() => onApplyAiHunk(hunk.index, true)}>✓</button>
              <span className="max-w-32 truncate text-muted-foreground">{hunk.modifiedLines[0]?.slice(0, 40) || '(空)'}{hunk.modifiedLines.length > 1 ? ` +${hunk.modifiedLines.length - 1}` : ''}</span>
              <button type="button" className="rounded px-1 hover:bg-destructive/20 hover:text-destructive" title="拒绝" onClick={() => onApplyAiHunk(hunk.index, false)}>✗</button>
            </span>
          ))}
          {aiHunks.length > 12 && <span className="text-muted-foreground">+{aiHunks.length - 12}</span>}
        </div>
      )}
      {diffView.source === 'ai' && aiHunks.length === 0 && <Button size="sm" className="h-7 px-3 text-xs" onClick={onAcceptAi}>接受全部</Button>}
      {diffView.source === 'search' && (
        <>
          <span className="text-muted-foreground">{searchPreviews.findIndex((p) => p.path === diffView.path) + 1}/{searchPreviews.length}</span>
          <Button size="sm" className="h-7 px-3 text-xs" onClick={() => void onAcceptSearch()}>接受替换</Button>
        </>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
        {diffView.source === 'ai' ? (aiHunks.length > 0 ? '拒绝全部' : '关闭') : diffView.source === 'merge' ? (mergeHunks.length === 0 ? '关闭' : '全部接受当前分支') : diffView.source === 'search' ? '跳过' : '关闭比较'}
      </Button>
    </div>
    <div className="min-h-0 flex-1">
      <DiffEditor
        original={diffView.original}
        modified={diffView.modified}
        language={diffView.language}
        originalModelPath={`file:///${diffView.path.replace(/\\/g, '/')}?disk`}
        modifiedModelPath={`file:///${diffView.path.replace(/\\/g, '/')}?local`}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          automaticLayout: true,
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
        }}
      />
    </div>
  </div>
);
