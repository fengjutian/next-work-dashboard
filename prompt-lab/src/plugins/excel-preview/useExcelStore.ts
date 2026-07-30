/**
 * Excel 编辑器内联状态管理 — 撤销/重做、选区、数据变更
 */
import { useRef, useCallback } from 'react';
import type { CellValue, CellSelection, UndoAction, SheetData } from './types';

export interface ExcelStoreRef {
  /** 撤销栈 */
  undoStack: UndoAction[];
  /** Redo stack (cleared on new edit) */
  redoStack: UndoAction[];
  /** 当前选区 */
  selection: CellSelection;
}

/**
 * 使用 ref 管理 Excel 编辑状态（避免不必要的 re-render）。
 * 只对需要触发 UI 更新的操作（数据变更）通过回调通知。
 */
export function useExcelStore(onDataChange: () => void) {
  const storeRef = useRef<ExcelStoreRef>({
    undoStack: [],
    redoStack: [],
    selection: { row: 0, col: 0 },
  });

  const pushUndo = useCallback(
    (action: UndoAction) => {
      const store = storeRef.current;
      store.undoStack.push(action);
      // 限制 undo 栈大小为 200
      if (store.undoStack.length > 200) {
        store.undoStack.shift();
      }
      store.redoStack = [];
    },
    [],
  );

  const undo = useCallback(
    (sheets: SheetData[], setSheets: (s: SheetData[]) => void) => {
      const store = storeRef.current;
      const action = store.undoStack.pop();
      if (!action) return;

      store.redoStack.push(action);

      const newSheets = sheets.map((sheet, i) => {
        if (i !== action.sheetIndex) return sheet;
        const newRows = sheet.rows.map((row, r) => {
          if (r !== action.row) return row;
          const newRow = [...row];
          newRow[action.col] = action.oldValue;
          return newRow;
        });
        return { ...sheet, rows: newRows };
      });

      setSheets(newSheets);
      onDataChange();
    },
    [onDataChange],
  );

  const redo = useCallback(
    (sheets: SheetData[], setSheets: (s: SheetData[]) => void) => {
      const store = storeRef.current;
      const action = store.redoStack.pop();
      if (!action) return;

      store.undoStack.push(action);

      const newSheets = sheets.map((sheet, i) => {
        if (i !== action.sheetIndex) return sheet;
        const newRows = sheet.rows.map((row, r) => {
          if (r !== action.row) return row;
          const newRow = [...row];
          newRow[action.col] = action.newValue;
          return newRow;
        });
        return { ...sheet, rows: newRows };
      });

      setSheets(newSheets);
      onDataChange();
    },
    [onDataChange],
  );

  const setCellValue = useCallback(
    (
      row: number,
      col: number,
      newValue: CellValue,
      sheets: SheetData[],
      sheetIndex: number,
      setSheets: (s: SheetData[]) => void,
    ) => {
      const oldValue = sheets[sheetIndex].rows[row]?.[col] ?? { v: null };

      // 无变化则跳过
      if (oldValue.v === newValue.v) return;

      // Push undo
      storeRef.current.undoStack.push({
        sheetIndex,
        row,
        col,
        oldValue: { ...oldValue },
        newValue: { ...newValue },
      });

      const newSheets = sheets.map((sheet, si) => {
        if (si !== sheetIndex) return sheet;
        const newRows = sheet.rows.map((rData, ri) => {
          if (ri !== row) return rData;
          const newRow = [...rData];
          // extend row if needed
          while (newRow.length <= col) newRow.push({ v: null });
          newRow[col] = newValue;
          return newRow;
        });
        // add rows if needed
        while (newRows.length <= row) {
          newRows.push([]);
        }
        return {
          ...sheet,
          rows: newRows,
          rowCount: Math.max(sheet.rowCount, row + 1),
          colCount: Math.max(sheet.colCount, col + 1),
        };
      });

      setSheets(newSheets);
      onDataChange();
    },
    [onDataChange],
  );

  const getCanUndo = useCallback(() => storeRef.current.undoStack.length > 0, []);
  const getCanRedo = useCallback(() => storeRef.current.redoStack.length > 0, []);

  return {
    storeRef,
    pushUndo,
    undo,
    redo,
    setCellValue,
    getCanUndo,
    getCanRedo,
  };
}
