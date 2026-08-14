import { useState } from 'react';
import type { ReactNode } from 'react';

const W = 520, H = 250, ox = 260, oy = 125, sx = 42, sy = 22;
const pt = (x: number, y: number) => `${ox + x * sx},${oy - y * sy}`;
const curve = (fn: (x: number) => number, from = -5.5, to = 5.5) => Array.from({ length: 121 }, (_, i) => { const x = from + (to - from) * i / 120; return `${i ? 'L' : 'M'}${pt(x, fn(x))}`; }).join(' ');

function Frame({ children }: { children: ReactNode }) {
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible rounded-2xl bg-white dark:bg-slate-950" role="img">
    <defs><pattern id="grid" width="42" height="22" patternUnits="userSpaceOnUse"><path d="M42 0H0V22" fill="none" stroke="currentColor" strokeOpacity=".08" /></pattern></defs>
    <rect width={W} height={H} fill="url(#grid)" /><path d={`M0 ${oy}H${W}M${ox} 0V${H}`} stroke="currentColor" strokeOpacity=".25" />{children}
  </svg>;
}
const Slider = ({ value, min, max, step = .1, label, onChange }: { value: number; min: number; max: number; step?: number; label: string; onChange: (n: number) => void }) => <label className="grid grid-cols-[120px_1fr_48px] items-center gap-3 text-xs"><span className="text-slate-500">{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="accent-emerald-600" /><strong className="text-right">{value.toFixed(step < 1 ? 1 : 0)}</strong></label>;

function FunctionVisual() {
  const [a, setA] = useState(2), [b, setB] = useState(1), [x, setX] = useState(2);
  return <Visual title="函数不是公式，而是输入—变换—输出" note={`输入 ${x.toFixed(1)}，先乘 ${a.toFixed(1)}，再加 ${b.toFixed(1)}，输出 ${(a*x+b).toFixed(1)}。`} controls={<><Slider label="倍率 a" value={a} min={-3} max={3} onChange={setA}/><Slider label="平移 b" value={b} min={-4} max={4} onChange={setB}/><Slider label="输入 x" value={x} min={-4} max={4} onChange={setX}/></>}>
    <Frame><path d={curve(v => a*v+b)} fill="none" stroke="#08766b" strokeWidth="3"/><circle cx={ox+x*sx} cy={oy-(a*x+b)*sy} r="6" fill="#d08332"/><path d={`M${ox+x*sx} ${oy}V${oy-(a*x+b)*sy}H${ox}`} fill="none" stroke="#d08332" strokeDasharray="5 4"/></Frame>
  </Visual>;
}

function LimitVisual() {
  const [h, setH] = useState(1.5); const x = 2 + h; const y = x + 2;
  return <Visual title="点可以缺失，附近的趋势仍然存在" note={`x = ${x.toFixed(2)} 时，化简后的值为 ${y.toFixed(2)}；让距离 h → 0，输出就趋近 4。`} controls={<Slider label="与 2 的距离 h" value={h} min={.05} max={2.5} step={.05} onChange={setH}/> }>
    <Frame><path d={curve(v => v+2)} fill="none" stroke="#08766b" strokeWidth="3"/><circle cx={ox+2*sx} cy={oy-4*sy} r="7" fill="white" stroke="#e11d48" strokeWidth="3"/><circle cx={ox+x*sx} cy={oy-y*sy} r="6" fill="#d08332"/><path d={`M${ox+x*sx} ${oy}V${oy-y*sy}`} stroke="#d08332" strokeDasharray="4 4"/></Frame>
  </Visual>;
}

function DerivativeVisual() {
  const [x, setX] = useState(1), [h, setH] = useState(2); const f=(v:number)=>v*v/2; const slope=(f(x+h)-f(x))/h; const tangent=(v:number)=>f(x)+x*(v-x); const secant=(v:number)=>f(x)+slope*(v-x);
  return <Visual title="缩短割线区间，平均变化率逼近导数" note={`割线斜率 = ${slope.toFixed(2)}；当 h → 0 时，它逼近切线斜率 f′(${x.toFixed(1)}) = ${x.toFixed(1)}。`} controls={<><Slider label="观察位置 x" value={x} min={-3} max={3} onChange={setX}/><Slider label="区间长度 h" value={h} min={.1} max={3} onChange={setH}/></>}>
    <Frame><path d={curve(f)} fill="none" stroke="#08766b" strokeWidth="3"/><path d={curve(secant,-5,5)} fill="none" stroke="#d08332" strokeWidth="2"/><path d={curve(tangent,-5,5)} fill="none" stroke="#7653a6" strokeWidth="2" strokeDasharray="6 4"/><circle cx={ox+x*sx} cy={oy-f(x)*sy} r="6" fill="#08766b"/><circle cx={ox+(x+h)*sx} cy={oy-f(x+h)*sy} r="6" fill="#d08332"/></Frame>
  </Visual>;
}

function IntegralVisual() {
  const [n, setN] = useState(6); const width=4/n; const area=Array.from({length:n},(_,i)=>{const x=i*width;return x*width;}).reduce((a,b)=>a+b,0);
  return <Visual title="把整体切成微小部分，再无限累积" note={`${n} 个左端点矩形的面积和约为 ${area.toFixed(3)}；分割越细，越接近 ∫₀⁴ x dx = 8。`} controls={<Slider label="矩形数量 n" value={n} min={2} max={40} step={1} onChange={setN}/> }>
    <Frame>{Array.from({length:n},(_,i)=>{const x=i*width,y=x; return <rect key={i} x={ox+x*sx} y={oy-y*sy} width={width*sx} height={y*sy} fill="#38bdf8" fillOpacity=".28" stroke="#0284c7" strokeWidth=".7"/>})}<path d={curve(v=>v,0,4)} fill="none" stroke="#08766b" strokeWidth="3"/></Frame>
  </Visual>;
}

function AlgebraVisual() {
  const [x,setX]=useState(3); return <Visual title="代数变形揭开极限的结构" note={`x²−4 = ${(x*x-4).toFixed(2)}，(x−2)(x+2) = ${((x-2)*(x+2)).toFixed(2)}；两种形式数值相同，但后一种能看见可约因子。`} controls={<Slider label="x" value={x} min={-4} max={5} onChange={setX}/> }><div className="grid min-h-52 place-items-center rounded-2xl bg-gradient-to-br from-blue-50 to-amber-50 p-6 dark:from-blue-950/40 dark:to-amber-950/30"><div className="flex flex-wrap items-center justify-center gap-4 text-2xl font-semibold"><span>x² − 4</span><span className="text-amber-600">=</span><span className="rounded-xl border border-amber-300 bg-white px-4 py-3 dark:bg-slate-900">(x − 2)</span><span className="rounded-xl border border-blue-300 bg-white px-4 py-3 dark:bg-slate-900">(x + 2)</span></div></div></Visual>;
}

function TaylorVisual() { const [n,setN]=useState(3); const fact=(v:number)=>Array.from({length:v},(_,i)=>i+1).reduce((a,b)=>a*b,1); const approx=(x:number)=>Array.from({length:n+1},(_,k)=>k%2===0?0:(k%4===1?1:-1)*x**k/fact(k)).reduce((a,b)=>a+b,0); return <Visual title="用局部导数逐层逼近整个函数" note={`当前使用到 ${n} 阶项。增加阶数后，多项式在原点附近更贴近 sin x，准确区间也逐渐扩大。`} controls={<Slider label="最高阶数" value={n} min={1} max={13} step={2} onChange={setN}/>}><Frame><path d={curve(Math.sin)} fill="none" stroke="#08766b" strokeWidth="3"/><path d={curve(approx)} fill="none" stroke="#d08332" strokeWidth="2" strokeDasharray="6 3"/></Frame></Visual>; }
function ExponentialVisual() { const [k,setK]=useState(.5); return <Visual title="增长率与当前数量成正比" note={`k=${k.toFixed(1)}：${k>0?'指数增长':'指数衰减'}。曲线上每一点的斜率都等于 k 乘以该点高度。`} controls={<Slider label="增长率 k" value={k} min={-1} max={1} onChange={setK}/>}><Frame><path d={curve(x=>Math.exp(k*x),-4,4)} fill="none" stroke="#08766b" strokeWidth="3"/></Frame></Visual>; }
function OptimizationVisual() { const [x,setX]=useState(-1.5); const f=(v:number)=>v**3/3-v; const slope=x*x-1; return <Visual title="导数符号控制函数的上升、下降与极值" note={`x=${x.toFixed(1)}，f′(x)=${slope.toFixed(2)}，函数此处正在${slope>0?'上升':slope<0?'下降':'转折候选'}。`} controls={<Slider label="观察位置 x" value={x} min={-2.5} max={2.5} onChange={setX}/>}><Frame><path d={curve(f)} fill="none" stroke="#08766b" strokeWidth="3"/><path d={curve(v=>f(x)+slope*(v-x))} fill="none" stroke="#d08332" strokeWidth="2"/><circle cx={ox+x*sx} cy={oy-f(x)*sy} r="6" fill="#7653a6"/></Frame></Visual>; }
function NumericalVisual() { const [n,setN]=useState(4); const width=4/n; return <Visual title="精确原函数不存在时，用梯形逼近积分" note={`${n} 个梯形正在逼近 ∫₀⁴ e^(−x²/4) dx。网格更细通常降低离散误差。`} controls={<Slider label="梯形数量" value={n} min={2} max={24} step={1} onChange={setN}/>}><Frame>{Array.from({length:n},(_,i)=>{const a=i*width,b=a+width,fa=Math.exp(-a*a/4),fb=Math.exp(-b*b/4);return <polygon key={i} points={`${pt(a,0)} ${pt(a,fa)} ${pt(b,fb)} ${pt(b,0)}`} fill="#38bdf8" fillOpacity=".25" stroke="#0284c7"/>})}<path d={curve(x=>Math.exp(-x*x/4),0,4)} fill="none" stroke="#08766b" strokeWidth="3"/></Frame></Visual>; }
function DirectionFieldVisual() { const [k,setK]=useState(.5); const lines=[]; for(let x=-5;x<=5;x++)for(let y=-4;y<=4;y++){const m=k*y,l=7/Math.sqrt(1+m*m);lines.push(<line key={`${x}-${y}`} x1={ox+x*sx-l} y1={oy-y*sy+m*l} x2={ox+x*sx+l} y2={oy-y*sy-m*l} stroke="#08766b" strokeWidth="1.3"/>)} return <Visual title="不用先求公式，也能看见解的流向" note={`方向场 y′=${k.toFixed(1)}y。每根短线给出解曲线经过该点时的方向。`} controls={<Slider label="系数 k" value={k} min={-1} max={1} onChange={setK}/>}><Frame>{lines}<path d={curve(x=>Math.exp(k*x),-4,3)} fill="none" stroke="#d08332" strokeWidth="3"/></Frame></Visual>; }
function PolarVisual() { const [petals,setPetals]=useState(3); const points=Array.from({length:241},(_,i)=>{const t=Math.PI*2*i/240,r=2.3*Math.cos(petals*t);return `${ox+r*Math.cos(t)*sx},${oy-r*Math.sin(t)*sy}`}).join(' '); return <Visual title="极坐标让旋转对称结构自然出现" note={`r=2.3 cos(${petals}θ)。改变频率会改变花瓣数量与对称性。`} controls={<Slider label="频率" value={petals} min={1} max={7} step={1} onChange={setPetals}/>}><Frame><polyline points={points} fill="#38bdf833" stroke="#7653a6" strokeWidth="2.5"/></Frame></Visual>; }
function VectorVisual() { const [angle,setAngle]=useState(45); const rad=angle*Math.PI/180,x=3*Math.cos(rad),y=3*Math.sin(rad); return <Visual title="向量把大小分解到坐标方向" note={`长度 3、方向 ${angle}° 的向量，分量约为 ⟨${x.toFixed(2)}, ${y.toFixed(2)}⟩。`} controls={<Slider label="方向角" value={angle} min={0} max={360} step={1} onChange={setAngle}/>}><Frame><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#08766b"/></marker></defs><line x1={ox} y1={oy} x2={ox+x*sx} y2={oy-y*sy} stroke="#08766b" strokeWidth="4" markerEnd="url(#arrow)"/><path d={`M${ox+x*sx} ${oy}V${oy-y*sy}H${ox}`} fill="none" stroke="#d08332" strokeDasharray="5 4"/></Frame></Visual>; }
function GradientVisual() { const [x,setX]=useState(1),[y,setY]=useState(1); return <Visual title="梯度垂直等高线，指向最快上升" note={`f=x²+y² 在 (${x.toFixed(1)},${y.toFixed(1)}) 的梯度为 ⟨${(2*x).toFixed(1)},${(2*y).toFixed(1)}⟩。`} controls={<><Slider label="x" value={x} min={-2} max={2} onChange={setX}/><Slider label="y" value={y} min={-2} max={2} onChange={setY}/></>}><Frame>{[1,2,3,4].map(r=><ellipse key={r} cx={ox} cy={oy} rx={r*sx} ry={r*sy} fill="none" stroke="#94a3b8"/>)}<line x1={ox+x*sx} y1={oy-y*sy} x2={ox+3*x*sx} y2={oy-3*y*sy} stroke="#d08332" strokeWidth="3"/><circle cx={ox+x*sx} cy={oy-y*sy} r="6" fill="#08766b"/></Frame></Visual>; }
function DoubleIntegralVisual() { const [n,setN]=useState(5); return <Visual title="二重积分把区域铺成微小面积元" note={`${n}×${n} 网格把区域分成 ${n*n} 个面积元；每个小柱高度由 f(x,y) 决定。`} controls={<Slider label="每边分割数" value={n} min={2} max={12} step={1} onChange={setN}/>}><Frame>{Array.from({length:n*n},(_,i)=>{const row=Math.floor(i/n),col=i%n,size=160/n,val=(row+col)/(2*n);return <rect key={i} x={180+col*size} y={45+row*size} width={size} height={size} fill={`rgba(8,118,107,${.15+.65*val})`} stroke="white"/>})}</Frame></Visual>; }
function VectorFieldVisual() { const [rotation,setRotation]=useState(1); const arrows=[]; for(let x=-4;x<=4;x++)for(let y=-3;y<=3;y++){const dx=-rotation*y,dy=rotation*x,len=Math.hypot(dx,dy)||1;arrows.push(<line key={`${x}-${y}`} x1={ox+x*sx} y1={oy-y*sy} x2={ox+x*sx+dx/len*12} y2={oy-y*sy-dy/len*12} stroke="#7653a6" strokeWidth="1.7"/>)}return <Visual title="向量场为每个位置指定一个方向" note={`${rotation>=0?'逆时针':'顺时针'}旋转场。沿闭合边界的环流与区域内部的旋转密切相关。`} controls={<Slider label="旋转方向" value={rotation} min={-1} max={1} step={2} onChange={setRotation}/>}><Frame>{arrows}</Frame></Visual>; }
function OscillationVisual(){const [damping,setDamping]=useState(.15);return <Visual title="阻尼让振动能量逐渐消失" note={`阻尼系数 ${damping.toFixed(2)}。包络 e^(−ct) 控制振幅衰减速度。`} controls={<Slider label="阻尼 c" value={damping} min={0} max={.8} step={.05} onChange={setDamping}/>}><Frame><path d={curve(x=>Math.exp(-damping*(x+5))*Math.cos(3*(x+5)),-5,5)} fill="none" stroke="#08766b" strokeWidth="3"/></Frame></Visual>}

function Visual({ title, note, controls, children }: { title:string; note:string; controls:ReactNode; children:ReactNode }) { return <div><div className="grid gap-5 lg:grid-cols-[1fr_240px]"><div>{children}</div><div className="flex flex-col justify-center gap-4 rounded-2xl bg-slate-50 p-5 dark:bg-slate-950">{controls}<p className="border-t pt-4 text-xs leading-6 text-slate-500">{note}</p></div></div><h3 className="mt-4 font-semibold">{title}</h3></div>; }

export function MathVisualLab({ nodeId }: { nodeId: string }) {
  if (nodeId === 'algebra') return <AlgebraVisual/>;
  if (['functions','graphs','trig'].includes(nodeId)) return <FunctionVisual/>;
  if (['approach','limits'].includes(nodeId)) return <LimitVisual/>;
  if (['rate','derivatives','chain-rule'].includes(nodeId)) return <DerivativeVisual/>;
  if (nodeId === 'integrals') return <IntegralVisual/>;
  if (nodeId === 'derivative-applications') return <OptimizationVisual/>;
  if (nodeId === 'integral-applications') return <IntegralVisual/>;
  if (nodeId === 'transcendental') return <ExponentialVisual/>;
  if (nodeId === 'integration-techniques') return <NumericalVisual/>;
  if (nodeId === 'first-order-odes') return <DirectionFieldVisual/>;
  if (nodeId === 'series') return <TaylorVisual/>;
  if (nodeId === 'parametric-polar') return <PolarVisual/>;
  if (['space-vectors','vector-functions'].includes(nodeId)) return <VectorVisual/>;
  if (nodeId === 'partial-derivatives') return <GradientVisual/>;
  if (nodeId === 'multiple-integrals') return <DoubleIntegralVisual/>;
  if (nodeId === 'vector-calculus') return <VectorFieldVisual/>;
  if (nodeId === 'second-order-odes') return <OscillationVisual/>;
  return <FunctionVisual/>;
}

export const VISUALIZED_CHAPTERS = ['functions','limits','derivatives','derivative-applications','integrals','integral-applications','transcendental','integration-techniques','first-order-odes','series','parametric-polar','space-vectors','vector-functions','partial-derivatives','multiple-integrals','vector-calculus','second-order-odes'] as const;
