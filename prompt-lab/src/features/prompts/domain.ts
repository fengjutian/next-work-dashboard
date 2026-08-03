import type { Prompt, PromptVariable } from '@/store/types';

export interface PromptQuery {
  search?: string;
  category?: string | null;
  tag?: string | null;
  enabledOnly?: boolean;
}

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractPromptVariableNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1].trim();
    if (name) names.add(name);
  }
  return [...names];
}

export function fillPromptVariables(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE_PATTERN, (token, rawName: string) => {
    const name = rawName.trim();
    return values[name] ?? token;
  });
}

export function syncPromptVariables(
  content: string,
  existing: PromptVariable[] = [],
): PromptVariable[] {
  const definitions = new Map(existing.map((variable) => [variable.name, variable]));
  return extractPromptVariableNames(content).map((name) => definitions.get(name) ?? {
    name,
    defaultValue: '',
    description: '',
  });
}

export function normalizePromptTags(value: string | string[]): string[] {
  const tags = Array.isArray(value) ? value : value.split(/[,，]/);
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function filterAndSortPrompts(prompts: Prompt[], query: PromptQuery = {}): Prompt[] {
  const search = query.search?.trim().toLocaleLowerCase();
  return prompts
    .filter((prompt) => {
      if (query.enabledOnly && prompt.enabled === false) return false;
      if (query.category && prompt.category !== query.category) return false;
      if (query.tag && !prompt.tags.includes(query.tag)) return false;
      if (!search) return true;
      return prompt.title.toLocaleLowerCase().includes(search)
        || prompt.content.toLocaleLowerCase().includes(search)
        || prompt.category.toLocaleLowerCase().includes(search)
        || prompt.tags.some((tag) => tag.toLocaleLowerCase().includes(search));
    })
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return b.updatedAt - a.updatedAt;
    });
}

export function getPromptPreview(content: string, limit = 120): string {
  const preview = content.replace(VARIABLE_PATTERN, '___').trim();
  return preview.length > limit ? `${preview.slice(0, limit)}…` : preview;
}
