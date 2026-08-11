/**
 * SearchBar — 顶部统一搜索（含 scope 切换 + Research 入口）
 */
import { Input, Button, Space, Tooltip, Segmented } from '../ui';
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
        <Input
          size="large"
          prefix={<Search size={16} />}
          placeholder="搜索网页、本地知识库、文件…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={submit}
          allowClear
          className="rounded-xl border-border/80 bg-background/70 shadow-sm"
        /></div>
        <Tooltip title={cleanerEnabled ? '关闭净化' : '开启净化（去广告/弹窗/Cookie Banner）'}>
          <Button size="large" type={cleanerEnabled ? 'primary' : 'default'} icon={<Shield size={16} />} onClick={onToggleCleaner} className="rounded-xl" aria-label="切换网页净化" />
        </Tooltip>
        {onSave && (
          <Tooltip title="保存当前页面到 Workspace（Markdown + 原 HTML）">
            <Button size="large" icon={<Save size={16} />} onClick={onSave} className="rounded-xl">保存</Button>
          </Tooltip>
        )}
        {onResearch && (
          <Tooltip title="Research Mode：基于多引擎 + 本地知识库生成结构化报告">
            <Button
              size="large"
              type="default"
              icon={<FlaskConical size={16} />}
              onClick={() => onResearch(text.trim() || '什么是 RAG？')}
            >
              深度研究
            </Button>
          </Tooltip>
        )}
        <Button size="large" type="primary" onClick={submit} loading={loading} className="rounded-xl px-5">搜索</Button>
      </div>
      <Segmented
        size="small"
        value={scope}
        onChange={(v) => setScope(v as SearchScope)}
        options={[
          { label: '🌐 网络', value: 'web' },
          { label: '📁 工作区', value: 'workspace' },
          { label: '📚 全库', value: 'library' },
        ]}
        className="w-fit"
      />
    </div>
  );
}
