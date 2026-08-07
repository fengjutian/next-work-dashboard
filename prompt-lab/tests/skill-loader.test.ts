import { describe, expect, it } from 'vitest';
import { parseGitHubUrl } from '../src/core/skill/loader';

describe('GitHub skill URL parsing', () => {
  it('does not truncate repository names', () => {
    expect(parseGitHubUrl('https://github.com/Leonxlnx/taste-skill')).toEqual({
      owner: 'Leonxlnx', repo: 'taste-skill', branch: 'main',
    });
  });

  it('supports repository subdirectories', () => {
    expect(parseGitHubUrl('https://github.com/acme/skills/tree/dev/skills/writer')).toEqual({
      owner: 'acme', repo: 'skills', branch: 'dev', skillDir: 'skills/writer',
    });
  });

  it('supports direct raw SKILL.md URLs', () => {
    expect(parseGitHubUrl('https://raw.githubusercontent.com/acme/skills/main/skills/writer/SKILL.md')).toEqual({
      owner: 'acme', repo: 'skills', branch: 'main', skillDir: 'skills/writer',
    });
  });
});
