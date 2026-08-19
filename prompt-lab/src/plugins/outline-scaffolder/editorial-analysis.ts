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
