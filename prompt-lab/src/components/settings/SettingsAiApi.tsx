import React from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { dbClearLlmCache, dbClearLlmCacheEvents, dbClearSemanticShadow, dbGetLlmCacheCount, dbGetLlmCacheStats, dbGetSemanticShadowCount, flushDbToDisk } from '@/db';
import { clearLlmMemoryCaches, getLlmCacheMetrics, getSemanticShadowMetrics, resetLlmCacheMetrics, resetSemanticShadowMetrics } from '@/core';

// ── AI API 设置 Tab ──

const PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', models: [{ value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' }, { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }] },
  qwen: { label: '千问（DashScope）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus', models: [{ value: 'qwen3.8-max-preview', label: 'Qwen 3.8 Max Preview' }, { value: 'qwen3.7-plus', label: 'Qwen 3.7 Plus' }, { value: 'qwen3.7-flash', label: 'Qwen 3.7 Flash' }] },
  custom: { label: '自定义 OpenAI 兼容', baseUrl: '', model: '', models: [] },
} as const;
const QWEN_URLS = {
  payg: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'token-plan': 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
} as const;

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
  const [shadowMetrics, setShadowMetrics] = React.useState(() => getSemanticShadowMetrics());
  const [persistentStats, setPersistentStats] = React.useState(() => dbGetLlmCacheStats());

  const refreshCacheStats = () => {
    setCacheCount(dbGetLlmCacheCount());
    setCacheMetrics(getLlmCacheMetrics());
    setShadowMetrics(getSemanticShadowMetrics());
    setPersistentStats(dbGetLlmCacheStats());
  };

  const clearCache = async () => {
    dbClearLlmCache();
    dbClearSemanticShadow();
    dbClearLlmCacheEvents();
    clearLlmMemoryCaches();
    resetLlmCacheMetrics();
    resetSemanticShadowMetrics();
    await flushDbToDisk();
    refreshCacheStats();
  };

  const changeProvider = (provider: keyof typeof PROVIDERS) => {
    const preset = PROVIDERS[provider];
    const providerApiKeys = { ...(aiApi.providerApiKeys ?? {}), [aiApi.provider]: aiApi.apiKey };
    const nextKey = (providerApiKeys[provider] ?? '').trim();
    const qwenPlan = provider === 'qwen' && nextKey.startsWith('sk-sp-') ? 'token-plan' : (aiApi.qwenPlan ?? 'payg');
    setAiApi({ provider, qwenPlan, providerApiKeys, apiKey: nextKey, baseUrl: provider === 'qwen' ? QWEN_URLS[qwenPlan] : preset.baseUrl, model: preset.model });
    setTestStatus('idle'); setTestMessage('');
  };
  const models = PROVIDERS[aiApi.provider].models;
  const changeQwenPlan = (qwenPlan: 'payg' | 'token-plan') => setAiApi({ qwenPlan, baseUrl: QWEN_URLS[qwenPlan] });
  const changeApiKey = (value: string) => {
    const apiKey = value.trim();
    const detectedPlan = aiApi.provider === 'qwen' && apiKey.startsWith('sk-sp-') ? 'token-plan' : aiApi.qwenPlan;
    setAiApi({ apiKey, qwenPlan: detectedPlan, baseUrl: detectedPlan ? QWEN_URLS[detectedPlan] : aiApi.baseUrl, providerApiKeys: { ...(aiApi.providerApiKeys ?? {}), [aiApi.provider]: apiKey } });
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
      const proxyResult = aiApi.provider === 'qwen' ? await window.electronAPI.llmChat({ baseUrl: base, apiKey: aiApi.apiKey, body: { model: aiApi.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, stream: false } }) : null;
      const res = proxyResult ? null : await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${aiApi.apiKey}` } });
      if (proxyResult?.ok || res?.ok) {
        setTestStatus('ok');
        setTestMessage('连接成功');
      } else {
        const status = proxyResult?.status ?? res?.status ?? 0;
        const body = proxyResult?.error ?? await res?.text().catch(() => '') ?? '';
        setTestStatus('fail');
        const qwenHint = aiApi.provider === 'qwen' && status === 401
          ? `；请确认 ${aiApi.qwenPlan === 'token-plan' ? 'sk-sp Key 对应 Token Plan 地址' : 'sk-ws/sk Key 对应按量付费地址'}，并检查 Key 是否完整`
          : '';
        setTestMessage(`${status ? `HTTP ${status}` : '网络请求失败'}${body ? ': ' + body.slice(0, 120) : ''}${qwenHint}`);
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
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">供应商</label>
          <select value={aiApi.provider} onChange={(event) => changeProvider(event.target.value as keyof typeof PROVIDERS)} className="flex h-8 w-full rounded-md border border-border bg-card px-2.5 text-xs">
            {Object.entries(PROVIDERS).map(([value, provider]) => <option key={value} value={value}>{provider.label}</option>)}
          </select>
        </div>
        {aiApi.provider === 'qwen' && <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">千问计费类型</label>
          <select value={aiApi.qwenPlan ?? 'payg'} onChange={(event) => changeQwenPlan(event.target.value as 'payg' | 'token-plan')} className="flex h-8 w-full rounded-md border border-border bg-card px-2.5 text-xs">
            <option value="payg">按量付费（sk-ws / sk）</option><option value="token-plan">Token Plan（sk-sp）</option>
          </select>
        </div>}
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            API Key
          </label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={aiApi.apiKey}
              onChange={(e) => changeApiKey(e.target.value)}
              placeholder={aiApi.provider === 'qwen' ? 'sk-ws-...' : 'sk-...'}
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
          {aiApi.provider !== 'custom' ? <select
            value={aiApi.model}
            onChange={(e) =>
              setAiApi({ model: e.target.value })
            }
            className="flex h-8 w-full rounded-md border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 ring-ring"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select> : <Input value={aiApi.model} onChange={(event) => setAiApi({ model: event.target.value })} placeholder="模型名称" className="h-8 text-xs" />}
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
          <label className="flex items-center justify-between rounded border p-2 text-xs">
            <span><span className="block font-medium">语义影子模式</span><span className="text-[10px] text-muted-foreground">只评估相似候选，不返回缓存答案；需要配置 Embedding</span></span>
            <input type="checkbox" checked={llmCacheConfig.semanticShadowEnabled} onChange={(event) => setLlmCacheConfig({ semanticShadowEnabled: event.target.checked })} />
          </label>
          <div className="rounded-md bg-muted/40 p-2 text-[10px] text-muted-foreground">
            <div>本地条目 {cacheCount} · L1 命中 {cacheMetrics.memoryHits} · L2 命中 {cacheMetrics.persistentHits}</div>
            <div>未命中 {cacheMetrics.misses} · 合并请求 {cacheMetrics.coalescedHits} · 主动绕过 {cacheMetrics.bypasses}</div>
            <div>影子条目 {dbGetSemanticShadowCount()} · 候选 {shadowMetrics.candidates} · ≥0.97 {shadowMetrics.highConfidence} · 最佳 {Math.max(0, shadowMetrics.bestSimilarity).toFixed(3)}</div>
            <div>近30天有效命中率 {persistentStats.total ? (((persistentStats.memoryHits + persistentStats.persistentHits + persistentStats.coalescedHits) / persistentStats.total) * 100).toFixed(1) : '0.0'}% · 请求 {persistentStats.total}</div>
            <div>影子分布：低 {persistentStats.shadowNone} · 中 {persistentStats.shadowMedium} · 高 {persistentStats.shadowHigh} · 均值 {persistentStats.averageShadowSimilarity.toFixed(3)}</div>
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
