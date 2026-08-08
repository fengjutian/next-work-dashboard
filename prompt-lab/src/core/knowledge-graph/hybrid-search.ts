import type { ExtractionDocument, GraphData, GraphEdge, GraphNode } from '@/plugins/knowledge-graph/graph-types';

export interface HybridSearchResult { nodes: GraphNode[]; edges: GraphEdge[]; documents: Array<{ name: string; sourcePath?: string; score: number; excerpt: string }>; context: string }

function terms(value: string): string[] {
  const normalized = value.toLocaleLowerCase();
  const latin: string[] = normalized.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const chinese = normalized.replace(/[^\u3400-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) latin.push(chinese.slice(index, index + 2));
  return [...new Set(latin)];
}

export function hybridGraphSearch(query: string, graph: GraphData, documents: ExtractionDocument[], depth = 2): HybridSearchResult {
  const queryTerms = terms(query);
  const matched = graph.nodes.filter((node) => {
    const text = [node.label, node.canonicalName, ...(node.aliases ?? [])].filter(Boolean).join(' ').toLocaleLowerCase();
    return queryTerms.some((term) => text.includes(term)) || text.includes(query.toLocaleLowerCase());
  });
  const included = new Set(matched.map((node) => node.id));
  for (let level = 0; level < Math.max(0, Math.min(depth, 3)); level += 1) {
    const frontier = new Set(included);
    graph.edges.filter((edge) => edge.status !== 'rejected' && edge.status !== 'stale').forEach((edge) => {
      if (frontier.has(edge.source) || frontier.has(edge.target)) { included.add(edge.source); included.add(edge.target); }
    });
  }
  const edges = graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target) && edge.status !== 'rejected' && edge.status !== 'stale');
  const nodes = graph.nodes.filter((node) => included.has(node.id));
  const documentHits = documents.map((document) => {
    const lower = document.content.toLocaleLowerCase();
    const score = queryTerms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0) / Math.max(1, queryTerms.length);
    const first = queryTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
    return { name: document.name, sourcePath: document.sourcePath, score, excerpt: document.content.slice(Math.max(0, first - 120), first + 380).trim() };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  const evidence = edges.flatMap((edge) => edge.evidence ?? []).filter((item, index, all) => all.findIndex((candidate) => candidate.sourcePath === item.sourcePath && candidate.quote === item.quote) === index);
  const context = [`问题：${query}`, '相关实体：', ...nodes.map((node) => `- ${node.label} [${node.category ?? '未分类'}]`), '关系：', ...edges.map((edge) => `- ${edge.source} --${edge.label ?? '关联'}--> ${edge.target}`), '证据：', ...evidence.map((item, index) => `[G${index + 1}] ${item.documentName}${item.sourcePath ? ` (${item.sourcePath})` : ''}: ${item.quote ?? ''}`), ...documentHits.map((item, index) => `[D${index + 1}] ${item.name}: ${item.excerpt}`)].join('\n');
  return { nodes, edges, documents: documentHits, context };
}
