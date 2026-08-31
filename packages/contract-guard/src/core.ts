export type Severity = 'high' | 'medium' | 'low';
export type PartyRole = '甲方' | '乙方' | '买方' | '卖方' | '服务商' | '客户';

export interface Clause {
  id: string; section: string; title: string; content: string;
  page?: number; startOffset: number; endOffset: number;
}
export interface ContractRisk {
  id: string; category: string; severity: Severity; score: number; title: string;
  clauseId: string; page?: number; evidence: string; reason: string; impact: string;
  recommendation: string; suggestedText: string; confidence: number;
}
export interface ContractAnalysis {
  name: string; role: PartyRole; clauses: Clause[]; risks: ContractRisk[];
  healthScore: number; analyzedAt: string; sourceText: string;
}

interface RiskRule {
  category: string; title: string; severity: Severity; score: number; patterns: RegExp[];
  reason: string; impact: string; recommendation: string; suggestedText: string;
}

const RULES: RiskRule[] = [
  { category: 'liability', title: '责任范围过宽', severity: 'high', score: 92, patterns: [/一切损失|全部损失|任何损失|无限责任|全部赔偿/], reason: '赔偿责任范围过宽，且未发现明确责任上限。', impact: '可能承担与合同金额不成比例的不可控赔偿责任。', recommendation: '增加累计责任上限，并排除间接损失与预期收益。', suggestedText: '除故意或重大过失外，任一方累计赔偿责任不超过本合同已支付金额的100%，且不承担间接损失。' },
  { category: 'renewal', title: '自动续约', severity: 'medium', score: 66, patterns: [/自动续(?:期|约)|期满自动/], reason: '存在自动续约机制，可能造成非预期续费或持续义务。', impact: '错过退出窗口后可能被迫继续履约和付款。', recommendation: '明确续约前通知和便捷退出机制。', suggestedText: '任何续约均须至少提前30日书面通知；任一方可在届满前30日书面通知不再续约。' },
  { category: 'payment', title: '付款周期偏长', severity: 'medium', score: 58, patterns: [/(?:收到|开具).{0,12}(?:60|六十|90|九十)日.{0,8}付款/, /付款期限.{0,8}(?:60|六十|90|九十)日/], reason: '付款周期达到或超过60日，现金流占用较高。', impact: '收款方可能面临较长垫资周期。', recommendation: '缩短付款周期并明确验收、发票与付款的先后条件。', suggestedText: '付款方应在收到合规发票后30日内付款，且不得以内部流程作为延迟付款理由。' },
  { category: 'termination', title: '单方解除权', severity: 'high', score: 82, patterns: [/有权随时解除|无理由解除|单方(?:终止|解除)/], reason: '单方解除权缺少对等条件、通知期或补偿安排。', impact: '对方可突然终止合作，造成投入无法回收。', recommendation: '设置对等解除权、合理通知期和已发生成本补偿。', suggestedText: '任一方无因解除合同应至少提前30日书面通知，并结清已完成工作及不可撤销成本。' },
  { category: 'intellectual-property', title: '知识产权完全转让', severity: 'high', score: 85, patterns: [/全部知识产权.{0,12}(?:归|属于)/, /永久.{0,8}(?:独占|排他).{0,8}授权/, /源代码.{0,8}(?:归|交付)/], reason: '成果权利范围可能包含既有技术、通用组件或源代码。', impact: '可能丧失背景知识产权及后续复用能力。', recommendation: '区分背景知识产权与项目成果，限定授权范围。', suggestedText: '各方背景知识产权仍归原权利人；仅项目定制成果按约定转让，通用技术与第三方材料除外。' },
  { category: 'data-security', title: '数据责任过重', severity: 'high', score: 88, patterns: [/数据泄露.{0,12}(?:全部|一切).{0,6}(?:责任|损失)/, /个人信息.{0,12}无限责任/], reason: '数据安全责任未按过错、控制范围和法定义务划分。', impact: '可能对不可控事件或第三方行为承担全部责任。', recommendation: '按过错分配责任，并约定事件响应、通知和责任边界。', suggestedText: '各方仅对其控制范围内因过错造成的数据安全事件承担责任，并依法及时通知及配合处置。' },
  { category: 'dispute', title: '异地争议解决', severity: 'low', score: 35, patterns: [/(?:人民法院|仲裁委员会).{0,10}(?:管辖|仲裁)|由.{2,20}人民法院管辖/], reason: '争议解决地点可能与实际经营地不同。', impact: '发生争议时可能增加差旅、取证和诉讼成本。', recommendation: '确认管辖地点是否符合己方诉讼便利性。', suggestedText: '争议由被告住所地有管辖权的人民法院管辖，或由双方认可的仲裁机构仲裁。' }
];

const HEADING = /^(第[一二三四五六七八九十百零〇0-9]+条\s*[^\n]*|\d+(?:\.\d+)*[、.．]\s*[^\n]+)$/gm;
export function extractClauses(text: string): Clause[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const matches = [...clean.matchAll(HEADING)];
  if (!matches.length) return clean ? [{ id: 'clause_001', section: '全文', title: '合同正文', content: clean, startOffset: 0, endOffset: clean.length }] : [];
  return matches.map((match, index) => {
    const start = match.index ?? 0; const end = matches[index + 1]?.index ?? clean.length;
    const heading = match[0].trim(); const section = heading.match(/^(第[^\s]+条|\d+(?:\.\d+)*)/)?.[0] ?? heading;
    return { id: `clause_${String(index + 1).padStart(3, '0')}`, section, title: heading.slice(section.length).replace(/^[、.．\s]+/, '') || section, content: clean.slice(start, end).trim(), startOffset: start, endOffset: end };
  });
}

export function detectRisks(clauses: Clause[], role: PartyRole): ContractRisk[] {
  const found: ContractRisk[] = [];
  for (const clause of clauses) for (const rule of RULES) {
    const hit = rule.patterns.map((pattern) => clause.content.match(pattern)).find(Boolean);
    if (!hit) continue;
    const evidenceStart = Math.max(0, (hit.index ?? 0) - 24);
    const evidence = clause.content.slice(evidenceStart, Math.min(clause.content.length, evidenceStart + 100)).trim();
    found.push({ id: `risk_${String(found.length + 1).padStart(3, '0')}`, category: rule.category, severity: rule.severity, score: rule.score, title: rule.title, clauseId: clause.id, page: clause.page, evidence, reason: `${rule.reason}（${role}视角）`, impact: rule.impact, recommendation: rule.recommendation, suggestedText: rule.suggestedText, confidence: 0.86 });
  }
  return found;
}

export function analyzeContract(name: string, text: string, role: PartyRole): ContractAnalysis {
  const clauses = extractClauses(text); const risks = detectRisks(clauses, role);
  const penalty = risks.reduce((sum, risk) => sum + (risk.severity === 'high' ? 16 : risk.severity === 'medium' ? 9 : 4), 0);
  return { name, role, clauses, risks, healthScore: Math.max(0, 100 - Math.min(100, penalty)), analyzedAt: new Date().toISOString(), sourceText: text };
}

export function buildMarkdownReport(result: ContractAnalysis): string {
  const counts = (level: Severity) => result.risks.filter((risk) => risk.severity === level).length;
  return `# ${result.name} — 合同风险审查报告\n\n> 审查视角：${result.role}；合同健康度：${result.healthScore}/100；生成时间：${new Date(result.analyzedAt).toLocaleString()}\n\n## 风险总览\n\n- 高风险：${counts('high')}\n- 中风险：${counts('medium')}\n- 低风险：${counts('low')}\n\n${result.risks.map((risk, i) => `## ${i + 1}. ${risk.title}（${risk.severity}）\n\n- 位置：${result.clauses.find(c => c.id === risk.clauseId)?.section ?? risk.clauseId}\n- 证据：> ${risk.evidence}\n- 原因：${risk.reason}\n- 影响：${risk.impact}\n- 建议：${risk.recommendation}\n- 建议文本：${risk.suggestedText}`).join('\n\n')}\n\n---\n本报告由规则引擎辅助生成，不构成法律意见；重要合同请由执业律师复核。\n`;
}
