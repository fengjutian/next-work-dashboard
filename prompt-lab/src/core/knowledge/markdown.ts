import type { KnowledgeDocument, KnowledgeDocumentType, ResolvedKnowledgeLink, WikiLink } from './types';

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseFrontmatter(content: string): { attributes: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { attributes: {}, body: content };
  const attributes: Record<string, unknown> = {};
  let listField: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) {
      listField = field[2].trim() ? null : field[1];
      attributes[field[1]] = listField ? [] : scalar(field[2]);
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listField && listItem && Array.isArray(attributes[listField])) {
      (attributes[listField] as unknown[]).push(scalar(listItem[1]));
    } else if (line.trim()) listField = null;
  }
  return { attributes, body: content.slice(match[0].length) };
}

export function extractWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const withoutInlineCode = line.replace(/`[^`]*`/g, '');
    for (const match of withoutInlineCode.matchAll(/(!)?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
      links.push({
        raw: match[0], target: match[2].trim(), label: match[3]?.trim(),
        embedded: Boolean(match[1]), line: index + 1, kind: 'wiki',
      });
    }
    for (const match of withoutInlineCode.matchAll(/(!)?\[([^\]]*)\]\(([^)]+\.(?:md|mdx)(?:#[^)\s]+)?)(?:\s+["'][^"']*["'])?\)/gi)) {
      const [target, anchor] = match[3].trim().split('#', 2);
      links.push({ raw: match[0], target, label: match[2]?.trim() || undefined, embedded: Boolean(match[1]), line: index + 1, kind: 'markdown', anchor });
    }
  });
  return links;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function fallbackTitle(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.(md|mdx)$/i, '') ?? path;
}

export function hashKnowledgeContent(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseKnowledgeDocument(path: string, content: string, modifiedAt = 0): KnowledgeDocument {
  const normalizedPath = path.replace(/\\/g, '/');
  const { attributes, body } = parseFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const declaredType = String(attributes.type ?? 'document') as KnowledgeDocumentType;
  const allowedTypes: KnowledgeDocumentType[] = ['conversation', 'note', 'spec', 'prompt', 'code', 'document'];
  return {
    uri: `knowledge://${encodeURI(normalizedPath)}`,
    path: normalizedPath,
    title: String(attributes.title ?? heading ?? fallbackTitle(normalizedPath)),
    type: allowedTypes.includes(declaredType) ? declaredType : 'document',
    tags: stringList(attributes.tags), aliases: stringList(attributes.aliases),
    links: extractWikiLinks(body), modifiedAt, contentHash: hashKnowledgeContent(content), frontmatter: attributes,
  };
}

export function rewriteResolvedWikiLinks(content: string, links: ResolvedKnowledgeLink[], nextPath: string): string {
  const lines = content.split(/\r?\n/);
  const normalizedNext = nextPath.replace(/\\/g, '/').replace(/\.(md|mdx)$/i, '');
  const nextBase = normalizedNext.split('/').at(-1) ?? normalizedNext;
  for (const link of links) {
    const index = link.line - 1;
    if (index < 0 || index >= lines.length) continue;
    const nextTarget = link.target.includes('/') || link.target.includes('\\') ? normalizedNext : nextBase;
    const replacement = link.raw.replace(link.target, nextTarget);
    lines[index] = lines[index].replace(link.raw, replacement);
  }
  return lines.join(content.includes('\r\n') ? '\r\n' : '\n');
}
