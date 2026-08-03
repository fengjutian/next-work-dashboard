import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store';
import { conversationMemory } from '@/core/conversation-memory';

export const SettingsMemory: React.FC = () => {
  const config = useStore((state) => state.memoryConfig);
  const setConfig = useStore((state) => state.setMemoryConfig);
  const [status, setStatus] = React.useState('');
  const [indexing, setIndexing] = React.useState(false);

  const numberSetting = (key: 'contextBudget' | 'recallCount' | 'minScore' | 'maxPerDocument', min: number, max: number) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) setConfig({ [key]: Math.max(min, Math.min(max, value)) });
    };

  const updateIndex = async () => {
    setIndexing(true);
    try {
      conversationMemory.configure(config);
      const stats = await conversationMemory.sync();
      setStatus(`已索引 ${stats.documents} 个文件、${stats.chunks} 个片段`);
    } catch { setStatus('索引失败，请检查历史文件'); }
    finally { setIndexing(false); }
  };

  return (
    <section>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">历史知识库</h4>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Memory Provider</label>
          <select value={config.provider} disabled className="flex h-8 w-full rounded-md border bg-card px-2.5 text-xs">
            <option value="local">本地索引（IndexedDB）</option>
          </select>
          <p className="text-[10px] text-muted-foreground">TencentDB Provider 将在官方 OpenAPI 稳定后提供。</p>
        </div>

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
          {status && <span className="text-[10px] text-muted-foreground">{status}</span>}
        </div>
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
