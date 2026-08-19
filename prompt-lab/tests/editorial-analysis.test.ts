import { describe, expect, it } from 'vitest';
import { assessNarrative, atomizeClaims, buildPublicationReadiness, checkQuoteAgainstSource, compareDocumentVersions, compareFactLocks, extractFactLock, extractTimelineEvents, findEntityConflicts, findEvidenceGaps, findSemanticDuplicates, findTimelineConflicts, runProfessionalRules } from '../src/plugins/outline-scaffolder/editorial-analysis';

describe('editorial analysis', () => {
  it('normalizes BCE dates and detects conflicting event dates', () => {
    const events = [
      ...extractTimelineEvents('第一章', '公元前221年，秦完成统一。'),
      ...extractTimelineEvents('第二章', '公元前220年，秦完成统一。'),
    ];
    expect(events.map((event) => event.normalizedYear)).toEqual([-221, -220]);
    expect(findTimelineConflicts(events)).toHaveLength(1);
  });

  it('finds canonical entity naming conflicts across chapters', () => {
    const issues = findEntityConflicts([
      { chapter: '一', content: '秦始皇下诏。' },
      { chapter: '二', content: '嬴政继续巡行。' },
    ], [{ kind: '人物', canonical: '秦始皇', aliases: ['嬴政'] }]);
    expect(issues[0].message).toContain('秦始皇');
  });

  it('detects near-duplicate paragraphs across chapters', () => {
    const paragraph = '郡县官员由中央任免，行政命令沿着文书与交通体系传递到地方，地方长官不能把职位世袭给家族成员。';
    const duplicates = findSemanticDuplicates([
      { chapter: '一', content: paragraph },
      { chapter: '二', content: `${paragraph}这一制度仍受到交通条件限制。` },
    ], 0.6);
    expect(duplicates[0].similarity).toBeGreaterThan(0.6);
  });

  it('checks quotations against normalized source excerpts', () => {
    expect(checkQuoteAgainstSource('人善其所私学', '李斯认为：“人善其所私学，以非上之所建立。”').exact).toBe(true);
    expect(checkQuoteAgainstSource('不存在的原句', '另一段材料').exact).toBe(false);
  });

  it('runs selectable professional rule packs', () => {
    expect(runProfessionalRules('该治疗保证治愈，绝无副作用。', ['medicine'])).toHaveLength(2);
    expect(runProfessionalRules('系统完全兼容所有环境。', ['technology'])[0].kind).toBe('professional');
  });

  it('compares arbitrary document versions line by line', () => {
    const result = compareDocumentVersions('# 标题\n共同段落\n旧段落', '# 标题\n共同段落\n新段落');
    expect(result.unchanged).toBe(2);
    expect(result.removed).toEqual(['旧段落']);
    expect(result.added).toEqual(['新段落']);
    expect(result.similarity).toBeCloseTo(2 / 3);
  });

  it('atomizes compound factual claims', () => {
    const claims = atomizeClaims('01.md', '公元前221年秦完成统一，因此郡县制被推向全国。李斯随后提出新的制度安排。');
    expect(claims.some((claim) => claim.type === 'date')).toBe(true);
    expect(claims.some((claim) => claim.type === 'causal')).toBe(true);
  });

  it('maps missing, weak and contradictory evidence gaps', () => {
    const gaps = findEvidenceGaps([
      { id: 'a', chapter: 'a.md', text: '无来源', evidenceIds: [] },
      { id: 'b', chapter: 'b.md', text: '弱来源', evidenceIds: ['e1'], evidenceStrengths: { e1: 'contextual' } },
      { id: 'c', chapter: 'c.md', text: '反证', evidenceIds: ['e2'], evidenceStrengths: { e2: 'contradictory' } },
    ], ['e1', 'e2']);
    expect(gaps.map((gap) => gap.kind)).toEqual(['missing', 'weak', 'contradictory']);
  });

  it('scores narrative signals and flags abstractions and causal leaps', () => {
    const result = assessNarrative('a.md', '朝堂上双方发生争论。然而，这一决定意义重大，因此必然造成帝国崩溃。');
    expect(result.conflictSignals).toBeGreaterThan(0);
    expect(result.abstractSignals).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.id.startsWith('causal:'))).toBe(true);
  });

  it('locks dates, quantities, names and quotations before rewriting', () => {
    const before = extractFactLock('公元前221年，秦始皇下令：“统一文字”，涉及三十六郡。', ['秦始皇']);
    const after = extractFactLock('公元前220年，秦始皇下令：“统一文字”，涉及40郡。', ['秦始皇']);
    const violations = compareFactLocks(before, after);
    expect(violations.find((item) => item.kind === 'dates')?.removed).toContain('公元前221年');
    expect(violations.find((item) => item.kind === 'numbers')?.added).toContain('40郡');
  });

  it('builds a publication readiness gate', () => {
    const report = buildPublicationReadiness({ chapters: 3, unresolvedBlockers: 1, evidenceGaps: [{ claimId: 'a', chapter: 'a.md', claim: 'x', kind: 'missing', message: 'missing' }], controversyCount: 1, approvedRoles: 3, requiredRoles: 5, averageNarrativeScore: 55 });
    expect(report.blockers).toHaveLength(3);
    expect(report.score).toBeLessThan(100);
  });
});
