import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store';
import { conversationMemory } from '@/core/conversation-memory';
import type { MemorySyncProgress } from '@/core/conversation-memory';

export const SettingsMemory: React.FC = () => {
  const config = useStore((state) => state.memoryConfig);
  const setConfig = useStore((state) => state.setMemoryConfig);
  const [status, setStatus] = React.useState('');
  const [indexing, setIndexing] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [progress, setProgress] = React.useState<MemorySyncProgress | null>(null);
  const indexController = React.useRef<AbortController | null>(null);

  const numberSetting = (key: 'contextBudget' | 'recallCount' | 'minScore' | 'maxPerDocument', min: number, max: number) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) setConfig({ [key]: Math.max(min, Math.min(max, value)) });
    };

  const updateIndex = async (force = false) => {
    setIndexing(true);
    setProgress(null);
    const controller = new AbortController();
    indexController.current = controller;
    try {
      conversationMemory.configure(config);
      const stats = await conversationMemory.sync({ force, signal: controller.signal, onProgress: setProgress });
      setStatus(`已索引 ${stats.documents} 个文件、${stats.chunks} 个片段；耗时 ${(stats.durationMs / 1000).toFixed(1)} 秒${stats.failedFiles.length ? `；失败 ${stats.failedFiles.length} 个` : ''}${stats.embeddingFallback ? '；Embedding 失败，已降级为本地索引' : ''}`);
    } catch (error) { setStatus(error instanceof Error && error.message === 'INDEX_CANCELLED' ? '索引已取消' : '索引失败，请检查历史文件'); }
    finally { setIndexing(false); indexController.current = null; }
  };

  const clearIndex = async () => {
    await conversationMemory.clear();
    setProgress(null);
    setStatus('本地索引缓存已清空，可随时重新构建');
  };

  const testEmbedding = async () => {
    setTesting(true);
    const result = await window.electronAPI.createEmbeddings({
      baseUrl: config.embeddingBaseUrl,
      apiKey: config.embeddingApiKey,
      model: config.embeddingModel,
      inputs: ['历史知识库连接测试'],
    });
    setStatus(result.success
      ? `Embedding 连接成功，向量维度 ${result.embeddings?.[0]?.length ?? 0}`
      : `Embedding 连接失败：${result.error ?? '未知错误'}`);
    setTesting(false);
  };

  return (
    <section>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">历史知识库</h4>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Memory Provider</label>
          <select value={config.provider} onChange={(event) => setConfig({ provider: event.target.value as 'local' | 'openai' })}
            className="flex h-8 w-full rounded-md border bg-card px-2.5 text-xs">
            <option value="local">本地索引（IndexedDB）</option>
            <option value="openai">OpenAI 兼容 Embedding</option>
          </select>
          <p className="text-[10px] text-muted-foreground">远程模式会将历史片段发送给配置的 Embedding 服务；失败时自动降级到本地检索。</p>
        </div>

        {config.provider === 'openai' && <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Embedding Base URL</label>
            <Input value={config.embeddingBaseUrl} onChange={(event) => setConfig({ embeddingBaseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1" className="h-8 text-xs" /></div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Embedding API Key</label>
            <Input type="password" value={config.embeddingApiKey} onChange={(event) => setConfig({ embeddingApiKey: event.target.value })}
              placeholder="sk-..." className="h-8 text-xs" /></div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Embedding 模型</label>
            <Input value={config.embeddingModel} onChange={(event) => setConfig({ embeddingModel: event.target.value })}
              placeholder="text-embedding-3-small" className="h-8 text-xs" /></div>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={testing || !config.embeddingBaseUrl || !config.embeddingModel}
            onClick={() => void testEmbedding()}>{testing ? '测试中…' : '测试 Embedding'}</Button>
        </div>}

        <SettingNumber label="上下文字符预算" description="每次最多注入模型的历史正文字符数" value={config.contextBudget}
          min={1000} max={30000} step={500} onChange={numberSetting('contextBudget', 1000, 30000)} />
        <SettingNumber label="召回片段数" description="发送问题时最多召回的候选片段" value={config.recallCount}
          min={1} max={12} step={1} onChange={numberSetting('recallCount', 1, 12)} />
        <SettingNumber label="最低相关度" description="低于该分数的片段不会进入上下文" value={config.minScore}
          min={0} max={1} step={0.01} onChange={numberSetting('minScore', 0, 1)} />
        <SettingNumber label="单文件片段上限" description="避免一个长文档占满全部召回结果" value={config.maxPerDocument}
          min={1} max={6} step={1} onChange={numberSetting('maxPerDocument', 1, 6)} />

        <label className="flex items-center justify-between rounded-md border p-2.5">
          <span><span className="block text-xs font-medium">自动更新索引</span><span className="text-[10px] text-muted-foreground">保存或修改历史文件后自动同步</span></span>
          <input type="checkbox" checked={config.autoIndex} onChange={(event) => setConfig({ autoIndex: event.target.checked })} />
        </label>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={indexing} onClick={() => void updateIndex()}>
            {indexing ? '更新中…' : '立即更新索引'}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={indexing} onClick={() => void updateIndex(true)}>强制重建</Button>
          {indexing
            ? <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => indexController.current?.abort()}>取消</Button>
            : <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => void clearIndex()}>清空缓存</Button>}
        </div>
        {progress && <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{progress.phase === 'reading' ? `读取 ${progress.fileName ?? ''}` : progress.phase === 'embedding' ? '生成向量' : '保存索引'}</span>
            <span>{progress.completed}/{progress.total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all"
            style={{ width: `${progress.total ? Math.round(progress.completed / progress.total * 100) : 0}%` }} /></div>
        </div>}
        {status && <div className="text-[10px] text-muted-foreground">{status}</div>}
      </div>
    </section>
  );
};

function SettingNumber(props: {
  label: string; description: string; value: number; min: number; max: number; step: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return <div className="space-y-1.5">
    <div className="flex items-end justify-between gap-3">
      <label className="text-xs font-medium text-muted-foreground">{props.label}<span className="block text-[10px] font-normal">{props.description}</span></label>
      <Input type="number" value={props.value} min={props.min} max={props.max} step={props.step} onChange={props.onChange} className="h-8 w-24 text-xs" />
    </div>
  </div>;
}
