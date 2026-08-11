/**
 * HistoryDrawer — 历史与收藏（侧抽屉）
 *
 * 需求 §6.7：搜索、收藏/取消、重命名、单条删除、清空非收藏（二次确认）。
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Search, Star, Trash2, X, Check, Draw } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ZodiacRun } from '../zodiac-types';
import {
  clearNonFavoriteRuns,
  deleteRun,
  loadRuns,
  renameRun,
  setFavorite,
} from '../zodiac-storage';

export interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 选中某条历史，加载到主面板查看 */
  onSelectRun: (run: ZodiacRun) => void;
  onAfterMutation: () => void;
  onCopy: (text: string, success: boolean) => void;
}

export function HistoryDrawer({
  open,
  onOpenChange,
  onSelectRun,
  onAfterMutation,
  onCopy,
}: HistoryDrawerProps) {
  const [runs, setRuns] = useState<ZodiacRun[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRuns(loadRuns({ search, limit: 50 }));
  }, [open, search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return runs;
    const keyword = search.trim().toLowerCase();
    return runs.filter((run) =>
      run.title.toLowerCase().includes(keyword) || run.question.toLowerCase().includes(keyword),
    );
  }, [runs, search]);

  const refresh = () => {
    setRuns(loadRuns({ search, limit: 50 }));
    onAfterMutation();
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => onOpenChange(false)} aria-hidden />
      )}
      <aside
        className={
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        }
        aria-hidden={!open}
        aria-label="历史与收藏"
      >
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">历史与收藏</h2>
            <span className="text-xs text-muted-foreground">最多保留 50 条</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="关闭">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="搜索问题或标题"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              {search ? '没有匹配的记录' : '暂无历史，去生成一轮看看吧。'}
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((run) => {
                const isEditing = editingId === run.id;
                return (
                  <li
                    key={run.id}
                    className="rounded-md border border-border/60 bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <Input
                            value={editingTitle}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                renameRun(run.id, editingTitle);
                                setEditingId(null);
                                refresh();
                              } else if (event.key === 'Escape') {
                                setEditingId(null);
                              }
                            }}
                            className="h-7 text-sm"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectRun(run)}
                            className="block w-full truncate text-left font-medium text-foreground hover:text-primary"
                            title={run.question}
                          >
                            {run.title || run.question.slice(0, 30)}
                          </button>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{new Date(run.updatedAt).toLocaleString('zh-CN')}</span>
                          {run.partial && <span className="text-amber-600">含缺失</span>}
                          <span>{run.perspectives.length} / {run.options.selectedSigns.length} 视角</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setFavorite(run.id, !run.favorite);
                            refresh();
                          }}
                          aria-label={run.favorite ? '取消收藏' : '收藏'}
                        >
                          <Star className={'h-4 w-4 ' + (run.favorite ? 'fill-yellow-400 text-yellow-500' : '')} />
                        </Button>
                        {isEditing ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              renameRun(run.id, editingTitle);
                              setEditingId(null);
                              refresh();
                            }}
                            aria-label="保存标题"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingId(run.id);
                              setEditingTitle(run.title);
                            }}
                            aria-label="重命名"
                          >
                            <Draw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            deleteRun(run.id);
                            refresh();
                          }}
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          {confirmingClear ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-destructive">清空所有非收藏记录？</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(false)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const removed = clearNonFavoriteRuns();
                    setConfirmingClear(false);
                    refresh();
                    onCopy(`已清空 ${removed} 条非收藏记录`, true);
                  }}
                >
                  确认清空
                </Button>
              </div>
            </div>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">收藏永不自动清理</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)}>
                <Trash2 className="h-3.5 w-3.5" /> 清空非收藏
              </Button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
