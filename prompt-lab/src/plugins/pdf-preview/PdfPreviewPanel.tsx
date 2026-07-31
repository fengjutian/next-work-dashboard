import React, { useState, useCallback, useRef } from 'react';
import { FileText, Upload, X, ZoomIn, ZoomOut, ChevronDown } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { INITIAL_PDF_STATE } from './types';
import { loadPdfFirstPage, renderPageToImage } from './convert';
import type { PdfPreviewState } from './types';

/**
 * PDF Preview 插件面板 — 系统级内置 PDF 预览
 *
 * 功能：
 *  - 选择本地 .pdf 文件
 *  - 拖拽 .pdf 文件到预览区
 *  - 使用 pdfjs-dist 将 PDF 每页渲染为图片
 *  - 分页翻页（上一页/下一页）
 *  - 缩放控制 + 适合宽度
 *  - 显示页码/总页数
 *
 * 依赖：pdfjs-dist (Apache 2.0)
 */
export const PdfPreviewPanel: React.FC = () => {
  const [state, setState] = useState<PdfPreviewState>(INITIAL_PDF_STATE);
  const [dragOver, setDragOver] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPdf = useCallback(async (file: File) => {
    setState({
      status: 'loading',
      fileName: file.name,
      pageCount: 0,
      currentPage: 1,
      pageImageUrl: null,
      scale: 1,
      error: null,
    });
    setPdfDoc(null);

    const result = await loadPdfFirstPage(file, 1);
    setState(result.state);
    setPdfDoc(result.pdfDoc);
  }, []);

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadPdf(file);
      e.target.value = '';
    },
    [loadPdf],
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
      if (file) loadPdf(file);
    },
    [loadPdf],
  );

  const clear = useCallback(() => {
    setState(INITIAL_PDF_STATE);
    setPdfDoc(null);
  }, []);

  // ── 翻页 ──
  const goToPage = useCallback(
    async (page: number) => {
      if (!pdfDoc || page < 1 || page > state.pageCount) return;
      setState(prev => ({ ...prev, status: 'loading' }));
      try {
        const pageImageUrl = await renderPageToImage(pdfDoc, page, state.scale);
        setState(prev => ({
          ...prev,
          status: 'loaded',
          currentPage: page,
          pageImageUrl,
        }));
      } catch (err: any) {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: err?.message ?? '页面渲染失败',
        }));
      }
    },
    [pdfDoc, state.pageCount, state.scale],
  );

  const prevPage = useCallback(() => {
    if (state.currentPage > 1) goToPage(state.currentPage - 1);
  }, [state.currentPage, goToPage]);

  const nextPage = useCallback(() => {
    if (state.currentPage < state.pageCount) goToPage(state.currentPage + 1);
  }, [state.currentPage, state.pageCount, goToPage]);

  // ── 缩放 ──
  const zoomIn = useCallback(() => {
    const newScale = Math.min(state.scale + 0.25, 3);
    if (pdfDoc) {
      setState(prev => ({ ...prev, status: 'loading' }));
      renderPageToImage(pdfDoc, state.currentPage, newScale)
        .then(url => {
          setState(prev => ({
            ...prev,
            status: 'loaded',
            scale: newScale,
            pageImageUrl: url,
          }));
        })
        .catch(err => {
          setState(prev => ({
            ...prev,
            status: 'error',
            error: err?.message ?? '缩放渲染失败',
          }));
        });
    }
  }, [pdfDoc, state.currentPage, state.scale]);

  const zoomOut = useCallback(() => {
    const newScale = Math.max(state.scale - 0.25, 0.25);
    if (pdfDoc) {
      setState(prev => ({ ...prev, status: 'loading' }));
      renderPageToImage(pdfDoc, state.currentPage, newScale)
        .then(url => {
          setState(prev => ({
            ...prev,
            status: 'loaded',
            scale: newScale,
            pageImageUrl: url,
          }));
        })
        .catch(err => {
          setState(prev => ({
            ...prev,
            status: 'error',
            error: err?.message ?? '缩放渲染失败',
          }));
        });
    }
  }, [pdfDoc, state.currentPage, state.scale]);

  // 页码输入
  const [pageInput, setPageInput] = useState('');
  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        const page = parseInt(pageInput, 10);
        if (!isNaN(page)) goToPage(page);
        setPageInput('');
      }
    },
    [goToPage, pageInput],
  );

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-red-500" />
          <h2 className="font-semibold text-sm text-foreground">
            PDF 预览
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
            accept=".pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            打开文件
          </button>
        </div>
      </div>

      {/* 工具栏（已加载时显示） */}
      {state.status === 'loaded' && (
        <div className="flex items-center justify-between px-4 py-1.5 border-b bg-background text-xs text-muted-foreground">
          {/* 翻页 */}
          <div className="flex items-center gap-2">
            <button
              onClick={prevPage}
              disabled={state.currentPage <= 1}
              className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              title="上一页"
            >
              ‹
            </button>
            <span className="flex items-center gap-1">
              <input
                type="text"
                value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onKeyDown={handlePageInputKeyDown}
                placeholder={String(state.currentPage)}
                className="w-8 text-center border rounded px-1 py-0.5 bg-card text-xs"
              />
              <span>/ {state.pageCount}</span>
            </span>
            <button
              onClick={nextPage}
              disabled={state.currentPage >= state.pageCount}
              className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              title="下一页"
            >
              ›
            </button>
          </div>

          {/* 缩放 */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={state.scale <= 0.25}
              className="p-1 rounded hover:bg-accent disabled:opacity-30"
              title="缩小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center font-mono">
              {Math.round(state.scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={state.scale >= 3}
              className="p-1 rounded hover:bg-accent disabled:opacity-30"
              title="放大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div
        className="flex-1 overflow-hidden bg-muted relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽提示 */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-red-500/10 border-2 border-dashed border-red-400 rounded-lg m-4">
            <div className="text-center">
              <Upload className="h-10 w-10 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">释放以打开 PDF</p>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {state.status === 'idle' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="h-16 w-16 text-foreground text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-1">打开或拖入 .pdf 文件</p>
              <p className="text-xs text-muted-foreground">支持 PDF 文档预览，可翻页和缩放</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors"
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
              <div className="h-8 w-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">正在渲染 PDF...</p>
              {state.pageCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  第 {state.currentPage} / {state.pageCount} 页
                </p>
              )}
              {state.fileName && (
                <p className="text-xs text-muted-foreground mt-1">{state.fileName}</p>
              )}
            </div>
          </div>
        )}

        {/* 错误 */}
        {state.status === 'error' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <X className="h-12 w-12 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-600 font-medium mb-1">预览失败</p>
              <p className="text-xs text-muted-foreground mb-2">{state.error}</p>
              {state.fileName && (
                <p className="text-xs text-muted-foreground mb-4">文件：{state.fileName}</p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-red-500 hover:text-red-600"
              >
                尝试打开另一个文件
              </button>
            </div>
          </div>
        )}

        {/* 预览 */}
        {state.status === 'loaded' && state.pageImageUrl && (
          <ScrollArea className="h-full">
            <div className="flex flex-col items-center py-4 px-4 gap-4">
              {/* 当前页 */}
              <div
                className="shadow-lg rounded-sm bg-white"
                style={{ maxWidth: '100%', width: 'fit-content' }}
              >
                <img
                  src={state.pageImageUrl}
                  alt={`第 ${state.currentPage} 页`}
                  className="block"
                  style={{ width: '100%', height: 'auto' }}
                />
              </div>

              {/* 底部翻页 */}
              <div className="flex items-center gap-3 py-2">
                <button
                  onClick={prevPage}
                  disabled={state.currentPage <= 1}
                  className="px-3 py-1.5 rounded-md bg-accent text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  上一页
                </button>
                <span className="text-xs text-muted-foreground">
                  第 {state.currentPage} / {state.pageCount} 页
                </span>
                <button
                  onClick={nextPage}
                  disabled={state.currentPage >= state.pageCount}
                  className="px-3 py-1.5 rounded-md bg-accent text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  下一页
                </button>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>

      {/* 底部状态 */}
      {state.status === 'loaded' && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-muted-foreground bg-background">
          <span>共 {state.pageCount} 页 · {Math.round(state.scale * 100)}%</span>
          <span>{state.fileName}</span>
        </div>
      )}
    </div>
  );
};
