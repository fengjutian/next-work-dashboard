/**
 * useMarkdownEditorSync — 把 Tiptap EditorHandle 与 documents store 绑定的核心 hook。
 *
 * 行为：
 *  - 当前激活文档变化时，把磁盘内容载入 Tiptap。
 *  - 模式在 visual/source 之间切换时：
 *     * 切到 visual：调用 handle.loadFromMarkdown(currentContent)
 *     * 切到 source：保留 Tiptap 内容（让用户继续编辑），但导出时仍然走 getMarkdown
 *  - 用户在编辑器里改动时：
 *     * 同步到 store.updateContent
 *     * 标记 dirty
 *     * 触发自动保存（如果开启）
 *  - 自动保存：debounce 1.5s，停止输入才触发；冲突或 unsafe roundtrip 时跳过。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDocuments } from './useMarkdownDocuments';
import { useMarkdownPersistence } from './useMarkdownPersistence';
import { AUTO_SAVE_IDLE_MS, type MarkdownEditorPreferences } from '../constants';
import type { EditorHandle } from '../editor/createMarkdownEditor';
import type { MarkdownDocument, SaveResult } from '../types';

export interface UseMarkdownEditorSyncOptions {
  handle: EditorHandle | null;
  preferences: MarkdownEditorPreferences;
}

export function useMarkdownEditorSync({ handle, preferences }: UseMarkdownEditorSyncOptions): {
  save: (document: MarkdownDocument) => Promise<void>;
} {
  const { activeDocument, updateContent, markDirty, setMode, setSaveState } = useDocuments();
  const noopOpen = (_doc: MarkdownDocument): void => undefined;
  const noopApply = (_id: string, _c: string, _l: 'lf' | 'crlf', _r: SaveResult): void => undefined;
  const noopDirty = (_id: string, _d: boolean): void => undefined;
  const noopSave = (_id: string, _s: boolean, _e: string | null): void => undefined;
  const { save: persistSave } = useMarkdownPersistence({
    activeDocument,
    openDocument: noopOpen,
    applySaveResult: noopApply,
    markDirty: noopDirty,
    setSaveState: noopSave,
  });
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastLoadedDocIdRef = useRef<string | null>(null);

  // 加载当前文档到编辑器
  useEffect(() => {
    if (!handle || !activeDocument) return;
    if (lastLoadedDocIdRef.current === activeDocument.id) return;
    lastLoadedDocIdRef.current = activeDocument.id;
    const { mode } = handle.loadFromMarkdown(activeDocument.savedContent);
    if (mode === 'source' && activeDocument.mode === 'visual') {
      setMode(activeDocument.id, 'source');
    }
  }, [handle, activeDocument, setMode]);

  // 监听 Tiptap 内容变化
  useEffect(() => {
    if (!handle) return;
    const editor = handle.editor;
    const handler = () => {
      if (!activeDocument) return;
      const md = handle.exportToMarkdown();
      if (md === activeDocument.savedContent) {
        markDirty(activeDocument.id, false);
        return;
      }
      updateContent(activeDocument.id, md);
      markDirty(activeDocument.id, true);

      // 自动保存
      if (preferences.autoSave && activeDocument.roundtrip === 'safe') {
        if (autoSaveTimerRef.current !== null) {
          window.clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = window.setTimeout(() => {
          void persistSave({ ...activeDocument, content: md }).catch(() => undefined);
        }, AUTO_SAVE_IDLE_MS);
      }
    };
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [handle, activeDocument, preferences.autoSave, markDirty, persistSave, updateContent]);

  const save = useCallback(
    async (document: MarkdownDocument) => {
      if (!handle) return;
      const md = handle.exportToMarkdown();
      const result = await persistSave({ ...document, content: md });
      if (result.ok) {
        markDirty(document.id, false);
      }
    },
    [handle, persistSave, markDirty],
  );

  return { save };
}
