import type { ThinkingFramework, ThinkingFrameworkId } from './thinking-types';

const framework = (
  id: ThinkingFrameworkId,
  name: string,
  summary: string,
  suitableFor: string[],
  prompt: string,
  temperature = 0.35,
): ThinkingFramework => ({ id, name, summary, suitableFor, prompt, temperature });

export const THINKING_FRAMEWORKS: ThinkingFramework[] = [
  framework('first-principles', '第一性原理', '拆除假设，从基础事实重新构建', ['技术架构', '创业', '产品设计'], '区分问题表象、基础事实、人为规则与未经验证的假设；找到核心矛盾，并从零构建方案。'),
  framework('red-team', '红队分析', '主动寻找漏洞和失败路径', ['安全', '战略', '方案评审'], '以对抗者身份寻找最大漏洞、可利用路径、脆弱假设和极端失败情形；按严重性和可能性排序并给出缓解措施。', 0.45),
  framework('inversion', '逆向思维', '先研究如何失败，再反推预防', ['风险控制', '项目复盘'], '先列出必然导致失败的行为、常见错误、隐藏陷阱和错误决策链，再逐项反推出预防措施。'),
  framework('systems', '系统思维', '分析反馈循环、延迟与杠杆点', ['组织', '复杂系统', '运营'], '分析输入、过程、输出、反馈循环、延迟、激励和副作用；识别根因、关键变量及系统杠杆点。'),
  framework('bayesian', '贝叶斯推理', '用证据持续更新概率', ['故障判断', '真假判断', '不确定决策'], '列出互斥或可竞争的解释及主观先验；说明证据如何改变概率，并指出信息价值最高的下一项证据。'),
  framework('occam', '奥卡姆剃刀', '优先检验额外假设最少的解释', ['故障排查', '原因分析'], '列出主要解释，比较各自所需的额外假设、与现有证据的吻合度及可证伪性，然后按概率排序。'),
  framework('decision-tree', '决策树', '比较分支概率、收益和长期影响', ['方案选择', '资源配置'], '建立关键决策分支，估计收益、成本、风险、概率和长期影响；不伪造精确数据，缺失数据用区间并做敏感性分析。'),
  framework('value-investing', '价值投资', '关注长期价值、护城河和安全边际', ['商业判断', '职业选择', '投资'], '分析长期价值、护城河、竞争优势、管理质量、现金流和风险边界；过滤短期噪音，并检验五年后是否仍有价值。'),
  framework('military-strategy', '军事战略', '从资源、时机和态势设计低成本策略', ['竞争', '谈判', '战略'], '分析知己、知彼、环境、时机、资源和士气；优先寻找避免正面消耗、以最小成本形成优势的路径。', 0.45),
  framework('naval', '杠杆与复利', '寻找所有权、独特技能和长期杠杆', ['个人成长', '财富', '职业'], '分析杠杆、复利、独特技能、判断力、所有权与长期游戏；指出可能产生数量级提升的行动和应该停止的低价值活动。'),
  framework('multi-agent', '多角色会诊', '让关键利益相关者互相辩论', ['公司战略', '产品决策'], '模拟 CEO、CTO、投资人、竞争对手和用户。各角色先独立陈述，再相互质询；最后记录共识、分歧和条件化结论。', 0.55),
  framework('metacognition', '元认知', '识别真正问题、隐藏假设和认知偏差', ['复杂决策', '自我反思'], '先判断用户真正要解决的问题、隐藏假设、可能的认知偏差及对方视角；分别从三个月和三年尺度评价。'),
  framework('psychological-game', '逆向博弈', '分析多阶信念和认知差', ['谈判', '博弈', '竞争'], '分析我方判断、对方判断以及对方对我方判断的判断；寻找信息、心理、时间和资源优势。避免操纵、欺骗或伤害性建议。', 0.45),
];

export const FRAMEWORK_BY_ID = new Map(THINKING_FRAMEWORKS.map((item) => [item.id, item]));

const RULES: Array<{ pattern: RegExp; ids: ThinkingFrameworkId[] }> = [
  { pattern: /故障|报错|异常|宕机|排查|根因|真假|证据/i, ids: ['occam', 'bayesian', 'inversion'] },
  { pattern: /架构|技术|重构|系统设计|性能/i, ids: ['first-principles', 'systems', 'red-team'] },
  { pattern: /产品|创业|商业模式|方向/i, ids: ['first-principles', 'systems', 'decision-tree', 'red-team'] },
  { pattern: /投资|股票|估值|现金流|职业/i, ids: ['value-investing', 'bayesian', 'inversion'] },
  { pattern: /谈判|竞争|对手|博弈|冲突/i, ids: ['military-strategy', 'psychological-game', 'red-team'] },
  { pattern: /成长|财富|技能|副业|长期/i, ids: ['naval', 'metacognition', 'decision-tree'] },
  { pattern: /组织|公司|团队|管理|运营/i, ids: ['systems', 'multi-agent', 'red-team', 'decision-tree'] },
];

export function recommendFrameworks(question: string, limit = 4): ThinkingFrameworkId[] {
  const ranked: ThinkingFrameworkId[] = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(question)) continue;
    for (const id of rule.ids) if (!ranked.includes(id)) ranked.push(id);
  }
  const fallback: ThinkingFrameworkId[] = ['first-principles', 'systems', 'red-team', 'decision-tree'];
  for (const id of fallback) if (!ranked.includes(id)) ranked.push(id);
  return ranked.slice(0, Math.max(1, limit));
}
