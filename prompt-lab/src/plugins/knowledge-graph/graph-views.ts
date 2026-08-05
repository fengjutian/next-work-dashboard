import type { GraphData, GraphEdge, GraphNode } from './graph-types';

/** 清除重复节点及端点不存在的旧边，保证所有视图都可安全交给图表渲染器。 */
export function sanitizeGraph(graph: GraphData): GraphData {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodeMap.keys());
  return {
    nodes: [...nodeMap.values()],
    edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

export function graphModuleName(node: GraphNode): string {
  if (node.category === '模块') return '外部模块';
  const path = (node.sourcePath || node.label).replace(/\\/g, '/');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'src' && parts[1]) return `src/${parts[1]}`;
  return parts[0] || '其他';
}

export function aggregateGraph(graph: GraphData): GraphData {
  const groups = new Map<string, GraphNode>();
  const nodeGroups = new Map<string, string>();
  graph.nodes.forEach((node) => {
    const name = graphModuleName(node);
    const id = `group:${name}`;
    nodeGroups.set(node.id, id);
    const current = groups.get(id);
    groups.set(id, current
      ? { ...current, degree: current.degree + 1 }
      : { id, label: name, category: '模块分组', source: node.source, degree: 1 });
  });
  const edgeMap = new Map<string, GraphEdge>();
  graph.edges.forEach((edge) => {
    const source = nodeGroups.get(edge.source);
    const target = nodeGroups.get(edge.target);
    if (!source || !target || source === target) return;
    const key = `${source}\0${target}`;
    const current = edgeMap.get(key);
    edgeMap.set(key, current ? { ...current, weight: current.weight + edge.weight } : { source, target, weight: edge.weight, label: '依赖', kind: edge.kind });
  });
  return { nodes: [...groups.values()], edges: [...edgeMap.values()] };
}

export function localGraph(graph: GraphData, centerId: string, depth = 1): GraphData {
  const included = new Set([centerId]);
  for (let level = 0; level < depth; level++) {
    const frontier = new Set(included);
    graph.edges.forEach((edge) => {
      if (frontier.has(edge.source) || frontier.has(edge.target)) { included.add(edge.source); included.add(edge.target); }
    });
  }
  return { nodes: graph.nodes.filter((node) => included.has(node.id)), edges: graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)) };
}

export function dependencyMatrix(graph: GraphData): { labels: string[]; values: number[][] } {
  const aggregated = aggregateGraph(graph);
  const labels = aggregated.nodes.map((node) => node.label).sort();
  const indexes = new Map(labels.map((label, index) => [`group:${label}`, index]));
  const values = labels.map(() => labels.map(() => 0));
  aggregated.edges.forEach((edge) => {
    const row = indexes.get(edge.source); const column = indexes.get(edge.target);
    if (row != null && column != null) values[row][column] += edge.weight;
  });
  return { labels, values };
}
