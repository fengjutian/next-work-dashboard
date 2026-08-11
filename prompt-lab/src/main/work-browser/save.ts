/**
 * Save Page — Save as Markdown
 *
 * - 在 main 端 fetch 目标 URL → 净化 → 输出 Markdown
 * - 写入 workspace 的 storagePath/documents/<id>.md
 * - 写 documents + document_versions 表
 * - 检测 hash 变化：有变化时追加新版本
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractReadability } from '../../core/work-browser/parser';
import { newDocument, computeContentHash, isContentChanged, newDocumentVersion } from '../../core/work-browser/document/version';
import { lineDiff, summarizeDiff } from '../../core/work-browser/document/diff';
import type { WorkspaceStore } from './workspace-store';
import type { DocumentStore } from './document-store';
import type { DocumentId, TabId, WorkspaceId } from '../../core/work-browser/types';
import { now } from '../../core/work-browser/types';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export interface SavePageInput {
  workspaceId: WorkspaceId;
  tabId?: TabId | null;
  url: string;
  title?: string;
  /** 可选：渲染端已经拿到的 HTML；不传则在 main 端 fetch。 */
  html?: string;
}

export interface SavePageResult {
  documentId: DocumentId;
  contentPath: string;
  rawPath: string;
  contentHash: string;
  wordCount: number;
  isNewVersion: boolean;
  diffSummary: string | null;
}

async function fetchHtml(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

export async function savePageAsMarkdown(
  input: SavePageInput,
  workspaceStore: WorkspaceStore,
  documentStore: DocumentStore,
): Promise<SavePageResult> {
  const ws = workspaceStore.getWorkspace(input.workspaceId);
  if (!ws) throw new Error(`Workspace ${input.workspaceId} not found`);

  // 1. 拿 HTML
  let html = input.html || '';
  if (!html) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      html = await fetchHtml(input.url, ac.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Readability 提取
  const readability = await extractReadability(html);
  const title = input.title || readability.title || input.url;
  const contentHash = computeContentHash(readability.contentText);
  const contentMd = `---\ntitle: ${title}\nurl: ${input.url}\nauthor: ${readability.author || ''}\npublished: ${readability.publishedAt ? new Date(readability.publishedAt).toISOString() : ''}\ncaptured: ${new Date().toISOString()}\nwordCount: ${readability.wordCount}\n---\n\n# ${title}\n\n${readability.contentMarkdown}\n`;

  // 3. 查重
  const existing = documentStore.listDocuments(input.workspaceId).find((d) => d.url === input.url);
  const isNewVersion = !!existing && isContentChanged(existing.contentHash, readability.contentText);

  // 4. 准备目录
  const docsDir = ws.storagePath ? path.join(ws.storagePath, 'documents') : path.join(appPath('work-browser-documents'), input.workspaceId, 'documents');
  const rawDir = ws.storagePath ? path.join(ws.storagePath, 'raw') : path.join(appPath('work-browser-documents'), input.workspaceId, 'raw');
  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(rawDir, { recursive: true });

  const t = now();
  let doc;
  if (existing) {
    doc = { ...existing, title, contentHash, wordCount: readability.wordCount, summary: readability.excerpt, updatedAt: t };
    documentStore.upsertDocument(doc);
  } else {
    const id = newDocument({
      workspaceId: input.workspaceId,
      title,
      url: input.url,
      sourceType: 'web',
      contentPath: '',
      rawPath: '',
      contentHash,
      wordCount: readability.wordCount,
      summary: readability.excerpt,
      originTabId: input.tabId || null,
    });
    doc = { ...id };
  }

  // 5. 写文件
  const contentPath = path.join(docsDir, `${doc.id}.md`);
  const rawPath = path.join(rawDir, `${doc.id}-${t}.html`);
  await fs.writeFile(contentPath, contentMd, 'utf8');
  await fs.writeFile(rawPath, html, 'utf8');
  documentStore.upsertDocument({ ...doc, contentPath, rawPath, updatedAt: t });

  // 6. 追加版本
  let diffSummary: string | null = null;
  if (existing && isNewVersion) {
    try {
      const oldContent = await fs.readFile(existing.contentPath, 'utf8');
      const hunks = lineDiff(oldContent, contentMd);
      diffSummary = summarizeDiff(hunks);
    } catch { diffSummary = 'unable to diff'; }
    documentStore.appendVersion(newDocumentVersion({
      documentId: doc.id,
      contentHash,
      rawPath,
      prevWordCount: existing.wordCount,
      wordCount: readability.wordCount,
      diffSummary,
    }));
  } else {
    documentStore.appendVersion(newDocumentVersion({
      documentId: doc.id,
      contentHash,
      rawPath,
      prevWordCount: 0,
      wordCount: readability.wordCount,
    }));
  }

  return {
    documentId: doc.id,
    contentPath,
    rawPath,
    contentHash,
    wordCount: readability.wordCount,
    isNewVersion,
    diffSummary,
  };
}

function appPath(...parts: string[]): string {
  // Lazy require — main 端调用；不在 core 测试中触发
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return path.join(app.getPath('userData'), ...parts);
}

