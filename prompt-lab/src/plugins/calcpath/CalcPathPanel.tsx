import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle, Info, RotateCcw, SlidersHorizontal } from '@/components/icons';
import { BRIDGE_CONTEXT, KNOWLEDGE_NODES, PROBLEMS } from './curriculum';
import { LearningLandscape } from './LearningLandscape';
import { KnowledgeStudio } from './KnowledgeStudio';
import { evaluateAnswer, getNextProblem, updateSkill } from './engine';
import { loadState, saveState } from './storage';
import type { CalcPathState, Problem } from './types';

type View = 'home' | 'path' | 'practice' | 'learn';
const pct = (value: number) => `${Math.round(value * 100)}%`;

export function CalcPathPanel() {
  const [state, setState] = useState<CalcPathState>(loadState);
  const [view, setView] = useState<View>('home');
  const [problem, setProblem] = useState<Problem>(() => getNextProblem(state));
  const [answer, setAnswer] = useState('');
  const [hintCount, setHintCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string }>();
  const [learningNodeId, setLearningNodeId] = useState('functions');
  useEffect(() => saveState(state), [state]);
  const overall = useMemo(() => {
    const values = Object.values(state.skillStates); return values.length ? values.reduce((sum, item) => sum + item.mastery, 0) / values.length : 0;
  }, [state.skillStates]);
  const due = Object.values(state.skillStates).filter((item) => item.nextReviewAt && item.nextReviewAt <= new Date().toISOString()).length;
  const currentNode = KNOWLEDGE_NODES.find((node) => node.id === problem.knowledgeId);
  const bridge = BRIDGE_CONTEXT[problem.knowledgeId];
  const openLesson = (nodeId: string) => { setLearningNodeId(nodeId); setView('learn'); };
  const lessonProblem = PROBLEMS.find((item) => item.knowledgeId === learningNodeId);

  const start = useCallback((target = getNextProblem(state)) => { setProblem(target); setAnswer(''); setHintCount(0); setFeedback(undefined); setView('practice'); }, [state]);
  useEffect(() => {
    const handlePractice = () => start();
    window.addEventListener('calcpath:practice', handlePractice);
    return () => window.removeEventListener('calcpath:practice', handlePractice);
  }, [start]);
  const submit = () => {
    if (!answer.trim() || feedback) return;
    const result = evaluateAnswer(problem, answer);
    const nextSkill = updateSkill(state.skillStates[problem.skillId], problem, result.correct, hintCount);
    const nextState: CalcPathState = { ...state, diagnosticComplete: true, skillStates: { ...state.skillStates, [problem.skillId]: nextSkill }, attempts: [{ id: crypto.randomUUID(), problemId: problem.id, answer, correct: result.correct, score: result.correct ? Math.max(.6, 1 - hintCount * .15) : 0, hintCount, difficulty: problem.difficulty, misconceptionIds: result.misconception ? [result.misconception.id] : [], createdAt: new Date().toISOString() }, ...state.attempts].slice(0, 200) };
    setState(nextState);
    setFeedback({ correct: result.correct, text: result.correct ? `正确。${problem.solution}` : result.misconception?.message ?? `还差一步。${problem.solution}` });
  };

  return <div className="flex h-full min-h-0 bg-[#f7f8f4] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <aside className="hidden w-56 shrink-0 border-r border-emerald-950/10 bg-[#103c35] p-5 text-white md:flex md:flex-col">
      <div className="mb-8"><div className="text-xl font-semibold tracking-tight">CalcPath</div><div className="mt-1 text-xs text-emerald-100/70">你的微积分学习路径</div></div>
      {[['home', '学习总览'], ['path', '知识路径']].map(([id, label]) => <button key={id} onClick={() => setView(id as View)} className={`mb-2 rounded-xl px-3 py-2.5 text-left text-sm ${view === id ? 'bg-white/15 font-medium' : 'text-emerald-50/75 hover:bg-white/10'}`}>{label}</button>)}
      <button onClick={() => start()} className="mb-2 rounded-xl px-3 py-2.5 text-left text-sm text-emerald-50/75 hover:bg-white/10">自适应练习</button>
      <div className="mt-auto rounded-2xl bg-white/10 p-4"><div className="text-xs text-emerald-100/70">综合掌握度</div><div className="mt-1 text-2xl font-semibold">{pct(overall)}</div><div className="mt-3 h-1.5 rounded bg-white/15"><div className="h-full rounded bg-[#efb85d]" style={{ width: pct(overall) }} /></div></div>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto p-5 md:p-8">
      {view === 'home' && <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">你的数学能力地形</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">从高中地基，走向大学微积分</h1><p className="mt-2 text-sm text-slate-500">CalcPath 不按章节推课，而是找到通往目标时真正断开的那座桥。</p></div><button onClick={() => start()} className="flex items-center gap-2 rounded-xl bg-[#d88b3d] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#c77b30]">定位我的断点 <ArrowRight className="h-4 w-4" /></button></div>
        <div className="mt-7"><LearningLandscape state={state} onSelect={openLesson} /></div>
        <div className="mt-7 grid gap-4 sm:grid-cols-3">{[[SlidersHorizontal, '当前掌握', pct(overall)], [BookOpen, '已练习', `${state.attempts.length} 题`], [RotateCcw, '待复习', `${due} 项`]].map(([Icon, label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><Icon className="h-5 w-5 text-emerald-700" /><div className="mt-4 text-xs text-slate-500">{label as string}</div><div className="mt-1 text-2xl font-semibold">{value as string}</div></div>)}</div>
        <section className="mt-7 rounded-3xl bg-[#e7efe7] p-6 dark:bg-emerald-950/40"><div className="text-xs font-semibold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">今天要修的桥</div><div className="mt-3 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">高中函数语言 → 无限趋近 → 极限与导数</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">先用一道短题判断：你的困难来自微积分概念，还是高中函数基础。</p></div><button onClick={() => start()} className="rounded-xl border border-emerald-900/15 bg-white px-4 py-2 text-sm font-medium dark:bg-slate-900">开始定位</button></div></section>
        {!state.diagnosticComplete && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"><div className="font-medium">首次诊断已准备好</div><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">从基础函数题开始，答题结果会逐步定位你的知识缺口，无需一次完成长测验。</p></div>}
      </div>}
      {view === 'path' && <div className="mx-auto max-w-6xl"><h1 className="text-3xl font-semibold">知识不是清单，而是一张路网</h1><p className="mt-2 text-sm text-slate-500">点击任意知识节点，进入它的学习室。</p><div className="mt-7"><LearningLandscape state={state} onSelect={openLesson} /></div><div className="mt-5 grid gap-4 md:grid-cols-3"><div className="rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="text-xs font-semibold text-blue-700">高中地基</div><p className="mt-2 text-sm text-slate-500">代数负责变形，函数负责表达变化，图像负责建立直觉。</p></div><div className="rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="text-xs font-semibold text-amber-700">关键桥梁</div><p className="mt-2 text-sm text-slate-500">“无限趋近”和“瞬时变化”是从高中静态数学转向大学动态数学的跃迁。</p></div><div className="rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="text-xs font-semibold text-violet-700">大学方向</div><p className="mt-2 text-sm text-slate-500">导数和积分继续分叉到多元微积分、微分方程、级数、概率与线代。</p></div></div></div>}
      {view === 'learn' && <KnowledgeStudio nodeId={learningNodeId} state={state} problem={lessonProblem} onBack={() => setView('path')} onPractice={(target) => start(target)} />}
      {view === 'practice' && <div className="mx-auto max-w-5xl"><button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setView('home')}>← 返回能力地图</button><div className="mt-5"><LearningLandscape state={state} compact activeId={problem.knowledgeId} /></div><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_270px]"><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between text-xs text-slate-500"><span>{currentNode?.title}</span><span>定位题 · 难度 {problem.difficulty}/5</span></div><h1 className="mt-6 text-2xl font-semibold leading-relaxed">{problem.question}</h1><input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} disabled={!!feedback} placeholder="输入你的推理结果" className="mt-7 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 outline-none focus:border-emerald-600 dark:border-slate-700" />
        {!feedback && <div className="mt-4 flex flex-wrap justify-between gap-3"><button onClick={() => setHintCount(Math.min(problem.hints.length, hintCount + 1))} disabled={hintCount >= problem.hints.length} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-amber-700 disabled:opacity-40"><Info className="h-4 w-4" />给我一点提示</button><button onClick={submit} className="rounded-xl bg-[#103c35] px-5 py-2.5 text-sm font-medium text-white">提交答案</button></div>}
        {hintCount > 0 && !feedback && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{problem.hints.slice(0, hintCount).map((hint, index) => <p key={hint}>{index + 1}. {hint}</p>)}</div>}
        {feedback && <div className={`mt-5 rounded-2xl p-5 ${feedback.correct ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100'}`}><div className="flex items-center gap-2 font-semibold"><CheckCircle className="h-5 w-5" />{feedback.correct ? '回答正确' : '这次还没答对'}</div><p className="mt-2 text-sm leading-6">{feedback.text}</p><button onClick={() => start(getNextProblem(state))} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm">下一题</button></div>}
      </div><aside className="rounded-3xl bg-[#132f3b] p-5 text-white"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/70">这道题在测什么</div><h2 className="mt-3 text-lg font-semibold">{bridge ? `${bridge.from.join(' + ')} → ${bridge.destination}` : currentNode?.title}</h2><p className="mt-3 text-sm leading-6 text-slate-300">{bridge?.bridge ?? currentNode?.description}</p><div className="mt-5 border-t border-white/10 pt-5"><div className="text-xs text-slate-400">如果这里卡住</div><p className="mt-2 text-sm leading-6 text-slate-200">系统会回到具体的高中先修节点修补，而不是让你反复刷同一种微积分题。</p></div></aside></div></div>}
    </main>
  </div>;
}
