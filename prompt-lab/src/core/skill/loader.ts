// ── Skill 加载器 — 解析 SKILL.md、从 GitHub/本地导入 ──

import type { Skill, SkillFile, SkillFrontmatter } from './types';

// ── Frontmatter 解析 ──

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return null;

  const frontmatter: Partial<SkillFrontmatter> = {};
  for (const line of fmMatch[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'name') frontmatter.name = val;
      if (key === 'description') frontmatter.description = val;
    }
  }

  if (!frontmatter.name) return null;

  const body = raw.slice(fmMatch[0].length).trim();
  return {
    frontmatter: { name: frontmatter.name, description: frontmatter.description || '' },
    body,
  };
}

// ── GitHub URL 解析 ──

/** 从 GitHub URL 提取 owner/repo 和分支信息 */
export function parseGitHubUrl(url: string): { owner: string; repo: string; branch: string; skillName: string } | null {
  // 支持格式:
  //   https://github.com/jakubkrehel/oklch-skill
  //   https://github.com/jakubkrehel/oklch-skill/tree/main/skills/oklch-skill
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+)\/skills\/([^/]+))?/);
  if (!match) return null;
  const [, owner, repo, branch, skillName] = match;
  // 清理 .git 后缀
  const cleanRepo = repo.replace(/\.git$/, '');
  return {
    owner,
    repo: cleanRepo,
    branch: branch || 'main',
    skillName: skillName || cleanRepo,
  };
}

// ── 从 GitHub 加载 Skill ──

export async function fetchSkillFromGitHub(githubUrl: string): Promise<{
  skillMd: string;
  files: SkillFile[];
}> {
  const info = parseGitHubUrl(githubUrl);
  if (!info) throw new Error(`无法解析 GitHub URL: ${githubUrl}`);

  const base = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}`;
  const skillDir = `skills/${info.skillName}`;

  // 1. 拉取 SKILL.md
  const skillMdUrl = `${base}/${skillDir}/SKILL.md`;
  const skillMdResp = await fetch(skillMdUrl);
  if (!skillMdResp.ok) throw new Error(`无法获取 SKILL.md: HTTP ${skillMdResp.status}`);
  const skillMd = await skillMdResp.text();

  // 2. 尝试通过 GitHub API 获取 skills 目录文件列表
  const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${encodeURIComponent(skillDir)}?ref=${info.branch}`;
  let fileList: { name: string; download_url: string }[] = [];
  try {
    const apiResp = await fetch(apiUrl);
    if (apiResp.ok) {
      const entries = await apiResp.json() as Array<{ name: string; download_url: string; type: string }>;
      fileList = entries
        .filter((e) => e.type === 'file' && e.name !== 'SKILL.md' && e.name.endsWith('.md'))
        .map((e) => ({ name: e.name, download_url: e.download_url }));
    }
  } catch {
    // GitHub API 可能限流，降级：尝试常见 reference 文件名
    fileList = [];
  }

  // 3. 如果 API 不可用，尝试从 skillMd 中解析引用链接
  const files: SkillFile[] = [];
  if (fileList.length === 0) {
    // 从 SKILL.md body 中提取 [xxx](filename.md) 引用
    const refRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
    const refs = new Set<string>();
    let m;
    while ((m = refRe.exec(skillMd)) !== null) {
      const refPath = m[2];
      if (!refPath.startsWith('http') && !refs.has(refPath)) {
        refs.add(refPath);
      }
    }
    for (const ref of refs) {
      try {
        const refUrl = `${base}/${skillDir}/${ref}`;
        const refResp = await fetch(refUrl);
        if (refResp.ok) {
          files.push({ path: `references/${ref}`, content: await refResp.text() });
        }
      } catch { /* skip unreachable refs */ }
    }
  } else {
    // 用 API 返回的文件列表
    for (const f of fileList) {
      try {
        const refResp = await fetch(f.download_url);
        if (refResp.ok) {
          files.push({ path: `references/${f.name}`, content: await refResp.text() });
        }
      } catch { /* skip */ }
    }
  }

  return { skillMd, files };
}

// ── 完整加载（解析 + 组装） ──

export async function loadSkillFromGitHub(githubUrl: string): Promise<Omit<Skill, 'id' | 'enabled' | 'createdAt' | 'updatedAt'>> {
  const { skillMd, files } = await fetchSkillFromGitHub(githubUrl);
  const parsed = parseSkillMd(skillMd);
  if (!parsed) throw new Error('SKILL.md 格式无效：缺少 frontmatter 或 name 字段');

  return {
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
    body: parsed.body,
    files,
    source: githubUrl,
  };
}

// ── 本地文件加载 ──

/** 从本地 SKILL.md 文本和引用文件列表组装 Skill */
export function loadSkillFromLocal(
  skillMd: string,
  refFiles: SkillFile[],
  source: string,
): Omit<Skill, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> {
  const parsed = parseSkillMd(skillMd);
  if (!parsed) throw new Error('SKILL.md 格式无效：缺少 frontmatter 或 name 字段');

  return {
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
    body: parsed.body,
    files: refFiles,
    source,
  };
}
