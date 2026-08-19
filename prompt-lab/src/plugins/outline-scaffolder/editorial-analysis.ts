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
