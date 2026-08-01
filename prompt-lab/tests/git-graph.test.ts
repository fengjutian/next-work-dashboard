import { describe, expect, it } from 'vitest';
import { layoutGitGraph } from '../src/plugins/code-editor/git-graph';

describe('layoutGitGraph', () => {
  it('creates separate lanes and merge edges', () => {
    const graph = layoutGitGraph([
      { hash: 'merge', parents: ['main', 'feature'] },
      { hash: 'feature', parents: ['base'] },
      { hash: 'main', parents: ['base'] },
      { hash: 'base', parents: [] },
    ]);
    expect(graph.laneCount).toBeGreaterThanOrEqual(2);
    expect(graph.edges.filter((edge) => edge.fromRow === 0)).toHaveLength(2);
    expect(graph.edges.some((edge) => edge.fromLane !== edge.toLane)).toBe(true);
  });
  it('extends edges to the pagination boundary for unloaded parents', () => {
    const graph = layoutGitGraph([{ hash: 'head', parents: ['older'] }]);
    expect(graph.edges[0]).toMatchObject({ fromRow: 0, toRow: 1, parent: 'older' });
  });
});
