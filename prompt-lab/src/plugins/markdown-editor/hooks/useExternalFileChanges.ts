/**
 * 外部文件变化监听 hook — 利用 workspace.onFileChanged 检测打开中的 .md 是否被外部修改。
 *
 * 行为：
 *  - 当工作区通知某个相对路径变化，查找是否在打开的 documents 里有匹配。
 *  - 如果有且文档未 dirty（savedContent == 当前内容），自动 reload。
 *  - 如果有但文档 dirty，标记 hasExternalChange=true，由 UI 提示用户选择 reload/discard/keep。
 *  - 文件被删除时只标记状态，不主动关闭（用户可以再选择）。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { MarkdownDocument } from '../types';

export interface ExternalChangeHandler {
  /** 外部文件发生变化的文档列表。 */
  pendingChanges: Set<string>;
  /** 用户确认 reload 后的回调。 */
  reloadDocument(document: MarkdownDocument): void;
  /** 用户确认放弃本地修改。 */
  discardLocalChanges(documentId: string): void;
}

export function useExternalFileChanges(
  documents: MarkdownDocument[],
  handlers: {
    onPendingChange: (documentId: string, path: string) => void;
    onPendingResolve: (documentId: string) => void;
    reloadDocument: (document: MarkdownDocument) => void | Promise<void>;
    discardLocalChanges: (documentId: string) => void;
  },
): void {
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  const matchDocument = useCallback((path: string): MarkdownDocument | null => {
    const normalized = path.replace(/\\/g, '/');
    return documentsRef.current.find((doc) => doc.relativePath.replace(/\\/g, '/') === normalized) ?? null;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.workspace.onFileChanged((event) => {
      if (event.type !== 'change') return;
      const document = matchDocument(event.path);
      if (!document) return;
      if (!document.dirty) {
        void handlers.reloadDocument(document);
        handlers.onPendingResolve(document.id);
      } else {
        handlers.onPendingChange(document.id, event.path);
      }
    });
    return () => unsubscribe();
  }, [matchDocument, handlers]);
}
