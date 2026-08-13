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

function Visual({ title, note, controls, children }: { title:string; note:string; controls:ReactNode; children:ReactNode }) { return <div><div className="grid gap-5 lg:grid-cols-[1fr_240px]"><div>{children}</div><div className="flex flex-col justify-center gap-4 rounded-2xl bg-slate-50 p-5 dark:bg-slate-950">{controls}<p className="border-t pt-4 text-xs leading-6 text-slate-500">{note}</p></div></div><h3 className="mt-4 font-semibold">{title}</h3></div>; }

export function MathVisualLab({ nodeId }: { nodeId: string }) {
  if (nodeId === 'algebra') return <AlgebraVisual/>;
  if (['functions','graphs','trig'].includes(nodeId)) return <FunctionVisual/>;
  if (['approach','limits'].includes(nodeId)) return <LimitVisual/>;
  if (['rate','derivatives','chain-rule'].includes(nodeId)) return <DerivativeVisual/>;
  if (nodeId === 'integrals') return <IntegralVisual/>;
  return <DerivativeVisual/>;
}
