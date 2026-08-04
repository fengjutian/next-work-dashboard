import { describe, expect, it } from 'vitest';
import { aggregateGraph, dependencyMatrix, localGraph } from '../src/plugins/knowledge-graph/graph-views';
import type { GraphData } from '../src/plugins/knowledge-graph/graph-types';

const graph: GraphData = {
  nodes: [
    { id: 'a', label: 'a.ts', sourcePath: 'src/core/a.ts', source: 'code', category: '文件', degree: 1 },
    { id: 'b', label: 'b.ts', sourcePath: 'src/plugins/b.ts', source: 'code', category: '文件', degree: 2 },
    { id: 'c', label: 'c.ts', sourcePath: 'src/plugins/c.ts', source: 'code', category: '文件', degree: 1 },
  ],
  edges: [{ source: 'a', target: 'b', weight: 1 }, { source: 'c', target: 'b', weight: 2 }],
};

describe('knowledge graph views', () => {
  it('aggregates nodes and relationships by module', () => {
    const result = aggregateGraph(graph);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });
  it('builds a one-hop local graph', () => expect(localGraph(graph, 'a').nodes.map((node) => node.id).sort()).toEqual(['a', 'b']));
  it('builds a module dependency matrix', () => {
    const result = dependencyMatrix(graph);
    expect(result.labels).toEqual(['src/core', 'src/plugins']);
    expect(result.values.flat().some((value) => value === 1)).toBe(true);
  });
});
