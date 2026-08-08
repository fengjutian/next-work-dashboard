import { describe, expect, it } from 'vitest';
import { findDuplicateEntities, mergeEntities, stableEntityId } from '../src/core/knowledge-graph/entity-normalization';
import { attachDocumentHashes, reconcileDocuments } from '../src/core/knowledge-graph/lifecycle';
import { hybridGraphSearch } from '../src/core/knowledge-graph/hybrid-search';
import type { GraphData } from '../src/plugins/knowledge-graph/graph-types';

const graph: GraphData = {
  nodes: [
    { id: 'llm', label: '大语言模型', aliases: ['LLM'], source: 'extracted', category: '技术', degree: 1 },
    { id: 'llm-duplicate', label: 'LLM', source: 'extracted', category: '技术', degree: 1 },
    { id: 'rag', label: 'GraphRAG', source: 'extracted', category: '系统', degree: 2 },
  ],
  edges: [{ source: 'rag', target: 'llm-duplicate', label: '依赖', weight: 1, status: 'accepted', evidence: [{ documentName: '设计', sourcePath: 'design.md', quote: 'GraphRAG 依赖大语言模型。' }] }],
};

describe('knowledge graph governance', () => {
  it('detects aliases and merges entities without dangling edges', () => {
    expect(stableEntityId('技术', 'LLM')).toBe(stableEntityId('技术', ' LLM '));
    const duplicate = findDuplicateEntities(graph.nodes)[0];
    expect(duplicate).toEqual({ canonicalId: 'llm', duplicateId: 'llm-duplicate', reason: 'name' });
    const merged = mergeEntities(graph, duplicate.canonicalId, duplicate.duplicateId);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges[0].target).toBe('llm');
    expect(merged.nodes.find((node) => node.id === 'llm')?.aliases).toContain('LLM');
  });

  it('marks facts stale when their source document changes', () => {
    const initial = reconcileDocuments(graph, [{ name: '设计', sourcePath: 'design.md', content: 'v1' }], 1).graph;
    const withHashes = attachDocumentHashes(initial);
    const changed = reconcileDocuments(withHashes, [{ name: '设计', sourcePath: 'design.md', content: 'v2' }], 2);
    expect(changed.changedPaths).toEqual(['design.md']);
    expect(changed.graph.edges[0].status).toBe('stale');
  });

  it('combines entity matching, graph traversal and document retrieval', () => {
    const result = hybridGraphSearch('LLM GraphRAG', graph, [{ name: '设计', sourcePath: 'design.md', content: 'GraphRAG 使用 LLM 构建知识图谱。' }]);
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['llm', 'rag']));
    expect(result.documents).toHaveLength(1);
    expect(result.context).toContain('[G1]');
    expect(result.context).toContain('[D1]');
  });
});
