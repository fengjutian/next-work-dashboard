export type SourceLevel = 'primary' | 'near-contemporary' | 'later-history' | 'archaeology' | 'modern-research' | 'search-clue';
export type SupportStrength = 'direct' | 'indirect' | 'contextual' | 'insufficient' | 'contradictory';
export type ProfessionalRulePackId = 'history' | 'law' | 'medicine' | 'finance' | 'technology' | 'general';
export type EditorialRole = 'author' | 'editor' | 'fact-checker' | 'subject-reviewer' | 'final-reviewer';

export interface TimelineEvent { id: string; chapter: string; expression: string; normalizedYear?: number; context: string; start: number }
export interface AnalysisIssue { id: string; kind: 'timeline' | 'entity' | 'semantic-duplicate' | 'quote' | 'professional'; severity: 'blocker' | 'warning'; chapters: string[]; message: string; excerpts: string[] }
export interface EntityRule { kind: string; canonical: string; aliases: string[]; notes?: string }
export interface SemanticDuplicate { leftChapter: string; rightChapter: string; leftText: string; rightText: string; similarity: number }
export interface QuoteCheck { quote: string; sourceExcerpt: string; exact: boolean; similarity: number; message: string }
export interface ProfessionalRule { id: string; label: string; pattern: RegExp; message: string; severity: 'blocker' | 'warning' }
export interface VersionComparison { unchanged: number; added: string[]; removed: string[]; similarity: number }
export interface AtomicClaim { id: string; text: string; sourceSentence: string; type: 'date' | 'number' | 'quote' | 'person-action' | 'causal' | 'general' }
export interface EvidenceGap { claimId: string; chapter: string; claim: string; kind: 'missing' | 'weak' | 'single-source' | 'contradictory'; message: string }
export interface NarrativeAssessment { score: number; sceneSignals: number; actionSignals: number; conflictSignals: number; transitionSignals: number; abstractSignals: number; issues: AnalysisIssue[] }
export interface FactLock { dates: string[]; numbers: string[]; names: string[]; quotes: string[] }
export interface FactLockViolation { kind: keyof FactLock; removed: string[]; added: string[] }
export interface PublicationReadiness { score: number; blockers: string[]; warnings: string[]; metrics: Record<string, number> }
export type CitationStyle = 'gb-t-7714' | 'chicago-notes' | 'mla' | 'apa';
export type CertaintyLevel = 'certain' | 'probable' | 'inferred' | 'legendary';
export type ContentLayer = 'documented' | 'reconstruction' | 'interpretation' | 'literary';
export interface CitationInput { id: string; title: string; author?: string; publisher?: string; year?: string; url?: string; accessedAt?: number; source?: string }
export interface EvidenceUsage { evidenceId: string; title: string; chapters: string[]; claimIds: string[]; quotes: string[] }
export interface SourceCluster { key: string; evidenceIds: string[]; titles: string[]; warning: string }
export interface QuoteContext { found: boolean; before: string; quote: string; after: string; message: string }
export interface ContentClassification { id: string; chapter: string; text: string; layer: ContentLayer; certainty: CertaintyLevel; reason: string }
export interface PersonRelation { id: string; from: string; to: string; kind: 'kinship' | 'official' | 'alliance' | 'conflict' | 'teacher' | 'appointment'; fromYear?: number; toYear?: number; evidenceIds: string[]; notes: string }
export interface PersonPresence { person: string; year: number; place: string; chapter: string; excerpt: string }
export interface PlaceMapping { id: string; historicalName: string; modernName: string; jurisdiction: string; fromYear?: number; toYear?: number; latitude?: number; longitude?: number; evidenceIds: string[] }
export interface NumericClaim { id: string; chapter: string; topic: string; value: number; unit: string; expression: string; evidenceIds: string[] }
export interface PacingAssessment { chapter: string; score: number; expositionRatio: number; paragraphLengths: number[]; openingQuestion: string; resolved: boolean; issues: string[] }
export interface QualitySnapshot { id: string; createdAt: number; readiness: number; evidenceCoverage: number; blockers: number; narrativeScore: number }
export interface GraphNode { id: string; label: string; kind: string; x: number; y: number }
export interface GraphEdge { id: string; from: string; to: string; label: string; kind: string }
export interface ChapterHeat { chapter: string; score: number; level: 'good' | 'watch' | 'risk' | 'blocked'; blockers: number; gaps: number; narrative: number; duplicates: number }
export interface QualityRegression { metric: keyof Pick<QualitySnapshot, 'readiness' | 'evidenceCoverage' | 'blockers' | 'narrativeScore'>; before: number; after: number; delta: number; regressed: boolean }
export interface RewriteSuggestion { id: string; original: string; replacement: string; reason: string; start: number; end: number }
export interface MergeSuggestion { sourceChapter: string; targetChapter: string; similarity: number; sourceText: string; targetText: string; recommendation: string }
export interface IndexEntry { term: string; kind: string; chapters: string[]; mentions: number }

export function generateChapterTransition(previousTitle: string, previousContent: string, nextTitle: string, nextContent: string): string {
  const clean = (value: string) => value.replace(/^#{1,6}\s+.*$/gm, '').replace(/<!--[^]*?-->/g, '').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const previousPoint = clean(previousContent).slice(-1)[0]?.replace(/\s+/g, ' ').slice(0, 120) ?? '';
  const nextPoint = clean(nextContent)[0]?.replace(/\s+/g, ' ').slice(0, 120) ?? '';
  return `在“${previousTitle}”中，${previousPoint.replace(/[。！？]+$/, '')}。这一变化并未结束相关问题，而是把讨论推向“${nextTitle}”：${nextPoint.replace(/[。！？]+$/, '')}。`;
}

export function calibrateAssertionStrength(content: string, weakClaims: string[] = []): RewriteSuggestion[] {
  const replacements: Record<string, string> = { 彻底: '在相当程度上', 唯一: '主要', 必然: '可能', 完全: '较大程度上', 从根本上: '在制度层面', 首次: '较早', 所有人: '许多人', 无一例外: '大多' };
  const suggestions: RewriteSuggestion[] = [];
  for (const match of content.matchAll(/彻底|唯一|必然|完全|从根本上|首次|所有人|无一例外/g)) {
    const sentence = sentenceAt(content, match.index ?? 0);
    if (weakClaims.length && !weakClaims.some((claim) => sentence.includes(claim) || claim.includes(sentence.slice(0, 24)))) continue;
    suggestions.push({ id: `strength:${match.index}`, original: match[0], replacement: replacements[match[0]], reason: '证据不足以支持绝对化论断，建议降低结论强度或补充直接证据', start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return suggestions;
}

export function suggestEvidenceBasedRewrites(content: string): RewriteSuggestion[] {
  const suggestions: RewriteSuggestion[] = [];
  for (const match of content.matchAll(/[^。！？\n]{0,80}(?:意义重大|影响深远|奠定了基础|引发强烈不满|造成深远影响|留下致命暗伤|形成深深裂痕)[^。！？\n]{0,80}[。！？]?/g)) {
    suggestions.push({ id: `evidence-rewrite:${match.index}`, original: match[0], replacement: '请改写为：具体人物或机构采取了什么行动；发生于何时何地；哪条材料能够证明；产生了什么可观察后果。', reason: '该段主要给出评价，没有提供可核验的信息链', start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return suggestions;
}

export function renderControversySection(card: { topic: string; positions: Array<{ label: string; argument: string }>; adoptedPosition: string; rationale: string }): string {
  const positions = card.positions.filter((item) => item.argument.trim()).map((item) => `- **${item.label}**：${item.argument.trim()}`).join('\n');
  return `### ${card.topic}\n\n${positions || '- 尚未录入有效观点'}\n\n**本书判断**：${card.adoptedPosition || '暂不裁断'}。${card.rationale ? `\n\n**判断依据与保留意见**：${card.rationale}` : ''}`;
}

export function buildMergeSuggestions(duplicates: SemanticDuplicate[]): MergeSuggestion[] {
  return duplicates.map((item) => ({ sourceChapter: item.rightChapter, targetChapter: item.leftChapter, similarity: item.similarity, sourceText: item.rightText, targetText: item.leftText, recommendation: item.similarity >= 0.9 ? '保留信息和证据更完整的一处，另一处改为简短回指' : '拆分共同背景与章节独有分析，避免两章重复展开' }));
}

export function buildBookIndex(documents: Array<{ chapter: string; content: string }>, terms: Array<{ name: string; canonical: string; kind: string; aliases?: string }>): IndexEntry[] {
  return terms.map((term) => {
    const variants = [term.canonical, term.name, ...(term.aliases?.split(/[、，,;；\n]+/) ?? [])].map((item) => item.trim()).filter(Boolean);
    const chapterCounts = documents.map((document) => ({ chapter: document.chapter, count: variants.reduce((sum, variant) => sum + (document.content.split(variant).length - 1), 0) })).filter((item) => item.count > 0);
    return { term: term.canonical || term.name, kind: term.kind, chapters: chapterCounts.map((item) => item.chapter), mentions: chapterCounts.reduce((sum, item) => sum + item.count, 0) };
  }).filter((item) => item.mentions > 0).sort((a, b) => b.mentions - a.mentions || a.term.localeCompare(b.term, 'zh-CN'));
}

export function layoutRelationshipGraph(relations: PersonRelation[], width = 720, height = 420): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const names = [...new Set(relations.flatMap((item) => [item.from, item.to]).filter(Boolean))];
  const radius = Math.max(80, Math.min(width, height) / 2 - 50);
  const nodes = names.map((label, index) => ({ id: label, label, kind: 'person', x: width / 2 + Math.cos((index / Math.max(1, names.length)) * Math.PI * 2 - Math.PI / 2) * radius, y: height / 2 + Math.sin((index / Math.max(1, names.length)) * Math.PI * 2 - Math.PI / 2) * radius }));
  const edges = relations.filter((item) => item.from && item.to).map((item) => ({ id: item.id, from: item.from, to: item.to, label: item.kind, kind: item.kind }));
  return { nodes, edges };
}

export function buildChapterHeatmap(chapters: string[], input: { issues: AnalysisIssue[]; gaps: EvidenceGap[]; narratives: Record<string, NarrativeAssessment>; duplicates: SemanticDuplicate[] }): ChapterHeat[] {
  return chapters.map((chapter) => {
    const blockers = input.issues.filter((item) => item.severity === 'blocker' && item.chapters.includes(chapter)).length;
    const gaps = input.gaps.filter((item) => item.chapter === chapter).length;
    const duplicates = input.duplicates.filter((item) => item.leftChapter === chapter || item.rightChapter === chapter).length;
    const narrative = input.narratives[chapter]?.score ?? 0;
    const score = Math.max(0, Math.min(100, narrative - blockers * 20 - gaps * 3 - duplicates * 5));
    return { chapter, score, level: blockers ? 'blocked' : score < 45 ? 'risk' : score < 70 ? 'watch' : 'good', blockers, gaps, narrative, duplicates };
  });
}

export function findAffectedChapters(changedChapter: string, claims: Array<{ chapter: string; evidenceIds: string[] }>, evidence: Array<{ id: string; chapter: string }>, duplicates: SemanticDuplicate[], relations: PersonRelation[], chapterTexts: Record<string, string> = {}): string[] {
  const affected = new Set([changedChapter]);
  const changedEvidence = new Set(evidence.filter((item) => item.chapter === changedChapter).map((item) => item.id));
  claims.filter((claim) => claim.evidenceIds.some((id) => changedEvidence.has(id))).forEach((claim) => affected.add(claim.chapter));
  duplicates.forEach((item) => { if (item.leftChapter === changedChapter) affected.add(item.rightChapter); if (item.rightChapter === changedChapter) affected.add(item.leftChapter); });
  const changedText = chapterTexts[changedChapter] ?? '';
  const relatedPeople = new Set(relations.flatMap((item) => changedText.includes(item.from) || changedText.includes(item.to) ? [item.from, item.to] : []));
  Object.entries(chapterTexts).forEach(([chapter, text]) => { if ([...relatedPeople].some((person) => text.includes(person))) affected.add(chapter); });
  return [...affected];
}

export function compareQualitySnapshots(before: QualitySnapshot, after: QualitySnapshot): QualityRegression[] {
  return (['readiness', 'evidenceCoverage', 'blockers', 'narrativeScore'] as const).map((metric) => {
    const delta = after[metric] - before[metric];
    return { metric, before: before[metric], after: after[metric], delta, regressed: metric === 'blockers' ? delta > 0 : delta < 0 };
  });
}

export function findPresenceConflicts(presences: PersonPresence[]): AnalysisIssue[] {
  const groups = new Map<string, PersonPresence[]>();
  presences.forEach((item) => groups.set(`${item.person}:${item.year}`, [...(groups.get(`${item.person}:${item.year}`) ?? []), item]));
  return [...groups.entries()].flatMap(([key, group]) => {
    const places = [...new Set(group.map((item) => item.place))];
    return places.length > 1 ? [{ id: `presence:${key}`, kind: 'entity' as const, severity: 'blocker' as const, chapters: [...new Set(group.map((item) => item.chapter))], message: `${group[0].person}在${group[0].year}年同时出现在多个地点：${places.join('、')}`, excerpts: group.map((item) => item.excerpt) }] : [];
  });
}

export function validateHistoricalTerms(documents: Array<{ chapter: string; content: string }>, rules: Array<{ term: string; fromYear?: number; toYear?: number; replacement?: string }>): AnalysisIssue[] {
  return documents.flatMap((document) => rules.flatMap((rule) => [...document.content.matchAll(new RegExp(rule.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].flatMap((match) => {
    const context = sentenceAt(document.content, match.index ?? 0);
    const yearMatch = context.match(/(?:公元前\s*)?(\d{1,4})\s*年/);
    if (!yearMatch) return [];
    const year = /公元前/.test(yearMatch[0]) ? -Number(yearMatch[1]) : Number(yearMatch[1]);
    if ((rule.fromYear !== undefined && year < rule.fromYear) || (rule.toYear !== undefined && year > rule.toYear)) return [{ id: `term-era:${document.chapter}:${rule.term}:${match.index}`, kind: 'entity' as const, severity: 'blocker' as const, chapters: [document.chapter], message: `“${rule.term}”不适用于${year}年${rule.replacement ? `，建议核对“${rule.replacement}”` : ''}`, excerpts: [context] }];
    return [];
  })));
}

export function findNumericDisagreements(claims: NumericClaim[]): Array<{ topic: string; unit: string; claims: NumericClaim[]; spread: number }> {
  const groups = new Map<string, NumericClaim[]>();
  claims.forEach((claim) => groups.set(`${claim.topic}:${claim.unit}`, [...(groups.get(`${claim.topic}:${claim.unit}`) ?? []), claim]));
  return [...groups.entries()].flatMap(([key, group]) => {
    const values = [...new Set(group.map((item) => item.value))];
    if (values.length < 2) return [];
    return [{ topic: key.slice(0, key.lastIndexOf(':')), unit: group[0].unit, claims: group, spread: Math.max(...values) - Math.min(...values) }];
  });
}

export function assessPacing(chapter: string, content: string): PacingAssessment {
  const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter((item) => item && !/^#/.test(item));
  const paragraphLengths = paragraphs.map((item) => item.length);
  const exposition = paragraphs.filter((item) => !/[“”]|(?:下令|抵达|回答|拒绝|出发|攻入|争论|逃亡)/.test(item)).reduce((sum, item) => sum + item.length, 0);
  const total = paragraphLengths.reduce((sum, value) => sum + value, 0) || 1;
  const expositionRatio = exposition / total;
  const opening = paragraphs.slice(0, 2).join('');
  const openingQuestion = opening.match(/[^。！？]{4,80}[？?]/)?.[0] ?? '';
  const questionText = openingQuestion.replace(/[？?]/g, '');
  const keywords = Array.from({ length: Math.max(0, questionText.length - 1) }, (_, index) => questionText.slice(index, index + 2)).filter((word) => !/^(为何|如何|什么|是否|能否|何时|何地)$/.test(word));
  const ending = paragraphs.slice(-2).join('');
  const resolved = Boolean(openingQuestion && keywords.some((word) => ending.includes(word)));
  const issues: string[] = [];
  if (expositionRatio > 0.78) issues.push('说明性文字占比过高，缺少人物行动或材料现场');
  if (paragraphLengths.some((length) => length > 600)) issues.push('存在超过 600 字的长段落');
  if (!openingQuestion) issues.push('开头没有建立明确问题或悬念'); else if (!resolved) issues.push('开头问题在结尾缺少回应');
  const score = Math.max(0, Math.min(100, 100 - Math.max(0, expositionRatio - 0.55) * 100 - issues.length * 10));
  return { chapter, score: Math.round(score), expositionRatio, paragraphLengths, openingQuestion, resolved, issues };
}

export function formatCitation(source: CitationInput, style: CitationStyle): string {
  const author = source.author?.trim() || source.source?.trim() || '佚名';
  const title = source.title.trim() || '未题名资料';
  const year = source.year?.trim() || '日期不详';
  const accessed = source.accessedAt ? new Date(source.accessedAt).toISOString().slice(0, 10) : '';
  if (style === 'gb-t-7714') return `${author}. ${title}[EB/OL]. (${year})${source.url ? `[${accessed || '引用日期不详'}]. ${source.url}` : ''}.`;
  if (style === 'chicago-notes') return `${author}, “${title},” ${year}${source.url ? `, accessed ${accessed || 'n.d.'}, ${source.url}` : ''}.`;
  if (style === 'mla') return `${author}. “${title}.” ${source.publisher || source.source || ''}, ${year}.${source.url ? ` ${source.url}. Accessed ${accessed || 'n.d.'}.` : ''}`.replace(/\s+/g, ' ').trim();
  return `${author}. (${year}). ${title}.${source.publisher ? ` ${source.publisher}.` : ''}${source.url ? ` ${source.url}` : ''}`;
}

export function buildFootnotes(content: string, sources: Array<CitationInput & { quote?: string }>, style: CitationStyle): { content: string; notes: string[] } {
  let next = content; const notes: string[] = [];
  sources.forEach((source) => {
    if (!source.quote || !next.includes(source.quote)) return;
    let noteIndex = notes.findIndex((note) => note === formatCitation(source, style));
    if (noteIndex < 0) { notes.push(formatCitation(source, style)); noteIndex = notes.length - 1; }
    const marker = `[^${noteIndex + 1}]`;
    if (!next.includes(`${source.quote}${marker}`)) next = next.replace(source.quote, `${source.quote}${marker}`);
  });
  const body = notes.map((note, index) => `[^${index + 1}]: ${note}`).join('\n');
  return { content: body ? `${next.trimEnd()}\n\n${body}\n` : next, notes };
}

export function buildEvidenceReverseIndex(evidence: Array<{ id: string; title: string; chapter: string; anchor?: { quote: string } }>, claims: Array<{ id: string; chapter: string; evidenceIds: string[] }>): EvidenceUsage[] {
  return evidence.map((item) => ({ evidenceId: item.id, title: item.title, chapters: [...new Set([item.chapter, ...claims.filter((claim) => claim.evidenceIds.includes(item.id)).map((claim) => claim.chapter)].filter(Boolean))], claimIds: claims.filter((claim) => claim.evidenceIds.includes(item.id)).map((claim) => claim.id), quotes: item.anchor?.quote ? [item.anchor.quote] : [] }));
}

export function findDependentSources(sources: Array<{ id: string; title: string; url: string; source: string; notes?: string }>): SourceCluster[] {
  const normalizeUrl = (url: string) => { try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`; } catch { return url.toLowerCase().replace(/[?#].*$/, ''); } };
  const groups = new Map<string, typeof sources>();
  sources.forEach((source) => {
    const cited = source.notes?.match(/(?:转引自|转载自|据)\s*[《“]?([^》”。，;；]{3,60})/)?.[1]?.trim();
    const key = cited ? `citation:${cited}` : `url:${normalizeUrl(source.url)}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  });
  return [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ key, evidenceIds: group.map((item) => item.id), titles: group.map((item) => item.title), warning: `${group.length} 条来源可能并非相互独立，实际指向同一网页或转引材料` }));
}

export function locateQuoteContext(quote: string, sourceExcerpt: string, radius = 100): QuoteContext {
  const index = sourceExcerpt.indexOf(quote);
  if (index < 0) return { found: false, before: '', quote, after: '', message: '原文摘录中未找到完全一致的引文' };
  return { found: true, before: sourceExcerpt.slice(Math.max(0, index - radius), index), quote, after: sourceExcerpt.slice(index + quote.length, index + quote.length + radius), message: '已找到引文，并保留前后文供断章取义检查' };
}

export function classifyContent(chapter: string, content: string): ContentClassification[] {
  return content.split(/(?<=[。！？!?])\s*|\n+/).map((text) => text.trim()).filter((text) => text.length >= 6).map((text, index) => {
    let layer: ContentLayer = 'documented'; let certainty: CertaintyLevel = 'certain'; let reason = '陈述性事实，仍需由证据台账确认';
    if (/传说|相传|据说|后世附会|民间故事/.test(text)) { layer = 'literary'; certainty = 'legendary'; reason = '包含传说或后世附会信号'; }
    else if (/也许|或许|可能|大概|推测|想必|似乎|可以想象/.test(text)) { layer = 'reconstruction'; certainty = 'inferred'; reason = '包含推测或场景复原信号'; }
    else if (/这意味着|可以看出|由此可见|本质上|反映了|表明了/.test(text)) { layer = 'interpretation'; certainty = 'probable'; reason = '属于作者分析或解释'; }
    return { id: `${chapter}:layer:${index}`, chapter, text, layer, certainty, reason };
  });
}

export function atomizeClaims(chapter: string, content: string): AtomicClaim[] {
  const sentences = content.replace(/^#{1,6}\s+.*$/gm, '').split(/(?<=[。！？!?；;])\s*|\n+/).map((item) => item.trim()).filter((item) => item.length >= 8);
  const claims: AtomicClaim[] = [];
  sentences.forEach((sentence, sentenceIndex) => {
    const pieces = sentence.split(/(?:，|,)(?=[^，,]{6,})|(?:并且|而且|同时|因此|因而|从而|但是|然而)/).map((item) => item.trim()).filter((item) => item.length >= 6);
    pieces.forEach((text, pieceIndex) => {
      const type: AtomicClaim['type'] = /公元|前\d+年|\d{3,4}年/.test(text) ? 'date' : /\d+(?:\.\d+)?(?:万|亿|人|军|郡|县|%|％)/.test(text) ? 'number' : /[“”「」『』]/.test(text) ? 'quote' : /因为|由于|导致|使得|因此|从而|根源|原因/.test(text) || (pieceIndex > 0 && /因此|因而|从而|导致|使得/.test(sentence)) ? 'causal' : /[一-龥]{2,6}(?:下令|任命|率领|主张|反对|建立|废除|逃亡|去世|即位)/.test(text) ? 'person-action' : 'general';
      if (type !== 'general' || /(?:是|为|成为|标志|意味着|结束|开始|改变|形成)/.test(text)) claims.push({ id: `${chapter}:${sentenceIndex}:${pieceIndex}`, text, sourceSentence: sentence, type });
    });
  });
  return claims;
}

export function findEvidenceGaps(claims: Array<{ id: string; chapter: string; text: string; evidenceIds: string[]; evidenceStrengths?: Record<string, SupportStrength> }>, verifiedEvidenceIds: Iterable<string>): EvidenceGap[] {
  const verified = new Set(verifiedEvidenceIds);
  const gaps: EvidenceGap[] = [];
  claims.forEach((claim) => {
    const linked = claim.evidenceIds.filter((id) => verified.has(id));
    if (!linked.length) gaps.push({ claimId: claim.id, chapter: claim.chapter, claim: claim.text, kind: 'missing', message: '没有已核实来源' });
    else if (linked.some((id) => claim.evidenceStrengths?.[id] === 'contradictory')) gaps.push({ claimId: claim.id, chapter: claim.chapter, claim: claim.text, kind: 'contradictory', message: '存在与主张相反的证据' });
    else if (linked.every((id) => ['contextual', 'insufficient'].includes(claim.evidenceStrengths?.[id] ?? 'indirect'))) gaps.push({ claimId: claim.id, chapter: claim.chapter, claim: claim.text, kind: 'weak', message: '只有背景性或不足的支持' });
    else if (linked.length === 1) gaps.push({ claimId: claim.id, chapter: claim.chapter, claim: claim.text, kind: 'single-source', message: '重要主张仅有单一来源' });
  });
  return gaps;
}

export function assessNarrative(chapter: string, content: string): NarrativeAssessment {
  const count = (pattern: RegExp) => (content.match(pattern) ?? []).length;
  const sceneSignals = count(/(?:清晨|黄昏|夜里|宫中|城门|军营|朝堂|路上|抵达|来到|走进)/g);
  const actionSignals = count(/(?:下令|出发|抵达|召见|交锋|攻入|撤退|逮捕|写信|回答|拒绝|逃亡)/g);
  const conflictSignals = count(/(?:冲突|反对|争论|危机|困境|压力|抵抗|失败|矛盾|威胁)/g);
  const transitionSignals = count(/(?:然而|但是|不久|次年|与此同时|直到|随后|转折|却)/g);
  const abstractSignals = count(/(?:意义重大|影响深远|奠定了基础|具有重要意义|历史长河|时代洪流|致命暗伤|深深裂痕|必然结果)/g);
  const score = Math.max(0, Math.min(100, 35 + Math.min(20, sceneSignals * 3) + Math.min(20, actionSignals * 2) + Math.min(15, conflictSignals * 3) + Math.min(10, transitionSignals * 2) - Math.min(30, abstractSignals * 5)));
  const issues: AnalysisIssue[] = [];
  if (sceneSignals === 0) issues.push({ id: `narrative:scene:${chapter}`, kind: 'professional', severity: 'warning', chapters: [chapter], message: '缺少可由材料支持的具体场景锚点', excerpts: [] });
  if (actionSignals < 2) issues.push({ id: `narrative:action:${chapter}`, kind: 'professional', severity: 'warning', chapters: [chapter], message: '人物行动过少，叙述主要停留在概括判断', excerpts: [] });
  if (conflictSignals === 0) issues.push({ id: `narrative:conflict:${chapter}`, kind: 'professional', severity: 'warning', chapters: [chapter], message: '缺少问题、阻力或选择，章节推进感较弱', excerpts: [] });
  for (const match of content.matchAll(/(?:显然|无疑|内心|意识到|深知|坚信|暗自|极度不满|感到恐惧)[^。！？\n]{0,60}/g)) issues.push({ id: `narrative:view:${chapter}:${match.index}`, kind: 'professional', severity: 'warning', chapters: [chapter], message: '可能越过材料证据臆测人物心理或使用全知判断', excerpts: [match[0]] });
  for (const match of content.matchAll(/(?:意义重大|影响深远|奠定了基础|具有重要意义|历史长河|时代洪流|致命暗伤|深深裂痕|必然结果)[^。！？\n]{0,80}/g)) issues.push({ id: `narrative:abstract:${chapter}:${match.index}`, kind: 'professional', severity: 'warning', chapters: [chapter], message: '空泛结论需要替换为具体制度、行动、材料或可观察后果', excerpts: [match[0]] });
  for (const match of content.matchAll(/[^。！？\n]{0,80}(?:因为|由于|导致|使得|因此|从而|根源在于|必然造成)[^。！？\n]{0,100}/g)) issues.push({ id: `causal:${chapter}:${match.index}`, kind: 'professional', severity: /必然|唯一|根源/.test(match[0]) ? 'blocker' : 'warning', chapters: [chapter], message: '因果论断需区分时间先后、机制证据和其他可能解释', excerpts: [match[0]] });
  return { score, sceneSignals, actionSignals, conflictSignals, transitionSignals, abstractSignals, issues };
}

export function extractFactLock(content: string, knownNames: string[] = []): FactLock {
  const unique = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort();
  return { dates: unique(content.match(/(?:公元前?\s*)?\d{1,4}\s*年/g) ?? []), numbers: unique(content.match(/\d+(?:\.\d+)?(?:万|亿|人|军|郡|县|里|公里|%|％|余名|余人)/g) ?? []), names: unique(knownNames.filter((name) => name && content.includes(name))), quotes: unique([...content.matchAll(/[“「『]([^”」』]{2,120})[”」』]/g)].map((match) => match[1])) };
}

export function compareFactLocks(before: FactLock, after: FactLock): FactLockViolation[] {
  return (Object.keys(before) as Array<keyof FactLock>).flatMap((kind) => {
    const removed = before[kind].filter((item) => !after[kind].includes(item));
    const added = after[kind].filter((item) => !before[kind].includes(item));
    return removed.length || added.length ? [{ kind, removed, added }] : [];
  });
}

export function buildPublicationReadiness(input: { chapters: number; unresolvedBlockers: number; evidenceGaps: EvidenceGap[]; controversyCount: number; approvedRoles: number; requiredRoles: number; averageNarrativeScore: number }): PublicationReadiness {
  const blockers: string[] = []; const warnings: string[] = [];
  if (input.unresolvedBlockers) blockers.push(`${input.unresolvedBlockers} 项审校阻断尚未解决`);
  const hardGaps = input.evidenceGaps.filter((gap) => gap.kind === 'missing' || gap.kind === 'contradictory').length;
  if (hardGaps) blockers.push(`${hardGaps} 项重要主张缺少来源或存在反证`);
  if (input.approvedRoles < input.requiredRoles) blockers.push(`审校签核仅完成 ${input.approvedRoles}/${input.requiredRoles}`);
  if (input.averageNarrativeScore < 60) warnings.push(`全书平均故事性评分仅 ${Math.round(input.averageNarrativeScore)} 分`);
  const score = Math.max(0, 100 - input.unresolvedBlockers * 8 - hardGaps * 5 - (input.requiredRoles - input.approvedRoles) * 8 - Math.max(0, 60 - input.averageNarrativeScore));
  return { score, blockers, warnings, metrics: { chapters: input.chapters, evidenceGaps: input.evidenceGaps.length, controversies: input.controversyCount, approvedRoles: input.approvedRoles, averageNarrativeScore: Math.round(input.averageNarrativeScore) } };
}

export function compareDocumentVersions(left: string, right: string): VersionComparison {
  const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ');
  const leftLines = left.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const rightLines = right.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const rightCounts = new Map<string, number>();
  rightLines.forEach((line) => rightCounts.set(line, (rightCounts.get(line) ?? 0) + 1));
  let unchanged = 0;
  const removed: string[] = [];
  leftLines.forEach((line) => {
    const count = rightCounts.get(line) ?? 0;
    if (count > 0) { unchanged += 1; rightCounts.set(line, count - 1); } else removed.push(line);
  });
  const leftCounts = new Map<string, number>();
  leftLines.forEach((line) => leftCounts.set(line, (leftCounts.get(line) ?? 0) + 1));
  const added: string[] = [];
  rightLines.forEach((line) => {
    const count = leftCounts.get(line) ?? 0;
    if (count > 0) leftCounts.set(line, count - 1); else added.push(line);
  });
  return { unchanged, added, removed, similarity: leftLines.length + rightLines.length ? (2 * unchanged) / (leftLines.length + rightLines.length) : 1 };
}

const sentenceAt = (content: string, start: number) => {
  const left = Math.max(content.lastIndexOf('。', start - 1), content.lastIndexOf('\n', start - 1));
  const rightStops = [content.indexOf('。', start), content.indexOf('\n', start)].filter((value) => value >= 0);
  const right = rightStops.length ? Math.min(...rightStops) + 1 : Math.min(content.length, start + 160);
  return content.slice(left + 1, right).trim();
};

export function extractTimelineEvents(chapter: string, content: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const pattern = /公元前\s*(\d{1,4})\s*年|公元\s*(\d{1,4})\s*年|(?<!公元)前\s*(\d{1,4})\s*年/g;
  for (const match of content.matchAll(pattern)) {
    const year = Number(match[1] || match[2] || match[3]);
    events.push({ id: `${chapter}:${match.index}`, chapter, expression: match[0], normalizedYear: match[1] || match[3] ? -year : year, context: sentenceAt(content, match.index ?? 0), start: match.index ?? 0 });
  }
  return events;
}

export function findTimelineConflicts(events: TimelineEvent[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const contexts = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const key = event.context.replace(event.expression, '').replace(/[\s，。、“”‘’：；]/g, '').slice(0, 28);
    if (key.length < 4) continue;
    contexts.set(key, [...(contexts.get(key) ?? []), event]);
  }
  for (const [key, group] of contexts) {
    const years = new Set(group.map((event) => event.normalizedYear));
    if (years.size > 1) issues.push({ id: `timeline:${key}`, kind: 'timeline', severity: 'blocker', chapters: [...new Set(group.map((event) => event.chapter))], message: `同一事件语境出现不同年代：${group.map((event) => event.expression).join('、')}`, excerpts: group.map((event) => event.context) });
  }
  return issues;
}

export function findEntityConflicts(documents: Array<{ chapter: string; content: string }>, rules: EntityRule[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  for (const rule of rules) {
    const variants = [rule.canonical, ...rule.aliases].filter(Boolean);
    const occurrences = documents.flatMap((document) => variants.filter((variant) => document.content.includes(variant)).map((variant) => ({ chapter: document.chapter, variant })));
    const used = [...new Set(occurrences.map((item) => item.variant))];
    if (used.length > 1) issues.push({ id: `entity:${rule.kind}:${rule.canonical}`, kind: 'entity', severity: 'warning', chapters: [...new Set(occurrences.map((item) => item.chapter))], message: `${rule.kind}“${rule.canonical}”存在混用写法：${used.join('、')}`, excerpts: occurrences.map((item) => `${item.chapter}：${item.variant}`) });
  }
  return issues;
}

const normalizeParagraph = (value: string) => value.replace(/^#{1,6}\s+.*$/gm, '').replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[\s，。！？；：、“”‘’（）()《》〈〉—…·]/g, '').toLowerCase();
const shingles = (value: string, size = 3) => {
  const normalized = normalizeParagraph(value);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) result.add(normalized.slice(index, index + size));
  return result;
};
export function semanticSimilarity(left: string, right: string) {
  const a = shingles(left); const b = shingles(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((item) => { if (b.has(item)) intersection += 1; });
  return intersection / (a.size + b.size - intersection);
}
export function findSemanticDuplicates(documents: Array<{ chapter: string; content: string }>, threshold = 0.72): SemanticDuplicate[] {
  const paragraphs = documents.flatMap((document) => document.content.split(/\n\s*\n/).map((text) => ({ chapter: document.chapter, text: text.trim() })).filter((item) => normalizeParagraph(item.text).length >= 30 && !/^#|^---$|^<!--/.test(item.text)));
  const duplicates: SemanticDuplicate[] = [];
  for (let left = 0; left < paragraphs.length; left += 1) for (let right = left + 1; right < paragraphs.length; right += 1) {
    if (paragraphs[left].chapter === paragraphs[right].chapter) continue;
    const similarity = semanticSimilarity(paragraphs[left].text, paragraphs[right].text);
    if (similarity >= threshold) duplicates.push({ leftChapter: paragraphs[left].chapter, rightChapter: paragraphs[right].chapter, leftText: paragraphs[left].text, rightText: paragraphs[right].text, similarity });
  }
  return duplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 200);
}

export function checkQuoteAgainstSource(quote: string, sourceExcerpt: string): QuoteCheck {
  const normalize = (value: string) => value.replace(/[\s，。！？；：、“”‘’（）()《》〈〉]/g, '');
  const normalizedQuote = normalize(quote); const normalizedSource = normalize(sourceExcerpt);
  const exact = Boolean(normalizedQuote && normalizedSource.includes(normalizedQuote));
  const similarity = exact ? 1 : semanticSimilarity(normalizedQuote, normalizedSource);
  return { quote, sourceExcerpt, exact, similarity, message: exact ? '引文与来源摘录一致' : similarity >= 0.65 ? '引文与来源相近但不完全一致，需要核对改字、漏字和上下文' : '来源摘录中未找到该引文' };
}

export const PROFESSIONAL_RULE_PACKS: Record<ProfessionalRulePackId, ProfessionalRule[]> = {
  history: [
    { id: 'history-absolute', label: '绝对化历史结论', pattern: /(?:彻底|唯一|必然|完全|从根本上)[^。！？\n]{0,50}[。！？]/g, message: '强结论需要材料、范围和争议边界支持', severity: 'warning' },
    { id: 'history-modern-concept', label: '现代概念投射', pattern: /(?:知识分子|民族认同|文化专制|封建社会|中央集权)/g, message: '说明这是现代分析概念，避免当作历史原生表达', severity: 'warning' },
  ],
  law: [{ id: 'law-certainty', label: '确定性法律结论', pattern: /(?:必然违法|绝对合法|肯定败诉|无需承担责任)/g, message: '法律结论需要限定法域、时间和事实条件', severity: 'blocker' }],
  medicine: [{ id: 'medicine-guarantee', label: '医疗效果保证', pattern: /(?:保证治愈|绝无副作用|适合所有人|无需就医)/g, message: '不得给出无条件医疗效果保证', severity: 'blocker' }],
  finance: [{ id: 'finance-guarantee', label: '收益保证', pattern: /(?:稳赚不赔|保证收益|零风险|必然上涨)/g, message: '不得作无依据的收益或风险保证', severity: 'blocker' }],
  technology: [{ id: 'technology-absolute', label: '技术绝对化判断', pattern: /(?:百分之百安全|永不宕机|完全兼容|不存在漏洞)/g, message: '技术结论需要版本、环境和测试边界', severity: 'warning' }],
  general: [{ id: 'general-ai-phrase', label: '模板化表达', pattern: /(?:值得注意的是|不难发现|综上所述)/g, message: '删除套话并直接陈述新增信息', severity: 'warning' }],
};

export function runProfessionalRules(content: string, packIds: ProfessionalRulePackId[]): AnalysisIssue[] {
  return packIds.flatMap((packId) => PROFESSIONAL_RULE_PACKS[packId].flatMap((rule) => [...content.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))].map((match, index) => ({ id: `${packId}:${rule.id}:${match.index}:${index}`, kind: 'professional' as const, severity: rule.severity, chapters: [], message: `${rule.label}：${rule.message}`, excerpts: [match[0]] }))));
}
