import { useCallback, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import type { TreeNode } from '../editor-types';
import { updateTreeNode } from './useExplorerTree';

interface Options {
  workspace: { path: string } | null;
  visibleTreeNodes: TreeNode[];
  selectedNode: TreeNode | null;
  selectTreeNode: (node: TreeNode) => void;
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>;
  loadDirectory: (rootPath: string, relativePath?: string) => Promise<TreeNode[]>;
  openTreeFile: (node: TreeNode, pinned?: boolean) => Promise<void>;
  beginRename: (node?: TreeNode | null) => void;
  deleteTreeSelection: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
}

export function useExplorerNavigation({
  workspace, visibleTreeNodes, selectedNode, selectTreeNode, setTree,
  setExpandedPaths, loadDirectory, openTreeFile, beginRename,
  deleteTreeSelection, setStatus,
}: Options) {
  const toggleDirectory = useCallback(async (node: TreeNode) => {
    if (!workspace) return;
    if (node.children !== undefined) {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        next.delete(node.path);
        return next;
      });
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, children: undefined,
      })));
      return;
    }
    setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
      ...current, loading: true,
    })));
    try {
      const children = await loadDirectory(workspace.path, node.path);
      setExpandedPaths((previous) => new Set(previous).add(node.path));
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, loading: false, children,
      })));
    } catch (error) {
      setTree((previous) => updateTreeNode(previous, node.path, (current) => ({
        ...current, loading: false,
      })));
      setStatus(error instanceof Error ? error.message : '目录读取失败');
    }
  }, [loadDirectory, setExpandedPaths, setStatus, setTree, workspace]);

  const handleTreeKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const index = selectedNode
      ? visibleTreeNodes.findIndex((node) => node.path === selectedNode.path)
      : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(visibleTreeNodes.length - 1, index + 1)
        : Math.max(0, index < 0 ? 0 : index - 1);
      const next = visibleTreeNodes[nextIndex];
      if (next) selectTreeNode(next);
    } else if (event.key === 'ArrowRight' && selectedNode?.type === 'directory' && selectedNode.children === undefined) {
      event.preventDefault(); void toggleDirectory(selectedNode);
    } else if (event.key === 'ArrowLeft' && selectedNode) {
      event.preventDefault();
      if (selectedNode.type === 'directory' && selectedNode.children !== undefined) void toggleDirectory(selectedNode);
      else {
        const parentPath = selectedNode.path.replace(/[\\/][^\\/]+$/, '');
        const parent = visibleTreeNodes.find((node) => node.path === parentPath);
        if (parent) selectTreeNode(parent);
      }
    } else if (event.key === 'Enter' && selectedNode) {
      event.preventDefault();
      if (selectedNode.type === 'directory') void toggleDirectory(selectedNode);
      else void openTreeFile(selectedNode);
    } else if (event.key === 'F2' && selectedNode) {
      event.preventDefault(); beginRename(selectedNode);
    } else if (event.key === 'Delete') {
      event.preventDefault(); void deleteTreeSelection();
    }
  }, [beginRename, deleteTreeSelection, openTreeFile, selectTreeNode, selectedNode, toggleDirectory, visibleTreeNodes]);

  return { toggleDirectory, handleTreeKeyDown };
}
