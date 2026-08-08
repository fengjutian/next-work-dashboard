import type { GraphData, GraphNode } from '@/plugins/knowledge-graph/graph-types';

export function normalizeEntityName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

export function stableEntityId(category: string | undefined, name: string): string {
  const input = `${category ?? 'entity'}:${normalizeEntityName(name)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `entity:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface DuplicateSuggestion { canonicalId: string; duplicateId: string; reason: 'name' | 'alias' }

export function findDuplicateEntities(nodes: GraphNode[]): DuplicateSuggestion[] {
  const seen = new Map<string, string>();
  const suggestions: DuplicateSuggestion[] = [];
  for (const node of nodes) {
    const terms = [node.canonicalName ?? node.label, ...(node.aliases ?? [])].map(normalizeEntityName).filter(Boolean);
    for (const term of terms) {
      const existing = seen.get(term);
      if (existing && existing !== node.id) {
        suggestions.push({ canonicalId: existing, duplicateId: node.id, reason: term === normalizeEntityName(node.label) ? 'name' : 'alias' });
        break;
      }
      seen.set(term, node.id);
    }
  }
  return suggestions;
}

export function mergeEntities(graph: GraphData, canonicalId: string, duplicateId: string): GraphData {
  if (canonicalId === duplicateId) return graph;
  const canonical = graph.nodes.find((node) => node.id === canonicalId);
  const duplicate = graph.nodes.find((node) => node.id === duplicateId);
  if (!canonical || !duplicate) return graph;
  const aliases = [...new Set([...(canonical.aliases ?? []), duplicate.label, ...(duplicate.aliases ?? [])])].filter((name) => normalizeEntityName(name) !== normalizeEntityName(canonical.label));
  const edgeKeys = new Set<string>();
  const edges = graph.edges.flatMap((edge) => {
    const updated = { ...edge, source: edge.source === duplicateId ? canonicalId : edge.source, target: edge.target === duplicateId ? canonicalId : edge.target };
    if (updated.source === updated.target) return [];
    const key = `${updated.source}\0${updated.target}\0${updated.label ?? ''}`;
    if (edgeKeys.has(key)) return [];
    edgeKeys.add(key); return [updated];
  });
  const degree = new Map<string, number>();
  edges.forEach((edge) => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); });
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== duplicateId).map((node) => node.id === canonicalId ? { ...node, aliases, canonicalName: node.canonicalName ?? node.label, degree: degree.get(node.id) ?? 0 } : { ...node, degree: degree.get(node.id) ?? 0 }),
    edges,
  };
}
