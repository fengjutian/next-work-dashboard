import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { computeContentHash, newDocument, newDocumentVersion } from '../../core/work-browser/document/version';
import type { DocumentSourceType, WorkspaceId } from '../../core/work-browser/types';
import type { WorkspaceStore } from './workspace-store';
import type { DocumentStore } from './document-store';
import { enqueueIndexDocument } from './embedding';

const SUPPORTED = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.pptx']);
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export interface ImportDocumentInput {
  workspaceId: WorkspaceId;
  sourcePath: string;
  title: string;
  plainText: string;
  sections?: Array<{ title: string; content: string; page?: number }>;
}

export async function importParsedDocument(input: ImportDocumentInput, workspaces: WorkspaceStore, documents: DocumentStore) {
  const workspace = workspaces.getWorkspace(input.workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  const sourcePath = path.resolve(input.sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  if (!SUPPORTED.has(extension)) throw new Error('UNSUPPORTED_DOCUMENT_TYPE');
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > MAX_IMPORT_BYTES) throw new Error('INVALID_DOCUMENT_FILE');
  const plainText = input.plainText.trim();
  if (!plainText) throw new Error('EMPTY_DOCUMENT_CONTENT');

  const timestamp = Date.now();
  const document = newDocument({
    workspaceId: input.workspaceId,
    title: input.title || path.basename(sourcePath),
    url: `file://${sourcePath.replace(/\\/g, '/')}`,
    sourceType: sourceType(extension),
    contentPath: '',
    rawPath: '',
    contentHash: computeContentHash(plainText),
    wordCount: plainText.split(/\s+/).filter(Boolean).length,
    summary: plainText.slice(0, 300),
  });
  const root = workspace.storagePath || path.join(app.getPath('userData'), 'work-browser-documents', input.workspaceId);
  const documentsDir = path.join(root, 'documents');
  const rawDir = path.join(root, 'raw');
  await Promise.all([fs.mkdir(documentsDir, { recursive: true }), fs.mkdir(rawDir, { recursive: true })]);
  const contentPath = path.join(documentsDir, `${document.id}.md`);
  const rawPath = path.join(rawDir, `${document.id}-${timestamp}${extension}`);
  const markdown = `# ${document.title}\n\n${(input.sections || []).map((section) => `## ${section.title}\n\n${section.content}`).join('\n\n') || plainText}`;
  await fs.copyFile(sourcePath, rawPath);
  await fs.writeFile(contentPath, markdown, 'utf8');
  const saved = { ...document, contentPath, rawPath, updatedAt: timestamp, plainText };
  try {
    documents.upsertDocumentWithVersion(saved, newDocumentVersion({
      documentId: document.id, contentHash: document.contentHash, rawPath, prevWordCount: 0, wordCount: document.wordCount,
    }));
  } catch (error) {
    await Promise.all([fs.unlink(contentPath).catch(() => undefined), fs.unlink(rawPath).catch(() => undefined)]);
    throw error;
  }
  enqueueIndexDocument({ documentId: document.id, title: document.title, plainText, workspaceId: input.workspaceId, url: document.url });
  return saved;
}

function sourceType(extension: string): DocumentSourceType {
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (extension === '.pptx') return 'pptx';
  return 'xlsx';
}
