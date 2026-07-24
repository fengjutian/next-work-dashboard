import React from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';

// ── AI API 设置 Tab ──

const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export const SettingsAiApi: React.FC = () => {
  const aiApi = useStore((s) => s.aiApi);
  const setAiApi = useStore((s) => s.setAiApi);
  const [showKey, setShowKey] = React.useState(false);
  const [testStatus, setTestStatus] = React.useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = React.useState('');

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
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        AI API
      </h4>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
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
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
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
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            模型
          </label>
          <select
            value={aiApi.model}
            onChange={(e) =>
              setAiApi({ model: e.target.value as typeof aiApi.model })
            }
            className="flex h-8 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
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
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> {testMessage}
            </span>
          )}
          {testStatus === 'fail' && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {testMessage}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
