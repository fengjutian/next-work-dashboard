/**
 * useMarkdownPersistence — 封装保存、版本检查、外部冲突处理。
 *
 * 复用现有 electronAPI.workspace.writeTextFile 的 expectedModifiedAt 能力。
 * 失败时（外部已修改）带回 incomingContent，由 UI 决定 overwrite / reload。
 */
import { useCallback, useRef } from 'react';
import type { MarkdownDocument, SaveResult } from '../types';
import { composeDocument, hasTrailingNewline } from '../editor/markdown-codec';

export interface MarkdownPersistenceApi {
  save(document: MarkdownDocument, body: string): Promise<SaveResult>;
}

export function useMarkdownPersistence(options: {
  onSaved: (id: string, savedContent: string, savedAt: number, version: number) => void;
  onConflict: (id: string, incomingContent: string, incomingModifiedAt: number) => void;
  onError: (id: string, message: string) => void;
}): MarkdownPersistenceApi {
  const optsRef = useRef(options);
  optsRef.current = options;

  const save = useCallback(async (document: MarkdownDocument, body: string): Promise<SaveResult> => {
    if (document.readOnly) {
      return { success: false, version: 0, modifiedAt: 0, size: 0, error: '文件为只读，无法保存' };
    }
    const composed = composeDocument(document.frontmatter, body, {
      lineEnding: document.lineEnding,
      trailingNewline: hasTrailingNewline(document.savedContent) || hasTrailingNewline(body),
    });
    const result = await window.electronAPI.workspace.writeTextFile(
      document.rootPath,
      document.relativePath,
      composed,
      {
        encoding: document.encoding,
        lineEnding: document.lineEnding === 'crlf' ? 'CRLF' : 'LF',
        expectedModifiedAt: document.version,
      },
    );
    if (!result.success) {
      const message = result.error ?? '保存失败';
      // 读取最新内容用于冲突回填
      const reRead = await window.electronAPI.workspace.readTextFile(document.rootPath, document.relativePath);
      const incomingContent = reRead.success && reRead.data ? reRead.data.content : '';
      const incomingModifiedAt = reRead.success && reRead.data ? reRead.data.modifiedAt : document.modifiedAt;
      if (incomingContent && incomingContent !== document.savedContent) {
        optsRef.current.onConflict(document.id, incomingContent, incomingModifiedAt);
        return {
          success: false,
          version: incomingModifiedAt,
          modifiedAt: incomingModifiedAt,
          size: incomingContent.length,
          error: message,
          externalContent: incomingContent,
        };
      }
      optsRef.current.onError(document.id, message);
      return { success: false, version: document.version, modifiedAt: document.modifiedAt, size: composed.length, error: message };
    }
    const data = result.data ?? { size: composed.length, modifiedAt: Date.now() };
    optsRef.current.onSaved(document.id, composed, Date.now(), data.modifiedAt);
    return { success: true, version: data.modifiedAt, modifiedAt: data.modifiedAt, size: data.size };
  }, []);

  return { save };
}
