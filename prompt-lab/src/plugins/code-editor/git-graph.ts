export interface GraphCommit { hash: string; parents: string[] }
export interface GraphNode { hash: string; row: number; lane: number; color: number }
export interface GraphEdge { fromRow: number; fromLane: number; toRow: number; toLane: number; color: number; parent: string }
export interface GitGraphLayout { nodes: GraphNode[]; edges: GraphEdge[]; laneCount: number }

export function layoutGitGraph(commits: GraphCommit[]): GitGraphLayout {
  const lanes: string[] = [];
  const nodes: GraphNode[] = [];
  const laneByHash = new Map<string, number>();

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.findIndex((value) => !value);
      if (lane < 0) lane = lanes.length;
    }
    lanes[lane] = commit.parents[0] ?? '';
    laneByHash.set(commit.hash, lane);
    nodes.push({ hash: commit.hash, row, lane, color: lane % 8 });
    for (const parent of commit.parents.slice(1)) {
      if (lanes.includes(parent)) continue;
      const free = lanes.findIndex((value) => !value);
      lanes[free < 0 ? lanes.length : free] = parent;
    }
    while (lanes.at(-1) === '') lanes.pop();
  });

  const rowByHash = new Map(commits.map((commit, row) => [commit.hash, row]));
  const edges: GraphEdge[] = [];
  commits.forEach((commit, fromRow) => {
    const fromLane = laneByHash.get(commit.hash) ?? 0;
    commit.parents.forEach((parent, parentIndex) => {
      const toRow = rowByHash.get(parent) ?? commits.length;
      const toLane = laneByHash.get(parent) ?? (parentIndex === 0 ? fromLane : fromLane + parentIndex);
      edges.push({ fromRow, fromLane, toRow, toLane, color: (parentIndex === 0 ? fromLane : toLane) % 8, parent });
    });
  });
  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1), ...edges.map((edge) => edge.toLane + 1));
  return { nodes, edges, laneCount };
}
