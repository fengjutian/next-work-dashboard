/**
 * useMarkdownDocuments — markdown 文档的内存状态管理。
 *
 * 责任：
 *  1. 维护打开中的标签页（按打开顺序排列）。
 *  2. 跟踪每篇文档的 dirty、roundtrip、外部冲突状态。
 *  3. 暴露命令式 API：open、close、activate、setMode、updateContent、markSaved、applyExternalChange。
 *
 * 设计上纯 UI 状态，不直接调 IPC；保存由 useMarkdownPersistence 完成。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ExternalChangeNotice,
  FrontmatterAttributes,
  MarkdownDocument,
  MarkdownEvent,
  RoundtripReport,
  SourceModeReason,
} from '../types';
import { inspectDocument, normalizeLineEndings, hasTrailingNewline } from '../editor/markdown-codec';

// ── 辅助 ──

function hashString(input: string): string {
  // 简单 FNV-1a 32-bit，足够区分内容差异
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function nextDocumentId(): string {
  return `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── 内部状态 ──

export interface MarkdownDocumentsApi {
  documents: MarkdownDocument[];
  activeId: string | null;
  activeDocument: MarkdownDocument | null;
  open(input: OpenInput): MarkdownDocument;
  close(id: string): void;
  activate(id: string): void;
  setActiveMode(mode: 'wysiwyg' | 'source', reason?: SourceModeReason): void;
  updateContent(id: string, body: string): void;
  markSaved(id: string, savedContent: string, savedAt: number, version: number): void;
  applyExternalChange(id: string, incoming: { content: string; modifiedAt: number; type: 'change' | 'rename' }): void;
  setRoundtrip(id: string, report: RoundtripReport): void;
  resolveConflict(id: string, strategy: 'overwrite-local' | 'reload-from-disk'): void;
  setFrontmatter(id: string, frontmatter: FrontmatterAttributes): void;
  hasDirty: boolean;
}

export interface OpenInput {
  rootPath: string;
  relativePath: string;
  fileName: string;
  content: string;
  encoding: MarkdownDocument['encoding'];
  lineEnding: MarkdownDocument['lineEnding'];
  mixedLineEndings: boolean;
  readOnly: boolean;
  size: number;
  modifiedAt: number;
  /** 同一路径已存在标签时是否复用 */
  reuseExisting?: boolean;
}

const EMPTY_REPORT: RoundtripReport = { severity: 'safe', issues: [], diffLines: 0, checkedAt: 0 };

/**
 * 创建/获取文档条目。
 *  - reuseExisting=true 时，若同 rootPath + relativePath 已存在则激活之，否则新建。
 *  - 自动通过 inspectDocument 决定是否强制源码模式。
 */
function createOrReuseDocument(
  list: MarkdownDocument[],
  input: OpenInput,
): { list: MarkdownDocument[]; active: MarkdownDocument; reused: boolean } {
  if (input.reuseExisting) {
    const existing = list.find(
      (doc) => doc.rootPath === input.rootPath && doc.relativePath === input.relativePath,
    );
    if (existing) {
      // 外部内容可能已变更，更新 savedContent/savedAt 但保留 dirty 状态
      const next: MarkdownDocument = {
        ...existing,
        content: input.content,
        savedContent: input.content,
        savedHash: hashString(input.content),
        modifiedAt: input.modifiedAt,
        savedAt: Date.now(),
        encoding: input.encoding,
        lineEnding: input.lineEnding,
        mixedLineEndings: input.mixedLineEndings,
        readOnly: input.readOnly,
        size: input.size,
        externalChange: null,
        roundtrip: { ...EMPTY_REPORT, checkedAt: Date.now() },
      };
      const nextList = list.map((doc) => (doc.id === existing.id ? next : doc));
      return { list: nextList, active: next, reused: true };
    }
  }
  const inspection = inspectDocument(input.content, input.size, input.mixedLineEndings);
  const doc: MarkdownDocument = {
    id: nextDocumentId(),
    rootPath: input.rootPath,
    relativePath: input.relativePath,
    fileName: input.fileName,
    content: input.content,
    savedContent: input.content,
    savedHash: hashString(input.content),
    version: input.modifiedAt,
    modifiedAt: input.modifiedAt,
    savedAt: Date.now(),
    encoding: input.encoding,
    lineEnding: input.lineEnding,
    mixedLineEndings: input.mixedLineEndings,
    readOnly: input.readOnly,
    size: input.size,
    frontmatter: inspection.frontmatter,
    body: inspection.body,
    mode: inspection.wysiwygSafe ? 'wysiwyg' : 'source',
    dirty: false,
    sourceModeReason: inspection.wysiwygSafe ? null : inspection.reason,
    externalChange: null,
    roundtrip: { ...EMPTY_REPORT, checkedAt: Date.now() },
  };
  return { list: [...list, doc], active: doc, reused: false };
}

// ── Hook 主体 ──

export function useMarkdownDocuments(): MarkdownDocumentsApi {
  const [documents, setDocuments] = useState<MarkdownDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const documentsRef = useRef<MarkdownDocument[]>([]);
  documentsRef.current = documents;

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? null,
    [documents, activeId],
  );

  const hasDirty = useMemo(() => documents.some((doc) => doc.dirty), [documents]);

  const listenersRef = useRef(new Set<(event: MarkdownEvent) => void>());
  const emit = useCallback((event: MarkdownEvent) => {
    for (const fn of listenersRef.current) fn(event);
  }, []);

  const subscribe = useCallback((fn: (event: MarkdownEvent) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const open = useCallback(
    (input: OpenInput): MarkdownDocument => {
      let resultDoc: MarkdownDocument = documentsRef.current[0] ?? ({} as MarkdownDocument);
      setDocuments((current) => {
        const { list, active } = createOrReuseDocument(current, input);
        resultDoc = active;
        return list;
      });
      setActiveId(resultDoc.id);
      // 同步通知
      const doc = resultDoc;
      queueMicrotask(() => emit({ kind: 'opened', document: doc }));
      return doc;
    },
    [emit],
  );

  const close = useCallback(
    (id: string) => {
      setDocuments((current) => current.filter((doc) => doc.id !== id));
      setActiveId((current) => (current === id ? null : current));
      queueMicrotask(() => emit({ kind: 'closed', id }));
    },
    [emit],
  );

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      queueMicrotask(() => emit({ kind: 'activated', id }));
    },
    [emit],
  );

  const setActiveMode = useCallback(
    (mode: 'wysiwyg' | 'source', reason: SourceModeReason = null) => {
      setActiveId((currentId) => {
        if (!currentId) return currentId;
        const id = currentId;
        setDocuments((current) =>
          current.map((doc) =>
            doc.id === id
              ? { ...doc, mode, sourceModeReason: mode === 'source' ? reason ?? 'user-toggle' : null }
              : doc,
          ),
        );
        queueMicrotask(() => emit({ kind: 'mode-changed', id, mode, reason }));
        return id;
      });
    },
    [emit],
  );

  const updateContent = useCallback(
    (id: string, body: string) => {
      setDocuments((current) =>
        current.map((doc) => {
          if (doc.id !== id) return doc;
          // 重新组装完整内容（含 frontmatter）
          const composed = composeFromDocParts(doc, body);
          const dirty = composed !== doc.savedContent;
          return { ...doc, body, content: composed, dirty };
        }),
      );
    },
    [],
  );

  const markSaved = useCallback(
    (id: string, savedContent: string, savedAt: number, version: number) => {
      setDocuments((current) =>
        current.map((doc) =>
          doc.id === id
            ? {
                ...doc,
                content: savedContent,
                savedContent,
                savedHash: hashString(savedContent),
                dirty: false,
                savedAt,
                version,
                externalChange: null,
                frontmatter: { ...doc.frontmatter, raw: extractFrontmatterRaw(savedContent) },
              }
            : doc,
        ),
      );
      // emit 由调用方负责（持久化 hook 会带 SaveResult）
    },
    [],
  );

  const applyExternalChange = useCallback(
    (id: string, incoming: { content: string; modifiedAt: number; type: 'change' | 'rename' }) => {
      setDocuments((current) =>
        current.map((doc) => {
          if (doc.id !== id) return doc;
          const notice: ExternalChangeNotice = {
            type: incoming.type,
            detectedAt: Date.now(),
            incomingContent: incoming.content,
            incomingModifiedAt: incoming.modifiedAt,
            localVersion: doc.version,
          };
          return { ...doc, externalChange: notice };
        }),
      );
      queueMicrotask(() =>
        emit({ kind: 'external-change', id, incomingContent: incoming.content, incomingModifiedAt: incoming.modifiedAt }),
      );
    },
    [emit],
  );

  const setRoundtrip = useCallback(
    (id: string, report: RoundtripReport) => {
      setDocuments((current) => current.map((doc) => (doc.id === id ? { ...doc, roundtrip: report } : doc)));
      queueMicrotask(() => emit({ kind: 'roundtrip', id, report }));
    },
    [emit],
  );

  const resolveConflict = useCallback(
    (id: string, strategy: 'overwrite-local' | 'reload-from-disk') => {
      setDocuments((current) =>
        current.map((doc) => {
          if (doc.id !== id || !doc.externalChange) return doc;
          if (strategy === 'reload-from-disk') {
            const inspection = inspectDocument(doc.externalChange.incomingContent, doc.size, doc.mixedLineEndings);
            return {
              ...doc,
              content: doc.externalChange.incomingContent,
              savedContent: doc.externalChange.incomingContent,
              savedHash: hashString(doc.externalChange.incomingContent),
              version: doc.externalChange.incomingModifiedAt,
              modifiedAt: doc.externalChange.incomingModifiedAt,
              frontmatter: inspection.frontmatter,
              body: inspection.body,
              mode: inspection.wysiwygSafe ? 'wysiwyg' : 'source',
              sourceModeReason: inspection.wysiwygSafe ? null : inspection.reason,
              dirty: false,
              externalChange: null,
            };
          }
          // overwrite-local：把外部版本号记下来，下次 save 时携带
          return {
            ...doc,
            version: doc.externalChange.incomingModifiedAt,
            externalChange: null,
          };
        }),
      );
    },
    [],
  );

  const setFrontmatter = useCallback((id: string, frontmatter: FrontmatterAttributes) => {
    setDocuments((current) => current.map((doc) => (doc.id === id ? { ...doc, frontmatter } : doc)));
  }, []);

  return {
    documents,
    activeId,
    activeDocument,
    open,
    close,
    activate,
    setActiveMode,
    updateContent,
    markSaved,
    applyExternalChange,
    setRoundtrip,
    resolveConflict,
    setFrontmatter,
    hasDirty,
  };
}

// ── 工具 ──

function composeFromDocParts(doc: MarkdownDocument, body: string): string {
  // 用 normalizeLineEndings 强制统一，保存时再根据 lineEnding 转换
  const normalizedBody = body.replace(/\r\n|\r/g, '\n');
  const fmText = doc.frontmatter.present ? doc.frontmatter.raw : '';
  const trailing = hasTrailingNewline(doc.savedContent);
  if (fmText) {
    const fmWithNewline = fmText.replace(/(\r?\n)?$/, '\n');
    return `${fmWithNewline}${normalizedBody}${trailing && !/\n$/.test(normalizedBody) ? '\n' : ''}`;
  }
  return `${normalizedBody}${trailing && !/\n$/.test(normalizedBody) ? '\n' : ''}`;
}

function extractFrontmatterRaw(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
  return match ? match[0] : '';
}

export { hashString, normalizeLineEndings, inspectDocument };
