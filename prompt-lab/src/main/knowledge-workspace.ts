import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildKnowledgeIndex,
  instantiateKnowledgeTemplate,
  KnowledgeSearchIndex,
  parseKnowledgeDocument,
  rewriteResolvedWikiLinks,
  validateKnowledgeDocument,
  type KnowledgeContentRule,
  type KnowledgeDiagnostic,
  type KnowledgeIndex,
  type KnowledgeSearchFilters,
  type KnowledgeSearchHit,
  type KnowledgeTemplate,
  type KnowledgeWorkspaceState,
} from '../core/knowledge';
import { resolveNewWorkspacePath, resolveWorkspacePath } from './workspace/path';
import { applyWorkspaceFileMutations } from './workspace/transaction';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache']);
const MAX_DOCUMENTS = 5_000;
const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;

export interface KnowledgeWorkspaceScanResult extends KnowledgeIndex {
  skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
  templates: KnowledgeTemplate[];
  rules: KnowledgeContentRule[];
  diagnostics: KnowledgeDiagnostic[];
  instructions?: string;
  state?: KnowledgeWorkspaceState;
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

function loadKnowledgeConfiguration(root: string): { templates: KnowledgeTemplate[]; rules: KnowledgeContentRule[]; instructions?: string; state?: KnowledgeWorkspaceState } {
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
  const instructionsPath = path.join(knowledgeDirectory, 'instructions.md');
  const instructions = fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : undefined;
  const state = readJson<KnowledgeWorkspaceState | undefined>(path.join(knowledgeDirectory, 'state.json'), undefined);
  return { templates, rules: Array.isArray(configured) ? configured : configured.rules ?? [], instructions, state };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveKnowledgeSourcePath(rootPath: string, source: string): string {
  const root = resolveWorkspacePath(rootPath, '');
  const candidate = path.resolve(root, source);
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('SOURCE_OUTSIDE_WORKSPACE');
  if (fs.existsSync(candidate)) {
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(fs.realpathSync(root), realCandidate);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('SOURCE_OUTSIDE_WORKSPACE');
    return realCandidate;
  }
  return candidate;
}

function sourceDiagnostics(rootPath: string, document: KnowledgeWorkspaceScanResult['documents'][number], state?: KnowledgeWorkspaceState): KnowledgeDiagnostic[] {
  const sources = stringList(document.frontmatter.sources);
  if (!sources.length) return [];
  const recorded = state?.documents[document.path];
  const diagnostics: KnowledgeDiagnostic[] = [];
  for (const source of sources) {
    let absolutePath: string;
    try { absolutePath = resolveKnowledgeSourcePath(rootPath, source); }
    catch {
      diagnostics.push({ severity: 'error', code: 'SOURCE_OUTSIDE_WORKSPACE', message: `知识来源超出工作区：${source}`, path: document.path });
      continue;
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      diagnostics.push({ severity: 'warning', code: 'SOURCE_MISSING', message: `知识来源不存在：${source}`, path: document.path });
      continue;
    }
    const previous = recorded?.sources[source];
    if (!previous) diagnostics.push({ severity: 'warning', code: 'SOURCE_NOT_TRACKED', message: `知识来源尚未建立基线：${source}`, path: document.path });
    else if (previous.hash !== hashFile(absolutePath)) diagnostics.push({ severity: 'warning', code: 'SOURCE_STALE', message: `知识来源已变化，文档可能过期：${source}`, path: document.path });
  }
  return diagnostics;
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
      return [
        ...validateKnowledgeDocument(document, content, configuration.rules),
        ...sourceDiagnostics(rootPath, document, configuration.state),
      ];
    } catch { return []; }
  });
  return { ...buildKnowledgeIndex(documents), skipped, ...configuration, diagnostics };
}

/** Captures a reproducible freshness baseline for documents that declare frontmatter `sources`. */
export function captureKnowledgeWorkspaceState(rootPath: string): KnowledgeWorkspaceState {
  const root = resolveWorkspacePath(rootPath, '');
  const workspace = scanKnowledgeWorkspace(rootPath);
  const capturedAt = new Date().toISOString();
  const documents: KnowledgeWorkspaceState['documents'] = {};
  for (const document of workspace.documents) {
    const sources: KnowledgeWorkspaceState['documents'][string]['sources'] = {};
    for (const source of stringList(document.frontmatter.sources)) {
      const absolutePath = resolveKnowledgeSourcePath(rootPath, source);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
      sources[source] = { hash: hashFile(absolutePath), capturedAt };
    }
    if (Object.keys(sources).length) documents[document.path] = { contentHash: document.contentHash, sources };
  }
  const state: KnowledgeWorkspaceState = { schemaVersion: 1, updatedAt: capturedAt, documents };
  const knowledgeDirectory = path.join(root, '.knowledge');
  fs.mkdirSync(knowledgeDirectory, { recursive: true });
  fs.writeFileSync(path.join(knowledgeDirectory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
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

export function renameKnowledgeDocumentWithBacklinks(
  rootPath: string,
  relativePath: string,
  nextRelativePath: string,
): { path: string; updatedReferences: string[] } {
  if (!/\.mdx?$/i.test(relativePath) || !/\.mdx?$/i.test(nextRelativePath)) throw new Error('NOT_A_KNOWLEDGE_DOCUMENT');
  const workspace = scanKnowledgeWorkspace(rootPath);
  const document = workspace.documents.find((item) => item.path === relativePath.replace(/\\/g, '/'));
  if (!document) throw new Error('KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const incoming = workspace.links.filter((link) => link.status === 'resolved' && link.targetUri === document.uri);
  const bySource = new Map<string, typeof incoming>();
  incoming.forEach((link) => bySource.set(link.sourceUri, [...(bySource.get(link.sourceUri) ?? []), link]));
  const targetFile = readKnowledgeDocument(rootPath, relativePath);
  let renamedContent: string | undefined;
  const mutations: import('./workspace/transaction').WorkspaceFileMutation[] = [];
  const updatedReferences: string[] = [];
  for (const [sourceUri, links] of bySource) {
    const source = workspace.documents.find((item) => item.uri === sourceUri);
    if (!source) continue;
    const sourceFile = source.path === relativePath ? targetFile : readKnowledgeDocument(rootPath, source.path);
    const content = rewriteResolvedWikiLinks(sourceFile.content, links, nextRelativePath);
    if (content === sourceFile.content) continue;
    updatedReferences.push(source.path);
    if (source.path === relativePath) renamedContent = content;
    else mutations.push({ kind: 'write', path: source.path, content, expectedModifiedAt: sourceFile.modifiedAt });
  }
  mutations.unshift({
    kind: 'rename', path: relativePath, targetPath: nextRelativePath,
    content: renamedContent, expectedModifiedAt: targetFile.modifiedAt,
  });
  applyWorkspaceFileMutations(rootPath, mutations);
  searchIndexes.delete(resolveWorkspacePath(rootPath, ''));
  return { path: nextRelativePath, updatedReferences };
}
