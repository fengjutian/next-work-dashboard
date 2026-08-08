import React, { useCallback, useEffect, useState } from 'react';
import { ExcelGrid } from '@/plugins/excel-preview/ExcelGrid';
import { bufferToSheets } from '@/plugins/excel-preview/convert';
import type { CellSelection, CellValue, SheetData } from '@/plugins/excel-preview/types';
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
  const [selection, setSelection] = useState<CellSelection>({ row: 0, col: 0 });
  const [formulaText, setFormulaText] = useState('');

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

  const selectCell = useCallback((next: CellSelection) => {
    setSelection(next);
    const cell = sheets[activeSheet]?.rows[next.row]?.[next.col];
    setFormulaText(cell?.f ? `=${cell.f}` : cell?.v == null ? '' : String(cell.v));
  }, [activeSheet, sheets]);

  const mutateStructure = async (operation: () => Promise<OfficeOperationResult>) => {
    const result = await operation();
    onMutation(result);
    if (!result.success) onError(result.error || '工作表结构修改失败');
    else await reload();
  };

  const addSheet = async () => {
    const name = window.prompt('新工作表名称', `Sheet${sheets.length + 1}`)?.trim();
    if (name) await mutateStructure(() => officeClient.add({ filePath, path: '/', type: 'sheet', properties: { name } }));
  };

  const renameSheet = async () => {
    const current = sheets[activeSheet];
    const name = window.prompt('工作表新名称', current.name)?.trim();
    if (name && name !== current.name) await mutateStructure(() => officeClient.set({ filePath, path: `/${current.name}`, properties: { name } }));
  };

  const removeSheet = async () => {
    const current = sheets[activeSheet];
    if (sheets.length <= 1) { onError('工作簿至少需要一个工作表'); return; }
    if (window.confirm(`确定删除工作表“${current.name}”？`)) await mutateStructure(() => officeClient.remove(filePath, `/${current.name}`));
  };

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载工作簿…</div>;
  const sheet = sheets[activeSheet];
  if (!sheet) return <div className="p-4 text-sm text-destructive">工作簿没有可用工作表</div>;
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <span className="w-16 rounded border bg-muted px-2 py-1 text-center font-mono text-xs">{columnLabel(selection.col)}{selection.row + 1}</span>
      <span className="text-xs font-semibold text-muted-foreground">fx</span>
      <input value={formulaText} onChange={(event) => setFormulaText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void changeCell(selection.row, selection.col, { v: formulaText, f: formulaText.startsWith('=') ? formulaText.slice(1) : undefined }); }} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" placeholder="输入值或 =公式，按 Enter 提交" />
      <button onClick={() => void mutateStructure(() => officeClient.add({ filePath, path: `/${sheet.name}`, type: 'row', index: selection.row, properties: {} }))} className="rounded border px-2 py-1 text-xs">插入行</button>
      <button onClick={() => void mutateStructure(() => officeClient.remove(filePath, `/${sheet.name}/row[${selection.row + 1}]`))} className="rounded border px-2 py-1 text-xs">删除行</button>
      <button onClick={() => void mutateStructure(() => officeClient.add({ filePath, path: `/${sheet.name}`, type: 'col', index: selection.col, properties: {} }))} className="rounded border px-2 py-1 text-xs">插入列</button>
      <button onClick={() => void mutateStructure(() => officeClient.remove(filePath, `/${sheet.name}/col[${columnLabel(selection.col)}]`))} className="rounded border px-2 py-1 text-xs">删除列</button>
    </div>
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 pt-1">
      {sheets.map((item, index) => <button key={item.name} onClick={() => setActiveSheet(index)} className={`rounded-t border border-b-0 px-3 py-1 text-xs ${index === activeSheet ? 'bg-card text-primary' : 'bg-muted text-muted-foreground'}`}>{item.name}</button>)}
      <button onClick={() => void addSheet()} className="px-2 py-1 text-xs">＋</button>
      <button onClick={() => void renameSheet()} className="px-2 py-1 text-xs text-muted-foreground">重命名</button>
      <button onClick={() => void removeSheet()} className="px-2 py-1 text-xs text-destructive">删除</button>
      <button onClick={() => void reload()} className="ml-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground">重新载入</button>
    </div>
    <ExcelGrid sheet={sheet} onCellChange={(row, col, value) => void changeCell(row, col, value)} canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} onSelectionChange={selectCell} />
  </div>;
};
