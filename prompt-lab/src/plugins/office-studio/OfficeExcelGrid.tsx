import React, { useCallback, useEffect, useState } from 'react';
import { ExcelGrid } from '@/plugins/excel-preview/ExcelGrid';
import { bufferToSheets } from '@/plugins/excel-preview/convert';
import type { CellValue, SheetData } from '@/plugins/excel-preview/types';
import { officeClient } from './office-client';
import type { OfficeOperationResult } from './types';

interface Props {
  filePath: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onMutation(result: OfficeOperationResult): void;
  onError(message: string): void;
}

export function columnLabel(index: number): string {
  let label = '';
  for (let value = index; value >= 0; value = Math.floor(value / 26) - 1) label = String.fromCharCode(65 + (value % 26)) + label;
  return label;
}

export function excelCellAddress(sheet: string, row: number, col: number): string {
  return `${sheet}!${columnLabel(col)}${row + 1}`;
}

function withEditableArea(sheet: SheetData): SheetData {
  return { ...sheet, rowCount: Math.max(sheet.rowCount, 50), colCount: Math.max(sheet.colCount, 20) };
}

export const OfficeExcelGrid: React.FC<Props> = ({ filePath, canUndo, canRedo, onUndo, onRedo, onMutation, onError }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await window.electronAPI.readFileBuffer(filePath);
    if (!result.success || !result.data) { onError(result.error || '无法读取 Excel 文件'); setLoading(false); return; }
    const binary = atob(result.data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    try {
      const parsed = bufferToSheets(bytes.buffer);
      setSheets(parsed.length ? parsed.map(withEditableArea) : [withEditableArea({ name: 'Sheet1', rows: [], rowCount: 0, colCount: 0 })]);
      setActiveSheet(0);
    } catch (error) { onError(error instanceof Error ? error.message : 'Excel 解析失败'); }
    setLoading(false);
  }, [filePath, onError]);

  useEffect(() => { void reload(); }, [reload]);

  const changeCell = async (row: number, col: number, value: CellValue) => {
    const sheet = sheets[activeSheet];
    const previous = sheet.rows[row]?.[col] ?? { v: null };
    setSheets((current) => current.map((item, index) => {
      if (index !== activeSheet) return item;
      const rows = item.rows.map((existing) => [...existing]);
      while (rows.length <= row) rows.push([]);
      while (rows[row].length <= col) rows[row].push({ v: null });
      rows[row][col] = value;
      return { ...item, rows };
    }));
    const address = excelCellAddress(sheet.name, row, col);
    const raw = value.v == null ? '' : String(value.v);
    const properties = raw.startsWith('=') ? { formula: raw } : { value: raw };
    const result = await officeClient.set({ filePath, path: address, properties });
    if (!result.success) {
      setSheets((current) => current.map((item, index) => {
        if (index !== activeSheet) return item;
        const rows = item.rows.map((existing) => [...existing]);
        while (rows.length <= row) rows.push([]);
        rows[row][col] = previous;
        return { ...item, rows };
      }));
      onError(result.error || `无法更新 ${address}`);
    }
    onMutation(result);
  };

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载工作簿…</div>;
  const sheet = sheets[activeSheet];
  if (!sheet) return <div className="p-4 text-sm text-destructive">工作簿没有可用工作表</div>;
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 pt-1">
      {sheets.map((item, index) => <button key={item.name} onClick={() => setActiveSheet(index)} className={`rounded-t border border-b-0 px-3 py-1 text-xs ${index === activeSheet ? 'bg-card text-primary' : 'bg-muted text-muted-foreground'}`}>{item.name}</button>)}
      <button onClick={() => void reload()} className="ml-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground">重新载入</button>
    </div>
    <ExcelGrid sheet={sheet} onCellChange={(row, col, value) => void changeCell(row, col, value)} canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
  </div>;
};
