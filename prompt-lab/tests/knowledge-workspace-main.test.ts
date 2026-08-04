import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeWorkspace } from '../src/main/workspace-path';
import { createKnowledgeDocumentFromTemplate, scanKnowledgeWorkspace } from '../src/main/knowledge-workspace';

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
});
