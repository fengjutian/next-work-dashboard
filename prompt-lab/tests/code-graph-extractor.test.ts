import { describe, expect, it } from 'vitest';
import { extractCodeGraph, isSupportedCodePath } from '../src/core/code-graph-extractor';

describe('code graph extractor', () => {
  it('extracts files, declarations, imports, inheritance and calls', () => {
    const graph = extractCodeGraph([
      { path: 'base.ts', content: 'export class Base {}\nexport function save() {}' },
      { path: 'service.ts', content: "import { Base, save } from './base'; class Service extends Base { run() { save(); } }" },
    ]);
    expect(graph.nodes.some((node) => node.label === 'Service' && node.category === '类')).toBe(true);
    expect(graph.edges.some((edge) => edge.label === '继承')).toBe(true);
    expect(graph.edges.some((edge) => edge.label === '调用')).toBe(true);
    expect(graph.edges.some((edge) => edge.label === '导入')).toBe(true);
  });

  it('only accepts supported source files', () => {
    expect(isSupportedCodePath('src/app.tsx')).toBe(true);
    expect(isSupportedCodePath('README.md')).toBe(false);
  });
});
