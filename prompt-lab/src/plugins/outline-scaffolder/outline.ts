export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  children: OutlineNode[];
}

export interface ChapterDocument {
  path: string;
  title: string;
  content: string;
}

const PART_PATTERN = /^(?:第[一二三四五六七八九十百千万零〇两\d]+[篇部卷]|part\s+\d+)\b/i;
const CHAPTER_PATTERN = /^(?:第[一二三四五六七八九十百千万零〇两\d]+章|chapter\s+\d+)\b/i;
const NUMBERED_PATTERN = /^(\d+(?:\.\d+)*)[、.．\s]+(.+)$/;

function inferredLevel(text: string): number {
  if (PART_PATTERN.test(text)) return 1;
  if (CHAPTER_PATTERN.test(text)) return 2;
  const numbered = text.match(NUMBERED_PATTERN);
  if (numbered) return Math.min(6, numbered[1].split('.').length + 1);
  return 2;
}

export function parseOutline(source: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  let sequence = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^(?:[-*+]\s+|\d+[.)、]\s*)(.+)$/);
    const title = (heading?.[2] ?? bullet?.[1] ?? line).trim();
    if (!title) continue;
    const indentation = rawLine.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
    const level = heading?.[1].length ?? (indentation > 0 ? Math.floor(indentation / 2) + 2 : inferredLevel(title));
    const node: OutlineNode = { id: `outline-${sequence++}`, title, level, children: [] };

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function safeName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[.\s]+$/g, '').trim();
  return cleaned.slice(0, 100) || '未命名章节';
}

function flatten(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function renderNode(node: OutlineNode, baseLevel: number): string {
  const markdownLevel = Math.min(6, Math.max(2, node.level - baseLevel + 2));
  return `${'#'.repeat(markdownLevel)} ${node.title}\n\n<!-- 在这里添加内容 -->\n\n${node.children.map((child) => renderNode(child, baseLevel)).join('')}`;
}

export function createChapterDocuments(nodes: OutlineNode[], folder = ''): ChapterDocument[] {
  const all = flatten(nodes);
  const explicitChapters = all.filter((node) => CHAPTER_PATTERN.test(node.title));
  const chapterLevel = explicitChapters[0]?.level ?? (all.some((node) => node.level === 2) ? 2 : 1);
  const chapters = explicitChapters.length ? explicitChapters : all.filter((node) => node.level === chapterLevel);
  const width = Math.max(2, String(chapters.length).length);
  return chapters.map((chapter, index) => {
    const filename = `${String(index + 1).padStart(width, '0')}-${safeName(chapter.title)}.md`;
    const path = folder.trim() ? `${safeName(folder.trim())}/${filename}` : filename;
    return {
      path,
      title: chapter.title,
      content: `# ${chapter.title}\n\n<!-- 在这里添加本章内容 -->\n\n${chapter.children.map((child) => renderNode(child, chapter.level)).join('')}`,
    };
  });
}

export function createReadme(documents: ChapterDocument[], title: string, folder = ''): ChapterDocument {
  const name = title.trim() || '文档目录';
  const safeFolder = folder.trim() ? safeName(folder.trim()) : '';
  const links = documents.map((document) => {
    const relativePath = safeFolder ? document.path.slice(safeFolder.length + 1) : document.path;
    return `- [${document.title}](${encodeURI(relativePath)})`;
  }).join('\n');
  return { path: safeFolder ? `${safeFolder}/README.md` : 'README.md', title: name, content: `# ${name}\n\n${links}\n` };
}
