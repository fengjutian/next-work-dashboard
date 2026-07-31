import React, { useState, useCallback, useRef } from 'react';
import { FileText, Upload, X } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { INITIAL_PREVIEW_STATE } from './types';
import { convertDocxToHtml } from './convert';

/**
 * Word Preview 插件面板 — V1：纯预览模式
 *
 * 功能：
 *  - 选择本地 .docx 文件
 *  - 拖拽 .docx 文件到预览区
 *  - 使用 mammoth.js 将 docx → HTML
 *  - 文档风格渲染（白色纸张 + 适当宽度）
 *
 * 依赖：mammoth (MIT) — 通过 convert.ts 动态 import
 */
export const WordPreviewPanel: React.FC = () => {
  const [state, setState] = useState(INITIAL_PREVIEW_STATE);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocx = useCallback(async (file: File) => {
    setState({ status: 'loading', fileName: file.name, html: null, error: null });
    const result = await convertDocxToHtml(file);
    setState(result);
  }, []);

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadDocx(file);
      e.target.value = ''; // 重置以允许重复选择同一文件
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

  const clear = useCallback(() => {
    setState(INITIAL_PREVIEW_STATE);
  }, []);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm text-foreground">
            Word 预览
          </h2>
          {state.fileName && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">
              {state.fileName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.status === 'loaded' && (
            <button
              onClick={clear}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
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
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            打开文件
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 overflow-hidden bg-muted"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽提示 */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-4">
            <div className="text-center">
              <Upload className="h-10 w-10 text-primary mx-auto mb-2" />
              <p className="text-sm text-primary">释放以打开文件</p>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {state.status === 'idle' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="h-16 w-16 text-foreground text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-1">打开或拖入 .docx 文件</p>
              <p className="text-xs text-muted-foreground">支持 Microsoft Word、Google Docs、LibreOffice 导出的文档</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary transition-colors"
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
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">正在解析文档...</p>
              <p className="text-xs text-muted-foreground mt-1">{state.fileName}</p>
            </div>
          </div>
        )}

        {/* 错误 */}
        {state.status === 'error' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <X className="h-12 w-12 text-destructive mx-auto mb-3" />
              <p className="text-sm text-destructive font-medium mb-1">预览失败</p>
              <p className="text-xs text-muted-foreground mb-2">{state.error}</p>
              {state.fileName && (
                <p className="text-xs text-muted-foreground mb-4">文件：{state.fileName}</p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-primary hover:text-primary"
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
                className="word-preview-document prose prose-sm dark:prose-invert max-w-[800px] w-full bg-card shadow-lg rounded-sm p-12 min-h-[1000px]"
                dangerouslySetInnerHTML={{ __html: state.html }}
              />
            </div>
          </ScrollArea>
        )}
      </div>

      {/* 底部状态 */}
      {state.status === 'loaded' && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-muted-foreground bg-background">
          <span>预览模式</span>
          <span>{state.fileName}</span>
        </div>
      )}
    </div>
  );
};
