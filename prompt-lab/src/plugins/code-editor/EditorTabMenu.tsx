import React from 'react';
import type { OpenDocument } from './editor-types';

interface Props {
  menu: { x: number; y: number; path: string } | null;
  documents: OpenDocument[];
  onCloseMenu: () => void;
  onTogglePin: (path: string) => void;
  onOpenSecondary: (path: string) => void;
  onClosePaths: (paths: string[]) => void;
}

export const EditorTabMenu: React.FC<Props> = ({
  menu, documents, onCloseMenu, onTogglePin, onOpenSecondary, onClosePaths,
}) => {
  if (!menu) return null;
  const document = documents.find((item) => item.path === menu.path);
  const index = documents.findIndex((item) => item.path === menu.path);
  if (!document) return null;
  const act = (action: () => void) => { action(); onCloseMenu(); };
  return <div className="fixed inset-0 z-50" onMouseDown={onCloseMenu}>
    <div className="fixed min-w-44 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => act(() => onTogglePin(document.path))}>{document.pinned === false ? '固定标签' : '取消固定'}</button>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => act(() => onOpenSecondary(document.path))}>在右侧打开</button>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => act(() => onClosePaths([document.path]))}>关闭</button>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => act(() => onClosePaths(documents.filter((item) => item.path !== document.path).map((item) => item.path)))}>关闭其他</button>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={index === documents.length - 1} onClick={() => act(() => onClosePaths(documents.slice(index + 1).map((item) => item.path)))}>关闭右侧</button>
      <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => act(() => onClosePaths(documents.filter((item) => item.content === item.savedContent).map((item) => item.path)))}>关闭已保存</button>
    </div>
  </div>;
};
