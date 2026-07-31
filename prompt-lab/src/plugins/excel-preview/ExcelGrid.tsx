/**
 * ExcelGrid — 轻量级虚拟表格渲染 + 内联编辑
 *
 * 设计：
 * - 仅渲染可见行（±buffer）以支持大数据量
 * - 点击选中单元格，双击/Enter进入编辑态
 * - Tab/方向键导航
 * - A/B/C...列标 + 1/2/3...行号
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CellValue, CellSelection, SheetData } from './types';

interface ExcelGridProps {
  sheet: SheetData;
  onCellChange: (row: number, col: number, value: CellValue) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const ROW_HEIGHT = 28;
const COL_WIDTH = 100;
const HEADER_ROW_HEIGHT = 28;
const HEADER_COL_WIDTH = 48;
const BUFFER_ROWS = 10;

/** 列索引 → 列标字母 (0→A, 25→Z, 26→AA) */
function colLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export const ExcelGrid: React.FC<ExcelGridProps> = ({
  sheet,
  onCellChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [selection, setSelection] = useState<CellSelection>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<CellSelection | null>(null);
  const [editText, setEditText] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [containerWidth, setContainerWidth] = useState(800);

  const { rows, rowCount, colCount } = sheet;

  // 容器尺寸监听
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 可见行范围
  const visibleRange = useMemo(() => {
    const headerH = HEADER_ROW_HEIGHT;
    const availableH = containerHeight - headerH;
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const visibleRows = Math.ceil(availableH / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const endRow = Math.min(rowCount, startRow + visibleRows);
    return { startRow, endRow };
  }, [scrollTop, containerHeight, rowCount]);

  // 可见列范围
  const visibleColRange = useMemo(() => {
    const headerW = HEADER_COL_WIDTH;
    const availableW = containerWidth - headerW;
    const startCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - 2);
    const visibleCols = Math.ceil(availableW / COL_WIDTH) + 4;
    const endCol = Math.min(colCount, startCol + visibleCols);
    return { startCol, endCol };
  }, [scrollLeft, containerWidth, colCount]);

  const totalHeight = HEADER_ROW_HEIGHT + rowCount * ROW_HEIGHT;
  const totalWidth = HEADER_COL_WIDTH + colCount * COL_WIDTH;

  // 开始编辑
  const startEdit = useCallback(
    (sel: CellSelection) => {
      const cell = rows[sel.row]?.[sel.col];
      setEditText(cell?.v != null ? String(cell.v) : '');
      setEditing(sel);
      setTimeout(() => editInputRef.current?.focus(), 0);
    },
    [rows],
  );

  // 提交编辑
  const commitEdit = useCallback(() => {
    if (!editing) return;
    const { row, col } = editing;
    let value: CellValue;
    const trimmed = editText.trim();
    if (trimmed === '') {
      value = { v: null };
    } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      value = { v: Number(trimmed), t: 'n' };
    } else if (trimmed === 'true' || trimmed === 'false') {
      value = { v: trimmed === 'true', t: 'b' };
    } else {
      value = { v: trimmed, t: 's' };
    }
    onCellChange(row, col, value);
    setEditing(null);
  }, [editing, editText, onCellChange]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 快捷键：撤销/重做
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey && canRedo) {
          onRedo();
        } else if (!e.shiftKey && canUndo) {
          onUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (canRedo) onRedo();
        return;
      }

      if (editing) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
          setSelection((s) => ({ row: Math.min(s.row + 1, rowCount - 1), col: s.col }));
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commitEdit();
          setSelection((s) => ({ row: s.row, col: Math.min(s.col + 1, colCount - 1) }));
        } else if (e.key === 'Escape') {
          setEditing(null);
        }
        return;
      }

      // 非编辑态导航
      setSelection((s) => {
        let { row, col } = s;
        if (e.key === 'ArrowDown') row = Math.min(row + 1, rowCount - 1);
        else if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
        else if (e.key === 'ArrowRight') col = Math.min(col + 1, colCount - 1);
        else if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
        else if (e.key === 'Tab') col = Math.min(col + 1, colCount - 1);
        else if (e.key === 'Enter') startEdit(s);
        else if (e.key === 'F2') startEdit(s);
        else if (e.key === 'Delete' || e.key === 'Backspace') {
          onCellChange(row, col, { v: null });
        }
        return { row, col };
      });
    },
    [editing, commitEdit, startEdit, rowCount, colCount, onCellChange, canUndo, canRedo, onUndo, onRedo],
  );

  // 生成可见行
  const visibleRows = useMemo(() => {
    const result: { index: number; cells: CellValue[] }[] = [];
    for (let r = visibleRange.startRow; r < visibleRange.endRow; r++) {
      result.push({ index: r, cells: rows[r] ?? [] });
    }
    return result;
  }, [rows, visibleRange]);

  // 单元格渲染
  const renderCell = (rowIdx: number, colIdx: number, cell: CellValue | undefined, isSelected: boolean, isEditing: boolean) => {
    const displayValue = cell?.v != null ? String(cell.v) : '';

    if (isEditing) {
      return (
        <input
          ref={editInputRef}
          className="absolute inset-0 w-full h-full px-1.5 text-sm bg-card border-2 border-primary outline-none z-10"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commitEdit();
              if (e.key === 'Enter') setSelection((s) => ({ row: Math.min(s.row + 1, rowCount - 1), col: s.col }));
              else setSelection((s) => ({ row: s.row, col: Math.min(s.col + 1, colCount - 1) }));
            }
          }}
        />
      );
    }

    return (
      <div
        className={`w-full h-full px-1.5 py-0.5 text-sm truncate select-none ${
          isSelected
            ? 'bg-primary-light border border-primary border-primary'
            : 'border border-transparent hover:bg-background dark:hover:bg-muted/50'
        }`}
        title={displayValue}
      >
        {displayValue}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden bg-card outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* 滚动容器 */}
      <div
        className="overflow-auto h-full w-full"
        onScroll={(e) => {
          const target = e.currentTarget;
          setScrollTop(target.scrollTop);
          setScrollLeft(target.scrollLeft);
        }}
      >
        <div
          className="relative"
          style={{ width: totalWidth, height: totalHeight }}
        >
          {/* 列标栏 */}
          <div
            className="sticky top-0 z-20 flex bg-muted border-b border-input"
            style={{ height: HEADER_ROW_HEIGHT, paddingLeft: HEADER_COL_WIDTH }}
          >
            {/* 左上角空白 */}
            <div
              className="absolute left-0 top-0 bg-accent border-r border-input flex items-center justify-center"
              style={{ width: HEADER_COL_WIDTH, height: HEADER_ROW_HEIGHT }}
            >
              <span className="text-[10px] text-muted-foreground font-mono">#</span>
            </div>
            {Array.from({ length: visibleColRange.endCol - visibleColRange.startCol }, (_, i) => {
              const colIdx = visibleColRange.startCol + i;
              return (
                <div
                  key={colIdx}
                  className="flex items-center justify-center text-[11px] font-medium text-muted-foreground border-r border-border flex-shrink-0 select-none"
                  style={{
                    width: COL_WIDTH,
                    height: HEADER_ROW_HEIGHT,
                    position: 'absolute',
                    left: HEADER_COL_WIDTH + colIdx * COL_WIDTH,
                  }}
                >
                  {colLabel(colIdx)}
                </div>
              );
            })}
          </div>

          {/* 行号 + 数据行 */}
          {visibleRows.map(({ index: r }) => {
            const isRowSelected = selection.row === r;
            const top = HEADER_ROW_HEIGHT + r * ROW_HEIGHT;

            return (
              <div key={r} className="absolute flex" style={{ top, height: ROW_HEIGHT, left: 0 }}>
                {/* 行号 */}
                <div
                  className={`flex items-center justify-end pr-1.5 text-[11px] text-muted-foreground border-r border-b border-border flex-shrink-0 select-none ${
                    isRowSelected ? 'bg-primary-light bg-primary-light' : 'bg-background bg-muted/50'
                  }`}
                  style={{ width: HEADER_COL_WIDTH }}
                >
                  {r + 1}
                </div>
                {/* 单元格 */}
                {Array.from({ length: visibleColRange.endCol - visibleColRange.startCol }, (_, i) => {
                  const colIdx = visibleColRange.startCol + i;
                  const cell = rows[r]?.[colIdx];
                  const isSelected = selection.row === r && selection.col === colIdx;
                  const isEditing = editing?.row === r && editing?.col === colIdx;

                  return (
                    <div
                      key={colIdx}
                      className="border-r border-b border-border flex-shrink-0 relative"
                      style={{ width: COL_WIDTH }}
                      onClick={() => {
                        setSelection({ row: r, col: colIdx });
                      }}
                      onDoubleClick={() => startEdit({ row: r, col: colIdx })}
                    >
                      {renderCell(r, colIdx, cell, isSelected, isEditing)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
