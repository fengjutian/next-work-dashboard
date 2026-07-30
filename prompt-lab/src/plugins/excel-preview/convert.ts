/**
 * SheetJS 桥接层 — Excel 文件 ↔ 内部 GridData 双向转换
 *
 * 依赖：xlsx (SheetJS) — 已是项目依赖
 */
import * as XLSX from 'xlsx';
import type { CellValue, SheetData } from './types';

/** 将 SheetJS workbook 转换为内部 SheetData[] */
function workbookToSheets(wb: XLSX.WorkBook): SheetData[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    // sheet_to_json with header:1 返回二维数组
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: false, // 格式化为字符串以保持显示一致性
    });

    const rowCount = Math.max(aoa.length, 1);
    const colCount = aoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);

    // 转换为 CellValue 结构
    const rows: CellValue[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const rowData = aoa[r];
      const row: CellValue[] = [];
      for (let c = 0; c < colCount; c++) {
        const raw = Array.isArray(rowData) && c < rowData.length ? rowData[c] : null;
        row.push(rawToCell(raw));
      }
      rows.push(row);
    }

    return { name, rows, rowCount, colCount };
  });
}

/** 将原始值转换为 CellValue */
function rawToCell(raw: unknown): CellValue {
  if (raw === null || raw === undefined || raw === '') {
    return { v: null, t: 's' };
  }
  if (typeof raw === 'number') {
    return { v: raw, t: 'n' };
  }
  if (typeof raw === 'boolean') {
    return { v: raw, t: 'b' };
  }
  return { v: String(raw), t: 's' };
}

/** 将内部 SheetData[] 转换为 SheetJS workbook 并输出 ArrayBuffer */
function sheetsToWorkbook(sheets: SheetData[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // 转换 CellValue[][] → 二维数组
    const aoa: unknown[][] = sheet.rows.map((row) =>
      row.map((cell) => {
        if (cell.v === null || cell.v === undefined) return '';
        return cell.v;
      }),
    );

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  // 输出为 ArrayBuffer
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/**
 * 从 File / ArrayBuffer 解析 Excel → 内部数据格式
 */
export async function fileToSheets(file: File): Promise<{ sheets: SheetData[]; fileName: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheets = workbookToSheets(wb);
  return { sheets, fileName: file.name };
}

/**
 * 从 ArrayBuffer 解析 Excel → 内部数据格式（用于已有 buffer 的场景）
 */
export function bufferToSheets(buffer: ArrayBuffer): SheetData[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  return workbookToSheets(wb);
}

/**
 * 将内部数据格式 → Excel Blob（用于浏览器下载）
 */
export function sheetsToBlob(sheets: SheetData[]): Blob {
  const arrayBuffer = sheetsToWorkbook(sheets);
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * 将内部数据格式 → Uint8Array（用于 Electron 写文件等场景）
 */
export function sheetsToUint8Array(sheets: SheetData[]): Uint8Array {
  const arrayBuffer = sheetsToWorkbook(sheets);
  return new Uint8Array(arrayBuffer);
}
