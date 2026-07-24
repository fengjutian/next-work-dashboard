import React, { useEffect, useState, useCallback } from 'react';
import { Trash2, FolderOpen, FileText, Calendar, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile } from '@/types/electron';

// ── 文件列表项 ──

const FileItem: React.FC<{
  file: ConversationFile;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ file, isActive, onClick, onDelete }) => {
  const sizeKB = (file.size / 1024).toFixed(1);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer text-xs border-b border-zinc-100 dark:border-zinc-800 transition-colors ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400'
      }`}
      onClick={onClick}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{file.title || file.site}</div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <Calendar className="h-3 w-3" />
          {file.date}
          <span>{sizeKB} KB</span>
        </div>
      </div>
      {showDelete && (
        <button
          className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-zinc-400 hover:text-red-500 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="删除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

// ── 主组件 ──

export const ConversationHistory: React.FC = () => {
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const conversationSavedAt = useStore((s) => s.conversationSavedAt);

  const loadList = useCallback(async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api?.listConversations) {
        console.warn('[ConvHistory] electronAPI.listConversations not available');
        return;
      }
      const list = await api.listConversations();
      console.log('[ConvHistory] loaded', list.length, 'files:', list.map((f: ConversationFile) => f.fileName));
      setFiles(list);
    } catch (err) {
      console.error('[ConvHistory] loadList failed:', err);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, conversationSavedAt]);

  const handleSelect = useCallback(async (file: ConversationFile) => {
    setActivePath(file.path);
    setLoading(true);
    try {
      const api = (window as any).electronAPI;
      if (!api?.readConversation) return;
      const result = await api.readConversation(file.path);
      if (result.success) {
        setContent(result.content || '');
      } else {
        toast('读取失败', 'error');
      }
    } catch {
      toast('读取失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleDelete = useCallback(async (file: ConversationFile) => {
    try {
      const api = (window as any).electronAPI;
      if (!api?.deleteConversation) return;
      await api.deleteConversation(file.path);
      if (activePath === file.path) {
        setActivePath(null);
        setContent('');
      }
      toast('已删除', 'success');
      loadList();
    } catch {
      toast('删除失败', 'error');
    }
  }, [activePath, loadList, toast]);

  const handleOpenFolder = useCallback(() => {
    // 通过主进程打开文件管理器
    try {
      const api = (window as any).electronAPI;
      if (!api?.listConversations) return;
      // 用第一个文件路径推断目录
      if (files.length > 0) {
        // 通过 shell 打开文件夹 — 需要新增 IPC，暂时用 toast 提示路径
        toast(`目录: Documents\\PromptLab\\conversations`, 'success');
      }
    } catch {
      // ignore
    }
  }, [files, toast]);

  return (
    <div className="flex h-full">
      {/* 左侧文件列表 */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col bg-zinc-50 dark:bg-zinc-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            对话记录 ({files.length})
          </span>
          <div className="flex items-center gap-1">
            <button
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
              onClick={loadList}
              title="刷新"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
              onClick={handleOpenFolder}
              title="打开文件夹"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
              <FileText className="h-8 w-8" />
              <p className="text-xs">暂无对话记录</p>
              <p className="text-[10px]">点击 AI 页面中的保存按钮来保存对话</p>
            </div>
          ) : (
            files.map((f) => (
              <FileItem
                key={f.path}
                file={f}
                isActive={activePath === f.path}
                onClick={() => handleSelect(f)}
                onDelete={() => handleDelete(f)}
              />
            ))
          )}
        </div>
      </div>

      {/* 右侧预览区 */}
      <div className="flex-1 flex flex-col bg-white dark:bg-zinc-950">
        {activePath ? (
          loading ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
              加载中...
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {content || '(空)'}
              </pre>
            </div>
          )
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
            选择左侧文件查看内容
          </div>
        )}
      </div>
    </div>
  );
};
