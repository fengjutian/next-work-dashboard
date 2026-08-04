import type { KnowledgeContentRule, KnowledgeDiagnostic, KnowledgeDocument, KnowledgeTemplate } from './types';

const SAFE_VARIABLE = /^[A-Za-z][\w-]*$/;

export function slugifyKnowledgeValue(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\\/:*?"<>|.]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function render(text: string, values: Record<string, string>, fileName = false): string {
  return text.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (_all, name: string) => {
    if (!SAFE_VARIABLE.test(name)) throw new Error(`INVALID_TEMPLATE_VARIABLE:${name}`);
    const value = values[name] ?? '';
    return fileName ? slugifyKnowledgeValue(value) : value;
  });
}

export function instantiateKnowledgeTemplate(template: KnowledgeTemplate, input: Record<string, string>): { path: string; content: string } {
  if (!/^[A-Za-z0-9][\w.-]*$/.test(template.id)) throw new Error('INVALID_TEMPLATE_ID');
  const values = { ...(template.defaults ?? {}), ...input };
  const directory = template.directory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!directory || directory.split('/').some((part) => part === '..')) throw new Error('INVALID_TEMPLATE_DIRECTORY');
  const fileName = render(template.fileName, values, true);
  if (!fileName || fileName.includes('/') || fileName === '..') throw new Error('INVALID_TEMPLATE_FILENAME');
  const renderedName = fileName.endsWith('.md') || fileName.endsWith('.mdx') ? fileName : `${fileName}.md`;
  return { path: directory === '.' ? renderedName : `${directory}/${renderedName}`, content: render(template.content, values) };
}

function matches(include: string, path: string): boolean {
  const normalized = include.replace(/\\/g, '/').replace(/\*\*.*$/, '').replace(/\*.*$/, '');
  return path.replace(/\\/g, '/').startsWith(normalized);
}

export function validateKnowledgeDocument(document: KnowledgeDocument, content: string, rules: KnowledgeContentRule[]): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  for (const rule of rules.filter((item) => matches(item.include, document.path))) {
    for (const field of rule.requiredFrontmatter ?? []) if (document.frontmatter[field] === undefined) diagnostics.push({ severity: 'error', code: 'MISSING_FRONTMATTER', message: `缺少 frontmatter 字段：${field}`, path: document.path });
    for (const section of rule.requiredSections ?? []) if (!new RegExp(`^#{1,6}\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(content)) diagnostics.push({ severity: 'warning', code: 'MISSING_SECTION', message: `缺少章节：${section}`, path: document.path });
    if (rule.allowedTypes?.length && !rule.allowedTypes.includes(document.type)) diagnostics.push({ severity: 'error', code: 'TYPE_NOT_ALLOWED', message: `目录不允许文档类型：${document.type}`, path: document.path });
  }
  return diagnostics;
}
