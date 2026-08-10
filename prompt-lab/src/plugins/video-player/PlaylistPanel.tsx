/**
 * 播放列表面板（V2）
 *
 * 显示当前播放队列：当前项高亮、循环模式选择、上一个/下一个、删除、清空。
 */

import { useState } from 'react';
import { Play, SkipBack, SkipForward, Trash2, X, ListMusic, Repeat, Repeat1, Shuffle, ArrowDown, ArrowUp } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { PlaylistItem, PlaylistMode, PlaylistState } from './types';
import { fileBaseName, formatDuration } from './format';

interface PlaylistPanelProps {
  playlist: PlaylistState;
  onPlayIndex: (index: number) => void;
  onPlayNext: () => void;
  onPlayPrev: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onModeChange: (mode: PlaylistMode) => void;
  onReorder: (from: number, to: number) => void;
  onAddFiles: () => void;
  onClose?: () => void;
}

const MODE_OPTIONS: Array<{ value: PlaylistMode; label: string; icon: React.ReactNode; description: string }> = [
  { value: 'sequential', label: '顺序', icon: <ListMusic className="h-3 w-3" />, description: '播完停止' },
  { value: 'loop-all', label: '列表循环', icon: <Repeat className="h-3 w-3" />, description: '播完循环' },
  { value: 'loop-one', label: '单曲循环', icon: <Repeat1 className="h-3 w-3" />, description: '单曲重播' },
  { value: 'shuffle', label: '随机', icon: <Shuffle className="h-3 w-3" />, description: '乱序播放' },
];

export function PlaylistPanel({
  playlist,
  onPlayIndex,
  onPlayNext,
  onPlayPrev,
  onRemove,
  onClear,
  onModeChange,
  onReorder,
  onAddFiles,
  onClose,
}: PlaylistPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { items, currentIndex, mode } = playlist;

  const handleDragStart = (id: string, e: React.DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const from = items.findIndex((it) => it.id === draggingId);
    const to = items.findIndex((it) => it.id === targetId);
    if (from >= 0 && to >= 0) onReorder(from, to);
    setDraggingId(null);
  };

  return (
    <aside className="flex flex-col h-full bg-card border-l w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListMusic className="h-4 w-4 text-primary" />
          播放列表
          <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <Button type="button" variant="ghost" size="icon" onClick={onClose} title="关闭面板">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 顶部控件条 */}
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={onPlayPrev} disabled={items.length === 0} title="上一首">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onPlayNext} disabled={items.length === 0} title="下一首">
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAddFiles} title="添加文件到播放列表">
          + 添加
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClear}
          disabled={items.length === 0}
          title="清空列表"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 循环模式 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/20">
        {MODE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            variant={mode === opt.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onModeChange(opt.value)}
            title={opt.description}
            className="flex-1 text-xs"
          >
            {opt.icon}
            <span className="ml-1">{opt.label}</span>
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground px-6 py-12 text-center">
            <ListMusic className="h-10 w-10 text-muted-foreground/40 mb-3" />
            播放列表为空
            <span className="mt-1">点击「+ 添加」选文件，或拖入</span>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item, idx) => (
              <PlaylistItemRow
                key={item.id}
                item={item}
                index={idx}
                active={idx === currentIndex}
                dragging={draggingId === item.id}
                onPlay={() => onPlayIndex(idx)}
                onRemove={() => onRemove(item.id)}
                onDragStart={(e) => handleDragStart(item.id, e)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(item.id, e)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}

interface PlaylistItemRowProps {
  item: PlaylistItem;
  index: number;
  active: boolean;
  dragging: boolean;
  onPlay: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function PlaylistItemRow({ item, active, dragging, onPlay, onRemove, onDragStart, onDragOver, onDrop }: PlaylistItemRowProps) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onPlay}
      className={`group flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-accent'
      } ${dragging ? 'opacity-50' : ''}`}
    >
      <div className="flex flex-col items-center justify-center w-5 mt-1 text-muted-foreground">
        {active ? <Play className="h-3 w-3 text-primary" /> : <span className="text-xs tabular-nums">{indexToLabel(0)}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" title={item.title}>
          {item.title}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {item.type === 'url' ? '网络' : '本地'} · {formatDuration(item.duration)}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
        title="从列表移除"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function indexToLabel(_idx: number): string {
  // 占位，实际在 row 外面用 idx 渲染
  return '';
}
