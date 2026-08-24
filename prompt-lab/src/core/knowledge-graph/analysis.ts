import type { GraphData, GraphDiff, GraphFinding, GraphHealthReport, GraphPath, GraphSnapshot, ImpactAnalysis, ImpactDirection } from '@/plugins/knowledge-graph/graph-types';

const usable = (status?: string) => status !== 'rejected' && status !== 'stale';

export function analyzeGraphImpact(graph: GraphData, centerId: string, options: { direction?: ImpactDirection; maxDepth?: number; acceptedOnly?: boolean } = {}): ImpactAnalysis {
  const direction = options.direction ?? 'downstream';
  const maxDepth = Math.max(1, options.maxDepth ?? 3);
  const edges = graph.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => !options.acceptedOnly || usable(edge.status));
  const depthByNode: Record<string, number> = { [centerId]: 0 };
  const paths: GraphPath[] = [];
  const queue: GraphPath[] = [{ nodeIds: [centerId], edgeIndexes: [] }];
  while (queue.length) {
    const path = queue.shift()!;
    const current = path.nodeIds.at(-1)!;
    const depth = path.nodeIds.length - 1;
    if (depth >= maxDepth) continue;
    const candidates = edges.flatMap(({ edge, index }) => {
      const ids: string[] = [];
      if ((direction === 'downstream' || direction === 'both') && edge.source === current) ids.push(edge.target);
      if ((direction === 'upstream' || direction === 'both') && edge.target === current) ids.push(edge.source);
      return ids.map((id) => ({ id, index }));
    });
    for (const { id, index } of candidates) {
      const next = { nodeIds: [...path.nodeIds, id], edgeIndexes: [...path.edgeIndexes, index] };
      paths.push(next);
      if (next.nodeIds.slice(0, -1).includes(id)) continue;
      const nextDepth = depth + 1;
      if (depthByNode[id] == null || nextDepth < depthByNode[id]) {
        depthByNode[id] = nextDepth;
        queue.push(next);
      }
    }
  }
  const ids = new Set(Object.keys(depthByNode).filter((id) => id !== centerId));
  const direct = graph.nodes.filter((node) => depthByNode[node.id] === 1);
  const transitive = graph.nodes.filter((node) => ids.has(node.id) && depthByNode[node.id] > 1);
  const cycles = paths.filter((path) => path.nodeIds.at(-1) === centerId).map((path) => path.nodeIds);
  const confidence = graph.edges.length ? paths.reduce((sum, path) => sum + (graph.edges[path.edgeIndexes.at(-1)!]?.confidence ?? .7), 0) / Math.max(paths.length, 1) : 0;
  return { centerId, direction, direct, transitive, paths, depthByNode, cycles, score: Math.min(100, Math.round((direct.length * 12 + transitive.length * 4 + cycles.length * 15) * (.5 + confidence / 2))) };
}

export function diagnoseGraph(graph: GraphData): GraphFinding[] {
  const findings: GraphFinding[] = [];
  const degree = new Map(graph.nodes.map((node) => [node.id, { in: 0, out: 0 }]));
  graph.edges.forEach((edge) => { degree.get(edge.source)!.out++; degree.get(edge.target)!.in++; });
  const hubThreshold = Math.max(8, Math.ceil(Math.sqrt(Math.max(graph.nodes.length, 1)) * 2));
  graph.nodes.forEach((node) => {
    const value = degree.get(node.id)!;
    if (!value.in && !value.out) findings.push({ id: `orphan:${node.id}`, kind: 'orphan', severity: 'info', nodeIds: [node.id], explanation: `${node.label} 没有任何关系`, suggestedAction: '补充关系或归档该节点' });
    if (value.in + value.out >= hubThreshold) findings.push({ id: `hub:${node.id}`, kind: 'hub', severity: 'warning', nodeIds: [node.id], explanation: `${node.label} 连接 ${value.in + value.out} 个关系`, suggestedAction: '检查是否需要拆分职责或实体' });
    if (value.in >= 4 && value.out >= 4) findings.push({ id: `coupling:${node.id}`, kind: 'high-coupling', severity: 'warning', nodeIds: [node.id], explanation: `${node.label} 同时具有较高入度和出度` });
  });
  graph.edges.forEach((edge, index) => {
    if (edge.status === 'stale') findings.push({ id: `stale:${index}`, kind: 'stale-evidence', severity: 'error', nodeIds: [edge.source, edge.target], edgeIndexes: [index], explanation: `${edge.label ?? '关系'} 的来源已变化`, suggestedAction: '重新抽取或审核证据' });
    if (edge.status === 'accepted' && !(edge.evidence?.length)) findings.push({ id: `unsupported:${index}`, kind: 'unsupported-claim', severity: 'warning', nodeIds: [edge.source, edge.target], edgeIndexes: [index], explanation: `已接受的 ${edge.label ?? '关系'} 没有证据`, suggestedAction: '补充引用或降级为候选关系' });
  });
  const seenCycles = new Set<string>();
  for (const node of graph.nodes) for (const cycle of analyzeGraphImpact(graph, node.id, { direction: 'downstream', maxDepth: 8, acceptedOnly: true }).cycles) {
    const body = cycle.slice(0, -1); const rotations = body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join('\0')); const key = rotations.sort()[0];
    if (!seenCycles.has(key)) { seenCycles.add(key); findings.push({ id: `cycle:${key}`, kind: 'cycle', severity: 'error', nodeIds: body, explanation: `发现循环：${body.join(' → ')}`, suggestedAction: '打断依赖或将关系标记为非传播关系' }); }
  }
  return findings;
}

export function evaluateGraphHealth(graph: GraphData): GraphHealthReport {
  const findings = diagnoseGraph(graph);
  const score = Math.max(0, 100 - findings.reduce((sum, item) => sum + (item.severity === 'error' ? 12 : item.severity === 'warning' ? 5 : 1), 0));
  return { score, grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F', findings };
}

export function enrichGraphMetrics(graph: GraphData): GraphData {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0])); const outgoing = new Map(incoming);
  graph.edges.forEach((edge) => { outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1); incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1); });
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics, inDegree: incoming.get(node.id) ?? 0, outDegree: outgoing.get(node.id) ?? 0, blastRadius: analyzeGraphImpact(graph, node.id, { maxDepth: 5, acceptedOnly: true }).direct.length + analyzeGraphImpact(graph, node.id, { maxDepth: 5, acceptedOnly: true }).transitive.length } })) };
}

const edgeKey = (edge: GraphData['edges'][number]) => `${edge.source}\0${edge.target}\0${edge.label ?? ''}\0${edge.kind ?? ''}`;
export function diffGraphSnapshots(from: GraphSnapshot | GraphData, to: GraphSnapshot | GraphData): GraphDiff {
  const before = 'graph' in from ? from.graph : from; const after = 'graph' in to ? to.graph : to;
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node])); const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge])); const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
  const addedNodeIds = [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)); const removedNodeIds = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id));
  const changedNodeIds = [...afterNodes.keys()].filter((id) => beforeNodes.has(id) && JSON.stringify(beforeNodes.get(id)) !== JSON.stringify(afterNodes.get(id)));
  const addedEdges = [...afterEdges].filter(([key]) => !beforeEdges.has(key)).map(([, edge]) => edge); const removedEdges = [...beforeEdges].filter(([key]) => !afterEdges.has(key)).map(([, edge]) => edge);
  return { addedNodeIds, removedNodeIds, changedNodeIds, addedEdges, removedEdges, affectedNodeIds: [...new Set([...addedNodeIds, ...removedNodeIds, ...changedNodeIds, ...addedEdges.flatMap((e) => [e.source, e.target]), ...removedEdges.flatMap((e) => [e.source, e.target])])] };
}
