import type { KnowledgeDocument, KnowledgeDocumentType, WikiLink } from './types';

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
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) attributes[field[1]] = scalar(field[2]);
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
        embedded: Boolean(match[1]), line: index + 1,
      });
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
