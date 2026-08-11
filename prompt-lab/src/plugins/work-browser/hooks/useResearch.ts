/**
 * useResearch — Research Mode 一站式 hook
 */
import { useCallback, useState } from 'react';

export interface ResearchProgress {
  stage: 'seed-query' | 'multi-search' | 'extract' | 'analyze' | 'save' | 'done' | 'error';
  message: string;
}

export interface ResearchResult {
  taskId: string;
  report: string;
  citations: Array<{ title: string; url: string; excerpt: string }>;
  reportPath?: string;
  took: number;
}

export function useResearch() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ResearchProgress | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (topic: string, workspaceId: string): Promise<ResearchResult | null> => {
    if (!topic.trim()) return null;
    setLoading(true); setError(null); setResult(null);
    setProgress({ stage: 'seed-query', message: '正在构造子查询…' });
    try {
      // 模拟阶段进度（实际进度由 main 端发，本轮简化：按时间推进）
      const progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (!prev) return prev;
          const order: ResearchProgress['stage'][] = ['seed-query', 'multi-search', 'extract', 'analyze', 'save', 'done'];
          const idx = order.indexOf(prev.stage);
          if (idx < 0 || idx >= order.length - 1) return prev;
          const next = order[idx + 1];
          const messages: Record<ResearchProgress['stage'], string> = {
            'seed-query': '正在构造子查询…',
            'multi-search': '多引擎并行搜索中…',
            'extract': '正文净化提取中…',
            'analyze': 'AI 聚合分析中…',
            'save': '保存报告到 Workspace…',
            'done': '研究完成',
            'error': '出错',
          };
          return { stage: next, message: messages[next] };
        });
      }, 2500);

      const r = (await window.electronAPI.workBrowser.research.run({ topic, workspaceId, autoSave: true })) as ResearchResult;
      clearInterval(progressTimer);
      setProgress({ stage: 'done', message: '研究完成' });
      setResult(r);
      return r;
    } catch (e) {
      setProgress({ stage: 'error', message: e instanceof Error ? e.message : String(e) });
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, progress, result, error, run };
}
