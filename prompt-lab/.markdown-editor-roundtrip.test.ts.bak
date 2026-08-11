/**
 * roundtrip-guard 单元测试。
 *
 * 覆盖：
 *  1. 相同内容 → safe
 *  2. 空白行差异 → safe
 *  3. 删除一整段 → lossy / unsafe
 *  4. diffReports 忽略 frontmatter 差异
 */
import { describe, expect, it } from 'vitest';
import { checkRoundtrip, diffReports, describeRoundtrip } from '../src/plugins/markdown-editor/editor/roundtrip-guard';

describe('checkRoundtrip', () => {
  it('returns safe for identical content', () => {
    const report = checkRoundtrip('# A\n\nB', '# A\n\nB');
    expect(report.severity).toBe('safe');
    expect(report.issues).toHaveLength(0);
  });

  it('ignores pure whitespace-only line replacement', () => {
    const report = checkRoundtrip('# A\n  \nB', '# A\n\nB');
    expect(report.severity).toBe('safe');
  });

  it('flags removed non-empty lines as lossy', () => {
    const original = '# A\n\nB\n\nC';
    const reSerialized = '# A\n\nC';
    const report = checkRoundtrip(original, reSerialized);
    expect(report.severity === 'lossy' || report.severity === 'unsafe').toBe(true);
    expect(report.issues.length).toBeGreaterThan(0);
  });
});

describe('diffReports', () => {
  it('ignores differences in frontmatter', () => {
    const original = '---\ntitle: Old\n---\n# Body';
    const current = '---\ntitle: New\n---\n# Body';
    const report = diffReports(original, current, { ignoreFrontmatter: true });
    expect(report.severity).toBe('safe');
  });

  it('detects body content changes', () => {
    const original = '# A\n\nB';
    const current = '# A\n\nB changed';
    const report = diffReports(original, current, { ignoreFrontmatter: true });
    expect(report.severity === 'lossy' || report.severity === 'unsafe').toBe(true);
  });
});

describe('describeRoundtrip', () => {
  it('produces a Chinese label for each severity', () => {
    expect(describeRoundtrip({ severity: 'safe', issues: [], diffLines: 0, checkedAt: 0 })).toBe('往返安全');
    expect(describeRoundtrip({ severity: 'lossy', issues: [], diffLines: 1, checkedAt: 0 })).toContain('差异');
    expect(describeRoundtrip({ severity: 'unsafe', issues: [], diffLines: 1, checkedAt: 0 })).toContain('丢失');
  });
});
