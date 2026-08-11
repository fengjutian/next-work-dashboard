/**
 * 文档状态管理 — 单一 store，多组件共享。
 *
 * 设计要点：
 *  - 用 useReducer + Context 实现，避免引入新依赖（项目已用 zustand 但本插件
 *    是自包含的，没必要复用全局 store）。
 *  - 所有写操作都是不可变更新，方便 React 做浅比较和测试。
 *  - 暴露的方法只允许在 MarkdownWorkspaceController 中调用，UI 组件只消费状态。
 */

import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import type { MarkdownDocument, MarkdownDocumentEvent, MarkdownEditorMode, SaveResult } from '../types';
import { splitFrontmatter } from '../editor/markdown-codec';
import { isMarkdownSafe } from '../editor/roundtrip-guard';

type State = {
  documents: MarkdownDocument[];
  activeDocumentId: string | null;
};

type Action =
  | { type: 'open-or-activate'; document: MarkdownDocument }
  | { type: 'close'; documentId: string }
  | { type: 'activate'; documentId: string | null }
  | { type: 'update-content'; documentId: string; content: string }
  | { type: 'mark-dirty'; documentId: string; dirty: boolean }
  | { type: 'mark-saved'; documentId: string; content: string; frontmatter: string; modifiedAt: number; lineEnding: 'lf' | 'crlf' }
  | { type: 'mark-saving'; documentId: string; saving: boolean }
  | { type: 'set-mode'; documentId: string; mode: MarkdownEditorMode }
  | { type: 'set-external-change'; documentId: string; changed: boolean }
  | { type: 'set-roundtrip'; documentId: string; safety: 'safe' | 'unsafe'; reason?: string; hasUnsupportedBlocks: boolean };

const initialState: State = { documents: [], activeDocumentId: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'open-or-activate': {
      const existing = state.documents.find((doc) => doc.id === action.document.id);
      if (existing) {
        return {
          documents: state.documents.map((doc) => (doc.id === action.document.id ? action.document : doc)),
          activeDocumentId: action.document.id,
        };
      }
      return {
        documents: [...state.documents, action.document],
        activeDocumentId: action.document.id,
      };
    }
    case 'close': {
      const documents = state.documents.filter((doc) => doc.id !== action.documentId);
      let activeDocumentId = state.activeDocumentId;
      if (activeDocumentId === action.documentId) {
        activeDocumentId = documents[documents.length - 1]?.id ?? null;
      }
      return { documents, activeDocumentId };
    }
    case 'activate':
      return { ...state, activeDocumentId: action.documentId };
    case 'update-content': {
      return {
        ...state,
        documents: state.documents.map((doc) => {
          if (doc.id !== action.documentId) return doc;
          const safe = isMarkdownSafe(action.content);
          return {
            ...doc,
            content: action.content,
            charCount: action.content.length,
            lineCount: action.content.split(/\r?\n/).length,
            roundtrip: safe ? 'safe' : 'unsafe',
            hasUnsupportedBlocks: !safe,
            roundtripReason: safe ? undefined : '检测到无法安全往返的语法',
          };
        }),
      };
    }
    case 'mark-dirty':
      return {
        ...state,
        documents: state.documents.map((doc) => (doc.id === action.documentId ? { ...doc, dirty: action.dirty } : doc)),
      };
    case 'mark-saved':
      return {
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === action.documentId
            ? {
                ...doc,
                content: action.content,
                savedContent: action.content,
                savedFrontmatter: action.frontmatter,
                baseModifiedAt: action.modifiedAt,
                dirty: false,
                lineEnding: action.lineEnding,
              }
            : doc,
        ),
      };
    case 'mark-saving':
      return {
        ...state,
        documents: state.documents.map((doc) => {
          if (doc.id !== action.documentId) return doc;
          return { ...doc, dirty: action.saving ? true : doc.dirty };
        }),
      };
    case 'set-mode':
      return {
        ...state,
        documents: state.documents.map((doc) => (doc.id === action.documentId ? { ...doc, mode: action.mode } : doc)),
      };
    case 'set-external-change': {
      return {
        ...state,
        documents: state.documents.map((doc) => (doc.id === action.documentId ? { ...doc, hasUnsupportedBlocks: doc.hasUnsupportedBlocks } : doc)),
      };
    }
    case 'set-roundtrip':
      return {
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === action.documentId
            ? {
                ...doc,
                roundtrip: action.safety,
                roundtripReason: action.reason,
                hasUnsupportedBlocks: action.hasUnsupportedBlocks,
                mode: action.safety === 'unsafe' ? 'source' : doc.mode,
              }
            : doc,
        ),
      };
    default:
      return state;
  }
}

export interface DocumentsContextValue {
  documents: MarkdownDocument[];
  activeDocumentId: string | null;
  activeDocument: MarkdownDocument | null;
  openDocument(document: MarkdownDocument): void;
  closeDocument(documentId: string): MarkdownDocumentEvent | null;
  activate(documentId: string | null): void;
  updateContent(documentId: string, content: string): void;
  markDirty(documentId: string, dirty: boolean): void;
  applySaveResult(documentId: string, content: string, lineEnding: 'lf' | 'crlf', result: SaveResult): void;
  setMode(documentId: string, mode: MarkdownEditorMode): void;
  subscribe(listener: (event: MarkdownDocumentEvent) => void): () => void;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export interface DocumentsProviderProps {
  children: React.ReactNode;
  /** 初始化时灌入的文档快照（来自 localStorage）。 */
  initialDocuments?: MarkdownDocument[];
}

export function DocumentsProvider({ children, initialDocuments }: DocumentsProviderProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    documents: initialDocuments ?? [],
    activeDocumentId: initialDocuments?.[0]?.id ?? null,
  }));
  const listenersRef = useRef(new Set<(event: MarkdownDocumentEvent) => void>());
  const notify = useCallback((event: MarkdownDocumentEvent) => {
    listenersRef.current.forEach((listener) => listener(event));
  }, []);

  const openDocument = useCallback((document: MarkdownDocument) => {
    dispatch({ type: 'open-or-activate', document });
  }, []);

  const closeDocument = useCallback((documentId: string): MarkdownDocumentEvent | null => {
    dispatch({ type: 'close', documentId });
    const event: MarkdownDocumentEvent = { kind: 'closed', documentId };
    notify(event);
    return event;
  }, [notify]);

  const activate = useCallback((documentId: string | null) => {
    dispatch({ type: 'activate', documentId });
  }, []);

  const updateContent = useCallback((documentId: string, content: string) => {
    dispatch({ type: 'update-content', documentId, content });
  }, []);

  const markDirty = useCallback((documentId: string, dirty: boolean) => {
    dispatch({ type: 'mark-dirty', documentId, dirty });
  }, []);

  const applySaveResult = useCallback((documentId: string, content: string, lineEnding: 'lf' | 'crlf', result: SaveResult) => {
    if (result.ok === true) {
      const { frontmatter } = splitFrontmatter(content);
      dispatch({ type: 'mark-saved', documentId, content, frontmatter, modifiedAt: result.modifiedAt, lineEnding });
      notify({ kind: 'saved', documentId, modifiedAt: result.modifiedAt });
    } else if (result.ok === false) {
      const failure = result as Extract<SaveResult, { ok: false }>;
      const reason =
        failure.reason === 'conflict'
          ? '磁盘文件已更新'
          : failure.reason === 'read-only'
            ? '文件为只读'
            : failure.reason === 'error'
              ? failure.message
              : '保存失败';
      notify({ kind: 'save-failed', documentId, reason });
    }
  }, [notify]);

  const setMode = useCallback((documentId: string, mode: MarkdownEditorMode) => {
    dispatch({ type: 'set-mode', documentId, mode });
  }, []);

  const subscribe = useCallback((listener: (event: MarkdownDocumentEvent) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const activeDocument = useMemo(
    () => state.documents.find((doc) => doc.id === state.activeDocumentId) ?? null,
    [state.documents, state.activeDocumentId],
  );

  const value = useMemo<DocumentsContextValue>(
    () => ({
      documents: state.documents,
      activeDocumentId: state.activeDocumentId,
      activeDocument,
      openDocument,
      closeDocument,
      activate,
      updateContent,
      markDirty,
      applySaveResult,
      setMode,
      subscribe,
    }),
    [state.documents, state.activeDocumentId, activeDocument, openDocument, closeDocument, activate, updateContent, markDirty, applySaveResult, setMode, subscribe],
  );

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments must be used within DocumentsProvider');
  return ctx;
}

export function useActiveDocument(): MarkdownDocument | null {
  return useDocuments().activeDocument;
}
