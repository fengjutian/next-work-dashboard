import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeWorkspace } from '../src/main/workspace/path';
import {
  createKnowledgeDocumentFromTemplate,
  captureKnowledgeWorkspaceState,
  readKnowledgeDocument,
  scanKnowledgeWorkspace,
  searchKnowledgeWorkspace,
  renameKnowledgeDocumentWithBacklinks,
} from '../src/main/knowledge-workspace';

const temporaryDirectories: string[] = [];

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwd-knowledge-'));
  temporaryDirectories.push(root);
  authorizeWorkspace(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('knowledge workspace filesystem boundary', () => {
  it('scans markdown, ignores node_modules and builds backlinks', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, 'notes'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'notes', 'alpha.md'), '# Alpha\n[[Beta]]', 'utf8');
    fs.writeFileSync(path.join(root, 'notes', 'beta.md'), '# Beta', 'utf8');
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.md'), '# Ignored', 'utf8');
    const result = scanKnowledgeWorkspace(root);
    expect(result.documents.map((document) => document.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(result.links[0].status).toBe('resolved');
    expect(result.templates.some((template) => template.id === 'note')).toBe(true);
  });

  it('loads project templates, enforces rules and refuses overwrite', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, '.knowledge', 'templates'), { recursive: true });
    fs.mkdirSync(path.join(root, 'decisions'));
    fs.writeFileSync(path.join(root, '.knowledge', 'templates', 'adr.json'), JSON.stringify({
      id: 'adr', name: 'ADR', directory: 'decisions', fileName: '{{title}}',
      content: '---\ntitle: {{title}}\ntype: spec\nstatus: draft\n---\n# {{title}}\n## Decision',
    }), 'utf8');
    fs.writeFileSync(path.join(root, '.knowledge', 'rules.json'), JSON.stringify([{
      include: 'decisions/**', requiredFrontmatter: ['status'], requiredSections: ['Decision'], allowedTypes: ['spec'],
    }]), 'utf8');
    const created = createKnowledgeDocumentFromTemplate(root, 'adr', { title: 'Store locally' });
    expect(created.path).toBe('decisions/store-locally.md');
    expect(fs.existsSync(path.join(root, created.path))).toBe(true);
    expect(() => createKnowledgeDocumentFromTemplate(root, 'adr', { title: 'Store locally' })).toThrow('ALREADY_EXISTS');
  });

  it('reads and ranks matching knowledge without escaping the workspace', () => {
    const root = createWorkspace();
    fs.writeFileSync(path.join(root, 'architecture.md'), '---\ntags: [storage]\n---\n# Local Architecture\nSQLite stores metadata.', 'utf8');
    fs.writeFileSync(path.join(root, 'other.md'), '# Other\nArchitecture is mentioned once.', 'utf8');
    const matches = searchKnowledgeWorkspace(root, 'architecture');
    expect(matches.map((match) => match.path)).toEqual(['architecture.md', 'other.md']);
    expect(readKnowledgeDocument(root, 'architecture.md').content).toContain('SQLite');
    fs.writeFileSync(path.join(root, 'architecture.md'), '# Replaced\nPostgreSQL only.', 'utf8');
    expect(searchKnowledgeWorkspace(root, 'SQLite')).toEqual([]);
    expect(searchKnowledgeWorkspace(root, 'PostgreSQL', 20, { pathPrefix: 'architecture', types: ['document'] })[0].path).toBe('architecture.md');
    fs.unlinkSync(path.join(root, 'architecture.md'));
    expect(searchKnowledgeWorkspace(root, 'PostgreSQL')).toEqual([]);
    expect(() => readKnowledgeDocument(root, '../outside.md')).toThrow('ACCESS_DENIED');
  });

  it('renames a document and atomically updates resolved backlinks', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'source.md'), '# Source\n[[Target|read this]]\n[[Missing]]', 'utf8');
    fs.writeFileSync(path.join(root, 'notes', 'target.md'), '# Target', 'utf8');
    const result = renameKnowledgeDocumentWithBacklinks(root, 'notes/target.md', 'notes/renamed.md');
    expect(result.updatedReferences).toEqual(['notes/source.md']);
    expect(fs.existsSync(path.join(root, 'notes', 'target.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes', 'source.md'), 'utf8')).toContain('[[renamed|read this]]');
    expect(fs.readFileSync(path.join(root, 'notes', 'source.md'), 'utf8')).toContain('[[Missing]]');
  });

  it('captures source baselines and diagnoses stale or missing knowledge sources', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'runtime.ts'), 'export const version = 1;', 'utf8');
    fs.writeFileSync(path.join(root, 'architecture.md'), '---\ntitle: Runtime\ntype: spec\nsources: [src/runtime.ts, src/missing.ts]\n---\n# Runtime', 'utf8');

    const initial = scanKnowledgeWorkspace(root);
    expect(initial.diagnostics.map((item) => item.code)).toEqual(['SOURCE_NOT_TRACKED', 'SOURCE_MISSING']);
    const state = captureKnowledgeWorkspaceState(root);
    expect(state.documents['architecture.md'].sources['src/runtime.ts'].hash).toHaveLength(64);
    expect(scanKnowledgeWorkspace(root).diagnostics.map((item) => item.code)).toEqual(['SOURCE_MISSING']);

    fs.writeFileSync(path.join(root, 'src', 'runtime.ts'), 'export const version = 2;', 'utf8');
    expect(scanKnowledgeWorkspace(root).diagnostics.map((item) => item.code)).toEqual(['SOURCE_STALE', 'SOURCE_MISSING']);
  });

  it('loads project knowledge instructions without requiring them', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, '.knowledge'));
    fs.writeFileSync(path.join(root, '.knowledge', 'instructions.md'), '# Knowledge brief\nKeep architecture current.', 'utf8');
    expect(scanKnowledgeWorkspace(root).instructions).toContain('Keep architecture current');
  });

  it('refreshes only selected document baselines', () => {
    const root = createWorkspace();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a1', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'b1', 'utf8');
    fs.writeFileSync(path.join(root, 'a.md'), '---\nsources: [src/a.ts]\n---\n# A', 'utf8');
    fs.writeFileSync(path.join(root, 'b.md'), '---\nsources: [src/b.ts]\n---\n# B', 'utf8');
    const first = captureKnowledgeWorkspaceState(root);
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a2', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'b2', 'utf8');
    const partial = captureKnowledgeWorkspaceState(root, ['a.md']);
    expect(partial.documents['a.md'].sources['src/a.ts'].hash).not.toBe(first.documents['a.md'].sources['src/a.ts'].hash);
    expect(partial.documents['b.md']).toEqual(first.documents['b.md']);
  });
});
