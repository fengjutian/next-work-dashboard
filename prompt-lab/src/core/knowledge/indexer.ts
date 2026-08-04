import type { KnowledgeDocument, KnowledgeIndex, ResolvedKnowledgeLink } from './types';

function normalize(value: string): string {
  return decodeURIComponent(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.(md|mdx)$/i, '').toLocaleLowerCase();
}

export function buildKnowledgeIndex(documents: KnowledgeDocument[]): KnowledgeIndex {
  const targets = new Map<string, Set<string>>();
  const addTarget = (key: string, uri: string) => {
    const normalized = normalize(key);
    if (!normalized) return;
    const values = targets.get(normalized) ?? new Set<string>();
    values.add(uri); targets.set(normalized, values);
  };
  for (const document of documents) {
    const path = normalize(document.path);
    addTarget(path, document.uri);
    addTarget(path.split('/').at(-1) ?? path, document.uri);
    addTarget(document.title, document.uri);
    document.aliases.forEach((alias) => addTarget(alias, document.uri));
  }

  const links: ResolvedKnowledgeLink[] = [];
  const backlinks: Record<string, ResolvedKnowledgeLink[]> = Object.fromEntries(documents.map((doc) => [doc.uri, []]));
  const incoming = new Set<string>();
  for (const document of documents) {
    for (const link of document.links) {
      const candidates = [...(targets.get(normalize(link.target)) ?? [])];
      const resolved: ResolvedKnowledgeLink = {
        ...link, sourceUri: document.uri,
        status: candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'unresolved',
        targetUri: candidates.length === 1 ? candidates[0] : undefined,
        candidates: candidates.length > 1 ? candidates : undefined,
      };
      links.push(resolved);
      if (resolved.targetUri) { backlinks[resolved.targetUri].push(resolved); incoming.add(resolved.targetUri); }
    }
  }
  const linkedSources = new Set(links.filter((link) => link.status === 'resolved').map((link) => link.sourceUri));
  return { documents, links, backlinks, orphanUris: documents.filter((doc) => !incoming.has(doc.uri) && !linkedSources.has(doc.uri)).map((doc) => doc.uri) };
}
