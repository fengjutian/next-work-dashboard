import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { FilePickResult } from '@/types/electron';
import { decodeBase64Utf8, languageIdFromName } from '../editor-utils';
import { displayError, type OpenDocument, type TreeNode } from '../editor-types';

interface QuickOpenState { open: boolean; query: string; files: TreeNode[] }

interface Options {
  workspace: { path: string } | null;
  documents: OpenDocument[];
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setQuickOpen: Dispatch<SetStateAction<QuickOpenState>>;
  revealWorkspacePath: (path: string) => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
}

export function useFileOpening({
  workspace, documents, setDocuments, setActivePath, setQuickOpen,
  revealWorkspacePath, setStatus,
}: Options) {
  const openRequestRef = useRef(0);

  const showQuickOpen = useCallback(async () => {
    if (!workspace) { setStatus('请先打开工作区'); return; }
    setStatus('正在索引工作区文件…');
    const result = await window.electronAPI.workspace.listFiles(workspace.path);
    if (!result.success) { setStatus(`文件索引失败：${displayError(result.error)}`); return; }
    setQuickOpen({ open: true, query: '', files: (result.data ?? []) as TreeNode[] });
    setStatus(`已索引 ${result.data?.length ?? 0} 个文件`);
  }, [setQuickOpen, setStatus, workspace]);

  const openStandaloneFile = useCallback(async () => {
    const result = await window.electronAPI.pickFile({ multiple: false });
    const file = (Array.isArray(result) ? result[0] : result) as FilePickResult | null;
    if (!file) return;
    try {
      const content = decodeBase64Utf8(file.content);
      if (!documents.some((document) => document.path === file.path)) {
        setDocuments((previous) => [...previous, {
          path: file.path, name: file.name, content, savedContent: content,
          language: languageIdFromName(file.name), standalone: true, encoding: 'utf8',
          lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF', mixedLineEndings: false,
          readOnly: false, pinned: true,
        }]);
      }
      setActivePath(file.path);
      setStatus(`已打开 ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '文件打开失败');
    }
  }, [documents, setActivePath, setDocuments, setStatus]);

  const openTreeFile = useCallback(async (node: TreeNode, pinned = false) => {
    if (!workspace) return;
    if (documents.some((document) => document.path === node.path)) {
      if (pinned) setDocuments((previous) => previous.map((document) => (
        document.path === node.path ? { ...document, pinned: true } : document
      )));
      setActivePath(node.path);
      void revealWorkspacePath(node.path);
      return;
    }
    const requestId = ++openRequestRef.current;
    setStatus(`正在打开 ${node.name}…`);
    const result = await window.electronAPI.workspace.readTextFile(workspace.path, node.path);
    if (requestId !== openRequestRef.current) return;
    if (!result.success || !result.data) { setStatus(displayError(result.error)); return; }
    const data = result.data;
    setDocuments((previous) => [
      ...previous.filter((document) => document.pinned !== false || document.content !== document.savedContent),
      {
        path: node.path, name: node.name, content: data.content,
        savedContent: data.content, language: languageIdFromName(node.name),
        encoding: data.encoding, lineEnding: data.lineEnding,
        mixedLineEndings: data.mixedLineEndings, modifiedAt: data.modifiedAt,
        readOnly: data.readOnly, pinned,
      },
    ]);
    setActivePath(node.path);
    void revealWorkspacePath(node.path);
    setStatus(`已打开 ${node.name}`);
  }, [documents, revealWorkspacePath, setActivePath, setDocuments, setStatus, workspace]);

  return { showQuickOpen, openStandaloneFile, openTreeFile };
}
