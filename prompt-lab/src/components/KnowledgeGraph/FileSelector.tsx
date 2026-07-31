import React from 'react';
import { RefreshCw, FileText } from '@/components/icons';
import type { ConversationFile } from '@/types/electron';

// ── 对话文件列表项 ──

const FileCheckItem: React.FC<{
  file: ConversationFile;
  checked: boolean;
  onChange: (path: string, checked: boolean) => void;
}> = ({ file, checked, onChange }) => {
  return (
    <label
      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs border-b border-border border-border transition-colors hover:bg-background dark:hover:bg-muted/50 ${
        checked ? 'text-primary' : 'text-muted-foreground'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(file.path, e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input"
      />
      <div className="flex-1 min-w-0">
        <div className="truncate">{file.title || file.fileName}</div>
        <div className="text-[10px] text-muted-foreground">{file.date}</div>
      </div>
    </label>
  );
};

// ── 文件选择器 ──

interface FileSelectorProps {
  files: ConversationFile[];
  selectedPaths: Set<string>;
  onToggle: (path: string, checked: boolean) => void;
  onToggleAll: () => void;
  onRefresh: () => void;
}

export const FileSelector: React.FC<FileSelectorProps> = ({
  files,
  selectedPaths,
  onToggle,
  onToggleAll,
  onRefresh,
}) => {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground">
          对话文件 ({selectedPaths.size}/{files.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-muted-foreground hover:bg-accent"
            onClick={onToggleAll}
          >
            {selectedPaths.size === files.length ? '取消全选' : '全选'}
          </button>
          <button
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            onClick={onRefresh}
            title="刷新"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FileText className="h-6 w-6" />
            <p className="text-xs">暂无对话记录</p>
          </div>
        ) : (
          files.map((f) => (
            <FileCheckItem
              key={f.path}
              file={f}
              checked={selectedPaths.has(f.path)}
              onChange={onToggle}
            />
          ))
        )}
      </div>
    </div>
  );
};
