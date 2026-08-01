import { describe, expect, it } from 'vitest';
import { redactGitSecrets } from '../src/main/git-security';

describe('Git 输出脱敏', () => {
  it('隐藏 HTTPS remote URL 中的用户名、密码和 token', () => {
    const output = 'origin\thttps://user:secret@example.com/org/repo.git (fetch)\nhttps://token@example.com/repo';
    expect(redactGitSecrets(output)).toBe(
      'origin\thttps://[REDACTED]@example.com/org/repo.git (fetch)\nhttps://[REDACTED]@example.com/repo',
    );
  });

  it('隐藏查询参数和 Authorization 头中的敏感值', () => {
    const output = 'https://example.com/repo?access_token=abc123&x=1\nAuthorization: Bearer top-secret';
    const redacted = redactGitSecrets(output);
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('top-secret');
    expect(redacted).toContain('access_token=[REDACTED]');
    expect(redacted).toContain('Bearer [REDACTED]');
  });

  it('不改变普通 Git 错误信息', () => {
    expect(redactGitSecrets('fatal: not a git repository')).toBe('fatal: not a git repository');
  });
});
