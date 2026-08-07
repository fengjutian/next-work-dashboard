import type { Skill, SkillFile, SkillFrontmatter } from './types';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return null;
  const frontmatter: Partial<SkillFrontmatter> = {};
  for (const line of fmMatch[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'name') frontmatter.name = value;
    if (key === 'description') frontmatter.description = value;
  }
  if (!frontmatter.name) return null;
  return {
    frontmatter: { name: frontmatter.name, description: frontmatter.description || '' },
    body: raw.slice(fmMatch[0].length).trim(),
  };
}

export interface GitHubSkillLocation {
  owner: string;
  repo: string;
  branch: string;
  /** Empty string means SKILL.md is at the repository root. */
  skillDir?: string;
}

export function parseGitHubUrl(value: string): GitHubSkillLocation | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!['github.com', 'www.github.com', 'raw.githubusercontent.com'].includes(hostname) || parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    if (!owner || !repo) return null;

    if (hostname === 'raw.githubusercontent.com') {
      if (parts.length < 4) return null;
      const rawPath = parts.slice(3).join('/');
      const skillDir = rawPath.replace(/(^|\/)SKILL\.md$/i, '').replace(/\/$/, '');
      return { owner, repo, branch: parts[2], skillDir };
    }
    if (parts[2] === 'tree' || parts[2] === 'blob') {
      if (!parts[3]) return null;
      const rawPath = parts.slice(4).join('/');
      const skillDir = rawPath.replace(/(^|\/)SKILL\.md$/i, '').replace(/\/$/, '');
      return { owner, repo, branch: parts[3], skillDir };
    }
    return { owner, repo, branch: 'main' };
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: 'no-store' });
  return response.ok ? response.text() : null;
}

export async function fetchSkillFromGitHub(githubUrl: string): Promise<{ skillMd: string; files: SkillFile[] }> {
  const info = parseGitHubUrl(githubUrl);
  if (!info) throw new Error(`无法解析 GitHub URL：${githubUrl}`);

  const candidateDirs = info.skillDir !== undefined ? [info.skillDir] : ['', `skills/${info.repo}`];
  const candidateBranches = info.skillDir !== undefined ? [info.branch] : [...new Set([info.branch, 'master'])];
  const attempted: string[] = [];
  let branch = info.branch;
  let skillDir = candidateDirs[0];
  let skillMd = '';

  for (const branchCandidate of candidateBranches) {
    for (const dirCandidate of candidateDirs) {
      const path = dirCandidate ? `${dirCandidate}/SKILL.md` : 'SKILL.md';
      const url = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${branchCandidate}/${path}`;
      attempted.push(url);
      const content = await fetchText(url);
      if (content !== null) {
        branch = branchCandidate;
        skillDir = dirCandidate;
        skillMd = content;
        break;
      }
    }
    if (skillMd) break;
  }
  if (!skillMd) throw new Error(`无法获取 SKILL.md。已尝试：${attempted.join('、')}`);

  const base = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${branch}`;
  const encodedDir = skillDir.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const apiPath = encodedDir ? `/contents/${encodedDir}` : '/contents';
  const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}${apiPath}?ref=${encodeURIComponent(branch)}`;
  let fileList: Array<{ name: string; download_url: string }> = [];
  try {
    const response = await fetch(apiUrl, { cache: 'no-store' });
    if (response.ok) {
      const entries = await response.json() as Array<{ name: string; download_url: string; type: string }>;
      fileList = entries.filter((entry) => entry.type === 'file' && entry.name !== 'SKILL.md' && entry.name.endsWith('.md'));
    }
  } catch {
    fileList = [];
  }

  const files: SkillFile[] = [];
  if (fileList.length) {
    for (const file of fileList) {
      try {
        const content = await fetchText(file.download_url);
        if (content !== null) files.push({ path: `references/${file.name}`, content });
      } catch { /* optional reference */ }
    }
  } else {
    const referencePattern = /\[([^\]]+)]\(([^)]+\.md)\)/g;
    const references = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = referencePattern.exec(skillMd)) !== null) {
      if (!match[2].startsWith('http')) references.add(match[2]);
    }
    for (const reference of references) {
      try {
        const prefix = skillDir ? `${skillDir}/` : '';
        const content = await fetchText(`${base}/${prefix}${reference}`);
        if (content !== null) files.push({ path: `references/${reference}`, content });
      } catch { /* optional reference */ }
    }
  }
  return { skillMd, files };
}

export async function loadSkillFromGitHub(githubUrl: string): Promise<Omit<Skill, 'id' | 'enabled' | 'createdAt' | 'updatedAt'>> {
  const { skillMd, files } = await fetchSkillFromGitHub(githubUrl);
  const parsed = parseSkillMd(skillMd);
  if (!parsed) throw new Error('SKILL.md 格式无效：缺少 frontmatter 或 name 字段');
  return { name: parsed.frontmatter.name, description: parsed.frontmatter.description, body: parsed.body, files, source: githubUrl };
}

export function loadSkillFromLocal(
  skillMd: string,
  refFiles: SkillFile[],
  source: string,
): Omit<Skill, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> {
  const parsed = parseSkillMd(skillMd);
  if (!parsed) throw new Error('SKILL.md 格式无效：缺少 frontmatter 或 name 字段');
  return { name: parsed.frontmatter.name, description: parsed.frontmatter.description, body: parsed.body, files: refFiles, source };
}
