export const DEFAULT_TEMPLATE = `# {{title}}

{{placeholder}}

{{headings}}`;

export const RECENT_PROJECTS_KEY = "outline-scaffolder.recent-projects.v1";

export const normalizeApiKey = (value: string) => value.trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
export const isValidApiKey = (value: string) => /^[\x21-\x7E]+$/.test(normalizeApiKey(value));

export const countArticleWords = (markdown: string) => {
  const text = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/<[^>]+>/g, "").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[*_~`>|]/g, " ");
  return (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) ?? []).length + (text.match(/[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/g) ?? []).length;
};

export const appendSourceReferences = (markdown: string, sources: string) => {
  if (!sources.trim() || /^##\s+(史料与参考资料|参考资料|参考文献)\s*$/m.test(markdown)) return markdown.trimEnd();
  const references = new Map<string, string>();
  for (const match of sources.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) { const title = match[1].trim(); const url = match[2].trim(); if (title && url && !references.has(url)) references.set(url, title); }
  if (!references.size) return markdown.trimEnd();
  const items = [...references].map(([url, title], index) => `${index + 1}. [${title}](${url})${sources.includes("搜索摘要（仅作线索") ? "（检索线索，引用前需核对原文）" : ""}`).join("\n");
  return `${markdown.trimEnd()}\n\n## 史料与参考资料\n\n${items}`;
};

export const normalizeForComparison = (value: string) => value.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[\s*_~`>，。！？；：、“”‘’（）()]+/g, "").replaceAll("[", "").replaceAll("]", "").toLowerCase();
export const removeRepeatedContinuation = (existing: string, generated: string) => {
  const existingNormalized = normalizeForComparison(existing);
  return generated.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/i, "").trim().split(/\n\s*\n/).filter((block) => { const normalized = normalizeForComparison(block); if (!normalized || /^##?史料与参考资料/.test(block.trim())) return false; return normalized.length < 12 || !existingNormalized.includes(normalized); }).join("\n\n").trim();
};
export const insertBeforeSourceReferences = (existing: string, addition: string) => {
  const marker = existing.search(/^##\s+(史料与参考资料|参考资料|参考文献)\s*$/m);
  if (marker < 0) return `${existing.trimEnd()}\n\n${addition.trim()}\n`;
  return `${existing.slice(0, marker).trimEnd()}\n\n${addition.trim()}\n\n${existing.slice(marker).trimStart().trimEnd()}\n`;
};
