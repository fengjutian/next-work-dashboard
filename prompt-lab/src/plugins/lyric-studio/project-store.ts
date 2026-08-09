import type { LyricProject } from './types';

export const PROJECTS_KEY = 'nwd:lyric-studio:projects:v2';
export const ACTIVE_PROJECT_KEY = 'nwd:lyric-studio:active-project:v2';

export function readProjects(fallback: LyricProject): LyricProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]') as LyricProject[];
    return Array.isArray(parsed) && parsed.length ? parsed : [fallback];
  } catch { return [fallback]; }
}

export function persistProjects(projects: LyricProject[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function duplicateProject(project: LyricProject): LyricProject {
  const now = Date.now();
  return { ...structuredClone(project), id: crypto.randomUUID(), title: `${project.title} 副本`, favorite: false, updatedAt: now, sections: project.sections.map((section) => ({ ...section, id: crypto.randomUUID() })) };
}

export function matchesProject(project: LyricProject, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [project.title, project.theme, project.collection, project.status, ...project.tags].join(' ').toLocaleLowerCase().includes(normalized);
}
