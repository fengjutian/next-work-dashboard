/**
 * FindReplacePanel — 查找替换浮层面板。
 *
 * 行为：
 *  - Ctrl/Cmd+F 打开；Esc 关闭。
 *  - 输入即搜索；高亮所有匹配项。
 *  - 上下箭头跳到下一个/上一个匹配。
 *  - 替换按钮替换当前匹配，全部替换替换所有。
 *  - 大小写敏感 / 正则 两个开关。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ArrowLeft as ChevronUp, X, Edit3 as Replace, Copy } from '@/components/icons';
import { getSearchState, setSearchTerm, setReplaceTerm, setCaseSensitive, setSearchRegex, gotoNextMatch, gotoPrevMatch, replaceCurrentMatch, replaceAllMatches, type SearchState } from '../extensions/search-replace';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Editor } from '@tiptap/core';

export interface FindReplacePanelProps {
  editor: Editor | null;
  open: boolean;
  onClose(): void;
}

const EMPTY_STATE: SearchState = {
  term: '',
  replaceTerm: '',
  caseSensitive: false,
  regex: false,
  currentIndex: -1,
  total: 0,
  positions: [],
};

export const FindReplacePanel: React.FC<FindReplacePanelProps> = ({ editor, open, onClose }) => {
  const [state, setState] = useState<SearchState>(EMPTY_STATE);
  const [showReplace, setShowReplace] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef('');
  const replaceTermRef = useRef('');

  // 同步编辑器状态到 UI
  useEffect(() => {
    if (!editor) return;
    const update = () => setState(getSearchState(editor));
    update();
    // 监听 editor state 变化
    const handler = () => update();
    editor.on('update', handler);
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('update', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      // 下一帧聚焦
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open]);

  // 同步内部 term → editor
  const handleTermChange = useCallback(
    (value: string) => {
      termRef.current = value;
      if (editor) {
        setState(setSearchTerm(editor, value));
      }
    },
    [editor],
  );

  const handleReplaceChange = useCallback(
    (value: string) => {
      replaceTermRef.current = value;
      if (editor) {
        setReplaceTerm(editor, value);
      }
    },
    [editor],
  );

  const handleNext = useCallback(() => {
    if (!editor) return;
    setState(gotoNextMatch(editor));
  }, [editor]);

  const handlePrev = useCallback(() => {
    if (!editor) return;
    setState(gotoPrevMatch(editor));
  }, [editor]);

  const handleReplace = useCallback(() => {
    if (!editor) return;
    setState(replaceCurrentMatch(editor));
  }, [editor]);

  const handleReplaceAll = useCallback(() => {
    if (!editor) return;
    setState(replaceAllMatches(editor));
  }, [editor]);

  const handleClose = useCallback(() => {
    if (editor) {
      setSearchTerm(editor, '');
    }
    onClose();
  }, [editor, onClose]);

  // 键盘：Esc 关闭；Enter 跳下一个；Shift+Enter 跳上一个
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      } else if (event.key === 'Enter' && document.activeElement === searchInputRef.current) {
        event.preventDefault();
        if (event.shiftKey) handlePrev();
        else handleNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose, handleNext, handlePrev]);

  if (!open) return null;

  const hasTerm = state.term.length > 0;
  const hasMatches = state.total > 0;

  return (
    <div className="absolute right-3 top-3 z-20 flex w-[min(420px,90vw)] flex-col gap-2 rounded-md border bg-background/95 p-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-1">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="搜索"
          value={state.term}
          onChange={(event) => handleTermChange(event.target.value)}
          className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="min-w-[64px] text-center text-[10px] text-muted-foreground">
          {hasTerm ? (hasMatches ? `${state.currentIndex + 1} / ${state.total}` : '0 / 0') : ''}
        </span>
        <Button size="icon" variant="ghost" onClick={handlePrev} disabled={!hasMatches} title="上一个 (Shift+Enter)">
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" onClick={handleNext} disabled={!hasMatches} title="下一个 (Enter)">
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setShowReplace((v) => !v)} title="显示替换" className={cn(showReplace && 'bg-accent')}>
          <Replace className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" onClick={handleClose} title="关闭 (Esc)">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            placeholder="替换为"
            value={state.replaceTerm}
            onChange={(event) => handleReplaceChange(event.target.value)}
            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button size="icon" variant="ghost" onClick={handleReplace} disabled={!hasMatches} title="替换当前">
            <Replace className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={handleReplaceAll} disabled={!hasMatches} title="全部替换">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            checked={state.caseSensitive}
            onChange={(event) => editor && setState(setCaseSensitive(editor, event.target.checked))}
          />
          大小写敏感
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            checked={state.regex}
            onChange={(event) => editor && setState(setSearchRegex(editor, event.target.checked))}
          />
          正则
        </label>
        {!hasMatches && hasTerm && <span className="text-rose-500">无匹配</span>}
      </div>
    </div>
  );
};
