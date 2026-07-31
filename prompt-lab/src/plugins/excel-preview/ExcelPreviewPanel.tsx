/**
 * ExcelPreviewPanel — Excel 预览/编辑主面板
 *
 * 功能：
 *  - 打开 .xlsx/.xls 文件（文件选择 + 拖拽）
 *  - 多 Sheet 切换
 *  - 单元格选中 → 双击编辑 → 方向键/Tab 导航
 *  - 撤销/重做 (Ctrl+Z / Ctrl+Y)
 *  - 保存 / 另存为
 *  - 添加/删除行列
 *
 * 依赖：xlsx (SheetJS) — 已是项目依赖
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FileText, Upload, X, Loader2 } from '@/components/icons';
import { INITIAL_EXCEL_STATE } from './types';
import type { ExcelState, CellValue, SheetData } from './types';
import { fileToSheets, sheetsToBlob, sheetsToUint8Array } from './convert';
import { ExcelGrid } from './ExcelGrid';
import { Toolbar } from './Toolbar';
import { useExcelStore } from './useExcelStore';

export const ExcelPreviewPanel: React.FC = () => {
  const [state, setState] = useState<ExcelState>(INITIAL_EXCEL_STATE);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 脏标记：编辑后 = dirty
  const onDataChange = useCallback(() => {
    setState((s) => (s.dirty ? s : { ...s, dirty: true }));
  }, []);

  const {
    getCanUndo,
    getCanRedo,
    undo,
    redo,
    setCellValue,
  } = useExcelStore(onDataChange);

  // Ctrl+S 保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 加载文件
  const loadFile = useCallback(async (file: File) => {
    const validExts = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!validExts.includes(ext)) {
      setState({
        status: 'error',
        fileName: file.name,
        fileBuffer: null,
        sheets: [],
        activeSheetIndex: 0,
        error: `不支持的文件格式 "${ext}"。请选择 .xlsx、.xls 或 .csv 文件。`,
        dirty: false,
      });
      return;
    }

    setState((s) => ({ ...s, status: 'loading', fileName: file.name }));

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await fileToSheets(file);

      if (result.sheets.length === 0) {
        result.sheets.push({ name: 'Sheet1', rows: [], rowCount: 0, colCount: 0 });
      }

      setState({
        status: 'loaded',
        fileName: file.name,
        fileBuffer: arrayBuffer,
        sheets: result.sheets,
        activeSheetIndex: 0,
        error: null,
        dirty: false,
      });
    } catch (err: any) {
      setState({
        status: 'error',
        fileName: file.name,
        fileBuffer: null,
        sheets: [],
        activeSheetIndex: 0,
        error: err?.message ?? '文件解析失败，请确认文件未损坏。',
        dirty: false,
      });
    }
  }, []);

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
      e.target.value = '';
    },
    [loadFile],
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
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 保存
  const handleSave = useCallback(() => {
    if (!state.fileName) return;

    const uint8 = sheetsToUint8Array(state.sheets);
    const blob = new Blob([uint8], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Electron 环境：尝试用 showSaveDialog，否则回退到 download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName || 'workbook.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setState((s) => ({ ...s, dirty: false, status: 'loaded' }));
  }, [state.fileName, state.sheets]);

  // 另存为
  const handleSaveAs = useCallback(() => {
    const blob = sheetsToBlob(state.sheets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workbook.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setState((s) => ({ ...s, dirty: false }));
  }, [state.sheets]);

  // Sheet 切换
  const handleSheetChange = useCallback((index: number) => {
    setState((s) => ({ ...s, activeSheetIndex: index }));
  }, []);

  // 单元格变更
  const handleCellChange = useCallback(
    (row: number, col: number, value: CellValue) => {
      setCellValue(row, col, value, state.sheets, state.activeSheetIndex, (newSheets) => {
        setState((s) => ({ ...s, sheets: newSheets }));
      });
    },
    [state.sheets, state.activeSheetIndex, setCellValue],
  );

  // 撤销/重做
  const handleUndo = useCallback(() => {
    undo(state.sheets, (newSheets) => {
      setState((s) => ({ ...s, sheets: newSheets }));
    });
  }, [state.sheets, undo]);

  const handleRedo = useCallback(() => {
    redo(state.sheets, (newSheets) => {
      setState((s) => ({ ...s, sheets: newSheets }));
    });
  }, [state.sheets, redo]);

  // 添加/删除行
  const handleAddRow = useCallback(() => {
    setState((s) => {
      const newSheets = [...s.sheets];
      const sheet = { ...newSheets[s.activeSheetIndex] };
      sheet.rows = [...sheet.rows, []];
      sheet.rowCount += 1;
      newSheets[s.activeSheetIndex] = sheet;
      return { ...s, sheets: newSheets, dirty: true };
    });
  }, []);

  const handleAddCol = useCallback(() => {
    setState((s) => {
      const newSheets = [...s.sheets];
      const sheet = { ...newSheets[s.activeSheetIndex] };
      sheet.colCount += 1;
      newSheets[s.activeSheetIndex] = sheet;
      return { ...s, sheets: newSheets, dirty: true };
    });
  }, []);

  const handleDeleteRow = useCallback(() => {
    setState((s) => {
      const newSheets = [...s.sheets];
      const sheet = { ...newSheets[s.activeSheetIndex] };
      if (sheet.rowCount <= 0) return s;
      sheet.rows = sheet.rows.slice(0, -1);
      sheet.rowCount -= 1;
      newSheets[s.activeSheetIndex] = sheet;
      return { ...s, sheets: newSheets, dirty: true };
    });
  }, []);

  const handleDeleteCol = useCallback(() => {
    setState((s) => {
      const newSheets = [...s.sheets];
      const sheet = { ...newSheets[s.activeSheetIndex] };
      if (sheet.colCount <= 0) return s;
      sheet.rows = sheet.rows.map((row) => row.slice(0, -1));
      sheet.colCount -= 1;
      newSheets[s.activeSheetIndex] = sheet;
      return { ...s, sheets: newSheets, dirty: true };
    });
  }, []);

  const clear = useCallback(() => {
    setState(INITIAL_EXCEL_STATE);
  }, []);

  const activeSheet = state.sheets[state.activeSheetIndex];

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-green-600" />
          <h2 className="font-semibold text-sm text-foreground">
            Excel 编辑
          </h2>
          {state.fileName && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]" title={state.fileName}>
              {state.fileName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state.status === 'loaded' && (
            <button
              onClick={clear}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              title="关闭当前文件"
            >
              <X className="h-3.5 w-3.5" />
              关闭
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={handleOpen}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            打开文件
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 overflow-hidden bg-muted relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽提示 */}
        {dragOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-green-500/10 border-2 border-dashed border-green-400 rounded-lg m-4">
            <div className="text-center">
              <Upload className="h-10 w-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">释放以打开文件</p>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {state.status === 'idle' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="h-16 w-16 text-foreground text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-1">打开或拖入 Excel 文件</p>
              <p className="text-xs text-muted-foreground mb-4">支持 .xlsx、.xls、.csv 格式</p>
              <button
                onClick={handleOpen}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
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
              <Loader2 className="h-8 w-8 text-green-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">正在解析表格...</p>
              <p className="text-xs text-muted-foreground mt-1">{state.fileName}</p>
            </div>
          </div>
        )}

        {/* 错误 */}
        {state.status === 'error' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <X className="h-12 w-12 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-600 font-medium mb-1">解析失败</p>
              <p className="text-xs text-muted-foreground mb-2">{state.error}</p>
              {state.fileName && <p className="text-xs text-muted-foreground mb-4">文件：{state.fileName}</p>}
              <button
                onClick={handleOpen}
                className="text-sm text-primary hover:text-primary"
              >
                尝试打开另一个文件
              </button>
            </div>
          </div>
        )}

        {/* 已加载：工具栏 + 表格 */}
        {state.status === 'loaded' && activeSheet && (
          <div className="flex flex-col h-full">
            <Toolbar
              fileName={state.fileName}
              sheets={state.sheets}
              activeSheetIndex={state.activeSheetIndex}
              dirty={state.dirty}
              canUndo={getCanUndo()}
              canRedo={getCanRedo()}
              onOpenFile={handleOpen}
              onSave={handleSave}
              onSaveAs={handleSaveAs}
              onSheetChange={handleSheetChange}
              onAddRow={handleAddRow}
              onAddCol={handleAddCol}
              onDeleteRow={handleDeleteRow}
              onDeleteCol={handleDeleteCol}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
            <ExcelGrid
              sheet={activeSheet}
              onCellChange={handleCellChange}
              canUndo={getCanUndo()}
              canRedo={getCanRedo()}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      {state.status === 'loaded' && activeSheet && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-muted-foreground bg-background">
          <span>
            {activeSheet.rowCount} 行 × {activeSheet.colCount} 列
            {state.dirty && <span className="text-amber-500 ml-2">未保存</span>}
          </span>
          <span>{activeSheet.name} — Sheet {state.activeSheetIndex + 1}/{state.sheets.length}</span>
        </div>
      )}
    </div>
  );
};
