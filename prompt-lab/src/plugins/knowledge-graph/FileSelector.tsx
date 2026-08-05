import React from 'react';
import { RefreshCw } from '@/components/icons';
import type { ConversationFile } from '@/types/electron';
import { KnowledgeFileList, type KnowledgeFileFolder } from '@/components/KnowledgeFileList';

// ── 文件选择器 ──

interface FileSelectorProps {
  files: ConversationFile[];
  folders?: KnowledgeFileFolder[];
  selectedPaths: Set<string>;
  onToggle: (path: string, checked: boolean) => void;
  onToggleAll: () => void;
  onRefresh: () => void;
}

export const FileSelector: React.FC<FileSelectorProps> = ({
  files,
  folders,
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

      <div className="min-h-0 flex-1">
        <KnowledgeFileList files={files} folders={folders} mode="select" selectedPaths={selectedPaths} onToggle={onToggle} />
      </div>
    </div>
  );
};
