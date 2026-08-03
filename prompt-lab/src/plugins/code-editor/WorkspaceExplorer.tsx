import React from 'react';
import { ChevronDown, Edit3, FileText, FolderOpen, Plus, RefreshCw, Search, Trash2 } from '../../components/icons';
import { FileTreeRow } from './FileTreeRow';
import type { TreeEditState, TreeNode } from './editor-types';

interface Folder { id: string; path: string; name: string }
interface Decorations { git?: string; errors?: number; warnings?: number }

interface Props {
  width: number;
  workspace: { path: string; name: string } | null;
  folders: Folder[];
  tree: TreeNode[];
  filter: string;
  sort: 'name' | 'type';
  activePath: string | null;
  selectedNode: TreeNode | null;
  selectedPaths: Set<string>;
  treeEdit: TreeEditState | null;
  decorations: Map<string, Decorations>;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFilterChange: (value: string) => void;
  onToggleSort: () => void;
  onCreate: (type: 'file' | 'directory') => void;
  onRename: () => void;
  onDelete: () => void;
  onQuickOpen: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onSwitchFolder: (folder: Folder) => void;
  onRemoveFolder: (folder: Folder) => void;
  onOpen: (node: TreeNode, pinned?: boolean) => Promise<void>;
  onToggle: (node: TreeNode) => Promise<void>;
  onSelect: (node: TreeNode, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onMove: (source: TreeNode, target: TreeNode) => void;
  onResize: (width: number) => void;
}

export const WorkspaceExplorer: React.FC<Props> = ({
  width, workspace, folders, tree, filter, sort, activePath, selectedNode,
  selectedPaths, treeEdit, decorations, onKeyDown, onFilterChange, onToggleSort,
  onCreate, onRename, onDelete, onQuickOpen, onRefresh, onCollapseAll,
  onSwitchFolder, onRemoveFolder, onOpen, onToggle, onSelect, onEditChange,
  onEditCommit, onEditCancel, onContextMenu, onMove, onResize,
}) => (
  <aside className="relative flex shrink-0 flex-col border-r bg-sidebar-bg outline-none" style={{ width }} tabIndex={0} onKeyDown={onKeyDown} aria-label="文件资源管理器">
    <div className="flex h-9 items-center gap-0.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className="flex-1 px-1">Explorer</span>
      <button type="button" className="rounded px-1 text-[9px] hover:bg-accent" onClick={onToggleSort} title="排序方式">{sort === 'name' ? 'A-Z' : 'Type'}</button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="新建文件" onClick={() => onCreate('file')} disabled={!workspace}><Plus className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="新建文件夹" onClick={() => onCreate('directory')} disabled={!workspace}><FolderOpen className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="重命名选中项" onClick={onRename} disabled={!selectedNode}><Edit3 className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="删除选中项" onClick={onDelete} disabled={!selectedNode}><Trash2 className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="快速打开 (Ctrl+P)" onClick={onQuickOpen} disabled={!workspace}><Search className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="刷新资源管理器" onClick={onRefresh} disabled={!workspace}><RefreshCw className="h-3.5 w-3.5" /></button>
      <button type="button" className="rounded p-1 hover:bg-accent" title="折叠全部" onClick={onCollapseAll} disabled={!workspace}><ChevronDown className="h-3.5 w-3.5 -rotate-90" /></button>
    </div>
    {workspace ? <div className="min-h-0 flex-1 overflow-auto">
      {folders.length > 1 && <div className="flex gap-0.5 border-b px-1 py-1">{folders.map((folder) => (
        <button key={folder.id} type="button" className={`group flex items-center truncate rounded px-2 py-0.5 text-[10px] ${folder.path === workspace.path ? 'bg-accent' : 'hover:bg-accent/50'}`} onClick={() => onSwitchFolder(folder)} title={folder.path}>
          {folder.name}<span className="ml-1 hidden group-hover:inline hover:text-destructive" onClick={(event) => { event.stopPropagation(); onRemoveFolder(folder); }}>×</span>
        </button>
      ))}</div>}
      <div className="px-2 pb-1"><input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="过滤文件…" className="h-6 w-full rounded border bg-background px-2 text-[10px] outline-none" /></div>
      <div className="flex h-7 items-center gap-1 px-2 text-xs font-semibold"><ChevronDown className="h-3 w-3" /><span className="truncate uppercase">{workspace.name}</span></div>
      {treeEdit && treeEdit.mode !== 'rename' && <div className="flex h-7 items-center gap-1 px-2">
        {treeEdit.mode === 'create-directory' ? <FolderOpen className="h-3.5 w-3.5 text-primary" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
        <input autoFocus value={treeEdit.value} onChange={(event) => onEditChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onEditCommit(); if (event.key === 'Escape') onEditCancel(); }} onBlur={onEditCommit} placeholder={selectedNode?.type === 'directory' ? `在 ${selectedNode.name} 中创建` : '输入名称'} className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
      </div>}
      {tree.map((node) => <FileTreeRow key={node.path} node={node} depth={0} activePath={activePath} selectedPaths={selectedPaths} onOpen={onOpen} onToggle={onToggle} onSelect={onSelect} editing={treeEdit} onEditChange={onEditChange} onEditCommit={onEditCommit} onEditCancel={onEditCancel} onContextMenu={onContextMenu} onMove={onMove} decorations={decorations} />)}
    </div> : <div className="px-4 py-5 text-xs leading-5 text-muted-foreground">尚未打开文件夹。打开工作区后可浏览和编辑其中的文件。</div>}
    <div className="absolute bottom-0 right-[-3px] top-0 z-20 w-1.5 cursor-col-resize" onMouseDown={(event) => {
      const startX = event.clientX;
      const startWidth = width;
      const move = (moveEvent: MouseEvent) => onResize(Math.max(180, Math.min(520, startWidth + moveEvent.clientX - startX)));
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }} />
  </aside>
);
