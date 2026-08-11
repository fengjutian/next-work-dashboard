/**
 * 文档持久化 hook — 把工作区内的 .md 文档读到 MarkdownDocument、把内存中的内容写回磁盘。
 *
 * 关键点：
 *  - 读取时记录 modifiedAt，作为后续保存的 expectedModifiedAt。
 *  - 写入失败且是 CONFLICT 时，把当前磁盘内容塞回 documents store，标记 dirty 由用户决定。
 *  - 异步操作是幂等的：同一文档短时间内多次保存以最后一次为准（用 inflightMap 取消旧请求）。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { MarkdownDocument, MarkdownDocumentSource, MarkdownEditorMode, SaveResult } from '../types';
import { splitFrontmatter } from '../editor/markdown-codec';
import { isMarkdownSafe } from '../editor/roundtrip-guard';

export interface PersistenceDeps {
  activeDocument: MarkdownDocument | null;
  openDocument: (doc: MarkdownDocument) => void;
  applySaveResult: (documentId: string, content: string, lineEnding: 'lf' | 'crlf', result: SaveResult) => void;
  markDirty: (documentId: string, dirty: boolean) => void;
  setSaveState: (documentId: string, saving: boolean, error: string | null) => void;
}

export interface OpenOptions {
  rootPath: string;
  relativePath: string;
  source?: MarkdownDocumentSource;
  /** 强制以源码模式打开（绕过可视化检测）。 */
  forceSource?: boolean;
}

export function useMarkdownPersistence(deps: PersistenceDeps) {
  const inflightRef = useRef(new Map<string, Promise<SaveResult>>());

  const openFromWorkspace = useCallback(async (options: OpenOptions): Promise<MarkdownDocument> => {
    const result = await window.electronAPI.workspace.readTextFile(options.rootPath, options.relativePath);
    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'READ_FAILED');
    }
    const file = result.data;
    const { body, frontmatter, attributes } = splitFrontmatter(file.content);
    const safe = isMarkdownSafe(body);
    const id = makeDocumentId(options.rootPath, options.relativePath);
    const mode = options.forceSource || !safe ? 'source' : 'visual';
    const document: MarkdownDocument = {
      id,
      rootPath: options.rootPath,
      relativePath: options.relativePath,
      displayName: basename(options.relativePath),
      source: options.source ?? 'workspace',
      content: file.content,
      savedContent: file.content,
      savedFrontmatter: frontmatter,
      baseModifiedAt: file.modifiedAt,
      lineEnding: file.lineEnding.toLowerCase() === 'crlf' ? 'crlf' : 'lf',
      dirty: false,
      mode,
      charCount: file.content.length,
      lineCount: file.content.split(/\r?\n/).length,
      roundtrip: safe ? 'safe' : 'unsafe',
      hasUnsupportedBlocks: !safe,
      roundtripReason: safe ? undefined : '检测到无法安全往返的语法',
      saveStatus: 'saved',
      saveError: null,
      ...(Object.keys(attributes).length ? { roundtripReason: safe ? undefined : '检测到无法安全往返的语法' } : {}),
    };
    deps.openDocument(document);
    return document;
  }, [deps]);

  const save = useCallback(async (document: MarkdownDocument, contentOverride?: string): Promise<SaveResult> => {
    if (!document.rootPath) {
      return { ok: false, reason: 'error', message: '外部打开的文档暂不支持保存，请用文件菜单重新打开' };
    }
    const inflight = inflightRef.current.get(document.id);
    if (inflight) return inflight;
    deps.setSaveState(document.id, true, null);
    const promise = (async (): Promise<SaveResult> => {
      const content = contentOverride ?? document.content;
      const writeResult = await window.electronAPI.workspace.writeTextFile(
        document.rootPath!,
        document.relativePath,
        content,
        {
          lineEnding: document.lineEnding === 'crlf' ? 'CRLF' : 'LF',
          ...(document.baseModifiedAt !== null ? { expectedModifiedAt: document.baseModifiedAt } : {}),
        },
      );
      if (!writeResult.success) {
        const message = writeResult.error ?? 'WRITE_FAILED';
        // 判定冲突：后端返回的 error 文本中包含 EXPECTED_MODIFIED_AT_MISMATCH。
        if (/expectedModifiedAt|EXPECTED_MODIFIED_AT|modified.*mismatch/i.test(message)) {
          // 重新读取磁盘版本，供用户决定。
          const reread = await window.electronAPI.workspace.readTextFile(document.rootPath!, document.relativePath);
          const currentContent = reread.success && reread.data ? reread.data.content : '';
          const currentModifiedAt = reread.success && reread.data ? reread.data.modifiedAt : Date.now();
          return { ok: false, reason: 'conflict', currentContent, currentModifiedAt };
        }
        if (/read.?only|EACCES|EPERM/i.test(message)) {
          return { ok: false, reason: 'read-only' };
        }
        return { ok: false, reason: 'error', message };
      }
      const modifiedAt = writeResult.data?.modifiedAt ?? Date.now();
      const size = writeResult.data?.size ?? content.length;
      return { ok: true, modifiedAt, size };
    })();
    inflightRef.current.set(document.id, promise);
    try {
      const result = await promise;
      deps.applySaveResult(document.id, contentOverride ?? document.content, document.lineEnding, result);
      deps.markDirty(document.id, false);
      if (result.ok) {
        deps.setSaveState(document.id, false, null);
      } else {
        const failure = result as Extract<SaveResult, { ok: false }>;
        const errorMsg =
          failure.reason === 'conflict'
            ? '磁盘文件已被外部修改'
            : failure.reason === 'read-only'
              ? '文件为只读'
              : failure.reason === 'error'
                ? failure.message
                : '保存失败';
        deps.setSaveState(document.id, false, errorMsg);
      }
      return result;
    } finally {
      inflightRef.current.delete(document.id);
    }
  }, [deps]);

  return { openFromWorkspace, save };
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function makeDocumentId(rootPath: string, relativePath: string): string {
  return `md:${rootPath}::${relativePath.replace(/\\/g, '/')}`;
}

/**
 * 加载 localStorage 中的最近文档列表（仅元数据，不含内容）。
 * 用于跨会话恢复最近打开的标签。
 */
export function loadRecentDocumentsFromStorage(): Array<{ rootPath: string | null; relativePath: string; mode: MarkdownEditorMode }> {
  try {
    const raw = localStorage.getItem('markdown-editor.recent-documents.v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { rootPath: string | null; relativePath: string; mode: MarkdownEditorMode } =>
        typeof item === 'object' && item !== null && typeof item.relativePath === 'string',
    );
  } catch {
    return [];
  }
}

/** 把当前打开的文档列表保存到 localStorage（不含 content，仅元数据）。 */
export function persistRecentDocuments(documents: MarkdownDocument[]): void {
  try {
    const minimal = documents.map((doc) => ({
      rootPath: doc.rootPath,
      relativePath: doc.relativePath,
      mode: doc.mode,
    }));
    localStorage.setItem('markdown-editor.recent-documents.v1', JSON.stringify(minimal.slice(-20)));
  } catch {
    /* localStorage 可能不可用 */
  }
}

/** 监听全局关闭事件：仅做 best-effort 提示，不阻塞 Electron 关闭。 */
export function useWarnOnUnsavedClose(documents: MarkdownDocument[]): void {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      const hasDirty = documents.some((doc) => doc.dirty);
      if (hasDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [documents]);
}
