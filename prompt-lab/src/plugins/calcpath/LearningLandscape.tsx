import type { CalcPathState } from './types';

type LandscapeNode = { id: string; title: string; subtitle: string; skill?: string; x: number; y: number; kind: 'high' | 'bridge' | 'calculus' | 'university' };
const NODES: LandscapeNode[] = [
  { id: 'algebra', title: '代数运算', subtitle: '式与方程', x: 7, y: 16, kind: 'high' },
  { id: 'functions', title: '函数语言', subtitle: '定义域与复合', skill: 'function-evaluation', x: 7, y: 38, kind: 'high' },
  { id: 'graphs', title: '图像直觉', subtitle: '变换与趋势', x: 7, y: 60, kind: 'high' },
  { id: 'trig', title: '三角 · 指对数', subtitle: '周期与增长', x: 7, y: 82, kind: 'high' },
  { id: 'approach', title: '无限趋近', subtitle: '从静态到过程', x: 31, y: 27, kind: 'bridge' },
  { id: 'rate', title: '变化率', subtitle: '从平均到瞬时', x: 31, y: 68, kind: 'bridge' },
  { id: 'limits', title: '极限与连续', subtitle: '微积分的入口', skill: 'limit-evaluation', x: 54, y: 24, kind: 'calculus' },
  { id: 'derivatives', title: '导数', subtitle: '局部变化', skill: 'power-rule', x: 54, y: 50, kind: 'calculus' },
  { id: 'integrals', title: '积分', subtitle: '整体累积', skill: 'basic-integral', x: 54, y: 77, kind: 'calculus' },
  { id: 'multivariable', title: '多元微积分', subtitle: '偏导 · 梯度', x: 79, y: 18, kind: 'university' },
  { id: 'diffeq', title: '微分方程', subtitle: '用变化描述世界', x: 79, y: 42, kind: 'university' },
  { id: 'series', title: '级数与 Taylor', subtitle: '用多项式逼近', x: 79, y: 66, kind: 'university' },
  { id: 'linear', title: '线代 · 概率', subtitle: '大学数学网络', x: 79, y: 88, kind: 'university' },
];
const EDGES = [['algebra','approach'],['functions','approach'],['graphs','approach'],['functions','rate'],['graphs','rate'],['trig','rate'],['approach','limits'],['rate','limits'],['limits','derivatives'],['derivatives','integrals'],['derivatives','multivariable'],['derivatives','diffeq'],['limits','series'],['integrals','diffeq'],['integrals','linear']] as const;
const colors = { high: '#3764a4', bridge: '#d08332', calculus: '#08766b', university: '#7653a6' };

export function LearningLandscape({ state, compact = false, activeId, onSelect }: { state: CalcPathState; compact?: boolean; activeId?: string; onSelect?: (id: string) => void }) {
  const mastery = (node: LandscapeNode) => node.skill ? state.skillStates[node.skill]?.mastery ?? 0 : 0;
  return <div className={`relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${compact ? 'h-52' : 'h-[560px]'}`}>
    <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)', backgroundSize: '22px 22px' }} />
    {!compact && <div className="absolute inset-x-0 top-0 grid grid-cols-4 px-5 pt-4 text-center text-[10px] font-semibold uppercase tracking-[.18em] text-slate-400"><span>高中数学地基</span><span>思维桥梁</span><span>微积分核心</span><span>大学数学方向</span></div>}
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">{EDGES.map(([from, to]) => { const a = NODES.find(n => n.id === from)!; const b = NODES.find(n => n.id === to)!; return <path key={`${from}-${to}`} d={`M ${a.x + 7} ${a.y} C ${a.x + 14} ${a.y}, ${b.x - 7} ${b.y}, ${b.x} ${b.y}`} vectorEffect="non-scaling-stroke" fill="none" stroke={activeId === from || activeId === to ? '#d08332' : '#cbd5e1'} strokeWidth={activeId === from || activeId === to ? 2.5 : 1.2} strokeDasharray={b.kind === 'university' ? '5 5' : undefined} /></svg>})}</svg>
    {NODES.map(node => { const value = mastery(node); const active = activeId === node.id; return <button key={node.id} onClick={() => onSelect?.(node.id)} className={`absolute -translate-y-1/2 rounded-2xl border bg-white text-left shadow-sm transition hover:-translate-y-[54%] hover:shadow-md dark:bg-slate-950 ${compact ? 'w-[15%] px-2 py-1.5' : 'w-[15%] px-3 py-2.5'} ${active ? 'ring-4 ring-amber-300/40' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%`, borderColor: `${colors[node.kind]}66` }}>
      <span className="mb-1 block h-1 w-7 rounded-full" style={{ background: colors[node.kind] }} /><span className={`block truncate font-semibold ${compact ? 'text-[10px]' : 'text-xs'}`}>{node.title}</span>{!compact && <><span className="mt-0.5 block truncate text-[10px] text-slate-400">{node.subtitle}</span><span className="mt-1 block text-[9px] font-medium" style={{ color: colors[node.kind] }}>{node.skill ? `${Math.round(value * 100)}% 掌握` : node.kind === 'university' ? '未来方向' : '待诊断'}</span></>}
    </button>})}
  </div>;
}

export const landscapeTitle = (id: string) => NODES.find(node => node.id === id)?.title ?? id;
