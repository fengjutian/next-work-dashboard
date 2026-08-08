import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeDocument } from '../src/core/knowledge';
import { extractMermaidBlocks, validateDeclaredSymbols, validateMermaid } from '../src/main/knowledge-validation';
import { authorizeWorkspace } from '../src/main/workspace/path';

const temporaryDirectories: string[] = [];
function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwd-validation-'));
  temporaryDirectories.push(root);
  authorizeWorkspace(root);
  return root;
}
afterEach(() => temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe('Mermaid knowledge validation', () => {
  it('extracts blocks with their fence line and validates syntax', async () => {
    const content = '# Diagram\n\n```mermaid\nflowchart TD\nA --> B\n```\n\n```mermaid\nflowchart TD\nA -->\n```';
    expect(extractMermaidBlocks(content).map((block) => block.line)).toEqual([3, 8]);
    const diagnostics = await validateMermaid(content, 'diagram.md');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'MERMAID_SYNTAX_ERROR', path: 'diagram.md', line: 10 });
  });

  it('reports empty and unclosed Mermaid fences', async () => {
    const diagnostics = await validateMermaid('```mermaid\n```\n```mermaid\nflowchart TD', 'broken.md');
    expect(diagnostics.map((item) => item.code)).toEqual(['MERMAID_EMPTY', 'MERMAID_FENCE_UNCLOSED']);
  });
});

describe('declared source symbol validation', () => {
  it('finds declarations, React components and IPC channels through the TypeScript AST', () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'ipc.ts'), `
      export function registerIpcHandlers() {}
      export const KnowledgePanel = () => null;
      interface WorkspaceContract {}
      ipcMain.handle('knowledge:scanWorkspace', async () => {});
    `, 'utf8');
    const document = parseKnowledgeDocument('architecture.md', `---\nsymbols:\n- src/ipc.ts#registerIpcHandlers\n- src/ipc.ts#KnowledgePanel\n- src/ipc.ts#WorkspaceContract\n- src/ipc.ts#knowledge:scanWorkspace\n- src/ipc.ts#removedSymbol\n---\n# Architecture`);
    expect(validateDeclaredSymbols(root, document)).toEqual([expect.objectContaining({
      code: 'SYMBOL_NOT_FOUND', message: expect.stringContaining('removedSymbol'), path: 'architecture.md',
    })]);
  });

  it('reports malformed references and missing source files', () => {
    const root = workspace();
    const document = parseKnowledgeDocument('architecture.md', '---\nsymbols: [invalid, missing.ts#thing]\n---\n# Architecture');
    expect(validateDeclaredSymbols(root, document).map((item) => item.code)).toEqual(['SYMBOL_REFERENCE_INVALID', 'SYMBOL_SOURCE_MISSING']);
  });
});
