import type { KnowledgeDiagnostic, KnowledgeHealthMetric, KnowledgeHealthReport, KnowledgeIndex } from './types';

function metric(key: KnowledgeHealthMetric['key'], label: string, count: number, penalty: number): KnowledgeHealthMetric {
  return { key, label, count, penalty: Math.max(0, Math.round(penalty)) };
}

/** Produces a deterministic, explainable health score from index and validation results. */
export function evaluateKnowledgeHealth(index: KnowledgeIndex, diagnostics: KnowledgeDiagnostic[]): KnowledgeHealthReport {
  const sourceCodes = new Set(['SOURCE_STALE', 'SOURCE_MISSING', 'SOURCE_OUTSIDE_WORKSPACE', 'SOURCE_NOT_TRACKED']);
  const errors = diagnostics.filter((item) => item.severity === 'error' && !sourceCodes.has(item.code)).length;
  const staleSources = diagnostics.filter((item) => item.code === 'SOURCE_STALE').length;
  const missingSources = diagnostics.filter((item) => item.code === 'SOURCE_MISSING' || item.code === 'SOURCE_OUTSIDE_WORKSPACE').length;
  const untrackedSources = diagnostics.filter((item) => item.code === 'SOURCE_NOT_TRACKED').length;
  const warnings = diagnostics.filter((item) => item.severity === 'warning' && !sourceCodes.has(item.code)).length;
  const unresolvedLinks = index.links.filter((item) => item.status === 'unresolved').length;
  const ambiguousLinks = index.links.filter((item) => item.status === 'ambiguous').length;
  const orphanDocuments = index.orphanUris.length;
  const orphanRatio = index.documents.length ? orphanDocuments / index.documents.length : 0;

  const metrics = [
    metric('errors', '规则错误', errors, Math.min(32, errors * 8)),
    metric('staleSources', '过期来源', staleSources, Math.min(30, staleSources * 6)),
    metric('missingSources', '缺失或越界来源', missingSources, Math.min(30, missingSources * 6)),
    metric('untrackedSources', '未建立基线来源', untrackedSources, Math.min(12, untrackedSources * 2)),
    metric('warnings', '规则警告', warnings, Math.min(15, warnings * 3)),
    metric('unresolvedLinks', '未解析链接', unresolvedLinks, Math.min(20, unresolvedLinks * 4)),
    metric('ambiguousLinks', '歧义链接', ambiguousLinks, Math.min(15, ambiguousLinks * 3)),
    metric('orphanDocuments', '孤立文档', orphanDocuments, Math.min(10, orphanRatio * 10)),
  ];
  const score = Math.max(0, 100 - metrics.reduce((sum, item) => sum + item.penalty, 0));
  return {
    score,
    grade: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
    metrics,
    issueCount: metrics.reduce((sum, item) => sum + item.count, 0),
  };
}
