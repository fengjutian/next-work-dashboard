/**
 * Excel Preview 插件 — 类型定义
 */

/** 单元格数据类型 */
export interface CellValue {
  v: string | number | boolean | null;
  t?: 's' | 'n' | 'b' | 'd';
  f?: string;
}

/** 一个 Sheet 的数据 */
export interface SheetData {
  name: string;
  rows: CellValue[][];
  rowCount: number;
  colCount: number;
}

export type ExcelStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'saving';

export interface ExcelState {
  status: ExcelStatus;
  fileName: string | null;
  fileBuffer: ArrayBuffer | null;
  sheets: SheetData[];
  activeSheetIndex: number;
  error: string | null;
  dirty: boolean;
}

export const INITIAL_EXCEL_STATE: ExcelState = {
  status: 'idle',
  fileName: null,
  fileBuffer: null,
  sheets: [],
  activeSheetIndex: 0,
  error: null,
  dirty: false,
};

export interface CellSelection {
  row: number;
  col: number;
}

export interface UndoAction {
  sheetIndex: number;
  row: number;
  col: number;
  oldValue: CellValue;
  newValue: CellValue;
}
