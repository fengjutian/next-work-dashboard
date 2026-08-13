import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Lightbulb, RotateCcw, Target } from '@/components/icons';
import { KNOWLEDGE_NODES, PROBLEMS } from './curriculum';
import { evaluateAnswer, getNextProblem, masteryLabel, updateSkill } from './engine';
import { createInitialState, loadState, saveState } from './storage';
import type { CalcPathState, Problem } from './types';

type View = 'home' | 'path' | 'practice';
const pct = (value: number) => `${Math.round(value * 100)}%`;

export function CalcPathPanel() {
  const [state, setState] = useState<CalcPathState>(loadState);
  const [view, setView] = useState<View>('home');
  const [problem, setProblem] = useState<Problem>(() => getNextProblem(state));
  const [answer, setAnswer] = useState('');
  const [hintCount, setHintCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string }>();
  useEffect(() => saveState(state), [state]);
  const overall = useMemo(() => {
    const values = Object.values(state.skillStates); return values.length ? values.reduce((sum, item) => sum + item.mastery, 0) / values.length : 0;
  }, [state.skillStates]);
  const due = Object.values(state.skillStates).filter((item) => item.nextReviewAt && item.nextReviewAt <= new Date().toISOString()).length;

  const start = (target = getNextProblem(state)) => { setProblem(target); setAnswer(''); setHintCount(0); setFeedback(undefined); setView('practice'); };
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
      {view === 'home' && <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">自适应学习中心</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">今天，从真正薄弱的地方开始</h1><p className="mt-2 text-sm text-slate-500">系统依据先修关系、掌握度和复习时间安排下一步。</p></div><button onClick={() => start()} className="flex items-center gap-2 rounded-xl bg-[#d88b3d] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#c77b30]">开始今日学习 <ArrowRight className="h-4 w-4" /></button></div>
        <div className="mt-7 grid gap-4 sm:grid-cols-3">{[[Target, '当前掌握', pct(overall)], [BookOpen, '已练习', `${state.attempts.length} 题`], [RotateCcw, '待复习', `${due} 项`]].map(([Icon, label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><Icon className="h-5 w-5 text-emerald-700" /><div className="mt-4 text-xs text-slate-500">{label as string}</div><div className="mt-1 text-2xl font-semibold">{value as string}</div></div>)}</div>
        <section className="mt-7 rounded-3xl bg-[#e7efe7] p-6 dark:bg-emerald-950/40"><div className="text-xs font-semibold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">系统推荐</div><div className="mt-3 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{getNextProblem(state).question}</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">约 8 分钟 · 难度 {getNextProblem(state).difficulty}/5 · 确定性判题</p></div><button onClick={() => start()} className="rounded-xl border border-emerald-900/15 bg-white px-4 py-2 text-sm font-medium dark:bg-slate-900">进入练习</button></div></section>
        {!state.diagnosticComplete && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"><div className="font-medium">首次诊断已准备好</div><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">从基础函数题开始，答题结果会逐步定位你的知识缺口，无需一次完成长测验。</p></div>}
      </div>}
      {view === 'path' && <div className="mx-auto max-w-4xl"><h1 className="text-3xl font-semibold">知识路径</h1><p className="mt-2 text-sm text-slate-500">达到 60% 掌握度后解锁后续节点。</p><div className="mt-7 space-y-3">{KNOWLEDGE_NODES.map((node, index) => { const value = node.skills.reduce((sum, skill) => sum + (state.skillStates[skill]?.mastery ?? 0), 0) / node.skills.length; const unlocked = node.prerequisites.every((id) => KNOWLEDGE_NODES.find((item) => item.id === id)?.skills.every((skill) => (state.skillStates[skill]?.mastery ?? 0) >= .6)); return <div key={node.id} className={`flex gap-4 rounded-2xl border bg-white p-5 dark:bg-slate-900 ${unlocked ? 'border-slate-200 dark:border-slate-800' : 'opacity-50'}`}><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><h2 className="font-semibold">{node.title}</h2><span className="text-sm font-medium">{pct(value)}</span></div><p className="mt-1 text-sm text-slate-500">{node.description}</p><div className="mt-3 h-1.5 rounded bg-slate-100 dark:bg-slate-800"><div className="h-full rounded bg-emerald-600" style={{ width: pct(value) }} /></div><div className="mt-2 text-xs text-slate-400">{unlocked ? `${masteryLabel(value)} · ${node.estimatedMinutes} 分钟` : '完成先修知识后解锁'}</div></div></div>})}</div></div>}
      {view === 'practice' && <div className="mx-auto max-w-3xl"><button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setView('home')}>← 返回总览</button><div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between text-xs text-slate-500"><span>{KNOWLEDGE_NODES.find((node) => node.id === problem.knowledgeId)?.title}</span><span>难度 {problem.difficulty}/5</span></div><h1 className="mt-6 text-2xl font-semibold leading-relaxed">{problem.question}</h1><input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} disabled={!!feedback} placeholder="输入你的答案" className="mt-7 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 outline-none focus:border-emerald-600 dark:border-slate-700" />
        {!feedback && <div className="mt-4 flex flex-wrap justify-between gap-3"><button onClick={() => setHintCount(Math.min(problem.hints.length, hintCount + 1))} disabled={hintCount >= problem.hints.length} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-amber-700 disabled:opacity-40"><Lightbulb className="h-4 w-4" />给我一点提示</button><button onClick={submit} className="rounded-xl bg-[#103c35] px-5 py-2.5 text-sm font-medium text-white">提交答案</button></div>}
        {hintCount > 0 && !feedback && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{problem.hints.slice(0, hintCount).map((hint, index) => <p key={hint}>{index + 1}. {hint}</p>)}</div>}
        {feedback && <div className={`mt-5 rounded-2xl p-5 ${feedback.correct ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100'}`}><div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" />{feedback.correct ? '回答正确' : '这次还没答对'}</div><p className="mt-2 text-sm leading-6">{feedback.text}</p><button onClick={() => start(getNextProblem(state))} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm">下一题</button></div>}
      </div></div>}
    </main>
  </div>;
}
