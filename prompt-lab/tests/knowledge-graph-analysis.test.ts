import { describe, expect, it } from 'vitest';
import { analyzeGraphImpact, diagnoseGraph, diffGraphSnapshots, enrichGraphMetrics, evaluateGraphHealth } from '../src/core/knowledge-graph/analysis';
import { exportGraphContent, graphToMarkdown, graphToSvg } from '../src/core/knowledge-graph/export';
import type { GraphData } from '../src/plugins/knowledge-graph/graph-types';

const graph: GraphData = {
  nodes: ['a', 'b', 'c', 'orphan'].map((id) => ({ id, label: id, degree: 0, source: 'code' as const })),
  edges: [
    { source: 'a', target: 'b', weight: 1, label: 'depends', status: 'accepted' },
    { source: 'b', target: 'c', weight: 1, label: 'depends', status: 'accepted', evidence: [{ documentName: 'x' }] },
    { source: 'c', target: 'a', weight: 1, label: 'depends', status: 'accepted', evidence: [{ documentName: 'x' }] },
  ],
};

describe('knowledge graph analysis', () => {
  it('computes directed blast radius and paths', () => {
    const result = analyzeGraphImpact(graph, 'a', { direction: 'downstream', maxDepth: 4, acceptedOnly: true });
    expect(result.direct.map((node) => node.id)).toEqual(['b']);
    expect(result.transitive.map((node) => node.id)).toEqual(['c']);
    expect(result.cycles).toContainEqual(['a', 'b', 'c', 'a']);
  });
  it('diagnoses cycles, orphans and unsupported accepted facts', () => {
    const findings = diagnoseGraph(graph);
    expect(findings.some((item) => item.kind === 'cycle')).toBe(true);
    expect(findings.some((item) => item.kind === 'orphan' && item.nodeIds[0] === 'orphan')).toBe(true);
    expect(findings.some((item) => item.kind === 'unsupported-claim')).toBe(true);
    expect(evaluateGraphHealth(graph).score).toBeLessThan(100);
  });
  it('enriches visual metrics and diffs snapshots', () => {
    const enriched = enrichGraphMetrics(graph);
    expect(enriched.nodes.find((node) => node.id === 'a')?.metrics).toMatchObject({ inDegree: 1, outDegree: 1, blastRadius: 2 });
    const next = { ...graph, nodes: [...graph.nodes, { id: 'd', label: 'd', degree: 0, source: 'manual' as const }] };
    expect(diffGraphSnapshots(graph, next).addedNodeIds).toEqual(['d']);
  });
  it('exports portable JSON, Markdown and SVG', () => {
    expect(graphToMarkdown(graph)).toContain('a → b');
    expect(graphToSvg(graph)).toContain('<svg');
    expect(JSON.parse(exportGraphContent('json', graph).content).graph.nodes).toHaveLength(4);
  });
});
