import React, { useState, useCallback, useRef } from 'react';
import { FileText, Upload, X, Plus, Download, Trash2, Edit3, Eye } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  INITIAL_PREVIEW_STATE,
  INITIAL_GENERATE_STATE,
} from './types';
import type { PptMode, SlideDraft } from './types';
import { parsePptxFile, generatePptx } from './convert';

/**
 * PPT 插件面板 — 生成 + 预览
 *
 * 功能：
 *  - 生成模式：自由添加幻灯片，填写标题与内容，一键导出 .pptx
 *  - 预览模式：打开 .pptx 文件，提取并展示每张幻灯片的文本结构
 *
 * 依赖：pptxgenjs (MIT) — 生成 .pptx
 *       jszip (MIT) — 解析 .pptx（预览模式）
 */
export const PptPreviewPanel: React.FC = () => {
  const [mode, setMode] = useState<PptMode>('generate');

  // ── 预览模式状态 ──
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPptx = useCallback(async (file: File) => {
    setPreviewState({ status: 'loading', fileName: file.name, slideCount: null, slides: null, error: null });
    const result = await parsePptxFile(file);
    setPreviewState(result);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadPptx(file);
      e.target.value = '';
    },
    [loadPptx],
  );

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
      if (file) loadPptx(file);
    },
    [loadPptx],
  );

  const clearPreview = useCallback(() => {
    setPreviewState(INITIAL_PREVIEW_STATE);
  }, []);

  // ── 生成模式状态 ──
  const [generateState, setGenerateState] = useState(INITIAL_GENERATE_STATE);

  const updateSlide = useCallback(
    (id: string, field: keyof SlideDraft, value: string) => {
      setGenerateState((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
      }));
    },
    [],
  );

  const addSlide = useCallback(() => {
    setGenerateState((prev) => ({
      ...prev,
      slides: [
        ...prev.slides,
        { id: crypto.randomUUID?.() ?? String(Date.now()), title: '', content: '' },
      ],
    }));
  }, []);

  const removeSlide = useCallback((id: string) => {
    setGenerateState((prev) => ({
      ...prev,
      slides: prev.slides.filter((s) => s.id !== id),
    }));
  }, []);

  const handleExport = useCallback(() => {
    const nonEmptySlides = generateState.slides.filter(
      (s) => s.title.trim() || s.content.trim(),
    );
    if (nonEmptySlides.length === 0) return;
    generatePptx(
      nonEmptySlides,
      generateState.title || '演示文稿',
      generateState.author || undefined,
    );
  }, [generateState]);

  const handleResetGenerate = useCallback(() => {
    setGenerateState(INITIAL_GENERATE_STATE);
  }, []);

  // ══════════════════════════════════════════
  // 渲染
  // ══════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 头部 + 模式切换 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-orange-500" />
          <h2 className="font-semibold text-sm text-foreground">
            PPT
          </h2>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setMode('generate')}
            className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-sm transition-colors ${
              mode === 'generate'
                ? 'bg-white bg-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Edit3 className="h-3 w-3" />
            生成
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-sm transition-colors ${
              mode === 'preview'
                ? 'bg-white bg-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="h-3 w-3" />
            预览
          </button>
        </div>
      </div>

      {/* ── 生成模式 ── */}
      {mode === 'generate' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* 文档信息 */}
          <div className="px-4 py-3 border-b space-y-2 bg-background/50 bg-background/50">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="演示文稿标题"
                value={generateState.title}
                onChange={(e) => setGenerateState((p) => ({ ...p, title: e.target.value }))}
                className="flex-1 px-2 py-1 text-sm border rounded bg-card border-border text-foreground"
              />
              <input
                type="text"
                placeholder="作者"
                value={generateState.author}
                onChange={(e) => setGenerateState((p) => ({ ...p, author: e.target.value }))}
                className="w-32 px-2 py-1 text-sm border rounded bg-card border-border text-foreground"
              />
            </div>
          </div>

          {/* 幻灯片列表 */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {generateState.slides.map((slide, i) => (
                <div
                  key={slide.id}
                  className="border rounded-md bg-card border-border p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">幻灯片 {i + 1}</span>
                    {generateState.slides.length > 1 && (
                      <button
                        onClick={() => removeSlide(slide.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="幻灯片标题"
                    value={slide.title}
                    onChange={(e) => updateSlide(slide.id, 'title', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-background bg-muted border-border text-foreground font-medium"
                  />
                  <textarea
                    placeholder="幻灯片内容（支持换行）"
                    rows={4}
                    value={slide.content}
                    onChange={(e) => updateSlide(slide.id, 'content', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-background bg-muted border-border text-foreground resize-none"
                  />
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* 底部操作栏 */}
          <div className="px-4 py-3 border-t flex items-center gap-2 bg-background/50 bg-background/50">
            <button
              onClick={addSlide}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              添加幻灯片
            </button>
            <div className="flex-1" />
            <button
              onClick={handleResetGenerate}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              重置
            </button>
            <button
              onClick={handleExport}
              disabled={generateState.slides.every((s) => !s.title.trim() && !s.content.trim())}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              导出 PPTX
            </button>
          </div>
        </div>
      )}

      {/* ── 预览模式 ── */}
      {mode === 'preview' && (
        <div
          className="flex-1 overflow-hidden bg-muted relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 拖拽提示 */}
          {dragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-orange-500/10 border-2 border-dashed border-orange-400 rounded-lg m-4">
              <div className="text-center">
                <Upload className="h-10 w-10 text-orange-400 mx-auto mb-2" />
                <p className="text-sm text-orange-600">释放以打开文件</p>
              </div>
            </div>
          )}

          {/* 工具栏 */}
          <div className="flex items-center justify-end px-4 py-2 border-b bg-card">
            {previewState.status === 'loaded' && (
              <button
                onClick={clearPreview}
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
              accept=".pptx"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              打开文件
            </button>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-hidden">
            {/* 空状态 */}
            {previewState.status === 'idle' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <FileText className="h-16 w-16 text-foreground text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground mb-1">打开或拖入 .pptx 文件</p>
                  <p className="text-xs text-muted-foreground">支持 Microsoft PowerPoint、Google Slides 导出的演示文稿</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                  >
                    <Upload className="h-4 w-4" />
                    选择文件
                  </button>
                </div>
              </div>
            )}

            {/* 加载中 */}
            {previewState.status === 'loading' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="h-8 w-8 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">正在解析文档...</p>
                  <p className="text-xs text-muted-foreground mt-1">{previewState.fileName}</p>
                </div>
              </div>
            )}

            {/* 错误 */}
            {previewState.status === 'error' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <X className="h-12 w-12 text-red-400 mx-auto mb-3" />
                  <p className="text-sm text-red-600 font-medium mb-1">预览失败</p>
                  <p className="text-xs text-muted-foreground mb-2">{previewState.error}</p>
                  {previewState.fileName && (
                    <p className="text-xs text-muted-foreground mb-4">文件：{previewState.fileName}</p>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-orange-500 hover:text-orange-600"
                  >
                    尝试打开另一个文件
                  </button>
                </div>
              </div>
            )}

            {/* 预览结果 */}
            {previewState.status === 'loaded' && previewState.slides && (
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  {previewState.slides.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                      <p className="text-sm text-muted-foreground">未检测到幻灯片内容</p>
                    </div>
                  ) : (
                    previewState.slides.map((slide) => (
                      <div
                        key={slide.index}
                        className="bg-card rounded-md border border-border shadow-sm p-4"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-bold">
                            {slide.index}
                          </span>
                          <h3 className="font-semibold text-sm text-foreground truncate">
                            {slide.title || '无标题'}
                          </h3>
                        </div>
                        {slide.body && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap ml-8">
                            {slide.body}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* 底部状态 */}
          {previewState.status === 'loaded' && (
            <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-muted-foreground bg-background">
              <span>共 {previewState.slideCount} 张幻灯片</span>
              <span>{previewState.fileName}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
