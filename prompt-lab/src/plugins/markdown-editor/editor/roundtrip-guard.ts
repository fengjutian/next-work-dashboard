/**
 * roundtrip-guard — 保护"任何无法证明可安全往返的文档，
 * 不得在可视化模式下静默覆盖原文件"这条底线。
 *
 * 提供两种入口：
 *  1. diffReports(original, current, report) — 用户已经编辑过，
 *     把原文 vs 当前 WYSIWYG 序列化结果做行级 diff，发现新增/丢失。
 *  2. roundtripCheck(originalMarkdown, parsedThenSerializedMarkdown) — 没编辑过，
 *     单纯验证"打开 → 关闭"是否破坏原内容。
 *
 * 输出统一的 RoundtripReport，UI 据此在状态栏显示绿色/黄色/红色徽标。
 */
import type { RoundtripIssue, RoundtripReport, RoundtripSeverity } from '../types';
import { computeTextDiffHunks } from '@/lib/text-diff';

// ── 主入口 ──

/**
 * 简单版往返检查：parse → serialize → 与原文比较。
 * 任何非空行差异都视为 lossy，因为 Tiptap 序列化可能规范化空白。
 */
export function checkRoundtrip(original: string, reSerialized: string): RoundtripReport {
  const checkedAt = Date.now();
  const normalizedOriginal = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedRe = reSerialized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (normalizedOriginal === normalizedRe) {
    return { severity: 'safe', issues: [], diffLines: 0, checkedAt };
  }

  const hunks = computeTextDiffHunks(normalizedOriginal, normalizedRe);
  const issues: RoundtripIssue[] = [];
  let severity: RoundtripSeverity = 'lossy';

  for (const hunk of hunks) {
    const removed = hunk.originalLines;
    const added = hunk.modifiedLines;
    const isWholeLineReplace = removed.length > 0 && added.length > 0 && removed.length === added.length;
    const onlyWhitespace =
      isWholeLineReplace &&
      removed.every((line) => line.trim() === '') &&
      added.every((line) => line.trim() === '');
    if (onlyWhitespace) continue;

    const removedSummary = removed.slice(0, 3).map((line) => line.trim().slice(0, 60)).join(' | ') || '(空)';
    issues.push({
      line: hunk.originalStart + 1,
      message: `行 ${hunk.originalStart + 1} 附近可能丢失：${removedSummary}`,
      severity: removed.some((line) => line.trim().length > 0) ? 'lossy' : 'safe',
    });
  }

  // 如果发现包含 frontmatter/JSX/HTML 标记的整段丢失 → unsafe
  const hasStructuredLoss = issues.some(
    (issue) => /frontmatter|<\w+|\{\{|\[\[|\$\{|\$\$/.test(issue.message) || /^\s*(import|export)\s/m.test(issues.map((i) => i.message).join('\n')),
  );
  if (hasStructuredLoss || issues.length > 20) severity = 'unsafe';

  return {
    severity,
    issues,
    diffLines: hunks.reduce((sum, h) => sum + Math.max(h.originalLines.length, h.modifiedLines.length), 0),
    checkedAt,
  };
}

/**
 * 用户编辑后比较原文件与最新内容。
 * 重点关注是否会覆盖外部新增内容、破坏代码块、删除图片等。
 */
export function diffReports(
  original: string,
  current: string,
  options: { ignoreFrontmatter?: boolean } = {},
): RoundtripReport {
  const checkedAt = Date.now();
  const ignoreFrontmatter = options.ignoreFrontmatter ?? true;

  const a = ignoreFrontmatter ? stripFrontmatter(original) : original;
  const b = ignoreFrontmatter ? stripFrontmatter(current) : current;

  return checkRoundtrip(a, b);
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
}

// ── 编辑安全提示（用于工具栏 tooltip / 状态栏） ──

export function describeRoundtrip(report: RoundtripReport): string {
  switch (report.severity) {
    case 'safe':
      return '往返安全';
    case 'lossy':
      return `轻微差异：${report.issues.length} 处`;
    case 'unsafe':
      return `可能丢失内容：${report.issues.length} 处，建议改用源码模式`;
  }
}
