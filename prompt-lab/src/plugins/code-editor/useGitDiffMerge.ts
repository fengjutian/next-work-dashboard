import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceGitStatus } from '@/types/electron';
import { classifyConflictStatus } from '../../main/git-conflicts';
import { hasGitConflictMarkers, languageIdFromName } from './editor-utils';
import { displayError, type AiHunk, type OpenDocument } from './editor-types';

export interface GitHunk { label: string; patch: string }

export interface EditorDiffView {
  path: string;
  name: string;
  original: string;
  modified: string;
  language: string;
  source?: 'external' | 'git' | 'merge' | 'ai' | 'search';
}

interface UseGitDiffMergeOptions {
  workspace: { path: string } | null;
  diffView: EditorDiffView | null;
  setDiffView: Dispatch<SetStateAction<EditorDiffView | null>>;
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  appendOutput: (message: string) => void;
  refreshGitStatus: () => Promise<void>;
  computeDiffHunks: (original: string, modified: string) => AiHunk[];
}

function extractGitHunks(patchText: string): GitHunk[] {
  const lines = patchText.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunk < 0) return [];
  const header = lines.slice(0, firstHunk).join('\n');
  const hunks: GitHunk[] = [];
  let start = firstHunk;
  for (let index = firstHunk + 1; index <= lines.length; index += 1) {
    if (index === lines.length || lines[index].startsWith('@@')) {
      const hunkLines = lines.slice(start, index);
      hunks.push({ label: hunkLines[0], patch: `${header}\n${hunkLines.join('\n')}\n` });
      start = index;
    }
  }
  return hunks;
}

export function useGitDiffMerge({
  workspace, diffView, setDiffView, setDocuments, setStatus,
  appendOutput, refreshGitStatus, computeDiffHunks,
}: UseGitDiffMergeOptions) {
  const [gitHunks, setGitHunks] = useState<GitHunk[]>([]);
  const [mergeHunks, setMergeHunks] = useState<AiHunk[]>([]);
  const [mergeBase, setMergeBase] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<string | null>(null);
  const [mergeInitialResult, setMergeInitialResult] = useState<string | null>(null);
  const [mergeConflictPaths, setMergeConflictPaths] = useState<{ base: string; ours: string; theirs: string } | null>(null);

  const showGitDiff = useCallback(async (entry: WorkspaceGitStatus) => {
    if (!workspace) return;
    if (classifyConflictStatus(entry.status)) {
      const versions = await window.electronAPI.workspace.gitOperation<{
        base: string; ours: string; theirs: string; conflictType?: string;
        paths: { base: string; ours: string; theirs: string };
      }>(workspace.path, 'conflictVersions', { path: entry.path });
      if (!versions.success || !versions.data) {
        setStatus(`冲突版本读取失败：${displayError(versions.error)}`);
        return;
      }
      setGitHunks([]);
      setMergeBase(versions.data.base);
      setMergeResult(versions.data.ours);
      setMergeInitialResult(versions.data.ours);
      setMergeConflictPaths(versions.data.conflictType === 'rename/rename' ? versions.data.paths : null);
      const name = versions.data.conflictType === 'rename/rename'
        ? `rename/rename: ${versions.data.paths.base} → ${versions.data.paths.ours} | ${versions.data.paths.theirs}`
        : entry.path;
      setDiffView({
        path: versions.data.paths.ours, name, original: versions.data.ours,
        modified: versions.data.theirs, language: languageIdFromName(versions.data.paths.ours), source: 'merge',
      });
      return;
    }
    const current = await window.electronAPI.workspace.readTextFile(workspace.path, entry.path);
    if (!current.success || !current.data) { setStatus(`Diff 读取失败：${displayError(current.error)}`); return; }
    const [head, patch] = await Promise.all([
      window.electronAPI.workspace.gitShowHead(workspace.path, entry.path),
      window.electronAPI.workspace.gitOperation<string>(workspace.path, 'fileDiff', { path: entry.path }),
    ]);
    setGitHunks(patch.success ? extractGitHunks(patch.data ?? '') : []);
    setDiffView({
      path: entry.path, name: entry.path, original: head.success ? head.data ?? '' : '',
      modified: current.data.content, language: languageIdFromName(entry.path), source: 'git',
    });
  }, [setDiffView, setStatus, workspace]);

  const stageGitHunk = useCallback(async (hunk: GitHunk) => {
    if (!workspace) return;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, 'stagePatch', { patch: hunk.patch });
    if (!result.success) { setStatus(`Hunk 暂存失败：${displayError(result.error)}`); return; }
    setGitHunks((previous) => previous.filter((item) => item.patch !== hunk.patch));
    await refreshGitStatus();
    setStatus(`已暂存 ${hunk.label}`);
  }, [refreshGitStatus, setStatus, workspace]);

  const unstageFile = useCallback(async () => {
    if (!workspace || !diffView) return;
    const result = await window.electronAPI.workspace.gitUnstage(workspace.path, [diffView.path]);
    if (!result.success) { setStatus(`取消暂存失败：${displayError(result.error)}`); return; }
    await refreshGitStatus();
    setStatus('已取消暂存全部更改');
  }, [diffView, refreshGitStatus, setStatus, workspace]);

  const resolveGitConflict = useCallback(async (strategy: 'ours' | 'theirs') => {
    if (!workspace || !diffView || diffView.source !== 'merge') return;
    const result = await window.electronAPI.workspace.gitOperation(workspace.path, 'resolveConflict', { path: diffView.path, strategy });
    if (!result.success) { setStatus(`冲突解决失败：${displayError(result.error)}`); return; }
    setDiffView(null);
    await refreshGitStatus();
    setStatus(`已使用${strategy === 'ours' ? '当前分支' : '传入分支'}版本并暂存`);
  }, [diffView, refreshGitStatus, setDiffView, setStatus, workspace]);

  const applyMergeHunk = useCallback((hunkIndex: number, side: 'ours' | 'theirs') => {
    if (!diffView || diffView.source !== 'merge') return;
    const hunk = mergeHunks.find((item) => item.index === hunkIndex);
    if (!hunk) return;
    const originalLines = diffView.original.split('\n');
    const modifiedLines = diffView.modified.split('\n');
    const newOriginal = side === 'theirs'
      ? [...originalLines.slice(0, hunk.originalStart - 1), ...hunk.modifiedLines, ...originalLines.slice(hunk.originalStart - 1 + hunk.originalLines.length)].join('\n')
      : diffView.original;
    const newModified = side === 'ours'
      ? [...modifiedLines.slice(0, hunk.modifiedStart - 1), ...hunk.originalLines, ...modifiedLines.slice(hunk.modifiedStart - 1 + hunk.modifiedLines.length)].join('\n')
      : diffView.modified;
    const remaining = computeDiffHunks(newOriginal, newModified);
    setMergeHunks(remaining);
    setDiffView({ ...diffView, original: newOriginal, modified: newModified });
    setMergeResult(newOriginal);
    setStatus(`冲突块 ${hunkIndex + 1}：选择${side === 'ours' ? '当前分支' : '传入分支'}，剩余 ${remaining.length} 个`);
  }, [computeDiffHunks, diffView, mergeHunks, setDiffView, setStatus]);

  const finishMerge = useCallback(async () => {
    if (!workspace || !diffView || diffView.source !== 'merge' || mergeResult === null) return;
    if (hasGitConflictMarkers(mergeResult)) { setStatus('Result 中仍有冲突标记，无法完成合并'); return; }
    const read = await window.electronAPI.workspace.readTextFile(workspace.path, diffView.path);
    if (!read.success || !read.data) { setStatus('无法读取文件以完成合并'); return; }
    const write = await window.electronAPI.workspace.writeTextFile(workspace.path, diffView.path, mergeResult, {
      encoding: read.data.encoding, lineEnding: read.data.lineEnding, expectedModifiedAt: read.data.modifiedAt,
    });
    if (!write.success) { setStatus(`写入合并结果失败：${displayError(write.error)}`); return; }
    const stage = mergeConflictPaths
      ? await window.electronAPI.workspace.gitOperation(workspace.path, 'stageConflictResult', {
        resultPath: diffView.path,
        obsoletePaths: [mergeConflictPaths.base, mergeConflictPaths.theirs].filter((path) => path !== diffView.path),
      })
      : await window.electronAPI.workspace.gitStage(workspace.path, [diffView.path]);
    if (!stage.success) {
      await window.electronAPI.workspace.writeTextFile(workspace.path, diffView.path, read.data.content, {
        encoding: read.data.encoding, lineEnding: read.data.lineEnding, expectedModifiedAt: write.data?.modifiedAt,
      });
      setStatus(`暂存失败：${displayError(stage.error)}`);
      return;
    }
    setDiffView(null);
    setMergeHunks([]);
    setMergeBase(null);
    setMergeResult(null);
    setMergeInitialResult(null);
    setMergeConflictPaths(null);
    await refreshGitStatus();
    setDocuments((previous) => previous.map((document) => document.path === diffView.path
      ? { ...document, content: mergeResult, savedContent: mergeResult, modifiedAt: write.data?.modifiedAt }
      : document));
    appendOutput(`合并完成：${diffView.name}`);
    setStatus('合并冲突已解决并暂存');
  }, [appendOutput, diffView, mergeConflictPaths, mergeResult, refreshGitStatus, setDiffView, setDocuments, setStatus, workspace]);

  return {
    gitHunks, mergeHunks, setMergeHunks, mergeBase, setMergeBase,
    mergeResult, setMergeResult, mergeInitialResult, setMergeInitialResult,
    mergeConflictPaths, showGitDiff, stageGitHunk, unstageFile,
    resolveGitConflict, applyMergeHunk, finishMerge,
  };
}
