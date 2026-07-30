/**
 * Excel Preview 插件 — 类型定义
 */

/** 单元格数据类型 */
export interface CellValue {
  /** 显示值 */
  v: string | number | boolean | null;
  /** 原始类型（用于 SheetJS 类型映射） */
  t?: 's' | 'n' | 'b' | 'd';
  /** 公式（如有） */
  f?: string;
}

/** 一个 Sheet 的数据 */
export interface SheetData {
  name: string;
  rows: CellValue[][];
  rowCount: number;
  colCount: number;
}

/** 插件整体状态 */
export type ExcelStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'saving';

export interface ExcelState {
  status: ExcelStatus;
  fileName: string | null;
  /** 原始 ArrayBuffer — 用于保存回写 */
  fileBuffer: ArrayBuffer | null;
  sheets: SheetData[];
  activeSheetIndex: number;
  error: string | null;
  /** 是否有未保存的修改 */
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

/** 选区 */
export interface CellSelection {
  row: number;
  col: number;
}

/** 撤销操作 */
export interface UndoAction {
  sheetIndex: number;
  row: number;
  col: number;
  oldValue: CellValue;
  newValue: CellValue;
}
