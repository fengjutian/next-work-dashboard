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
import { assertPublicRemoteUrl, assertSafeRemoteUrl } from '../../core/work-browser/security/url-policy';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 5;

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

async function fetchHtml(rawUrl: string, signal: AbortSignal, redirectCount = 0): Promise<string> {
  const url = await assertPublicRemoteUrl(rawUrl);
  // Defense in depth against DNS rebinding: re-verify the resolved
  // addresses immediately before issuing the request. The race window
  // is microseconds, but a misbehaving resolver can return public IPs
  // for the initial check and private IPs for the actual connect.
  await assertHostnameStillPublic(url.hostname);
  const res = await fetch(url, {
    signal,
    redirect: 'manual',
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (res.status >= 300 && res.status < 400) {
    if (redirectCount >= MAX_REDIRECTS) throw new Error('TOO_MANY_REDIRECTS');
    const location = res.headers.get('location');
    if (!location) throw new Error('REDIRECT_WITHOUT_LOCATION');
    return fetchHtml(new URL(location, url).toString(), signal, redirectCount + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const contentType = res.headers.get('content-type')?.toLowerCase() || '';
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE:${contentType}`);
  }
  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength > MAX_HTML_BYTES) throw new Error('PAGE_TOO_LARGE');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_HTML_BYTES) throw new Error('PAGE_TOO_LARGE');
  return new TextDecoder().decode(bytes);
}

async function assertHostnameStillPublic(hostname: string): Promise<void> {
  const { isIP } = await import('node:net');
  if (isIP(hostname)) {
    // assertPublicRemoteUrl already passed; no further check needed.
    return;
  }
  const { lookup } = await import('node:dns/promises');
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('URL_HOST_LOOKUP_FAILED');
  }
  if (!addrs.length) throw new Error('URL_HOST_LOOKUP_FAILED');
  // We can't import the security module's isPrivateAddress without a
  // cycle, so duplicate the rules here. Keep in sync with
  // core/work-browser/security/url-policy.ts.
  for (const { address } of addrs) {
    if (isPrivateAddressLoose(address)) throw new Error('PRIVATE_NETWORK_URL_BLOCKED');
  }
}

function isPrivateAddressLoose(host: string): boolean {
  const { isIP } = require('node:net') as typeof import('node:net');
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || a >= 224;
  }
  if (version === 6) {
    const n = host.toLowerCase();
    return n === '::' || n === '::1' || n.startsWith('fc') || n.startsWith('fd')
      || /^fe[89ab]/.test(n) || n.startsWith('ff');
  }
  return false;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value.split(String.fromCharCode(0)).join(''));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function savePageAsMarkdown(
  input: SavePageInput,
  workspaceStore: WorkspaceStore,
  documentStore: DocumentStore,
): Promise<SavePageResult> {
  assertSafeRemoteUrl(input.url);
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
  const contentMd = `---\ntitle: ${yamlScalar(title)}\nurl: ${yamlScalar(input.url)}\nauthor: ${yamlScalar(readability.author || '')}\npublished: ${yamlScalar(readability.publishedAt ? new Date(readability.publishedAt).toISOString() : '')}\ncaptured: ${yamlScalar(new Date().toISOString())}\nwordCount: ${readability.wordCount}\n---\n\n# ${title}\n\n${readability.contentMarkdown}\n`;

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
  const previousContentMd = existing
    ? await fs.readFile(existing.contentPath, 'utf8').catch(() => null)
    : null;
  await atomicWrite(contentPath, contentMd);
  await atomicWrite(rawPath, html);
  // The document row and its version are committed together below.

  // 6. 异步入向量索引（不阻塞主流程）
  // 动态 import 避免循环依赖 + 减少启动期
  const { enqueueIndexDocument } = await import('./embedding');
  const indexInput = {
    documentId: doc.id,
    title,
    plainText: readability.contentText,
    workspaceId: input.workspaceId,
    url: input.url,
  };

  // 6. 追加版本
  let diffSummary: string | null = null;
  let version: ReturnType<typeof newDocumentVersion>;
  if (existing && isNewVersion) {
    try {
      const hunks = lineDiff(previousContentMd ?? '', contentMd);
      diffSummary = summarizeDiff(hunks);
    } catch { diffSummary = 'unable to diff'; }
    version = newDocumentVersion({
      documentId: doc.id,
      contentHash,
      rawPath,
      prevWordCount: existing.wordCount,
      wordCount: readability.wordCount,
      diffSummary,
    });
  } else {
    version = newDocumentVersion({
      documentId: doc.id,
      contentHash,
      rawPath,
      prevWordCount: existing?.wordCount ?? 0,
      wordCount: readability.wordCount,
    });
  }

  try {
    documentStore.upsertDocumentWithVersion(
      { ...doc, contentPath, rawPath, updatedAt: t, plainText: readability.contentText } as any,
      version,
    );
  } catch (error) {
    await rollbackFiles(contentPath, rawPath, previousContentMd);
    throw error;
  }
  enqueueIndexDocument(indexInput);

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

async function rollbackFiles(contentPath: string, rawPath: string, previousContent: string | null): Promise<void> {
  await fs.unlink(rawPath).catch(() => undefined);
  if (previousContent === null) await fs.unlink(contentPath).catch(() => undefined);
  else await atomicWrite(contentPath, previousContent);
}

function appPath(...parts: string[]): string {
  // Lazy require — main 端调用；不在 core 测试中触发
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return path.join(app.getPath('userData'), ...parts);
}
