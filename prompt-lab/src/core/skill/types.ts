// ── Skill 类型定义 ──

export interface SkillFile {
  /** skill 内相对路径，如 "references/color-conversion.md" */
  path: string;
  content: string;
}

export interface Skill {
  id: string;
  /** SKILL.md frontmatter name（唯一标识） */
  name: string;
  /** SKILL.md frontmatter description（触发描述） */
  description: string;
  /** SKILL.md body（去掉 frontmatter 后的 markdown） */
  body: string;
  /** 引用文件列表 */
  files: SkillFile[];
  /** 来源：github URL 或本地路径 */
  source: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 构建注入到 system prompt 的技能内容 */
export function buildSkillPrompt(skill: Skill): string {
  const refs = skill.files
    .map((f) => f.content)
    .join('\n\n');
  return [skill.body, refs].filter(Boolean).join('\n\n');
}

/** SKILL.md frontmatter 解析结果 */
export interface SkillFrontmatter {
  name: string;
  description: string;
}
