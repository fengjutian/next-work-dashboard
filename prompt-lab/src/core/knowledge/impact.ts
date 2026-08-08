import type { KnowledgeDocument, KnowledgeSourceChange, KnowledgeUpdateImpact } from './types';

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase();
}

function sourcesOf(document: KnowledgeDocument): string[] {
  const value = document.frontmatter.sources;
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

/** Maps deterministic repository changes to the documents that explicitly cite them. */
export function analyzeKnowledgeUpdateImpact(
  documents: KnowledgeDocument[],
  changes: KnowledgeSourceChange[],
): KnowledgeUpdateImpact[] {
  const changedByPath = new Map(changes.map((change) => [normalize(change.path), change]));
  return documents.flatMap((document) => {
    const changedSources = sourcesOf(document)
      .map((source) => changedByPath.get(normalize(source)))
      .filter((change): change is KnowledgeSourceChange => Boolean(change));
    return changedSources.length ? [{
      documentUri: document.uri,
      documentPath: document.path,
      documentTitle: document.title,
      changedSources,
    }] : [];
  }).sort((left, right) => right.changedSources.length - left.changedSources.length || left.documentPath.localeCompare(right.documentPath));
}
