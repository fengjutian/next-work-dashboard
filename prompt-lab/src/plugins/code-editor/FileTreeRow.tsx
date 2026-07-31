import React from 'react';
import { ChevronDown, FileText, FolderOpen, RefreshCw } from '@/components/icons';
import type { TreeNode, TreeEditState } from './editor-types';

function fileIconColor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  if (['ts', 'tsx'].includes(extension ?? '')) return 'text-blue-500';
  if (['js', 'jsx'].includes(extension ?? '')) return 'text-yellow-500';
  if (extension === 'json') return 'text-amber-500';
  if (['css', 'scss', 'less'].includes(extension ?? '')) return 'text-purple-500';
  if (['html', 'vue', 'svelte'].includes(extension ?? '')) return 'text-orange-500';
  if (['md', 'mdx'].includes(extension ?? '')) return 'text-cyan-500';
  if (extension === 'py') return 'text-emerald-500';
  return 'text-muted-foreground';
}

export const FileTreeRow: React.FC<{
  node: TreeNode;
  depth: number;
  activePath: string | null;
  selectedPaths: Set<string>;
  onOpen: (node: TreeNode, pinned?: boolean) => void;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode, event: React.MouseEvent) => void;
  editing?: TreeEditState | null;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onMove: (source: TreeNode, target: TreeNode) => void;
  decorations?: Map<string, { git?: string; errors?: number; warnings?: number }>;
}> = ({
  node, depth, activePath, selectedPaths, onOpen, onToggle, onSelect,
  editing, onEditChange, onEditCommit, onEditCancel, onContextMenu, onMove, decorations,
}) => {
  const isDirectory = node.type === 'directory';
  const expanded = node.children !== undefined;
  return (
    <>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-1.5 truncate pr-2 text-left text-xs hover:bg-accent/60 ${
          activePath === node.path || selectedPaths.has(node.path)
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(event) => {
          onSelect(node, event);
          if (event.detail > 1) return;
          if (isDirectory) onToggle(node);
          else onOpen(node, false);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (!isDirectory) onOpen(node, true);
        }}
        title={node.path}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-nwd-tree-path', node.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (isDirectory) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!isDirectory) return;
          event.preventDefault();
          const sourcePath = event.dataTransfer.getData('application/x-nwd-tree-path');
          if (sourcePath) onMove({ name: sourcePath.split(/[\\/]/).pop() ?? sourcePath, path: sourcePath, type: 'file' }, node);
        }}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        {isDirectory ? (
          <>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText className={`h-3.5 w-3.5 shrink-0 ${fileIconColor(node.name)}`} />
          </>
        )}
        {editing?.mode === 'rename' && editing.target?.path === node.path ? (
          <input
            autoFocus
            value={editing.value}
            onChange={(event) => onEditChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') onEditCommit();
              if (event.key === 'Escape') onEditCancel();
            }}
            onBlur={onEditCommit}
            className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {node.loading && <RefreshCw className="ml-auto h-3 w-3 animate-spin" />}
        {decorations?.get(node.path)?.errors ? <span className="ml-auto text-[10px] font-semibold text-destructive">{decorations.get(node.path)?.errors}</span> : decorations?.get(node.path)?.warnings ? <span className="ml-auto text-[10px] font-semibold text-warning">{decorations.get(node.path)?.warnings}</span> : decorations?.get(node.path)?.git ? <span className="ml-auto text-[10px] font-semibold text-primary">{decorations.get(node.path)?.git?.trim()}</span> : null}
      </button>
      {expanded && node.children?.map((child) => (
        <FileTreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          selectedPaths={selectedPaths}
          onOpen={onOpen}
          onToggle={onToggle}
          onSelect={onSelect}
          editing={editing}
          onEditChange={onEditChange}
          onEditCommit={onEditCommit}
          onEditCancel={onEditCancel}
          onContextMenu={onContextMenu}
          onMove={onMove}
          decorations={decorations}
        />
      ))}
    </>
  );
};
