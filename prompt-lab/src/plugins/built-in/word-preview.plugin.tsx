import React, { useState, useCallback, useRef } from 'react';
import { FileText, Eye, Upload, X } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * Word Preview 插件 — V1：纯预览模式
 *
 * 功能：
 *  - 选择本地 .docx 文件
 *  - 拖拽 .docx 文件到预览区
 *  - 使用 mammoth.js 将 docx → HTML
 *  - 文档风格渲染（白色纸张 + 适当宽度）
 *  - 显示文件名、转换状态
 *
 * 依赖：mammoth (MIT)
 */

interface PreviewState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  fileName: string | null;
  html: string | null;
  error: string | null;
}

const initial: PreviewState = {
  status: 'idle',
  fileName: null,
  html: null,
  error: null,
};

export const WordPreviewPanel: React.FC = () => {
  const [state, setState] = useState<PreviewState>(initial);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocx = useCallback(async (file: File) => {
    if (!file.name.endsWith('.docx')) {
      setState({ status: 'error', fileName: file.name, html: null, error: '仅支持 .docx 格式文件' });
      return;
    }

    setState({ status: 'loading', fileName: file.name, html: null, error: null });

    try {
      const mammoth: any = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });

      if (result.messages.length > 0) {
        console.warn('[WordPreview] mammoth conversion messages:', result.messages);
      }

      setState({
        status: 'loaded',
        fileName: file.name,
        html: result.value,
        error: null,
      });
    } catch (err: any) {
      setState({
        status: 'error',
        fileName: file.name,
        html: null,
        error: err?.message ?? '文件解析失败，请确认文件格式正确',
      });
    }
  }, []);

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadDocx(file);
      // 重置以允许重复选择同一文件
      e.target.value = '';
    },
    [loadDocx],
  );

  // 拖拽
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) loadDocx(file);
    },
    [loadDocx],
  );

  // 清除
  const clear = useCallback(() => {
    setState(initial);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-500" />
          <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
            Word 预览
          </h2>
          {state.fileName && (
            <span className="text-xs text-zinc-400 truncate max-w-[160px]">
              {state.fileName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.status === 'loaded' && (
            <button
              onClick={clear}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1"
              title="关闭当前文档"
            >
              <X className="h-3.5 w-3.5" />
              关闭
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            打开文件
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-900"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽提示 */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-lg m-4">
            <div className="text-center">
              <Upload className="h-10 w-10 text-blue-400 mx-auto mb-2" />
              <p className="text-sm text-blue-600">释放以打开文件</p>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {state.status === 'idle' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="h-16 w-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
              <p className="text-sm text-zinc-500 mb-1">打开或拖入 .docx 文件</p>
              <p className="text-xs text-zinc-400">支持 Microsoft Word、Google Docs、LibreOffice 导出的文档</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
              >
                <Upload className="h-4 w-4" />
                选择文件
              </button>
            </div>
          </div>
        )}

        {/* 加载中 */}
        {state.status === 'loading' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="h-8 w-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-zinc-500">正在解析文档...</p>
              <p className="text-xs text-zinc-400 mt-1">{state.fileName}</p>
            </div>
          </div>
        )}

        {/* 错误 */}
        {state.status === 'error' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <X className="h-12 w-12 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-600 font-medium mb-1">预览失败</p>
              <p className="text-xs text-zinc-500 mb-2">{state.error}</p>
              {state.fileName && (
                <p className="text-xs text-zinc-400 mb-4">文件：{state.fileName}</p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-blue-500 hover:text-blue-600"
              >
                尝试打开另一个文件
              </button>
            </div>
          </div>
        )}

        {/* 预览 */}
        {state.status === 'loaded' && state.html && (
          <ScrollArea className="h-full">
            <div className="flex justify-center py-8 px-4">
              <div
                className="word-preview-document prose prose-sm dark:prose-invert max-w-[800px] w-full bg-white dark:bg-zinc-950 shadow-lg rounded-sm p-12 min-h-[1000px]"
                dangerouslySetInnerHTML={{ __html: state.html }}
              />
            </div>
          </ScrollArea>
        )}
      </div>

      {/* 底部状态 */}
      {state.status === 'loaded' && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-900">
          <span>预览模式</span>
          <span>{state.fileName}</span>
        </div>
      )}
    </div>
  );
};
