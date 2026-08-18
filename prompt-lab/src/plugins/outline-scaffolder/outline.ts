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

export type SplitMode = 'chapter' | 'section' | 'single';
export type ChapterWorkflowState = 'pending' | 'generating' | 'draft' | 'review' | 'revising' | 'quality' | 'complete' | 'error';

export function chapterStateAfterSave(state: ChapterWorkflowState): ChapterWorkflowState {
  if (state === 'pending' || state === 'error') return 'draft';
  if (state === 'revising') return 'quality';
  return state;
}

export interface ScaffoldOptions {
  folder?: string;
  splitMode?: SplitMode;
  organizeByPart?: boolean;
  projectTitle?: string;
  template?: string;
}

const PART_PATTERN = /^(?:第[一二三四五六七八九十百千万零〇两\d]+[篇部卷]|part\s+\d+)(?=\s|$)/i;
const CHAPTER_PATTERN = /^(?:第[一二三四五六七八九十百千万零〇两\d]+章|chapter\s+\d+)(?=\s|$)/i;
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
    const bullet = line.match(/^(?:[-*+]\s+|\d+(?:[)、]|\.(?!\d))\s*)(.+)$/);
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

interface LocatedNode { node: OutlineNode; part?: OutlineNode }

function locate(nodes: OutlineNode[], part?: OutlineNode): LocatedNode[] {
  return nodes.flatMap((node) => {
    const currentPart = PART_PATTERN.test(node.title) ? node : part;
    return [{ node, part: currentPart }, ...locate(node.children, currentPart)];
  });
}

function renderNode(node: OutlineNode, baseLevel: number): string {
  const markdownLevel = Math.min(6, Math.max(2, node.level - baseLevel + 2));
  return `${'#'.repeat(markdownLevel)} ${node.title}\n\n<!-- 在这里添加内容 -->\n\n${node.children.map((child) => renderNode(child, baseLevel)).join('')}`;
}

function applyTemplate(template: string | undefined, title: string, headings: string): string {
  const fallback = `# {{title}}\n\n<!-- 在这里添加内容 -->\n\n{{headings}}`;
  return (template?.trim() || fallback)
    .replaceAll('{{title}}', title)
    .replaceAll('{{headings}}', headings)
    .replaceAll('{{placeholder}}', '<!-- 在这里添加内容 -->')
    .replace(/\s+$/, '') + '\n';
}

export function createChapterDocuments(nodes: OutlineNode[], folderOrOptions: string | ScaffoldOptions = ''): ChapterDocument[] {
  const options: ScaffoldOptions = typeof folderOrOptions === 'string' ? { folder: folderOrOptions } : folderOrOptions;
  const folder = options.folder ?? '';
  const all = flatten(nodes);
  const explicitChapters = all.filter((node) => CHAPTER_PATTERN.test(node.title));
  const chapterLevel = explicitChapters[0]?.level ?? (all.some((node) => node.level === 2) ? 2 : 1);
  const located = locate(nodes);
  const chapters = explicitChapters.length
    ? located.filter(({ node }) => explicitChapters.includes(node))
    : located.filter(({ node }) => node.level === chapterLevel);

  if (options.splitMode === 'single') {
    const title = options.projectTitle?.trim() || '文档';
    const headings = nodes.map((node) => renderNode(node, 0)).join('');
    const filename = `${safeName(title)}.md`;
    return [{ path: folder.trim() ? `${safeName(folder)}/${filename}` : filename, title, content: applyTemplate(options.template, title, headings) }];
  }

  const targets: LocatedNode[] = options.splitMode === 'section'
    ? chapters.flatMap(({ node, part }) => node.children.length ? node.children.map((child) => ({ node: child, part })) : [{ node, part }])
    : chapters;
  const width = Math.max(2, String(targets.length).length);
  return targets.map(({ node, part }, index) => {
    const filename = `${String(index + 1).padStart(width, '0')}-${safeName(node.title)}.md`;
    const directories = [folder.trim() ? safeName(folder) : '', options.organizeByPart && part ? safeName(part.title) : ''].filter(Boolean);
    const path = [...directories, filename].join('/');
    const headings = node.children.map((child) => renderNode(child, node.level)).join('');
    return {
      path,
      title: node.title,
      content: applyTemplate(options.template, node.title, headings),
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
