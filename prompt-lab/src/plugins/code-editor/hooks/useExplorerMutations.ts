import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { displayError, type OpenDocument, type TreeEditState, type TreeNode } from './editor-types';

interface Options {
  workspace: { path: string } | null;
  documents: OpenDocument[];
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  activePath: string | null;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  secondaryPath: string | null;
  setSecondaryPath: Dispatch<SetStateAction<string | null>>;
  selectedNode: TreeNode | null;
  setSelectedNode: Dispatch<SetStateAction<TreeNode | null>>;
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  treeEdit: TreeEditState | null;
  setTreeEdit: Dispatch<SetStateAction<TreeEditState | null>>;
  setTreeMenu: Dispatch<SetStateAction<{ x: number; y: number; node: TreeNode } | null>>;
  treeClipboard: { nodes: TreeNode[]; cut: boolean } | null;
  setTreeClipboard: Dispatch<SetStateAction<{ nodes: TreeNode[]; cut: boolean } | null>>;
  refreshWorkspaceTree: () => Promise<void>;
  remapOpenPaths: (oldPath: string, nextPath: string) => void;
  appConfirm: (message: string) => Promise<boolean>;
  setStatus: Dispatch<SetStateAction<string>>;
}

const contains = (path: string, parent: string) => path === parent
  || path.startsWith(`${parent}/`) || path.startsWith(`${parent}\\`);

export function useExplorerMutations(options: Options) {
  const {
    workspace, documents, setDocuments, activePath, setActivePath, secondaryPath,
    setSecondaryPath, selectedNode, setSelectedNode, selectedPaths, setSelectedPaths,
    treeEdit, setTreeEdit, setTreeMenu, treeClipboard, setTreeClipboard,
    refreshWorkspaceTree, remapOpenPaths,
    appConfirm, setStatus,
  } = options;

  const beginCreate = useCallback((type: 'file' | 'directory') => {
    if (workspace) setTreeEdit({ mode: type === 'file' ? 'create-file' : 'create-directory', value: '' });
  }, [setTreeEdit, workspace]);

  const beginRename = useCallback((node = selectedNode) => {
    if (!node) return;
    setSelectedNode(node);
    setTreeEdit({ mode: 'rename', value: node.name, target: node });
    setTreeMenu(null);
  }, [selectedNode, setSelectedNode, setTreeEdit, setTreeMenu]);

  const commitTreeEdit = useCallback(async () => {
    if (!workspace || !treeEdit?.value.trim()) { setTreeEdit(null); return; }
    if (treeEdit.mode !== 'rename') {
      const parent = selectedNode?.type === 'directory' ? selectedNode.path : '';
      const path = parent ? `${parent}/${treeEdit.value.trim()}` : treeEdit.value.trim();
      const result = treeEdit.mode === 'create-file'
        ? await window.electronAPI.workspace.createFile(workspace.path, path)
        : await window.electronAPI.workspace.createDirectory(workspace.path, path);
      if (!result.success) { setStatus(`新建失败：${displayError(result.error)}`); return; }
      setTreeEdit(null);
      await refreshWorkspaceTree();
      setStatus(`已新建 ${path}`);
      return;
    }
    const target = treeEdit.target;
    if (!target || treeEdit.value.trim() === target.name) { setTreeEdit(null); return; }
    const parent = target.path.replace(/[\\/][^\\/]+$/, '');
    const name = treeEdit.value.trim();
    const nextPath = parent ? `${parent}/${name}` : name;
    const isKnowledgeDocument = target.type === 'file' && /\.mdx?$/i.test(target.path) && /\.mdx?$/i.test(nextPath);
    const result = isKnowledgeDocument
      ? await window.electronAPI.knowledge.renameDocument(workspace.path, target.path, nextPath)
      : await window.electronAPI.workspace.renameEntry(workspace.path, target.path, nextPath);
    if (!result.success) { setStatus(`重命名失败：${displayError(result.error)}`); return; }
    remapOpenPaths(target.path, nextPath);
    setSelectedNode(null);
    setTreeEdit(null);
    await refreshWorkspaceTree();
    const updatedReferences = isKnowledgeDocument && result.data && 'updatedReferences' in result.data
      ? result.data.updatedReferences.length
      : 0;
    setStatus(`已重命名为 ${name}${updatedReferences ? `，同步更新 ${updatedReferences} 篇文档的 Wiki Link` : ''}`);
  }, [refreshWorkspaceTree, remapOpenPaths, selectedNode, setSelectedNode, setStatus, setTreeEdit, treeEdit, workspace]);

  const removeDocuments = useCallback((paths: string[]) => {
    const affected = new Set(documents.filter((document) => paths.some((path) => contains(document.path, path))).map((document) => document.path));
    const remaining = documents.filter((document) => !affected.has(document.path));
    setDocuments(remaining);
    if (activePath && affected.has(activePath)) setActivePath(remaining[0]?.path ?? null);
    if (secondaryPath && affected.has(secondaryPath)) setSecondaryPath(null);
  }, [activePath, documents, secondaryPath, setActivePath, setDocuments, setSecondaryPath]);

  const deleteSelected = useCallback(async (node = selectedNode) => {
    if (!workspace || !node) return;
    const affected = documents.filter((document) => contains(document.path, node.path));
    if (affected.some((document) => document.content !== document.savedContent)) {
      setStatus('删除目标中包含未保存文件，请先保存或关闭'); return;
    }
    if (!await appConfirm(`确定将“${node.name}”移到系统回收站吗？`)) return;
    const result = await window.electronAPI.workspace.trashEntry(workspace.path, node.path);
    if (!result.success) { setStatus(`删除失败：${displayError(result.error)}`); return; }
    removeDocuments([node.path]);
    setSelectedNode(null);
    await refreshWorkspaceTree();
    setStatus(`已将 ${node.name} 移到回收站`);
  }, [appConfirm, documents, refreshWorkspaceTree, removeDocuments, selectedNode, setSelectedNode, setStatus, workspace]);

  const deleteTreeSelection = useCallback(async () => {
    if (!workspace || !selectedPaths.size) return;
    const paths = [...selectedPaths].filter((candidate) => ![...selectedPaths].some((parent) => parent !== candidate && contains(candidate, parent)));
    const affected = documents.filter((document) => paths.some((path) => contains(document.path, path)));
    if (affected.some((document) => document.content !== document.savedContent)) {
      setStatus('所选项目中包含未保存文件，请先保存或关闭'); return;
    }
    if (!await appConfirm(`确定将所选 ${paths.length} 个项目移到系统回收站吗？`)) return;
    for (const path of paths) {
      const result = await window.electronAPI.workspace.trashEntry(workspace.path, path);
      if (!result.success) { setStatus(`删除失败：${path} — ${displayError(result.error)}`); return; }
    }
    removeDocuments(paths);
    setSelectedNode(null);
    setSelectedPaths(new Set());
    await refreshWorkspaceTree();
    setStatus(`已将 ${paths.length} 个项目移到回收站`);
  }, [appConfirm, documents, refreshWorkspaceTree, removeDocuments, selectedPaths, setSelectedNode, setSelectedPaths, setStatus, workspace]);

  const pasteTreeEntry = useCallback(async (target = selectedNode) => {
    if (!workspace || !treeClipboard) return;
    const parent = target?.type === 'directory'
      ? target.path
      : target?.path.replace(/[\\/][^\\/]+$/, '') ?? '';
    let completed = 0;
    let skipped = 0;
    for (const node of treeClipboard.nodes) {
      let nextPath = parent ? `${parent}/${node.name}` : node.name;
      if (contains(nextPath, node.path)) { skipped += 1; continue; }
      const mutate = (path: string) => treeClipboard.cut
        ? window.electronAPI.workspace.renameEntry(workspace.path, node.path, path)
        : window.electronAPI.workspace.copyEntry(workspace.path, node.path, path);
      let result = await mutate(nextPath);
      if (!result.success && result.error === 'ALREADY_EXISTS') {
        const dot = node.name.lastIndexOf('.');
        const extension = dot > 0 ? node.name.slice(dot) : '';
        const base = extension ? node.name.slice(0, dot) : node.name;
        for (let counter = 1; counter < 100 && !result.success; counter += 1) {
          const name = `${base} - Copy${counter > 1 ? ` (${counter})` : ''}${extension}`;
          const candidate = parent ? `${parent}/${name}` : name;
          result = await mutate(candidate);
          if (result.success) nextPath = candidate;
          else if (result.error !== 'ALREADY_EXISTS') break;
        }
      }
      if (!result.success) {
        setStatus(`粘贴失败：${node.name} — ${displayError(result.error)}`);
        return;
      }
      if (treeClipboard.cut) remapOpenPaths(node.path, nextPath);
      completed += 1;
    }
    if (treeClipboard.cut) setTreeClipboard(null);
    await refreshWorkspaceTree();
    setStatus(`已${treeClipboard.cut ? '移动' : '复制'} ${completed} 个项目${skipped ? `，跳过 ${skipped} 个` : ''}`);
  }, [refreshWorkspaceTree, remapOpenPaths, selectedNode, setStatus, setTreeClipboard, treeClipboard, workspace]);

  const moveTreeEntry = useCallback(async (source: TreeNode, target: TreeNode) => {
    if (!workspace || target.type !== 'directory') return;
    const name = source.path.split(/[\\/]/).pop() ?? source.name;
    const nextPath = `${target.path}/${name}`;
    if (contains(nextPath, source.path)) {
      setStatus('不能将文件夹移动到自身内部');
      return;
    }
    const result = await window.electronAPI.workspace.renameEntry(workspace.path, source.path, nextPath);
    if (!result.success) { setStatus(`移动失败：${displayError(result.error)}`); return; }
    remapOpenPaths(source.path, nextPath);
    await refreshWorkspaceTree();
    setStatus(`已移动到 ${target.path}`);
  }, [refreshWorkspaceTree, remapOpenPaths, setStatus, workspace]);

  return {
    beginCreate, beginRename, commitTreeEdit, deleteSelected, deleteTreeSelection,
    pasteTreeEntry, moveTreeEntry,
  };
}
