import { XMarkdown } from '@ant-design/x-markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Download, History, Loader2, RefreshCw, Sparkles, Trash2, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/store';
import { crossExamineAnalyses, runFramework, settleWithConcurrency, synthesizeAnalyses } from './analysis-service';
import { FRAMEWORK_BY_ID, recommendFrameworks, THINKING_FRAMEWORKS } from './framework-registry';
import { deleteThinkingRun, loadThinkingRuns, saveThinkingRun } from './thinking-storage';
import { buildThinkingReport, downloadMarkdown } from './report';
import type { AnalysisMode, FrameworkResult, ThinkingFrameworkId, ThinkingRun } from './thinking-types';

const DEFAULT_IDS = recommendFrameworks('复杂产品和技术决策');

function createResults(ids: ThinkingFrameworkId[]): FrameworkResult[] {
  return ids.map((frameworkId) => ({ frameworkId, status: 'pending', content: '' }));
}

export function ThinkingLabPanel() {
  const aiApi = useStore((state) => state.aiApi);
  const configured = Boolean(aiApi.apiKey?.trim() && aiApi.baseUrl?.trim() && aiApi.model?.trim());
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [selected, setSelected] = useState<ThinkingFrameworkId[]>(DEFAULT_IDS);
  const [mode, setMode] = useState<AnalysisMode>('standard');
  const [results, setResults] = useState<FrameworkResult[]>([]);
  const [critique, setCritique] = useState('');
  const [synthesis, setSynthesis] = useState('');
  const [running, setRunning] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ThinkingRun[]>(() => loadThinkingRuns());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (command === 'new') {
        controllerRef.current?.abort();
        setQuestion(''); setContext(''); setResults([]); setCritique(''); setSynthesis('');
      }
      if (command === 'history') setHistoryOpen(true);
    };
    window.addEventListener('thinking-lab:command', handleCommand);
    return () => window.removeEventListener('thinking-lab:command', handleCommand);
  }, []);

  const updateResult = useCallback((id: ThinkingFrameworkId, patch: Partial<FrameworkResult>) => {
    setResults((current) => current.map((item) => item.frameworkId === id ? { ...item, ...patch } : item));
  }, []);

  const recommend = useCallback(() => {
    if (!question.trim()) return toast.message('请先输入要分析的问题');
    const ids = recommendFrameworks(question);
    setSelected(ids);
    toast.success(`已推荐 ${ids.length} 个互补框架`);
  }, [question]);

  const execute = useCallback(async () => {
    if (!question.trim()) return toast.error('请输入要分析的问题');
    if (!selected.length) return toast.error('请至少选择一个分析框架');
    if (!configured) return toast.error('请先在设置中配置 AI 服务');

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const initial = createResults(selected);
    setResults(initial);
    setCritique('');
    setSynthesis('');
    setRunning(true);

    const ai = { apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, model: aiApi.model };
    const completed: FrameworkResult[] = [];
    const tasks = selected.map((id) => async () => {
      updateResult(id, { status: 'running', content: '', error: undefined, critique: undefined });
      try {
        const result = await runFramework(id, question.trim(), context.trim(), ai, controller.signal, (content) => {
          updateResult(id, { status: 'running', content });
        });
        completed.push(result);
        updateResult(id, result);
      } catch (error) {
        if (controller.signal.aborted) return;
        updateResult(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    });
    await settleWithConcurrency(tasks, mode === 'quick' ? 2 : 3);

    if (!controller.signal.aborted && completed.length) {
      setSynthesizing(true);
      try {
        let audit = '';
        if (mode === 'deep' && completed.length > 1) {
          audit = await crossExamineAnalyses(question.trim(), completed, ai, controller.signal);
          setCritique(audit);
        }
        const synthesisInputs = audit
          ? completed.map((item, index) => index === 0 ? { ...item, content: `${item.content}\n\n## 分析审计补充\n${audit}` } : item)
          : completed;
        const merged = await synthesizeAnalyses(question.trim(), synthesisInputs, ai, controller.signal, setSynthesis);
        setSynthesis(merged);
        const run: ThinkingRun = {
          id: crypto.randomUUID(), question: question.trim(), context: context.trim(), mode, frameworkIds: selected,
          results: completed, critique: audit, synthesis: merged, model: ai.model, createdAt: Date.now(),
        };
        saveThinkingRun(run);
        setHistory(loadThinkingRuns());
        toast.success('分析与综合已完成');
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSynthesizing(false);
      }
    } else if (!controller.signal.aborted) {
      toast.error('所有分析框架均执行失败');
    }
    setRunning(false);
    if (controllerRef.current === controller) controllerRef.current = null;
  }, [aiApi, configured, context, mode, question, selected, updateResult]);

  const retryOne = useCallback(async (id: ThinkingFrameworkId) => {
    if (!configured || running || !question.trim()) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    updateResult(id, { status: 'running', content: '', error: undefined });
    try {
      const result = await runFramework(id, question.trim(), context.trim(), { apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, model: aiApi.model }, controller.signal, (content) => updateResult(id, { status: 'running', content }));
      updateResult(id, result);
      setCritique(''); setSynthesis('');
      toast.success(`${FRAMEWORK_BY_ID.get(id)?.name ?? id}已重新生成，请重新执行完整分析以更新综合结论`);
    } catch (error) {
      if (!controller.signal.aborted) updateResult(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [aiApi, configured, context, question, running, updateResult]);

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
    setSynthesizing(false);
    toast.message('已停止分析');
  };

  const loadRun = (run: ThinkingRun) => {
    controllerRef.current?.abort();
    setQuestion(run.question);
    setContext(run.context);
    setMode(run.mode ?? 'standard');
    setSelected(run.frameworkIds);
    setResults(run.results);
    setCritique(run.critique ?? '');
    setSynthesis(run.synthesis);
    setHistoryOpen(false);
  };

  const doneCount = useMemo(() => results.filter((item) => item.status === 'done').length, [results]);
  const currentRun = useMemo<ThinkingRun | null>(() => question.trim() && results.length ? {
    id: 'preview', question: question.trim(), context: context.trim(), mode, frameworkIds: selected,
    results, critique, synthesis, model: aiApi.model, createdAt: Date.now(),
  } : null, [aiApi.model, context, critique, mode, question, results, selected, synthesis]);

  return <div className="flex h-full min-h-0 bg-background">
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><div><h1 className="font-semibold">战略分析室</h1><p className="text-xs text-muted-foreground">多框架并行推演与决策综合</p></div></div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!currentRun} onClick={() => { if (!currentRun) return; void navigator.clipboard.writeText(buildThinkingReport(currentRun)); toast.success('报告已复制'); }}><Copy className="h-4 w-4" /> 复制</Button>
          <Button variant="ghost" size="sm" disabled={!currentRun} onClick={() => currentRun && downloadMarkdown(`战略分析-${new Date().toISOString().slice(0, 10)}.md`, buildThinkingReport(currentRun))}><Download className="h-4 w-4" /> 导出</Button>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((value) => !value)}><History className="h-4 w-4" /> 历史</Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <section className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <label className="mb-1 block text-sm font-medium">要分析的问题</label>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} disabled={running}
              placeholder="例如：是否应该把现有单体应用拆成微服务？" className="min-h-24 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <label className="mb-1 mt-3 block text-sm font-medium">背景、目标与约束 <span className="font-normal text-muted-foreground">（可选）</span></label>
            <textarea value={context} onChange={(event) => setContext(event.target.value)} disabled={running}
              placeholder="已有证据、资源限制、时间范围、不能改变的条件……" className="min-h-16 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">分析框架</h2><p className="text-xs text-muted-foreground">建议选择 2～4 个互补框架，避免重复和过高成本</p></div><Button variant="outline" size="sm" disabled={running} onClick={recommend}><Sparkles className="h-3.5 w-3.5" /> 智能推荐</Button></div>
            <div className="mb-3 flex flex-wrap gap-2">
              {([['quick', '快速', '1～2 个并发，无交叉质询'], ['standard', '标准', '最多 3 个并发并综合'], ['deep', '深度', '增加交叉质询与盲点审计']] as const).map(([id, label, hint]) => <button key={id} type="button" disabled={running} title={hint} onClick={() => setMode(id)} className={`rounded-full border px-3 py-1 text-xs ${mode === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{label}</button>)}
              <span className="self-center text-xs text-muted-foreground">{mode === 'quick' ? '适合快速判断' : mode === 'deep' ? '请求更多、质量更高' : '推荐日常使用'}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {THINKING_FRAMEWORKS.map((item) => {
                const checked = selected.includes(item.id);
                return <button type="button" key={item.id} disabled={running} onClick={() => setSelected((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])}
                  className={`rounded-lg border p-3 text-left transition ${checked ? 'border-primary bg-primary/5' : 'hover:border-primary/40 hover:bg-muted/40'}`}>
                  <div className="flex items-center justify-between"><span className="text-sm font-medium">{item.name}</span><span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : ''}`}>{checked && <Check className="h-3 w-3" />}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                </button>;
              })}
            </div>
            <div className="mt-4 flex items-center gap-2">
              {running ? <Button variant="destructive" onClick={stop}><X className="h-4 w-4" /> 停止</Button> : <Button onClick={() => void execute()} disabled={!configured}><Sparkles className="h-4 w-4" /> 开始分析</Button>}
              {!configured && <span className="text-xs text-amber-600">请先在设置中配置 AI 服务</span>}
              {running && <span className="text-xs text-muted-foreground">已完成 {doneCount}/{selected.length}</span>}
            </div>
          </div>

          {!!results.length && <div className="grid gap-4 lg:grid-cols-2">
            {results.map((result) => {
              const meta = FRAMEWORK_BY_ID.get(result.frameworkId);
              return <article key={result.frameworkId} className="min-w-0 rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{meta?.name}</h3><div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">{result.status === 'running' ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3" />分析中</span> : result.status === 'done' ? '完成' : result.status === 'failed' ? '失败' : '等待'}</span>{(result.status === 'done' || result.status === 'failed') && <Button variant="ghost" size="sm" className="h-7 px-2" disabled={running} onClick={() => void retryOne(result.frameworkId)} title="仅重新运行这个框架"><RefreshCw className="h-3.5 w-3.5" /></Button>}</div></div>
                {result.error ? <div className="rounded bg-destructive/10 p-3 text-sm text-destructive">{result.error}</div> : result.content ? <XMarkdown content={result.content} streaming={{ hasNextChunk: result.status === 'running' }} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" /> : <div className="h-20 animate-pulse rounded bg-muted/50" />}
              </article>;
            })}
          </div>}

          {critique && <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.035] p-5">
            <h2 className="mb-3 font-semibold">交叉质询与盲点审计</h2>
            <XMarkdown content={critique} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />
          </section>}

          {(synthesis || synthesizing) && <section className="rounded-xl border border-primary/30 bg-primary/[0.025] p-5">
            <div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">委员会综合结论</h2>{synthesizing && <Loader2 className="h-3.5 w-3.5" />}</div>
            {synthesis ? <XMarkdown content={synthesis} streaming={{ hasNextChunk: synthesizing }} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" /> : <p className="text-sm text-muted-foreground">正在比较共识、分歧与盲点……</p>}
          </section>}
        </section>
      </div>
    </main>

    {historyOpen && <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-3">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">分析历史</h2><Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}><X className="h-4 w-4" /></Button></div>
      {!history.length && <p className="p-4 text-center text-sm text-muted-foreground">暂无历史记录</p>}
      <div className="space-y-2">{history.map((run) => <div key={run.id} className="group rounded-lg border p-3 hover:bg-muted/40">
        <button className="w-full text-left" onClick={() => loadRun(run)}><p className="line-clamp-2 text-sm font-medium">{run.question}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.frameworkIds.length} 个框架</p></button>
        <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-destructive opacity-0 group-hover:opacity-100" onClick={() => setHistory(deleteThinkingRun(run.id))}><Trash2 className="h-3.5 w-3.5" /> 删除</Button>
      </div>)}</div>
    </aside>}
  </div>;
}
