import type { KnowledgeNode, Problem } from './types';

export const KNOWLEDGE_NODES: KnowledgeNode[] = [
  { id: 'functions', title: '函数与图像', description: '理解函数、定义域、函数值与图像之间的关系。', stage: 1, difficulty: 1, estimatedMinutes: 25, prerequisites: [], skills: ['function-evaluation'] },
  { id: 'limits', title: '极限与连续', description: '从趋近过程理解极限，并判断简单函数的连续性。', stage: 2, difficulty: 2, estimatedMinutes: 35, prerequisites: ['functions'], skills: ['limit-evaluation'] },
  { id: 'derivatives', title: '导数基础', description: '把导数理解为瞬时变化率和切线斜率。', stage: 3, difficulty: 2, estimatedMinutes: 40, prerequisites: ['limits'], skills: ['power-rule'] },
  { id: 'chain-rule', title: '链式法则', description: '识别复合函数，逐层计算导数。', stage: 4, difficulty: 3, estimatedMinutes: 45, prerequisites: ['derivatives'], skills: ['chain-rule'] },
  { id: 'integrals', title: '积分基础', description: '理解原函数、面积累积与微积分基本定理。', stage: 5, difficulty: 3, estimatedMinutes: 50, prerequisites: ['derivatives'], skills: ['basic-integral'] },
];

export const PROBLEMS: Problem[] = [
  { id: 'fn-1', knowledgeId: 'functions', skillId: 'function-evaluation', difficulty: 1, type: 'concept', question: '若 f(x) = 2x + 3，f(4) 等于多少？', answers: ['11'], solution: '把 x = 4 代入：f(4) = 2 × 4 + 3 = 11。', hints: ['把 4 代入所有出现 x 的位置。'] },
  { id: 'lim-1', knowledgeId: 'limits', skillId: 'limit-evaluation', difficulty: 2, type: 'calculation', question: '计算 lim(x→2) (x² − 4)/(x − 2)。', answers: ['4'], solution: '因式分解 x²−4=(x−2)(x+2)，约去 x−2 后令 x→2，结果为 4。', hints: ['先对分子使用平方差公式。'] },
  { id: 'der-1', knowledgeId: 'derivatives', skillId: 'power-rule', difficulty: 2, type: 'calculation', question: '若 f(x) = x³，写出 f′(x)。', answers: ['3x^2', '3x²', '3*x^2'], solution: '幂函数求导：(xⁿ)′ = nxⁿ⁻¹，所以 f′(x)=3x²。', hints: ['指数移到系数位置，再把指数减 1。'], misconception: { id: 'power-rule.unchanged-exponent', message: '你可能把指数移到了前面，但忘记将原指数减 1。', matches: ['3x^3', '3x³'] } },
  { id: 'chain-1', knowledgeId: 'chain-rule', skillId: 'chain-rule', difficulty: 3, type: 'transfer', question: '若 f(x) = (2x + 1)²，写出 f′(x)。', answers: ['4(2x+1)', '8x+4', '4*(2x+1)'], solution: '外层平方求导得到 2(2x+1)，再乘内层导数 2，因此是 4(2x+1)=8x+4。', hints: ['先把 2x+1 整体看作 u。', '不要忘记乘以内层函数的导数。'], misconception: { id: 'chain-rule.missing-inner-derivative', message: '你正确处理了外层，但漏乘了内层 2x+1 的导数 2。', matches: ['2(2x+1)', '4x+2', '2*(2x+1)'] } },
  { id: 'int-1', knowledgeId: 'integrals', skillId: 'basic-integral', difficulty: 3, type: 'application', question: '写出 ∫ 2x dx 的最一般结果。', answers: ['x^2+c', 'x²+c', 'x^2 + c', 'x² + c'], solution: '由幂函数积分公式，∫2x dx=x²+C；不定积分必须包含积分常数。', hints: ['寻找一个导数等于 2x 的函数。', '别忘了积分常数 C。'], misconception: { id: 'integral.missing-constant', message: '不定积分表示一族原函数，需要补上积分常数 C。', matches: ['x^2', 'x²'] } },
];
