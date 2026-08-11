/**
 * ZodiacPerspectivesPanel — 主面板
 *
 * 职责：
 * - 串接 QuestionInput / PerspectiveGrid / SynthesisPanel / HistoryDrawer / FollowupDialog
 * - 调度 zodiac-service 12 路并行 + 独立汇总
 * - 维护 RunSession（卡片状态、汇总状态、错误）
 * - 持久化：完成后写入 DB、读历史进入面板
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, History, RefreshCw, Save, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/store';
import { QuestionInput } from './components/QuestionInput';
import { PerspectiveGrid, type DifferenceFilter, type LayoutMode } from './components/PerspectiveGrid';
import { SynthesisPanel } from './components/SynthesisPanel';
import { HistoryDrawer } from './components/HistoryDrawer';
import { FollowupDialog } from './components/FollowupDialog';
import { DecisionSummary } from './components/DecisionSummary';
import { QualityStatsDialog } from './components/QualityStatsDialog';
import { recordFeedback, recordRunMetric } from './zodiac-quality';
import { ZODIAC_SIGNS, ZODIAC_ORDER } from './zodiac-types';
import type {
  CardStatus,
  GenerationOptions,
  PerspectiveCardState,
  SynthesisStatus,
  ZodiacPerspective,
  ZodiacRun,
  ZodiacSign,
} from './zodiac-types';
import { describeLlmError, generateAllPerspectives, generatePerspective, regenerateSynthesis, type GenerateCallbacks } from './zodiac-service';
import { buildAllPerspectivesMarkdown, copyText } from './zodiac-copy';
import {
  defaultTitle,
  pruneOldRuns,
  saveRun,
  setFavorite,
  setPartial,
  updateRunPerspectives,
  updateRunSynthesis,
} from './zodiac-storage';
import { detectHighRisk } from './zodiac-prompts';
import { ZODIAC_META } from './zodiac-data';

const DEFAULT_OPTIONS: GenerationOptions = {
  scene: 'general',
  length: 'standard',
  tone: 'gentle',
  includeSynthesis: true,
  mode: 'standard',
  selectedSigns: [...ZODIAC_SIGNS],
};

const EMPTY_RUN: Omit<ZodiacRun, 'id' | 'createdAt' | 'updatedAt'> = {
  question: '',
  options: DEFAULT_OPTIONS,
  perspectives: [],
  synthesis: null,
  favorite: false,
  title: '',
  model: '',
  partial: false,
};

function makeInitialCards(signs: readonly ZodiacSign[] = ZODIAC_SIGNS): PerspectiveCardState[] {
  return signs.map((sign) => ({ sign, status: 'pending' as CardStatus }));
}

// ── 差异识别：focus 第一条 / 关键词集合做近似去重 ──────────────────

const SIGNATURE_STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '你', '我', '他', '她', '它', '我们', '你们', '他们',
  '可以', '需要', '应该', '要', '把', '让', '给', '为', '到', '从', '对', '以', '及', '等', '与',
  '一个', '一些', '什么', '怎么', '如何', '是否', '也', '就', '都', '还', '更', '最', '比较',
]);

function tokenize(text: string): string[] {
  return text
    .replace(/[，。！？、；：·…—《》（）()【】[]"'`]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SIGNATURE_STOPWORDS.has(token));
}

function signatureOf(perspective: ZodiacPerspective): string {
  const tokens = new Set<string>();
  for (const item of perspective.focus) {
    for (const token of tokenize(item)) tokens.add(token);
  }
  for (const item of perspective.advice) {
    for (const token of tokenize(item.slice(0, 30))) tokens.add(token);
  }
  return [...tokens].sort().join('|');
}

function identifyOutliers(perspectives: ZodiacPerspective[]): ZodiacSign[] {
  if (perspectives.length < 4) return [];
  const counts = new Map<string, number>();
  const sigOfPerspective = new Map<ZodiacSign, string>();
  for (const p of perspectives) {
    const sig = signatureOf(p);
    sigOfPerspective.set(p.sign, sig);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  // 取出现次数最少（唯一）签名的视角作为差异
  const minCount = Math.min(...counts.values());
  const outliers: ZodiacSign[] = [];
  for (const [sign, sig] of sigOfPerspective.entries()) {
    if ((counts.get(sig) ?? 0) === minCount && minCount < 3) {
      outliers.push(sign);
    }
  }
  return outliers;
}

// ── 主面板 ─────────────────────────────────────────────────────

export function ZodiacPerspectivesPanel() {
  const aiApi = useStore((state) => state.aiApi);
  const aiConfigured = Boolean(aiApi.apiKey?.trim() && aiApi.baseUrl?.trim() && aiApi.model?.trim());

  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  const [run, setRun] = useState<ZodiacRun | null>(null);
  const [cards, setCards] = useState<PerspectiveCardState[]>(() => makeInitialCards());
  const [synthesisStatus, setSynthesisStatus] = useState<SynthesisStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highRiskNotice, setHighRiskNotice] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [differenceFilter, setDifferenceFilter] = useState<DifferenceFilter>('all');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [followup, setFollowup] = useState<{ open: boolean; sign: ZodiacSign | null }>({ open: false, sign: null });
  const [running, setRunning] = useState(false);
  const [qualityStatsOpen, setQualityStatsOpen] = useState(false);

  const generationAbortRef = useRef<AbortController | null>(null);
  const synthesisAbortRef = useRef<AbortController | null>(null);
  const retryAbortRefs = useRef<Map<ZodiacSign, AbortController>>(new Map());
  const runIdRef = useRef<string | null>(null);

  // 计算差异
  const outlierSigns = useMemo(() => {
    const structured = run?.synthesis?.distinctiveViews?.map((item) => item.sign) ?? [];
    if (structured.length > 0) return structured;
    const done = cards.filter((c) => c.status === 'done' && c.perspective).map((c) => c.perspective!);
    return identifyOutliers(done);
  }, [cards, run?.synthesis]);

  const completedCount = useMemo(() => cards.filter((c) => c.status === 'done').length, [cards]);

  // 写入 DB：每次 perspectives / synthesis 变化时（去抖）
  useEffect(() => {
    if (!run) return;
    const completed = cards.filter((c) => c.perspective).map((c) => c.perspective!) as ZodiacPerspective[];
    if (completed.length === 0 && synthesisStatus !== 'done') return;
    const next: ZodiacRun = {
      ...run,
      perspectives: completed,
      updatedAt: Date.now(),
    };
    if (next.perspectives.length > 0) {
      saveRun(next);
    }
  }, [cards, synthesisStatus, run?.synthesis, run?.id]);

  // 启动时清理历史
  useEffect(() => {
    pruneOldRuns();
  }, []);

  // 插件切换或组件卸载时终止仍在进行的生成/汇总，避免卸载后更新状态。
  useEffect(() => () => {
    generationAbortRef.current?.abort();
    synthesisAbortRef.current?.abort();
    for (const controller of retryAbortRefs.current.values()) controller.abort();
    retryAbortRefs.current.clear();
    generationAbortRef.current = null;
    synthesisAbortRef.current = null;
  }, []);

  // ── 操作：开始生成 ────────────────────────────────────────────

  const startGeneration = useCallback(
    async (question: string) => {
      if (!aiConfigured) {
        toast.error('请先在工作台设置中配置 AI 服务（API Key、Base URL、模型）');
        return;
      }
      // 取消旧任务
      generationAbortRef.current?.abort();
      const controller = new AbortController();
      generationAbortRef.current = controller;

      const runId = crypto.randomUUID();
      runIdRef.current = runId;
      const newRun: ZodiacRun = {
        ...EMPTY_RUN,
        id: runId,
        question,
        title: defaultTitle(question),
        options,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: aiApi.model,
        partial: false,
      };
      setRun(newRun);
      setCards(makeInitialCards(options.selectedSigns));
      setSynthesisStatus('idle');
      setErrorMessage(null);

      // 高风险提示
      const hr = detectHighRisk(question);
      setHighRiskNotice(hr ? `${hr.category}类问题：${hr.guidance}` : null);

      setRunning(true);
      const generationStartedAt = Date.now();

      // 流式更新卡片
      const updateCard = (sign: ZodiacSign, patch: Partial<PerspectiveCardState>) => {
        setCards((prev) => prev.map((c) => (c.sign === sign ? { ...c, ...patch } : c)));
      };

      const callbacks: GenerateCallbacks = {
        onCardStart: (sign) => updateCard(sign, { status: 'streaming', streamedInterpretation: '', error: undefined }),
        // 模型流里是尚未闭合的 JSON；卡片只展示生成占位，解析成功后再呈现正文。
        onCardDone: (sign, perspective) => updateCard(sign, { status: 'done', perspective, streamedInterpretation: undefined, error: undefined }),
        onCardFailed: (sign, error) => updateCard(sign, { status: 'failed', error, streamedInterpretation: undefined }),
        onSynthesisStart: () => setSynthesisStatus('running'),
        onSynthesisDone: (synthesis) => {
          setSynthesisStatus('done');
          setRun((prev) => (prev ? { ...prev, synthesis, updatedAt: Date.now() } : prev));
          updateRunSynthesis(runId, synthesis);
        },
        onSynthesisFailed: (error) => {
          setSynthesisStatus('failed');
          setErrorMessage(error);
        },
        onFatalError: (error) => {
          setErrorMessage(error);
          toast.error(error);
        },
      };

      try {
        const result = await generateAllPerspectives(question, options, {
          apiKey: aiApi.apiKey,
          baseUrl: aiApi.baseUrl,
          model: aiApi.model,
        }, callbacks, controller.signal);
        recordRunMetric({
          scene: options.scene,
          mode: options.mode,
          durationMs: Date.now() - generationStartedAt,
          expected: options.selectedSigns.length,
          parsed: result.perspectives.length,
          fastFallback: options.mode === 'fast' && result.warnings.some((item) => item.includes('自动逐项补全')),
          perspectives: result.perspectives,
        });

        // 标记 partial（失败项）
        if (result.partialSigns.length > 0) {
          setPartial(runId, true);
          setRun((prev) => (prev ? { ...prev, partial: true } : prev));
        }
        if (result.warnings.length > 0) {
          for (const w of result.warnings) toast.warning(w);
        }
        if (result.synthesis) {
          setSynthesisStatus('done');
        } else if (options.includeSynthesis) {
          setSynthesisStatus('failed');
        }
        if (result.partialSigns.length > 0) {
          toast.warning(`${result.partialSigns.length} 个视角生成失败，可在卡片上点击「重试」补全。`);
        } else {
          toast.success(`${options.selectedSigns.length} 个星座视角已全部回答完毕。`);
        }
      } catch (error) {
        const message = describeLlmError(error);
        if (controller.signal.aborted) {
          toast.message('已取消当前生成。');
        } else {
          setErrorMessage(message);
          toast.error(message);
        }
      } finally {
        setRunning(false);
        if (generationAbortRef.current === controller) generationAbortRef.current = null;
      }
    },
    [aiApi, aiConfigured, options],
  );

  // ── 操作：取消 ────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    generationAbortRef.current?.abort();
  }, []);

  // ── 操作：重试单张卡 ──────────────────────────────────────────

  const handleRetryOneSign = useCallback(
    async (sign: ZodiacSign) => {
      if (!run || !aiConfigured) return;
      const updateCard = (patch: Partial<PerspectiveCardState>) => {
        setCards((prev) => prev.map((c) => (c.sign === sign ? { ...c, ...patch } : c)));
      };
      updateCard({ status: 'streaming', error: undefined, streamedInterpretation: '' });
      const controller = new AbortController();
      retryAbortRefs.current.get(sign)?.abort();
      retryAbortRefs.current.set(sign, controller);
      try {
        const perspective = await generatePerspective(
          sign,
          run.question,
          run.options,
          { apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, model: aiApi.model },
          controller.signal,
        );
        // 只有新答案成功后才让旧总结失效；失败重试仍保留原有一致结果。
        setSynthesisStatus('idle');
        updateRunSynthesis(run.id, null);
        updateCard({ status: 'done', perspective, streamedInterpretation: undefined });
        setRun((prev) => {
          if (!prev) return prev;
          const nextPerspectives = [...prev.perspectives.filter((p) => p.sign !== sign), perspective]
            .sort((a, b) => ZODIAC_ORDER.indexOf(a.sign) - ZODIAC_ORDER.indexOf(b.sign));
          const partial = nextPerspectives.length !== prev.options.selectedSigns.length;
          updateRunPerspectives(prev.id, nextPerspectives);
          setPartial(prev.id, partial);
          return { ...prev, partial, perspectives: nextPerspectives, synthesis: null, updatedAt: Date.now() };
        });
        toast.success(`${ZODIAC_META[sign].name} 已重新生成。`);
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = describeLlmError(error);
        updateCard({ status: 'failed', error: message, streamedInterpretation: undefined });
        toast.error(`重试失败：${message}`);
      } finally {
        if (retryAbortRefs.current.get(sign) === controller) retryAbortRefs.current.delete(sign);
      }
    },
    [aiApi, aiConfigured, run],
  );

  const handleRetrySynthesis = useCallback(async () => {
    if (!run || !aiConfigured || run.perspectives.length < 4) return;
    setSynthesisStatus('running');
    setErrorMessage(null);
    const controller = new AbortController();
    synthesisAbortRef.current?.abort();
    synthesisAbortRef.current = controller;
    try {
      const synthesis = await regenerateSynthesis(
        run.question,
        run.options,
        run.perspectives,
        { apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl, model: aiApi.model },
        controller.signal,
      );
      updateRunSynthesis(run.id, synthesis);
      setRun((prev) => (prev ? { ...prev, synthesis, updatedAt: Date.now() } : prev));
      setSynthesisStatus('done');
      toast.success('圆桌纪要已更新。');
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = describeLlmError(error);
      setErrorMessage(message);
      setSynthesisStatus('failed');
      toast.error(`总结生成失败：${message}`);
    } finally {
      if (synthesisAbortRef.current === controller) synthesisAbortRef.current = null;
    }
  }, [aiApi, aiConfigured, run]);

  // ── 操作：补全缺失 ──────────────────────────────────────────

  const handleFillMissing = useCallback(async () => {
    const missing = cards.filter((c) => c.status === 'failed' || c.status === 'pending').map((c) => c.sign);
    if (!missing.length) return;
    for (const sign of missing) {
      // 顺序串行重试，避免触发限流
      // eslint-disable-next-line no-await-in-loop
      await handleRetryOneSign(sign);
    }
  }, [cards, handleRetryOneSign]);

  // ── 操作：复制全部 ──────────────────────────────────────────

  const handleCopyAll = useCallback(async () => {
    if (!run) return;
    const ok = await copyText(buildAllPerspectivesMarkdown(run));
    toast[ok ? 'success' : 'error'](ok ? '已复制全部视角（Markdown）' : '复制失败');
  }, [run]);

  // ── 操作：保存 / 收藏 / 命名 ──────────────────────────────────

  const handleToggleFavorite = useCallback(() => {
    if (!run) return;
    const nextFavorite = !run.favorite;
    setFavorite(run.id, nextFavorite);
    setRun((prev) => (prev ? { ...prev, favorite: nextFavorite } : prev));
    toast.success(nextFavorite ? '已收藏本轮' : '已取消收藏');
  }, [run]);

  // ── 操作：打开历史 ──────────────────────────────────────────

  const handleSelectHistory = useCallback((historical: ZodiacRun) => {
    const cardsFromHistory = historical.options.selectedSigns.map((sign) => {
      const p = historical.perspectives.find((item) => item.sign === sign);
      return p
        ? { sign, status: 'done' as CardStatus, perspective: p }
        : { sign, status: 'pending' as CardStatus };
    });
    setRun(historical);
    setCards(cardsFromHistory);
    setSynthesisStatus(historical.synthesis ? 'done' : historical.options.includeSynthesis ? 'skipped' : 'idle');
    setOptions(historical.options);
    setHistoryOpen(false);
    toast.message('已加载历史记录（只读模式）');
  }, []);

  // ── 操作：开启追问 ──────────────────────────────────────────

  const handleOpenFollowup = useCallback((sign: ZodiacSign) => {
    setFollowup({ open: true, sign });
  }, []);

  const currentRunForFollowup: ZodiacRun | null = useMemo(() => {
    if (!run) return null;
    // 给当前 run 加最新的 cards 状态
    return { ...run, perspectives: cards.filter((c) => c.perspective).map((c) => c.perspective!) as ZodiacPerspective[] };
  }, [run, cards]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">十二星座视角</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">· 多视角思考</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setQualityStatsOpen(true)}>质量统计</Button>
      </header>

      <QuestionInput
        options={options}
        onOptionsChange={setOptions}
        onSubmit={startGeneration}
        onClear={() => { setErrorMessage(null); setHighRiskNotice(null); }}
        disabled={running}
        aiConfigured={aiConfigured}
      />

      {highRiskNotice && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <span>⚠</span>
          <span>{highRiskNotice}</span>
        </div>
      )}

      {running && (
        <div className="flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
          <span>正在生成 {options.selectedSigns.length} 个星座视角（已完成 {completedCount} / {options.selectedSigns.length}）…</span>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <RefreshCw className="h-3.5 w-3.5" /> 取消
          </Button>
        </div>
      )}

      {errorMessage && !running && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {run && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate text-foreground">
                <span className="text-xs text-muted-foreground">本轮问题：</span>
                {run.question}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(run.createdAt).toLocaleString('zh-CN')} · 场景 {run.options.scene} · 篇幅 {run.options.length} · 语气 {run.options.tone} · 模型 {run.model}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleCopyAll} disabled={!run.perspectives.length}>
                <Copy className="h-3.5 w-3.5" /> 复制全部
              </Button>
              <Button variant="ghost" size="sm" onClick={handleToggleFavorite} disabled={!run.perspectives.length}>
                <Save className="h-3.5 w-3.5" /> {run.favorite ? '已收藏' : '收藏'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <History className="h-3.5 w-3.5" /> 历史
              </Button>
              {run.partial && (
                <Button variant="outline" size="sm" onClick={handleFillMissing} disabled={running || !aiConfigured}>
                  <RefreshCw className="h-3.5 w-3.5" /> 补全缺失视角
                </Button>
              )}
            </div>
          </div>

          {run.synthesis && <DecisionSummary synthesis={run.synthesis} />}

          {run.perspectives.length > 0 && (
            <PerspectiveGrid
              cards={cards}
              outlierSigns={outlierSigns}
              run={run}
              layout={layout}
              differenceFilter={differenceFilter}
              onLayoutChange={setLayout}
              onDifferenceFilterChange={setDifferenceFilter}
              onFollowup={handleOpenFollowup}
              onRetry={handleRetryOneSign}
              onCopy={(text, success) => toast[success ? 'success' : 'error'](text)}
              onFeedback={(sign, kind) => {
                recordFeedback({ sign, kind, scene: run.options.scene, model: run.model });
                toast.success('感谢反馈，已匿名保存在本地。');
              }}
            />
          )}

          {run.options.includeSynthesis && (
            <SynthesisPanel
              run={run}
              status={synthesisStatus}
              synthesis={run.synthesis}
              error={errorMessage ?? undefined}
              onCopy={(text, success) => toast[success ? 'success' : 'error'](text)}
              onRetry={handleRetrySynthesis}
            />
          )}
        </>
      )}

      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onSelectRun={handleSelectHistory}
        onAfterMutation={() => { /* 抽屉内自刷新；这里无需动作 */ }}
        onCopy={(text, success) => toast[success ? 'success' : 'error'](text)}
      />

      <FollowupDialog
        open={followup.open}
        onOpenChange={(open) => setFollowup((prev) => ({ ...prev, open }))}
        run={currentRunForFollowup}
        sign={followup.sign}
        apiKey={aiApi.apiKey ?? ''}
        baseUrl={aiApi.baseUrl ?? ''}
        model={aiApi.model ?? ''}
        onCopy={(text, success) => toast[success ? 'success' : 'error'](text)}
      />
      <QualityStatsDialog open={qualityStatsOpen} onClose={() => setQualityStatsOpen(false)} />
    </div>
  );
}
