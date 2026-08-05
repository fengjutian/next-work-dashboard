import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { displayError, type AiHunk, type OpenDocument } from '../editor-types';
import type { AiEditHistory, AiFileProposal } from './useAiSessionState';
import type { EditorDiffView } from '../useGitDiffMerge';

interface UseAiProposalReviewOptions {
  workspace: { path: string } | null;
  isolated?: boolean;
  documents: OpenDocument[];
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  diffView: EditorDiffView | null;
  setDiffView: Dispatch<SetStateAction<EditorDiffView | null>>;
  aiProposals: AiFileProposal[];
  setAiProposals: Dispatch<SetStateAction<AiFileProposal[]>>;
  aiHistory: AiEditHistory[];
  setAiHistory: Dispatch<SetStateAction<AiEditHistory[]>>;
  aiHunks: AiHunk[];
  setAiHunks: Dispatch<SetStateAction<AiHunk[]>>;
  computeDiffHunks: (original: string, modified: string) => AiHunk[];
  updateSessionAcceptCount: (count?: number) => void;
  appendOutput: (message: string) => void;
  setStatus: Dispatch<SetStateAction<string>>;
}

function proposalDiff(proposal: AiFileProposal): EditorDiffView {
  return {
    path: proposal.path, name: proposal.path, original: proposal.original,
    modified: proposal.modified, language: proposal.language, source: 'ai',
  };
}

export function useAiProposalReview({
  workspace, isolated = false, documents, setDocuments, setActivePath, diffView, setDiffView,
  aiProposals, setAiProposals, aiHistory, setAiHistory, aiHunks, setAiHunks,
  computeDiffHunks, updateSessionAcceptCount, appendOutput, setStatus,
}: UseAiProposalReviewOptions) {
  const advance = useCallback((path: string) => {
    const remaining = aiProposals.filter((proposal) => proposal.path !== path);
    setAiProposals(remaining);
    setDiffView(remaining[0] ? proposalDiff(remaining[0]) : null);
  }, [aiProposals, setAiProposals, setDiffView]);

  const acceptProposalView = useCallback((view: EditorDiffView) => {
    const proposal = aiProposals.find((item) => item.path === view.path);
    const isNew = !proposal?.metadata;
    const isDelete = view.modified === '' && view.original !== '';
    setDocuments((previous) => {
      const exists = previous.some((document) => document.path === view.path);
      if (isDelete) return previous.filter((document) => document.path !== view.path);
      const updated = previous.map((document) => document.path === view.path
        ? { ...document, content: view.modified, pinned: true }
        : document);
      if (exists) return updated;
      return [...updated, {
        path: view.path,
        name: view.path.split(/[\\/]/).pop() ?? view.path,
        content: view.modified,
        savedContent: isNew ? '' : view.modified,
        language: view.language,
        encoding: 'utf8',
        lineEnding: 'LF',
        pinned: true,
      }];
    });
    setAiHistory((previous) => [...previous.slice(-49), {
      id: Date.now(), path: view.path, before: view.original, after: view.modified,
    }]);
    setActivePath(view.path);
    appendOutput(`已接受 AI 对 ${view.name} 的修改（尚未保存）`);
    setStatus('已接受 AI 修改，请检查后保存');
    updateSessionAcceptCount();
    advance(view.path);
  }, [advance, aiProposals, appendOutput, setActivePath, setAiHistory, setDocuments, setStatus, updateSessionAcceptCount]);

  const acceptAiEdit = useCallback(() => {
    if (!diffView || diffView.source !== 'ai') return;
    if (isolated) { setStatus('隔离模式请使用“全部接受”，修改将原子写入 worktree'); return; }
    acceptProposalView(diffView);
  }, [acceptProposalView, diffView, isolated, setStatus]);

  const acceptAiProposal = useCallback((path: string) => {
    if (isolated) { setStatus('隔离模式请使用“全部接受”，修改将原子写入 worktree'); return; }
    const proposal = aiProposals.find((item) => item.path === path);
    if (proposal) acceptProposalView(proposalDiff(proposal));
  }, [acceptProposalView, aiProposals, isolated, setStatus]);

  const rejectAiEdit = useCallback(() => {
    if (diffView?.source === 'ai') advance(diffView.path);
  }, [advance, diffView]);

  const rejectAiProposal = useCallback((path: string) => advance(path), [advance]);

  const rejectAllAiEdits = useCallback(() => {
    const count = aiProposals.length;
    setAiProposals([]);
    setDiffView(null);
    setStatus(count ? `已拒绝 ${count} 个 AI 修改候选` : '没有待拒绝的 AI 修改');
  }, [aiProposals.length, setAiProposals, setDiffView, setStatus]);

  const acceptAllAiEdits = useCallback(async () => {
    if (!workspace || !aiProposals.length) return;
    for (const proposal of aiProposals) {
      const sourcePath = proposal.previousPath ?? proposal.path;
      const opened = isolated ? undefined : documents.find((document) => document.path === sourcePath);
      if (opened && opened.content !== proposal.original) {
        setStatus(`AI 候选已过期：${proposal.path} 在生成后被修改，未接受任何文件`);
        return;
      }
      if (proposal.metadata && !opened) {
        const current = await window.electronAPI.workspace.readTextFile(workspace.path, sourcePath);
        if (!current.success || !current.data || current.data.modifiedAt !== proposal.metadata.modifiedAt) {
          setStatus(`AI 候选已过期：${proposal.path} 的磁盘版本已变化，未接受任何文件`);
          return;
        }
      }
    }
    const mutations = aiProposals.map((proposal) => {
      if (!proposal.metadata) return {
        kind: 'create' as const, path: proposal.path, content: proposal.modified,
        encoding: 'utf8' as const, lineEnding: 'LF' as const,
      };
      if (proposal.modified === '') return {
        kind: 'delete' as const, path: proposal.path, expectedModifiedAt: proposal.metadata.modifiedAt,
      };
      if (proposal.previousPath) return {
        kind: 'rename' as const, path: proposal.previousPath, targetPath: proposal.path,
        content: proposal.modified, encoding: proposal.metadata.encoding,
        lineEnding: proposal.metadata.lineEnding, expectedModifiedAt: proposal.metadata.modifiedAt,
      };
      return {
        kind: 'write' as const, path: proposal.path, content: proposal.modified,
        encoding: proposal.metadata.encoding, lineEnding: proposal.metadata.lineEnding,
        expectedModifiedAt: proposal.metadata.modifiedAt,
      };
    });
    const diskResult = await window.electronAPI.workspace.mutateFiles(workspace.path, mutations);
    if (!diskResult.success) {
      setStatus(`AI 文件事务失败，工作区未产生部分修改：${displayError(diskResult.error)}`);
      return;
    }
    const modifiedAt = new Map((diskResult.data ?? []).map((item) => [item.path, item.modifiedAt]));
    if (!isolated) setDocuments((previous) => {
      const updated = previous
        .filter((document) => aiProposals.find((proposal) => (
          (proposal.previousPath ?? proposal.path) === document.path
        ))?.modified !== '')
        .map((document) => {
          const proposal = aiProposals.find((item) => (item.previousPath ?? item.path) === document.path);
          return proposal ? {
            ...document, path: proposal.path,
            name: proposal.path.split(/[\\/]/).pop() ?? proposal.path,
            content: proposal.modified, savedContent: proposal.modified,
            language: proposal.language, modifiedAt: modifiedAt.get(proposal.path), pinned: true,
          } : document;
        });
      const existingPaths = new Set(updated.map((document) => document.path));
      for (const proposal of aiProposals) {
        if (proposal.modified === '' || existingPaths.has(proposal.path)) continue;
        updated.push({
          path: proposal.path, name: proposal.path.split(/[\\/]/).pop() ?? proposal.path,
          content: proposal.modified, savedContent: proposal.modified,
          language: proposal.language, encoding: 'utf8', lineEnding: 'LF',
          modifiedAt: modifiedAt.get(proposal.path), pinned: true,
        });
      }
      return updated;
    });
    const now = Date.now();
    setAiHistory((previous) => [...previous, ...aiProposals.map((proposal, index) => ({
      id: now + index, path: proposal.path, before: proposal.original, after: proposal.modified,
    }))].slice(-50));
    const count = aiProposals.length;
    setAiProposals([]);
    setDiffView(null);
    updateSessionAcceptCount(count);
    appendOutput(`已原子应用 ${count} 个 AI 文件修改到磁盘`);
    setStatus(`已原子应用 ${count} 个文件`);
  }, [aiProposals, appendOutput, documents, isolated, setAiHistory, setAiProposals, setDiffView, setDocuments, setStatus, updateSessionAcceptCount, workspace]);

  const applyAiHunk = useCallback((hunkIndex: number, accept: boolean) => {
    if (!diffView || diffView.source !== 'ai') return;
    if (isolated) { setStatus('隔离模式不支持将单个 Hunk 应用到主编辑器，请审阅后全部接受到 worktree'); return; }
    const hunk = aiHunks.find((item) => item.index === hunkIndex);
    if (!hunk) return;
    const originalLines = diffView.original.split('\n');
    const modifiedLines = diffView.modified.split('\n');
    const newOriginal = accept
      ? [...originalLines.slice(0, hunk.originalStart - 1), ...hunk.modifiedLines, ...originalLines.slice(hunk.originalStart - 1 + hunk.originalLines.length)].join('\n')
      : diffView.original;
    const newModified = accept
      ? diffView.modified
      : [...modifiedLines.slice(0, hunk.modifiedStart - 1), ...hunk.originalLines, ...modifiedLines.slice(hunk.modifiedStart - 1 + hunk.modifiedLines.length)].join('\n');
    const remaining = computeDiffHunks(newOriginal, newModified);
    setAiHunks(remaining);
    setDiffView({ ...diffView, original: newOriginal, modified: newModified });
    setDocuments((previous) => previous.map((document) => document.path === diffView.path
      ? { ...document, content: newOriginal, pinned: true }
      : document));
    if (remaining.length) {
      setStatus(`${accept ? '接受' : '拒绝'} Hunk ${hunkIndex + 1}，剩余 ${remaining.length} 个`);
      return;
    }
    const proposal = aiProposals.find((item) => item.path === diffView.path);
    setAiHistory((previous) => [...previous.slice(-49), {
      id: Date.now(), path: diffView.path, before: proposal?.original ?? '', after: newModified,
    }]);
    appendOutput(`已审阅 AI 对 ${diffView.name} 的修改（尚未保存）`);
    setStatus('AI 修改审阅完成，请检查后保存');
    advance(diffView.path);
  }, [advance, aiHunks, aiProposals, appendOutput, computeDiffHunks, diffView, isolated, setAiHistory, setAiHunks, setDiffView, setDocuments, setStatus]);

  const undoLastAiEdit = useCallback(() => {
    const edit = aiHistory.at(-1);
    if (!edit) return;
    setDocuments((previous) => previous.map((document) => document.path === edit.path
      ? { ...document, content: edit.before, pinned: true }
      : document));
    setAiHistory((previous) => previous.slice(0, -1));
    setActivePath(edit.path);
    setStatus(`已撤销 AI 对 ${edit.path} 的修改`);
  }, [aiHistory, setActivePath, setAiHistory, setDocuments, setStatus]);

  return { acceptAiEdit, acceptAiProposal, rejectAiEdit, rejectAiProposal, rejectAllAiEdits, acceptAllAiEdits, applyAiHunk, undoLastAiEdit };
}
