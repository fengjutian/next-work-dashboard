import type { ExtractionDocument, GraphData, GraphDocumentSnapshot } from '@/plugins/knowledge-graph/graph-types';

export function contentHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) { hash ^= content.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeDocumentSnapshots(documents: ExtractionDocument[], now = Date.now()): GraphDocumentSnapshot[] {
  return documents.flatMap((document) => document.sourcePath ? [{ path: document.sourcePath, name: document.name, hash: contentHash(document.content), indexedAt: now, active: true }] : []);
}

export function reconcileDocuments(graph: GraphData, documents: ExtractionDocument[], now = Date.now()): { graph: GraphData; changedPaths: string[] } {
  const incoming = makeDocumentSnapshots(documents, now);
  const previous = new Map((graph.documents ?? []).map((item) => [item.path, item]));
  const changedPaths = incoming.filter((item) => previous.get(item.path)?.hash !== item.hash).map((item) => item.path);
  const changed = new Set(changedPaths);
  return {
    changedPaths,
    graph: {
      ...graph,
      documents: [...(graph.documents ?? []).filter((item) => !incoming.some((next) => next.path === item.path)), ...incoming],
      edges: graph.edges.map((edge) => edge.evidence?.some((item) => item.sourcePath && changed.has(item.sourcePath)) ? { ...edge, status: 'stale' as const } : edge),
    },
  };
}

export function attachDocumentHashes(graph: GraphData): GraphData {
  const hashes = new Map((graph.documents ?? []).map((item) => [item.path, item.hash]));
  return { ...graph, edges: graph.edges.map((edge) => ({ ...edge, evidence: edge.evidence?.map((item) => ({ ...item, documentHash: item.documentHash ?? (item.sourcePath ? hashes.get(item.sourcePath) : undefined) })) })) };
}
