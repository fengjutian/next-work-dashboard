/**
 * MarkdownToolbar — 顶部工具栏。
 *
 * 包含：撤销/重做、标题、正文、粗体/斜体/删除线/行内代码、
 *      引用、有序/无序/任务列表、链接/图片/表格/代码块/分隔线、
 *      切换源码/可视化、保存、状态指示。
 *
 * 命令通过 registerCommands 由父组件注入，符合 Tiptap 最佳实践。
 */
import React from 'react';
import {
  Bold,
  Code as CodeIcon,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Save,
  Strikethrough,
  Table as TableIcon,
  Undo2,
  Minus,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MarkdownEditorCommands } from '../editor/createMarkdownEditor';
import type { EditorMode, RoundtripSeverity, SourceModeReason } from '../types';

export interface MarkdownToolbarProps {
  mode: EditorMode;
  sourceModeReason: SourceModeReason;
  dirty: boolean;
  saving: boolean;
  roundtripSeverity: RoundtripSeverity;
  hasCommands: boolean;
  commands: MarkdownEditorCommands | null;
  onToggleMode: () => void;
  onSave: () => void;
  onOpenLinkDialog: () => void;
  onOpenImageDialog: () => void;
}

interface ButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolButton({ label, onClick, active, disabled, children }: ButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({
  mode,
  sourceModeReason,
  dirty,
  saving,
  roundtripSeverity,
  hasCommands,
  commands,
  onToggleMode,
  onSave,
  onOpenLinkDialog,
  onOpenImageDialog,
}) => {
  const disabled = !hasCommands && mode === 'wysiwyg';
  return (
    <div className="flex h-10 flex-shrink-0 items-center gap-0.5 border-b bg-card px-2">
      <div className="flex items-center">
        <ToolButton label="撤销" onClick={() => commands?.undo()} disabled={disabled}>
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="重做" onClick={() => commands?.redo()} disabled={disabled}>
          <Redo2 className="h-4 w-4" />
        </ToolButton>
      </div>
      <Divider />
      <div className="flex items-center">
        <select
          aria-label="标题级别"
          className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'p') commands?.setParagraph();
            else if (/^h[1-6]$/.test(value)) commands?.toggleHeading(Number(value[1]) as 1 | 2 | 3 | 4 | 5 | 6);
            event.currentTarget.value = '';
          }}
        >
          <option value="">标题</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="h5">H5</option>
          <option value="h6">H6</option>
          <option value="p">正文</option>
        </select>
      </div>
      <Divider />
      <div className="flex items-center">
        <ToolButton label="粗体" active={false} onClick={() => commands?.toggleBold()} disabled={disabled}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="斜体" onClick={() => commands?.toggleItalic()} disabled={disabled}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="删除线" onClick={() => commands?.toggleStrike()} disabled={disabled}>
          <Strikethrough className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="行内代码" onClick={() => commands?.toggleCode()} disabled={disabled}>
          <CodeIcon className="h-4 w-4" />
        </ToolButton>
      </div>
      <Divider />
      <div className="flex items-center">
        <ToolButton label="无序列表" onClick={() => commands?.toggleBulletList()} disabled={disabled}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="有序列表" onClick={() => commands?.toggleOrderedList()} disabled={disabled}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="任务列表" onClick={() => commands?.toggleTaskList()} disabled={disabled}>
          <ListChecks className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="引用" onClick={() => commands?.toggleBlockquote()} disabled={disabled}>
          <Quote className="h-4 w-4" />
        </ToolButton>
      </div>
      <Divider />
      <div className="flex items-center">
        <ToolButton label="链接" onClick={onOpenLinkDialog} disabled={disabled}>
          <LinkIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="图片" onClick={onOpenImageDialog} disabled={disabled}>
          <ImageIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="表格" onClick={() => commands?.insertTable()} disabled={disabled}>
          <TableIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="代码块" onClick={() => commands?.toggleCodeBlock()} disabled={disabled}>
          <FileText className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="分隔线" onClick={() => commands?.insertHorizontalRule()} disabled={disabled}>
          <Minus className="h-4 w-4" />
        </ToolButton>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <RoundtripBadge severity={roundtripSeverity} />
        <ToolButton
          label={mode === 'wysiwyg' ? '切换到源码模式' : '切换到可视化模式'}
          active={mode === 'source'}
          onClick={onToggleMode}
        >
          {mode === 'wysiwyg' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolButton>
        <button
          type="button"
          title={dirty ? '保存（Ctrl+S）' : '已保存'}
          aria-label="保存"
          onClick={onSave}
          disabled={saving}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            'border border-input bg-background hover:bg-accent hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
            dirty && 'border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/30',
          )}
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>
      </div>
      {sourceModeReason && mode === 'source' && (
        <span className="ml-2 hidden text-xs text-muted-foreground md:inline" title={`当前文件因 ${sourceModeReason} 强制使用源码模式`}>
          源码模式（{sourceModeReason}）
        </span>
      )}
    </div>
  );
};

function RoundtripBadge({ severity }: { severity: RoundtripSeverity }) {
  if (severity === 'safe') return null;
  const map = {
    lossy: { color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200', label: '轻微差异' },
    unsafe: { color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200', label: '可能丢失内容' },
  } as const;
  const { color, label } = map[severity];
  return (
    <span className={cn('flex h-6 items-center rounded-md px-2 text-[11px] font-medium', color)} title="往返安全检查未通过">
      {label}
    </span>
  );
}
