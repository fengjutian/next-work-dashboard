/**
 * MarkdownToolbar — 工具栏。
 *
 * 设计：
 *  - 工具栏只负责"按钮 → 派发命令"；具体命令执行由 Tiptap editor 实例在 EditorCommandContext 中提供。
 *  - 模式切换通过 onModeChange 回调告诉上层。
 */

import React from 'react';
import {
  Code as CodeIcon,
  Code as Code2,
  Edit3 as Bold,
  Edit3 as Italic,
  Edit3 as Strikethrough,
  ExternalLink as Link2,
  Rows3 as List,
  Rows3 as ListOrdered,
  Check as ListChecks,
  MessageSquare as Quote,
  RefreshCw as Redo2,
  RotateCcw as Undo2,
  RotateCcw as RetryIcon,
  Columns2 as Table,
  Image as ImageIcon,
  Minus,
  Save,
  Search as SearchIcon,
  CheckCircle as CheckIcon,
  Loader2,
  ShieldAlert as AlertCircle,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownDocument, MarkdownEditorMode, SaveStatus } from '../types';

export type EditorCommand =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'toggleBold' }
  | { kind: 'toggleItalic' }
  | { kind: 'toggleStrike' }
  | { kind: 'toggleCode' }
  | { kind: 'toggleBulletList' }
  | { kind: 'toggleOrderedList' }
  | { kind: 'toggleTaskList' }
  | { kind: 'toggleBlockquote' }
  | { kind: 'toggleCodeBlock' }
  | { kind: 'insertTable' }
  | { kind: 'setHorizontalRule' }
  | { kind: 'setLink'; href: string }
  | { kind: 'setImage'; src: string }
  | { kind: 'openImagePicker' }
  | { kind: 'openFindReplace' };

export interface MarkdownToolbarProps {
  document: MarkdownDocument;
  onSave(): void | Promise<void>;
  onModeChange(mode: MarkdownEditorMode): void;
  onCommand(command: EditorCommand): void;
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ label, onClick, active, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    )}
  >
    {children}
  </button>
);

const Group: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex items-center gap-0.5">{children}</div>;
const Divider: React.FC = () => <div className="mx-1 h-5 w-px bg-border" />;

const ModeButton: React.FC<{ mode: MarkdownEditorMode; current: MarkdownEditorMode; onSelect(mode: MarkdownEditorMode): void }> = ({ mode, current, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(mode)}
    className={cn(
      'flex h-7 items-center rounded-md px-2 text-[11px] transition-colors',
      current === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
    )}
    title={mode === 'visual' ? '可视化模式' : '源码模式'}
  >
    {mode === 'visual' ? '可视化' : '源码'}
  </button>
);

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({ document, onSave, onModeChange, onCommand }) => {
  const disabled = false;
  return (
    <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b bg-background px-2 text-xs">
      <Group>
        {document.saveStatus === 'saving' ? (
          <button
            type="button"
            disabled
            title="保存中…"
            className="flex h-7 items-center gap-1 rounded-md bg-primary/80 px-2.5 text-[11px] text-primary-foreground shadow-sm"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-medium">保存中…</span>
            <span className="ml-1 rounded border border-primary-foreground/40 px-1 font-mono text-[9px]">Ctrl+S</span>
          </button>
        ) : document.saveStatus === 'error' ? (
          <button
            type="button"
            onClick={onSave}
            title={`保存失败：${document.saveError ?? '未知错误'}（点击重试）`}
            className="flex h-7 items-center gap-1 rounded-md bg-rose-600 px-2.5 text-[11px] font-medium text-white shadow-sm hover:bg-rose-500"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            <span>重试保存</span>
            <span className="ml-1 rounded border border-white/30 px-1 font-mono text-[9px]">Ctrl+S</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSave}
            title="保存 (Ctrl+S)"
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] transition-all',
              document.dirty
                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            <span className="font-medium">{document.dirty ? '保存' : '已保存'}</span>
            <span className={cn('ml-1 rounded border px-1 font-mono text-[9px]', document.dirty ? 'border-primary-foreground/40' : 'border-border')}>
              Ctrl+S
            </span>
          </button>
        )}
      </Group>
      <Divider />
      <Group>
        <ModeButton mode="visual" current={document.mode} onSelect={onModeChange} />
        <ModeButton mode="source" current={document.mode} onSelect={onModeChange} />
      </Group>
      <Divider />
      <Group>
        <ToolbarButton label="撤销" onClick={() => onCommand({ kind: 'undo' })} disabled={disabled}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="重做" onClick={() => onCommand({ kind: 'redo' })} disabled={disabled}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
      <Divider />
      <Group>
        {[1, 2, 3, 4].map((level) => (
          <ToolbarButton key={level} label={`标题 ${level}`} onClick={() => onCommand({ kind: 'heading', level: level as 1 | 2 | 3 | 4 })}>
            <span className="text-[11px] font-semibold">H{level}</span>
          </ToolbarButton>
        ))}
      </Group>
      <Divider />
      <Divider />
      <Group>
        <ToolbarButton label="查找替换 (Ctrl+F)" onClick={() => onCommand({ kind: 'openFindReplace' })}>
          <SearchIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
      <Divider />
      <Group>
        <ToolbarButton label="粗体" onClick={() => onCommand({ kind: 'toggleBold' })}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="斜体" onClick={() => onCommand({ kind: 'toggleItalic' })}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="删除线" onClick={() => onCommand({ kind: 'toggleStrike' })}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="行内代码" onClick={() => onCommand({ kind: 'toggleCode' })}>
          <CodeIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
      <Divider />
      <Group>
        <ToolbarButton label="无序列表" onClick={() => onCommand({ kind: 'toggleBulletList' })}>
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="有序列表" onClick={() => onCommand({ kind: 'toggleOrderedList' })}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="任务列表" onClick={() => onCommand({ kind: 'toggleTaskList' })}>
          <ListChecks className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
      <Divider />
      <Group>
        <ToolbarButton label="引用" onClick={() => onCommand({ kind: 'toggleBlockquote' })}>
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="代码块" onClick={() => onCommand({ kind: 'toggleCodeBlock' })}>
          <Code2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="表格" onClick={() => onCommand({ kind: 'insertTable' })}>
          <Table className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="分隔线" onClick={() => onCommand({ kind: 'setHorizontalRule' })}>
          <Minus className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
      <Divider />
      <Group>
        <ToolbarButton label="链接" onClick={() => {
          const href = window.prompt('请输入链接地址：', 'https://');
          if (href) onCommand({ kind: 'setLink', href });
        }}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="图片（本地选择）" onClick={() => onCommand({ kind: 'openImagePicker' })}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
      </Group>
    </div>
  );
};
