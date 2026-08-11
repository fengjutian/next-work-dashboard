/**
 * SearchBar — 顶部统一搜索（含 scope 切换 + Research 入口）
 */
import { Input, Button, Tooltip } from '../ui';
import { Search, Save, Shield, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import type { SearchScope } from '../hooks/useSearch';

export interface SearchBarProps {
  onSearch: (text: string, scope: SearchScope) => void;
  onSave?: () => void;
  onResearch?: (topic: string) => void;
  cleanerEnabled?: boolean;
  onToggleCleaner?: () => void;
  loading?: boolean;
  defaultScope?: SearchScope;
}

export function SearchBar({ onSearch, onSave, onResearch, cleanerEnabled, onToggleCleaner, loading, defaultScope = 'workspace' }: SearchBarProps) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<SearchScope>(defaultScope);
  const submit = () => { if (text.trim()) onSearch(text.trim(), scope); };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-border/70 bg-card p-1 shadow-[0_5px_20px_hsl(var(--foreground)/0.045)] transition focus-within:border-primary/25 focus-within:shadow-[0_8px_30px_hsl(var(--primary)/0.08)]">
        <div className="flex shrink-0 items-center rounded-xl bg-muted/80 p-0.5">
          {([
            ['web', '网络'], ['workspace', '工作区'], ['library', '全库'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${scope === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
        <Input
          prefix={<Search size={16} />}
          placeholder="搜索网页、本地知识库、文件…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={submit}
          allowClear
          className="h-10 border-transparent bg-transparent shadow-none focus-within:border-transparent focus-within:ring-0"
        /></div>
        <Button type="primary" onClick={submit} loading={loading} className="h-9 rounded-xl border-0 px-4 shadow-none">搜索</Button>
      </div>
        <Tooltip title={cleanerEnabled ? '关闭净化' : '开启净化（去广告/弹窗/Cookie Banner）'}>
          <Button type="text" icon={<Shield size={17} />} onClick={onToggleCleaner} className={`h-11 w-11 rounded-xl border ${cleanerEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-border bg-card'}`} aria-label="切换网页净化" />
        </Tooltip>
        {onSave && (
          <Tooltip title="保存当前页面到 Workspace（Markdown + 原 HTML）">
            <Button icon={<Save size={16} />} onClick={onSave} className="h-11 rounded-xl bg-card">保存</Button>
          </Tooltip>
        )}
        {onResearch && (
          <Tooltip title="Research Mode：基于多引擎 + 本地知识库生成结构化报告">
            <Button
              type="default"
              icon={<FlaskConical size={16} />}
              onClick={() => onResearch(text.trim() || '什么是 RAG？')}
            >
              研究
            </Button>
          </Tooltip>
        )}
    </div>
  );
}
