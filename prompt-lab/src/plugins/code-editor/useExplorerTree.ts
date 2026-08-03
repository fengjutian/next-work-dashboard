import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { displayError, type OpenDocument, type TreeNode } from './editor-types';

interface UseExplorerTreeOptions {
  workspace: { path: string } | null;
  expandedPaths: Set<string>;
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>;
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
}

export function updateTreeNode(
  nodes: TreeNode[],
  path: string,
  update: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return update(node);
    return node.children ? { ...node, children: updateTreeNode(node.children, path, update) } : node;
  });
}

export function useExplorerTree({
  workspace, expandedPaths, setExpandedPaths, setTree, setDocuments, setActivePath,
}: UseExplorerTreeOptions) {
  const loadDirectory = useCallback(async (rootPath: string, relativePath = '') => {
    const result = await window.electronAPI.workspace.listDirectory(rootPath, relativePath);
    if (!result.success) throw new Error(displayError(result.error));
    return (result.data ?? []) as TreeNode[];
  }, []);

  const hydrateExpandedTree = useCallback(async function hydrate(
    rootPath: string,
    nodes: TreeNode[],
    paths: Set<string>,
  ): Promise<TreeNode[]> {
    return Promise.all(nodes.map(async (node) => {
      if (node.type !== 'directory' || !paths.has(node.path)) return node;
      const children = await loadDirectory(rootPath, node.path);
      return { ...node, children: await hydrate(rootPath, children, paths) };
    }));
  }, [loadDirectory]);

  const refreshWorkspaceTree = useCallback(async () => {
    if (!workspace) return;
    const entries = await loadDirectory(workspace.path);
    setTree(await hydrateExpandedTree(workspace.path, entries, expandedPaths));
  }, [expandedPaths, hydrateExpandedTree, loadDirectory, setTree, workspace]);

  const remapOpenPaths = useCallback((oldPath: string, nextPath: string) => {
    const remap = (path: string) => (
      path === oldPath || path.startsWith(`${oldPath}\\`) || path.startsWith(`${oldPath}/`)
        ? `${nextPath}${path.slice(oldPath.length)}`
        : path
    );
    setDocuments((previous) => previous.map((document) => {
      const path = remap(document.path);
      return path === document.path ? document : {
        ...document, path, name: path.split(/[\\/]/).pop() ?? document.name,
      };
    }));
    setActivePath((current) => current ? remap(current) : current);
  }, [setActivePath, setDocuments]);

  const revealWorkspacePath = useCallback(async (relativePath: string) => {
    if (!workspace) return;
    const parts = relativePath.split(/[\\/]/);
    const separator = relativePath.includes('\\') ? '\\' : '/';
    const nextExpanded = new Set(expandedPaths);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}${separator}${part}` : part;
      nextExpanded.add(current);
    }
    setExpandedPaths(nextExpanded);
    const entries = await loadDirectory(workspace.path);
    setTree(await hydrateExpandedTree(workspace.path, entries, nextExpanded));
  }, [expandedPaths, hydrateExpandedTree, loadDirectory, setExpandedPaths, setTree, workspace]);

  return { loadDirectory, hydrateExpandedTree, refreshWorkspaceTree, remapOpenPaths, revealWorkspacePath };
}
