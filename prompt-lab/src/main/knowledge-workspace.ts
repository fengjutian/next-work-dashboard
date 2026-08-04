import fs from 'node:fs';
import path from 'node:path';
import {
  buildKnowledgeIndex,
  instantiateKnowledgeTemplate,
  KnowledgeSearchIndex,
  parseKnowledgeDocument,
  validateKnowledgeDocument,
  type KnowledgeContentRule,
  type KnowledgeDiagnostic,
  type KnowledgeIndex,
  type KnowledgeSearchFilters,
  type KnowledgeSearchHit,
  type KnowledgeTemplate,
} from '../core/knowledge';
import { resolveNewWorkspacePath, resolveWorkspacePath } from './workspace-path';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache']);
const MAX_DOCUMENTS = 5_000;
const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;

export interface KnowledgeWorkspaceScanResult extends KnowledgeIndex {
  skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
  templates: KnowledgeTemplate[];
  rules: KnowledgeContentRule[];
  diagnostics: KnowledgeDiagnostic[];
}

interface CachedKnowledgeSearchIndex { signature: string; index: KnowledgeSearchIndex }
const searchIndexes = new Map<string, CachedKnowledgeSearchIndex>();

const BUILTIN_TEMPLATES: KnowledgeTemplate[] = [{
  id: 'note', name: '普通笔记', directory: '.', fileName: '{{title}}.md',
  content: '---\ntitle: {{title}}\ntype: note\ntags: []\n---\n\n# {{title}}\n',
  variables: [{ name: 'title', label: '标题', required: true }],
}];

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T; } catch { return fallback; }
}

function loadKnowledgeConfiguration(root: string): { templates: KnowledgeTemplate[]; rules: KnowledgeContentRule[] } {
  const knowledgeDirectory = path.join(root, '.knowledge');
  const templateDirectory = path.join(knowledgeDirectory, 'templates');
  const templates = [...BUILTIN_TEMPLATES];
  if (fs.existsSync(templateDirectory)) {
    for (const entry of fs.readdirSync(templateDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const template = readJson<KnowledgeTemplate | null>(path.join(templateDirectory, entry.name), null);
      if (template?.id && template.name && template.directory && template.fileName && typeof template.content === 'string') {
        const existing = templates.findIndex((item) => item.id === template.id);
        if (existing >= 0) templates.splice(existing, 1, template); else templates.push(template);
      }
    }
  }
  const configured = readJson<KnowledgeContentRule[] | { rules?: KnowledgeContentRule[] }>(path.join(knowledgeDirectory, 'rules.json'), []);
  return { templates, rules: Array.isArray(configured) ? configured : configured.rules ?? [] };
}

/** Scans Markdown from an already-authorized workspace without following symlinks. */
export function scanKnowledgeWorkspace(rootPath: string): KnowledgeWorkspaceScanResult {
  const root = resolveWorkspacePath(rootPath, '');
  const documents = [] as KnowledgeWorkspaceScanResult['documents'];
  const skipped: KnowledgeWorkspaceScanResult['skipped'] = [];

  const visit = (directory: string) => {
    if (documents.length >= MAX_DOCUMENTS) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(absolutePath); continue; }
      if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      try {
        const stat = fs.statSync(absolutePath);
        if (stat.size > MAX_DOCUMENT_SIZE) { skipped.push({ path: relativePath, reason: 'too-large' }); continue; }
        documents.push(parseKnowledgeDocument(relativePath, fs.readFileSync(absolutePath, 'utf8'), stat.mtimeMs));
      } catch {
        skipped.push({ path: relativePath, reason: 'unreadable' });
      }
    }
  };
  visit(root);
  const configuration = loadKnowledgeConfiguration(root);
  const diagnostics = documents.flatMap((document) => {
    try {
      const content = fs.readFileSync(path.join(root, document.path), 'utf8');
      return validateKnowledgeDocument(document, content, configuration.rules);
    } catch { return []; }
  });
  return { ...buildKnowledgeIndex(documents), skipped, ...configuration, diagnostics };
}

export function createKnowledgeDocumentFromTemplate(
  rootPath: string,
  templateId: string,
  values: Record<string, string>,
): { path: string; modifiedAt: number; diagnostics: KnowledgeDiagnostic[] } {
  const root = resolveWorkspacePath(rootPath, '');
  const configuration = loadKnowledgeConfiguration(root);
  const template = configuration.templates.find((item) => item.id === templateId);
  if (!template) throw new Error('TEMPLATE_NOT_FOUND');
  const rendered = instantiateKnowledgeTemplate(template, values);
  const absolutePath = resolveNewWorkspacePath(rootPath, rendered.path);
  if (fs.existsSync(absolutePath)) throw new Error(`ALREADY_EXISTS:${rendered.path}`);
  const document = parseKnowledgeDocument(rendered.path, rendered.content);
  const diagnostics = validateKnowledgeDocument(document, rendered.content, configuration.rules);
  if (diagnostics.some((item) => item.severity === 'error')) throw new Error(`CONTENT_RULE_FAILED:${diagnostics.map((item) => item.code).join(',')}`);
  fs.writeFileSync(absolutePath, rendered.content, { encoding: 'utf8', flag: 'wx' });
  return { path: rendered.path, modifiedAt: fs.statSync(absolutePath).mtimeMs, diagnostics };
}

export function readKnowledgeDocument(rootPath: string, relativePath: string): { content: string; modifiedAt: number } {
  const absolutePath = resolveWorkspacePath(rootPath, relativePath);
  if (!/\.mdx?$/i.test(absolutePath) || !fs.statSync(absolutePath).isFile()) throw new Error('NOT_A_KNOWLEDGE_DOCUMENT');
  const stat = fs.statSync(absolutePath);
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error('FILE_TOO_LARGE');
  return { content: fs.readFileSync(absolutePath, 'utf8'), modifiedAt: stat.mtimeMs };
}

export function searchKnowledgeWorkspace(
  rootPath: string,
  query: string,
  limit = 30,
  filters: KnowledgeSearchFilters = {},
): KnowledgeSearchHit[] {
  if (!query.trim()) return [];
  const root = resolveWorkspacePath(rootPath, '');
  const workspace = scanKnowledgeWorkspace(rootPath);
  const signature = workspace.documents.map((document) => `${document.path}:${document.contentHash}`).sort().join('|');
  let cached = searchIndexes.get(root);
  if (!cached || cached.signature !== signature) {
    const index = new KnowledgeSearchIndex();
    index.replace(workspace.documents.map((document) => ({
      document,
      content: readKnowledgeDocument(rootPath, document.path).content,
    })));
    cached = { signature, index };
    searchIndexes.set(root, cached);
  }
  return cached.index.search(query, limit, filters);
}
