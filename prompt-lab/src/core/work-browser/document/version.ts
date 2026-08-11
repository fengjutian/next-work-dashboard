/**
 * Document 版本 / Hash
 *
 * - 内容指纹：FNV-1a 64-bit（与 search/provider 里的 contentFingerprint 一致）
 * - 用于检测"网页是否变化"，配合 DocumentVersion 表
 */
import type { Document, DocumentVersion, DocumentId, DocumentVersionId, TabId } from '../types';
import { newId, now } from '../types';

function fnv1a64(str: string): string {
  let h1 = 0xcbf29ce4;
  let h2 = 0x84222325;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h2 ^= c << 1;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export function computeContentHash(content: string): string {
  return fnv1a64(content.replace(/\s+/g, ' ').trim());
}

export function isContentChanged(prevHash: string, newContent: string): boolean {
  return prevHash !== computeContentHash(newContent);
}

export function newDocumentVersion(params: {
  documentId: DocumentId;
  contentHash: string;
  rawPath: string;
  prevWordCount: number;
  wordCount: number;
  diffSummary?: string;
}): DocumentVersion {
  return {
    id: newId<DocumentVersionId>(),
    documentId: params.documentId,
    contentHash: params.contentHash,
    rawPath: params.rawPath,
    diffSummary: params.diffSummary || null,
    wordDelta: params.wordCount - params.prevWordCount,
    capturedAt: now(),
  };
}

export function newDocument(params: {
  workspaceId: string;
  title: string;
  url: string;
  sourceType?: Document['sourceType'];
  contentPath: string;
  rawPath: string;
  contentHash: string;
  wordCount: number;
  summary?: string;
  originTabId?: TabId | null;
}): Document {
  const t = now();
  return {
    id: newId<DocumentId>(),
    workspaceId: params.workspaceId as Document['workspaceId'],
    title: params.title,
    url: params.url,
    sourceType: params.sourceType || 'web',
    contentPath: params.contentPath,
    rawPath: params.rawPath,
    screenshotPath: null,
    contentHash: params.contentHash,
    author: null,
    publishedAt: null,
    capturedAt: t,
    wordCount: params.wordCount,
    summary: params.summary || null,
    originTabId: params.originTabId || null,
    createdAt: t,
    updatedAt: t,
  };
}
