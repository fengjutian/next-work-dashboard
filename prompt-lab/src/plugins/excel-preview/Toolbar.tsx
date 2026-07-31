/**
 * Excel 工具栏 — Sheet 切换、行列操作、保存、撤销/重做
 */
import React from 'react';
import { FileText, Upload, Download, Plus, Trash2, RefreshCw } from '@/components/icons';
import type { SheetData } from './types';

interface ToolbarProps {
  fileName: string | null;
  sheets: SheetData[];
  activeSheetIndex: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onSheetChange: (index: number) => void;
  onAddRow: () => void;
  onAddCol: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  fileName,
  sheets,
  activeSheetIndex,
  dirty,
  canUndo,
  canRedo,
  onOpenFile,
  onSave,
  onSaveAs,
  onSheetChange,
  onAddRow,
  onAddCol,
  onDeleteRow,
  onDeleteCol,
  onUndo,
  onRedo,
}) => {
  return (
    <div className="flex flex-col border-b bg-background">
      {/* 第一行：操作按钮 */}
      <div className="flex items-center gap-1 px-3 py-1.5 flex-wrap">
        {/* 文件操作 */}
        <button
          onClick={onOpenFile}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
          title="打开 Excel 文件"
        >
          <Upload className="h-3.5 w-3.5" />
          打开
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            dirty
              ? 'text-primary hover:bg-primary-light dark:hover:bg-primary-light'
              : 'text-muted-foreground cursor-not-allowed'
          }`}
          title="保存 (Ctrl+S)"
        >
          <Download className="h-3.5 w-3.5" />
          保存
        </button>
        <button
          onClick={onSaveAs}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
          title="另存为..."
        >
          <FileText className="h-3.5 w-3.5" />
          另存为
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 撤销/重做 */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            canUndo ? 'hover:bg-accent' : 'text-muted-foreground cursor-not-allowed'
          }`}
          title="撤销 (Ctrl+Z)"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            canRedo ? 'hover:bg-accent' : 'text-muted-foreground cursor-not-allowed'
          }`}
          title="重做 (Ctrl+Y)"
        >
          <RefreshCw className="h-3.5 w-3.5 scale-x-[-1]" />
          重做
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 行列操作 */}
        <button
          onClick={onAddRow}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
          title="在末尾添加行"
        >
          <Plus className="h-3 w-3" />
          行
        </button>
        <button
          onClick={onAddCol}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
          title="在末尾添加列"
        >
          <Plus className="h-3 w-3" />
          列
        </button>
        <button
          onClick={onDeleteRow}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-destructive/10 dark:hover:bg-destructive/10 text-destructive transition-colors"
          title="删除最后一行"
        >
          <Trash2 className="h-3 w-3" />
          行
        </button>
        <button
          onClick={onDeleteCol}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-destructive/10 dark:hover:bg-destructive/10 text-destructive transition-colors"
          title="删除最后一列"
        >
          <Trash2 className="h-3 w-3" />
          列
        </button>

        {/* 右侧：文件名 + 脏状态 */}
        <div className="flex-1" />
        {fileName && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
            {dirty && <span className="text-warning ml-1">●</span>}
          </span>
        )}
      </div>

      {/* 第二行：Sheet 标签栏 */}
      {sheets.length > 0 && (
        <div className="flex items-center gap-0.5 px-3 pb-1 overflow-x-auto">
          {sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => onSheetChange(idx)}
              className={`px-3 py-0.5 text-xs rounded-t border border-b-0 transition-colors whitespace-nowrap ${
                idx === activeSheetIndex
                  ? 'bg-card text-primary border-input font-medium'
                  : 'bg-accent text-muted-foreground border-transparent hover:bg-accent/80'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
