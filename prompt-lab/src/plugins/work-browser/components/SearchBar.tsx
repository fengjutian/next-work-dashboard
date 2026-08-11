/**
 * SearchBar — 顶部统一搜索
 */
import { Input, Button, Space, Tooltip } from 'antd';
import { Search, Save, Shield } from 'lucide-react';
import { useState } from 'react';

export interface SearchBarProps {
  onSearch: (text: string) => void;
  onSave?: () => void;
  cleanerEnabled?: boolean;
  onToggleCleaner?: () => void;
  loading?: boolean;
}

export function SearchBar({ onSearch, onSave, cleanerEnabled, onToggleCleaner, loading }: SearchBarProps) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) onSearch(text.trim()); };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        size="large"
        prefix={<Search size={16} />}
        placeholder="搜索网页、本地知识库、文件…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={submit}
        allowClear
      />
      <Tooltip title={cleanerEnabled ? '关闭净化' : '开启净化（去广告/弹窗/Cookie Banner）'}>
        <Button size="large" type={cleanerEnabled ? 'primary' : 'default'} icon={<Shield size={16} />} onClick={onToggleCleaner} />
      </Tooltip>
      {onSave && (
        <Tooltip title="保存当前页面到 Workspace（Markdown + 原 HTML）">
          <Button size="large" icon={<Save size={16} />} onClick={onSave}>保存</Button>
        </Tooltip>
      )}
      <Button size="large" type="primary" onClick={submit} loading={loading}>搜索</Button>
    </Space.Compact>
  );
}
