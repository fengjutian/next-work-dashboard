import { describe, expect, it } from 'vitest';
import { EDITORIAL_PRESETS, assessNarrative, assessPacing, atomizeClaims, buildAIConstraintBlock, buildBookIndex, buildChapterHeatmap, buildEvidenceReverseIndex, buildFootnotes, buildMergeSuggestions, buildPublicationReadiness, calibrateAssertionStrength, checkQuoteAgainstSource, classifyContent, compareDocumentVersions, compareFactLocks, compareQualitySnapshots, createBackupManifest, evaluateExportGate, extractFactLock, extractTimelineEvents, findAffectedChapters, findDependentSources, findEntityConflicts, findEvidenceGaps, findNumericDisagreements, findPresenceConflicts, findSemanticDuplicates, findTimelineConflicts, formatCitation, generateChapterTransition, layoutRelationshipGraph, locateQuoteContext, renderControversySection, renderPrintHtml, runProfessionalRules, suggestEvidenceBasedRewrites, validateHistoricalTerms } from '../src/plugins/outline-scaffolder/editorial-analysis';

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

  it('formats citations and inserts deduplicated footnotes', () => {
    const source = { id: 'e1', title: '史记·秦始皇本纪', author: '司马迁', year: '前1世纪', url: 'https://example.com', quote: '分天下以为三十六郡' };
    expect(formatCitation(source, 'gb-t-7714')).toContain('司马迁');
    const result = buildFootnotes('材料称“分天下以为三十六郡”。', [source], 'chicago-notes');
    expect(result.content).toContain('[^1]');
    expect(result.notes).toHaveLength(1);
  });

  it('builds reverse evidence usage and detects dependent sources', () => {
    const usage = buildEvidenceReverseIndex([{ id: 'e1', title: '材料', chapter: 'a.md', anchor: { quote: '引文' } }], [{ id: 'c1', chapter: 'b.md', evidenceIds: ['e1'] }]);
    expect(usage[0].chapters).toEqual(['a.md', 'b.md']);
    const clusters = findDependentSources([{ id: 'e1', title: '甲', url: 'https://example.com/a?x=1', source: '甲' }, { id: 'e2', title: '乙', url: 'https://example.com/a', source: '乙' }]);
    expect(clusters).toHaveLength(1);
  });

  it('shows quote context and classifies reconstruction versus interpretation', () => {
    expect(locateQuoteContext('统一文字', '此前争论很多，最终决定统一文字，随后推行。').found).toBe(true);
    const layers = classifyContent('a.md', '或许他在夜里作出了决定。这意味着政策发生转向。相传天降异象。');
    expect(layers.map((item) => item.layer)).toEqual(['reconstruction', 'interpretation', 'literary']);
  });

  it('detects impossible same-year person presences', () => {
    const issues = findPresenceConflicts([{ person: '张三', year: 100, place: '咸阳', chapter: 'a.md', excerpt: '甲' }, { person: '张三', year: 100, place: '临淄', chapter: 'b.md', excerpt: '乙' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('blocker');
  });

  it('checks historical term ranges and numeric disagreements', () => {
    const issues = validateHistoricalTerms([{ chapter: 'a.md', content: '公元前221年，朝廷设置刺史。' }], [{ term: '刺史', fromYear: -106 }]);
    expect(issues).toHaveLength(1);
    const disagreements = findNumericDisagreements([{ id: 'a', chapter: 'a.md', topic: '军队', value: 10, unit: '万', expression: '十万', evidenceIds: [] }, { id: 'b', chapter: 'b.md', topic: '军队', value: 20, unit: '万', expression: '二十万', evidenceIds: [] }]);
    expect(disagreements[0].spread).toBe(10);
  });

  it('assesses pacing and question resolution', () => {
    const result = assessPacing('a.md', '## 开端\n\n秦为何突然改变政策？\n\n秦王下令召见群臣，双方发生争论。\n\n最终，这次政策改变回应了秦为何改变政策的问题。');
    expect(result.openingQuestion).toContain('为何');
    expect(result.resolved).toBe(true);
  });

  it('lays out relationship graphs and chapter heat scores', () => {
    const graph = layoutRelationshipGraph([{ id: 'r', from: '甲', to: '乙', kind: 'conflict', evidenceIds: [], notes: '' }]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges[0].label).toBe('conflict');
    const heat = buildChapterHeatmap(['a.md'], { issues: [{ id: 'i', kind: 'timeline', severity: 'blocker', chapters: ['a.md'], message: 'x', excerpts: [] }], gaps: [], narratives: { 'a.md': { score: 80, sceneSignals: 1, actionSignals: 1, conflictSignals: 1, transitionSignals: 1, abstractSignals: 0, issues: [] } }, duplicates: [] });
    expect(heat[0].level).toBe('blocked');
  });

  it('finds affected chapters and quality regressions', () => {
    const affected = findAffectedChapters('a.md', [{ chapter: 'b.md', evidenceIds: ['e1'] }], [{ id: 'e1', chapter: 'a.md' }], [], [], {});
    expect(affected).toEqual(['a.md', 'b.md']);
    const regression = compareQualitySnapshots({ id: 'a', createdAt: 1, readiness: 80, evidenceCoverage: 70, blockers: 1, narrativeScore: 75 }, { id: 'b', createdAt: 2, readiness: 70, evidenceCoverage: 75, blockers: 2, narrativeScore: 75 });
    expect(regression.filter((item) => item.regressed).map((item) => item.metric)).toEqual(['readiness', 'blockers']);
  });

  it('generates transitions and calibrated rewrite suggestions', () => {
    const transition = generateChapterTransition('旧章', '# 旧章\n\n旧制度遇到阻力。', '新章', '# 新章\n\n改革者开始调整政策。');
    expect(transition).toContain('旧制度遇到阻力');
    expect(calibrateAssertionStrength('这一制度彻底消除了矛盾。')[0].replacement).toBe('在相当程度上');
    expect(suggestEvidenceBasedRewrites('这场改革意义重大，影响深远。')).toHaveLength(1);
  });

  it('renders controversies, merge plans and book index entries', () => {
    expect(renderControversySection({ topic: '争议', positions: [{ label: '甲说', argument: '依据甲材料' }], adoptedPosition: '甲说', rationale: '材料较早' })).toContain('本书判断');
    expect(buildMergeSuggestions([{ leftChapter: 'a.md', rightChapter: 'b.md', leftText: '甲', rightText: '乙', similarity: 0.95 }])[0].recommendation).toContain('回指');
    const index = buildBookIndex([{ chapter: 'a.md', content: '秦始皇统一。秦始皇巡行。' }], [{ name: '嬴政', canonical: '秦始皇', kind: 'person', aliases: '始皇帝' }]);
    expect(index[0]).toMatchObject({ term: '秦始皇', mentions: 2 });
  });

  it('builds AI constraints and enforces template export gates', () => {
    const block = buildAIConstraintBlock({ lock: { dates: ['前221年'], numbers: ['36郡'], names: ['秦始皇'], quotes: ['统一文字'] }, canonicalTerms: [{ name: '嬴政', canonical: '秦始皇' }], controversies: [], forbidden: ['虚构心理'] });
    expect(block).toContain('不得新增、删除或改写');
    const gate = evaluateExportGate({ readiness: { score: 100, blockers: [], warnings: [], metrics: {} }, approvals: [], preset: EDITORIAL_PRESETS['academic-history'], evidenceCoverage: 100, narrativeScore: 80 });
    expect(gate.allowed).toBe(false);
    expect(gate.blockers.length).toBe(5);
  });

  it('creates verifiable backup manifests and printable HTML', () => {
    const manifest = createBackupManifest([{ path: 'a.md', content: '正文' }]);
    expect(manifest[0].checksum).toMatch(/^[0-9a-f]{8}$/);
    const html = renderPrintHtml('书名', [{ title: '第一章', content: '## 第一节\n\n正文' }], ['参考资料'], { author: '作者', version: 'v1' });
    expect(html).toContain('@page');
    expect(html).toContain('第一章');
  });
});
