import React from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { dbClearLlmCache, dbGetLlmCacheCount, flushDbToDisk } from '@/db';
import { clearLlmMemoryCaches, getLlmCacheMetrics, resetLlmCacheMetrics } from '@/core';

// ── AI API 设置 Tab ──

const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export const SettingsAiApi: React.FC = () => {
  const aiApi = useStore((s) => s.aiApi);
  const setAiApi = useStore((s) => s.setAiApi);
  const llmCacheConfig = useStore((s) => s.llmCacheConfig);
  const setLlmCacheConfig = useStore((s) => s.setLlmCacheConfig);
  const [showKey, setShowKey] = React.useState(false);
  const [testStatus, setTestStatus] = React.useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = React.useState('');
  const [cacheCount, setCacheCount] = React.useState(() => dbGetLlmCacheCount());
  const [cacheMetrics, setCacheMetrics] = React.useState(() => getLlmCacheMetrics());

  const refreshCacheStats = () => {
    setCacheCount(dbGetLlmCacheCount());
    setCacheMetrics(getLlmCacheMetrics());
  };

  const clearCache = async () => {
    dbClearLlmCache();
    clearLlmMemoryCaches();
    resetLlmCacheMetrics();
    await flushDbToDisk();
    refreshCacheStats();
  };

  const handleTest = async () => {
    if (!aiApi.apiKey) {
      setTestStatus('fail');
      setTestMessage('请先填写 API Key');
      return;
    }
    setTestStatus('testing');
    setTestMessage('');
    try {
      const base = aiApi.baseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${aiApi.apiKey}` },
      });
      if (res.ok) {
        setTestStatus('ok');
        setTestMessage('连接成功');
      } else {
        const body = await res.text().catch(() => '');
        setTestStatus('fail');
        setTestMessage(`HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
      }
    } catch (err: any) {
      setTestStatus('fail');
      setTestMessage(err?.message ?? '网络请求失败');
    }
  };

  return (
    <section>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        AI API
      </h4>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            API Key
          </label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={aiApi.apiKey}
              onChange={(e) => setAiApi({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="pr-8 h-8 text-xs"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Model */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            模型
          </label>
          <select
            value={aiApi.model}
            onChange={(e) =>
              setAiApi({ model: e.target.value as typeof aiApi.model })
            }
            className="flex h-8 w-full rounded-md border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 ring-ring"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Base URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            API Base URL
          </label>
          <Input
            type="text"
            value={aiApi.baseUrl}
            onChange={(e) => setAiApi({ baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
            className="h-8 text-xs"
          />
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleTest}
            disabled={testStatus === 'testing'}
          >
            {testStatus === 'testing' && (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            )}
            测试连接
          </Button>
          {testStatus === 'ok' && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> {testMessage}
            </span>
          )}
          {testStatus === 'fail' && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {testMessage}
            </span>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-xs font-medium">AI 响应缓存</div><div className="text-[10px] text-muted-foreground">普通对话使用本地精确缓存；Agent 与工具调用不会缓存</div></div>
            <input type="checkbox" checked={llmCacheConfig.enabled} onChange={(event) => setLlmCacheConfig({ enabled: event.target.checked })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-[10px] text-muted-foreground">有效期（小时）
              <Input type="number" min={1} max={720} value={llmCacheConfig.ttlHours} onChange={(event) => setLlmCacheConfig({ ttlHours: Number(event.target.value) })} className="h-8 text-xs" />
            </label>
            <label className="space-y-1 text-[10px] text-muted-foreground">最大条目数
              <Input type="number" min={100} max={50000} step={100} value={llmCacheConfig.maxEntries} onChange={(event) => setLlmCacheConfig({ maxEntries: Number(event.target.value) })} className="h-8 text-xs" />
            </label>
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-[10px] text-muted-foreground">
            <div>本地条目 {cacheCount} · L1 命中 {cacheMetrics.memoryHits} · L2 命中 {cacheMetrics.persistentHits}</div>
            <div>未命中 {cacheMetrics.misses} · 合并请求 {cacheMetrics.coalescedHits} · 主动绕过 {cacheMetrics.bypasses}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={refreshCacheStats}>刷新统计</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => void clearCache()}>清空缓存</Button>
          </div>
        </div>
      </div>
    </section>
  );
};
