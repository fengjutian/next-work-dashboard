import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceEncoding, WorkspaceSearchResult } from '@/types/electron';
import { languageIdFromName } from '../editor-utils';
import { displayError, type OpenDocument } from '../editor-types';

export interface SearchPanelState {
  open: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  include: string;
  exclude: string;
  loading: boolean;
  results: WorkspaceSearchResult[];
}

interface SearchDiff {
  path: string;
  name: string;
  original: string;
  modified: string;
  language: string;
  source?: 'external' | 'git' | 'merge' | 'ai' | 'search';
}

interface ReplaceSnapshot {
  path: string;
  content: string;
  encoding: WorkspaceEncoding;
  lineEnding: 'LF' | 'CRLF';
}

interface SearchPreview extends ReplaceSnapshot {
  name: string;
  original: string;
  modified: string;
  language: string;
  modifiedAt?: number;
}

interface UseWorkspaceSearchOptions {
  workspace: { path: string } | null;
  diffView: SearchDiff | null;
  setDiffView: Dispatch<SetStateAction<SearchDiff | null>>;
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  appConfirm: (message: string) => Promise<boolean>;
  appendOutput: (message: string) => void;
  setStatus: Dispatch<SetStateAction<string>>;
  markRecentlySaved: (path: string) => void;
  openResult: (result: WorkspaceSearchResult) => Promise<void>;
}

const INITIAL_SEARCH: SearchPanelState = {
  open: false,
  query: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  include: '',
  exclude: '',
  loading: false,
  results: [],
};

export function useWorkspaceSearch({
  workspace, diffView, setDiffView, setDocuments, appConfirm, appendOutput,
  setStatus, markRecentlySaved, openResult,
}: UseWorkspaceSearchOptions) {
  const [searchPanel, setSearchPanel] = useState<SearchPanelState>(INITIAL_SEARCH);
  const [replaceHistory, setReplaceHistory] = useState<ReplaceSnapshot[][]>([]);
  const [searchPreviews, setSearchPreviews] = useState<SearchPreview[]>([]);

  const runSearch = useCallback(async () => {
    if (!workspace || !searchPanel.query.trim()) return;
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    const result = await window.electronAPI.workspace.search(workspace.path, searchPanel.query.trim(), {
      caseSensitive: searchPanel.caseSensitive,
      wholeWord: searchPanel.wholeWord,
      useRegex: searchPanel.useRegex,
      include: searchPanel.include,
      exclude: searchPanel.exclude,
    });
    if (!result.success) {
      setStatus(`搜索失败：${displayError(result.error)}`);
      setSearchPanel((previous) => ({ ...previous, loading: false }));
      return;
    }
    setSearchPanel((previous) => ({ ...previous, loading: false, results: result.data ?? [] }));
    setStatus(`找到 ${result.data?.length ?? 0} 个结果`);
  }, [searchPanel, setStatus, workspace]);

  const buildMatcher = useCallback((global: boolean) => {
    const escaped = searchPanel.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = searchPanel.useRegex ? searchPanel.query : escaped;
    const expression = searchPanel.wholeWord ? `\\b(?:${source})\\b` : source;
    return new RegExp(global ? expression : `^(?:${expression})`, `${searchPanel.caseSensitive ? '' : 'i'}${global ? 'g' : ''}`);
  }, [searchPanel.caseSensitive, searchPanel.query, searchPanel.useRegex, searchPanel.wholeWord]);

  const previewSearchReplace = useCallback(async (results: WorkspaceSearchResult[]) => {
    if (!workspace || results.length === 0 || !searchPanel.replacement) return;
    let matcher: RegExp;
    try { matcher = buildMatcher(true); } catch (error) {
      setStatus(`预览失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    const previews: SearchPreview[] = [];
    for (const path of new Set(results.map((result) => result.path))) {
      const read = await window.electronAPI.workspace.readTextFile(workspace.path, path);
      if (!read.success || !read.data) continue;
      matcher.lastIndex = 0;
      const modified = read.data.content.replace(matcher, searchPanel.replacement);
      if (modified === read.data.content) continue;
      previews.push({
        path, name: path.split(/[\\/]/).pop() ?? path, original: read.data.content, modified,
        language: languageIdFromName(path), encoding: read.data.encoding,
        lineEnding: read.data.lineEnding, modifiedAt: read.data.modifiedAt,
        content: read.data.content,
      });
    }
    setSearchPanel((previous) => ({ ...previous, loading: false }));
    if (!previews.length) { setStatus('没有文件需要修改'); return; }
    setSearchPreviews(previews);
    const first = previews[0];
    setDiffView({ ...first, source: 'search' });
    appendOutput(`替换预览：${previews.length} 个文件，${results.length} 处匹配`);
    setStatus(`预览 ${previews.length} 个文件的变更`);
  }, [appendOutput, buildMatcher, searchPanel.replacement, setDiffView, setStatus, workspace]);

  const showNextPreview = useCallback((remaining: SearchPreview[]) => {
    setSearchPreviews(remaining);
    const next = remaining[0];
    setDiffView(next ? { ...next, source: 'search' } : null);
    return next;
  }, [setDiffView]);

  const acceptSearchReplace = useCallback(async () => {
    if (!diffView || diffView.source !== 'search' || !workspace) return;
    const preview = searchPreviews.find((item) => item.path === diffView.path);
    if (!preview) return;
    const write = await window.electronAPI.workspace.writeTextFile(workspace.path, preview.path, preview.modified, {
      encoding: preview.encoding, lineEnding: preview.lineEnding, expectedModifiedAt: preview.modifiedAt,
    });
    if (!write.success) { setStatus(`替换失败：${preview.path} — ${displayError(write.error)}`); return; }
    markRecentlySaved(preview.path);
    setDocuments((previous) => previous.map((document) => document.path === preview.path
      ? { ...document, content: preview.modified, savedContent: preview.modified, modifiedAt: write.data?.modifiedAt }
      : document));
    const next = showNextPreview(searchPreviews.filter((item) => item.path !== preview.path));
    if (!next) {
      appendOutput('全部替换预览已应用');
      setStatus('所有替换已应用');
      setSearchPanel((previous) => ({ ...previous, results: [] }));
    } else setStatus(`已应用 ${preview.name}，剩余 ${searchPreviews.length - 1} 个文件`);
  }, [appendOutput, diffView, markRecentlySaved, searchPreviews, setDocuments, setStatus, showNextPreview, workspace]);

  const rejectSearchReplace = useCallback(() => {
    if (!diffView || diffView.source !== 'search') return;
    const remaining = searchPreviews.filter((item) => item.path !== diffView.path);
    const next = showNextPreview(remaining);
    if (!next) { appendOutput('已取消所有替换预览'); setStatus('已取消替换预览'); }
    else setStatus(`已跳过，剩余 ${remaining.length} 个文件`);
  }, [appendOutput, diffView, searchPreviews, setStatus, showNextPreview]);

  const replaceAllSearchResults = useCallback(async () => {
    if (!workspace || !searchPanel.results.length) return;
    const paths = [...new Set(searchPanel.results.map((result) => result.path))];
    if (!await appConfirm(`将在 ${paths.length} 个文件中替换 ${searchPanel.results.length} 处匹配，是否继续？`)) return;
    let matcher: RegExp;
    try { matcher = buildMatcher(true); } catch (error) { setStatus(`替换失败：${error instanceof Error ? error.message : String(error)}`); return; }
    setSearchPanel((previous) => ({ ...previous, loading: true }));
    let replacedFiles = 0;
    for (const path of paths) {
      const read = await window.electronAPI.workspace.readTextFile(workspace.path, path);
      if (!read.success || !read.data) continue;
      matcher.lastIndex = 0;
      const content = read.data.content.replace(matcher, searchPanel.replacement);
      if (content === read.data.content) continue;
      const write = await window.electronAPI.workspace.writeTextFile(workspace.path, path, content, {
        encoding: read.data.encoding, lineEnding: read.data.lineEnding, expectedModifiedAt: read.data.modifiedAt,
      });
      if (!write.success) { setStatus(`替换中止：${path} — ${displayError(write.error)}`); break; }
      replacedFiles += 1;
      markRecentlySaved(path);
      setDocuments((previous) => previous.map((document) => document.path === path
        ? { ...document, content, savedContent: content, modifiedAt: write.data?.modifiedAt }
        : document));
    }
    appendOutput(`工作区替换完成：${replacedFiles}/${paths.length} 个文件`);
    setSearchPanel((previous) => ({ ...previous, loading: false, results: [] }));
    setStatus(`已在 ${replacedFiles} 个文件中完成替换`);
  }, [appConfirm, appendOutput, buildMatcher, markRecentlySaved, searchPanel.replacement, searchPanel.results, setDocuments, setStatus, workspace]);

  const replaceSearchResults = useCallback(async (results: WorkspaceSearchResult[]) => {
    if (!workspace || !results.length) return;
    if (results.length > 1 && !await appConfirm(`将替换 ${results.length} 处匹配，是否继续？`)) return;
    let matcher: RegExp;
    try { matcher = buildMatcher(false); } catch (error) { setStatus(`替换失败：${error instanceof Error ? error.message : String(error)}`); return; }
    const grouped = new Map<string, WorkspaceSearchResult[]>();
    for (const result of results) grouped.set(result.path, [...(grouped.get(result.path) ?? []), result]);
    const snapshots: ReplaceSnapshot[] = [];
    const edits: Array<ReplaceSnapshot & { expectedModifiedAt: number }> = [];
    for (const [path, matches] of grouped) {
      const read = await window.electronAPI.workspace.readTextFile(workspace.path, path);
      if (!read.success || !read.data) continue;
      let content = read.data.content;
      snapshots.push({ path, content, encoding: read.data.encoding, lineEnding: read.data.lineEnding });
      const offsets: number[] = [];
      let offset = 0;
      for (const line of content.split('\n')) { offsets.push(offset); offset += line.length + 1; }
      for (const match of [...matches].sort((a, b) => b.line - a.line || b.column - a.column)) {
        const start = (offsets[match.line - 1] ?? 0) + match.column - 1;
        const tail = content.slice(start);
        matcher.lastIndex = 0;
        if (!matcher.test(tail)) continue;
        matcher.lastIndex = 0;
        content = `${content.slice(0, start)}${tail.replace(matcher, searchPanel.replacement)}`;
      }
      edits.push({ path, content, encoding: read.data.encoding, lineEnding: read.data.lineEnding, expectedModifiedAt: read.data.modifiedAt });
    }
    if (!edits.length) return;
    const write = await window.electronAPI.workspace.writeTextFiles(workspace.path, edits);
    if (!write.success) { setStatus(`替换失败，未写入任何文件：${displayError(write.error)}`); return; }
    const modifiedAt = new Map((write.data ?? []).map((item) => [item.path, item.modifiedAt]));
    for (const edit of edits) markRecentlySaved(edit.path);
    setDocuments((previous) => previous.map((document) => {
      const edit = edits.find((item) => item.path === document.path);
      return edit ? { ...document, content: edit.content, savedContent: edit.content, modifiedAt: modifiedAt.get(edit.path) } : document;
    }));
    setReplaceHistory((previous) => [...previous.slice(-19), snapshots]);
    await runSearch();
  }, [appConfirm, buildMatcher, markRecentlySaved, runSearch, searchPanel.replacement, setDocuments, setStatus, workspace]);

  const undoSearchReplace = useCallback(async () => {
    if (!workspace) return;
    const snapshots = replaceHistory.at(-1);
    if (!snapshots) return;
    for (const snapshot of snapshots) {
      const current = await window.electronAPI.workspace.readTextFile(workspace.path, snapshot.path);
      if (!current.success || !current.data) continue;
      const write = await window.electronAPI.workspace.writeTextFile(workspace.path, snapshot.path, snapshot.content, {
        encoding: snapshot.encoding, lineEnding: snapshot.lineEnding, expectedModifiedAt: current.data.modifiedAt,
      });
      if (!write.success) { setStatus(`撤销替换失败：${snapshot.path} — ${displayError(write.error)}`); return; }
      markRecentlySaved(snapshot.path);
      setDocuments((previous) => previous.map((document) => document.path === snapshot.path
        ? { ...document, content: snapshot.content, savedContent: snapshot.content, modifiedAt: write.data?.modifiedAt }
        : document));
    }
    setReplaceHistory((previous) => previous.slice(0, -1));
    await runSearch();
    setStatus('已撤销上一次搜索替换');
  }, [markRecentlySaved, replaceHistory, runSearch, setDocuments, setStatus, workspace]);

  const openSearchResult = useCallback(async (result: WorkspaceSearchResult) => {
    await openResult(result);
    setSearchPanel((previous) => ({ ...previous, open: false }));
  }, [openResult]);

  return {
    searchPanel, setSearchPanel, replaceHistory, searchPreviews, runSearch, previewSearchReplace,
    acceptSearchReplace, rejectSearchReplace, replaceAllSearchResults,
    replaceSearchResults, undoSearchReplace, openSearchResult,
  };
}
