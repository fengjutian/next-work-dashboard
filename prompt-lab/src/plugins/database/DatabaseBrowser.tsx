import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exportDb,
  getDatabaseStats,
  getDatabaseTablePage,
  getDatabaseTableSchema,
  getDatabaseTableStats,
  getDatabaseColumnAnalysis,
  getDatabaseSchemaDiagnostics,
  getTableInfo,
  isDbReady,
  type DatabaseStats,
  type DatabaseTablePage,
  type DatabaseTableSchema,
  type DatabaseTableStats,
  type DatabaseColumnFilter,
  type DatabaseFilterOperator,
  type DatabaseColumnAnalysis,
  type DatabaseSchemaDiagnostic,
} from '@/db';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, Database, Download, RefreshCw, Search } from '@/components/icons';
import { TABLE_CATEGORIES, tableCategoryId, tableDisplayName } from './tableCatalog';
import { SqlWorkbench } from './SqlWorkbench';

interface TableInfo {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

type SortState = { column: string; direction: 'asc' | 'desc' } | null;
type CellSelection = { column: string; value: unknown } | null;
type ViewMode = 'data' | 'structure' | 'analysis' | 'sql';
type NavigationEntry = { table: string; page: number; sort: SortState; filters: DatabaseColumnFilter[] };
interface TableViewPreferences { widths: Record<string, number>; hidden: string[]; pinned: number; sort: SortState; filters: DatabaseColumnFilter[] }
const TABLE_PREFS_KEY = 'database-browser.table-preferences.v1';

function loadTablePreferences(table: string): TableViewPreferences {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_PREFS_KEY) ?? '{}') as Record<string, Partial<TableViewPreferences>>;
    return { widths: {}, hidden: [], pinned: 0, sort: null, filters: [], ...all[table] };
  } catch { return { widths: {}, hidden: [], pinned: 0, sort: null, filters: [] }; }
}

function saveTablePreferences(table: string, preferences: TableViewPreferences): void {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_PREFS_KEY) ?? '{}') as Record<string, TableViewPreferences>;
    localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify({ ...all, [table]: preferences }));
  } catch { /* localStorage may be unavailable */ }
}

function formatBytes(bytes?: number): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function displayValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) return `<BLOB · ${formatBytes(value.byteLength)}>`;
  return String(value);
}

function detailedValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  }
  if (typeof value !== 'string') return String(value);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const DatabaseBrowser: React.FC = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [data, setData] = useState<DatabaseTablePage | null>(null);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [selectedStats, setSelectedStats] = useState<Required<DatabaseTableStats> | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<DatabaseTableSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tableQuery, setTableQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<SortState>(null);
  const [selectedCell, setSelectedCell] = useState<CellSelection>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('data');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterOperator, setFilterOperator] = useState<DatabaseFilterOperator>('contains');
  const [filters, setFilters] = useState<DatabaseColumnFilter[]>([]);
  const [navigationStack, setNavigationStack] = useState<NavigationEntry[]>([]);
  const [analysis, setAnalysis] = useState<DatabaseColumnAnalysis | null>(null);
  const [diagnostics, setDiagnostics] = useState<DatabaseSchemaDiagnostic[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [pinnedColumns, setPinnedColumns] = useState(0);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [gridSelection, setGridSelection] = useState<{ row: number; visibleColumn: number } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);
  const exportCancelledRef = useRef(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const loadTables = useCallback(() => {
    if (!isDbReady()) return;
    try {
      setTables(getTableInfo());
      setStats(getDatabaseStats());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const loadTableData = useCallback((table: string, nextPage: number, limit: number, nextSort: SortState, activeFilters: DatabaseColumnFilter[], totalRows?: number, refreshStats = false) => {
    if (!isDbReady()) return;
    setLoading(true);
    setSelectedRows(new Set());
    setError(null);
    try {
      setData(getDatabaseTablePage(table, {
        offset: nextPage * limit,
        limit,
        sortColumn: nextSort?.column,
        sortDirection: nextSort?.direction,
        totalRows,
        filters: activeFilters,
      }));
      if (refreshStats) {
        setSelectedStats(getDatabaseTableStats(table));
        setSelectedSchema(getDatabaseTableSchema(table));
        setDiagnostics(getDatabaseSchemaDiagnostics(table));
      }
    } catch (err) {
      setError(String(err));
      setData(null);
      setSelectedStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);
  useEffect(() => {
    if (selectedTable) saveTablePreferences(selectedTable, { widths: columnWidths, hidden: hiddenColumns, pinned: pinnedColumns, sort, filters });
  }, [columnWidths, filters, hiddenColumns, pinnedColumns, selectedTable, sort]);
  useEffect(() => {
    if (tables.length > 0) return;
    const interval = window.setInterval(() => {
      if (isDbReady()) {
        loadTables();
        window.clearInterval(interval);
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [tables.length, loadTables]);

  const selectTable = (table: string) => {
    const preferences = loadTablePreferences(table);
    setSelectedTable(table);
    setPage(0);
    setSort(preferences.sort);
    setFilters(preferences.filters);
    setColumnWidths(preferences.widths);
    setHiddenColumns(preferences.hidden);
    setPinnedColumns(preferences.pinned);
    setFilterColumn('');
    setFilterValue('');
    setFilterOperator('contains');
    setViewMode('data');
    setNavigationStack([]);
    setAnalysis(null);
    setSelectedRows(new Set());
    setSelectedCell(null);
    loadTableData(table, 0, pageSize, preferences.sort, preferences.filters, undefined, true);
  };

  const refresh = () => {
    loadTables();
    if (selectedTable) loadTableData(selectedTable, page, pageSize, sort, filters, undefined, true);
  };

  const changePage = (nextPage: number) => {
    if (!selectedTable) return;
    setPage(nextPage);
    loadTableData(selectedTable, nextPage, pageSize, sort, filters, filters.length ? undefined : data?.totalRows);
  };

  const changePageSize = (limit: number) => {
    if (!selectedTable) return;
    setPageSize(limit);
    setPage(0);
    loadTableData(selectedTable, 0, limit, sort, filters, filters.length ? undefined : data?.totalRows);
  };

  const changeSort = (column: string) => {
    if (!selectedTable) return;
    const nextSort: SortState = sort?.column === column
      ? sort.direction === 'asc' ? { column, direction: 'desc' } : null
      : { column, direction: 'asc' };
    setSort(nextSort);
    setPage(0);
    loadTableData(selectedTable, 0, pageSize, nextSort, filters, filters.length ? undefined : data?.totalRows);
  };

  const applyFilter = () => {
    const needsValue = filterOperator !== 'is-null' && filterOperator !== 'not-null';
    if (!selectedTable || !filterColumn || (needsValue && !filterValue)) return;
    const nextFilters: DatabaseColumnFilter[] = [...filters, {
      column: filterColumn,
      operator: filterOperator,
      value: needsValue ? filterValue : undefined,
    }];
    setFilters(nextFilters);
    setFilterValue('');
    setPage(0);
    loadTableData(selectedTable, 0, pageSize, sort, nextFilters);
  };

  const clearFilter = () => {
    if (!selectedTable) return;
    setFilters([]);
    setFilterValue('');
    setPage(0);
    loadTableData(selectedTable, 0, pageSize, sort, [], selectedStats?.rowCount);
  };

  const removeFilter = (index: number) => {
    if (!selectedTable) return;
    const nextFilters = filters.filter((_, filterIndex) => filterIndex !== index);
    setFilters(nextFilters);
    setPage(0);
    loadTableData(selectedTable, 0, pageSize, sort, nextFilters, nextFilters.length ? undefined : selectedStats?.rowCount);
  };

  const jumpToForeignKey = (column: string, value: unknown) => {
    if (!selectedTable || value === null) return;
    const foreignKey = selectedSchema?.foreignKeys.find((item) => item.from === column)
      ?? inferredRelations.find((item) => item.from === column);
    if (!foreignKey || !tables.some((table) => table.table === foreignKey.targetTable)) return;
    const targetSchema = getDatabaseTableSchema(foreignKey.targetTable);
    const targetColumn = foreignKey.targetColumn
      || targetSchema.columns.find((target) => target.primaryKeyOrder === 1)?.name;
    if (!targetColumn) return;
    setNavigationStack((stack) => [...stack, { table: selectedTable, page, sort, filters }]);
    const nextFilters: DatabaseColumnFilter[] = [{ column: targetColumn, operator: 'equals', value: String(value) }];
    setSelectedTable(foreignKey.targetTable);
    setPage(0);
    setSort(null);
    setFilters(nextFilters);
    setFilterColumn(targetColumn);
    setFilterOperator('equals');
    setFilterValue(String(value));
    setViewMode('data');
    setSelectedCell(null);
    loadTableData(foreignKey.targetTable, 0, pageSize, null, nextFilters, undefined, true);
  };

  const navigateBack = () => {
    const previous = navigationStack[navigationStack.length - 1];
    if (!previous) return;
    setNavigationStack((stack) => stack.slice(0, -1));
    setSelectedTable(previous.table);
    setPage(previous.page);
    setSort(previous.sort);
    setFilters(previous.filters);
    setFilterColumn('');
    setFilterValue('');
    setViewMode('data');
    setSelectedCell(null);
    loadTableData(previous.table, previous.page, pageSize, previous.sort, previous.filters, undefined, true);
  };

  const navigateToRelatedTable = (targetTable: string) => {
    if (!selectedTable || !tables.some((table) => table.table === targetTable)) return;
    setNavigationStack((stack) => [...stack, { table: selectedTable, page, sort, filters }]);
    setSelectedTable(targetTable); setPage(0); setSort(null); setFilters([]); setViewMode('data'); setSelectedCell(null);
    loadTableData(targetTable, 0, pageSize, null, [], undefined, true);
  };

  const analyzeColumn = (column: string) => {
    if (!selectedTable) return;
    try {
      setAnalysis(getDatabaseColumnAnalysis(selectedTable, column));
      setViewMode('analysis');
      setError(null);
    } catch (err) { setError(String(err)); }
  };

  const resizeColumn = (column: string, startX: number) => {
    const initialWidth = columnWidths[column] ?? 180;
    const onMove = (event: MouseEvent) => setColumnWidths((widths) => ({ ...widths, [column]: Math.max(80, Math.min(600, initialWidth + event.clientX - startX)) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const copyGridSelection = async (mode: 'cell' | 'row' | 'column' | 'markdown') => {
    if (!data || !gridSelection) return;
    const selected = visibleColumns[gridSelection.visibleColumn];
    if (!selected) return;
    let text = '';
    if (mode === 'cell') text = detailedValue(data.values[gridSelection.row]?.[selected.index]);
    if (mode === 'row') text = visibleColumns.map((item) => displayValue(data.values[gridSelection.row]?.[item.index])).join('\t');
    if (mode === 'column') text = [selected.column, ...data.values.map((row) => displayValue(row[selected.index]))].join('\n');
    if (mode === 'markdown') {
      text = `| ${visibleColumns.map((item) => item.column).join(' | ')} |\n| ${visibleColumns.map(() => '---').join(' | ')} |\n| ${visibleColumns.map((item) => displayValue(data.values[gridSelection.row]?.[item.index]).replace(/\|/g, '\\|')).join(' | ')} |`;
    }
    await navigator.clipboard.writeText(text);
  };

  const exportSelectedRows = (format: 'csv' | 'json' | 'markdown') => {
    if (!data || !selectedTable || selectedRows.size === 0) return;
    const rows = [...selectedRows].sort((a, b) => a - b).map((rowIndex) => data.values[rowIndex]).filter(Boolean);
    const columns = visibleColumns;
    const escapeCsv = (value: unknown) => { const text = value === null ? '' : displayValue(value); return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
    if (format === 'json') {
      download(`${selectedTable}-selected.json`, new Blob([JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((item) => [item.column, row[item.index]]))), null, 2)], { type: 'application/json' })); return;
    }
    const lines = [`${format === 'markdown' ? '| ' : ''}${columns.map((item) => format === 'markdown' ? item.column : escapeCsv(item.column)).join(format === 'markdown' ? ' | ' : ',')}${format === 'markdown' ? ' |' : ''}`];
    if (format === 'markdown') lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    lines.push(...rows.map((row) => format === 'markdown' ? `| ${columns.map((item) => displayValue(row[item.index]).replace(/\|/g, '\\|')).join(' | ')} |` : columns.map((item) => escapeCsv(row[item.index])).join(',')));
    download(`${selectedTable}-selected.${format === 'markdown' ? 'md' : 'csv'}`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  };

  const exportDatabase = () => {
    try {
      download(`next-work-dashboard-${new Date().toISOString().slice(0, 10)}.db`, new Blob([exportDb()], { type: 'application/octet-stream' }));
    } catch (err) {
      setError(String(err));
    }
  };

  const exportCsv = () => {
    if (!data || !selectedTable) return;
    const encode = (value: unknown) => {
      const text = value === null ? '' : displayValue(value);
      return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const exportedColumns = visibleColumns.length ? visibleColumns : data.columns.map((column, index) => ({ column, index }));
    const csv = [exportedColumns.map((item) => encode(item.column)).join(','), ...data.values.map((row) => exportedColumns.map((item) => encode(row[item.index])).join(','))].join('\n');
    download(`${selectedTable}-page-${page + 1}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  };

  const copyJson = async () => {
    if (!data) return;
    const exportedColumns = visibleColumns.length ? visibleColumns : data.columns.map((column, index) => ({ column, index }));
    const rows = data.values.map((row) => Object.fromEntries(exportedColumns.map((item) => [item.column, row[item.index]])));
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const exportAllRows = async (format: 'csv' | 'sql') => {
    if (!selectedTable || !data || exportProgress !== null) return;
    exportCancelledRef.current = false;
    setExportProgress(0);
    try {
      const exportedColumns = visibleColumns.length ? visibleColumns : data.columns.map((column, index) => ({ column, index }));
      const lines: string[] = [];
      const csvValue = (value: unknown) => { const text = value === null ? '' : displayValue(value); return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
      const sqlValue = (value: unknown) => value === null ? 'NULL' : value instanceof Uint8Array ? `X'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'` : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
      if (format === 'csv') lines.push(exportedColumns.map((item) => csvValue(item.column)).join(','));
      let offset = 0;
      while (!exportCancelledRef.current) {
        const batch = getDatabaseTablePage(selectedTable, { offset, limit: 500, sortColumn: sort?.column, sortDirection: sort?.direction, filters, totalRows: data.totalRows });
        for (const row of batch.values) {
          if (format === 'csv') lines.push(exportedColumns.map((item) => csvValue(row[item.index])).join(','));
          else lines.push(`INSERT INTO "${selectedTable.replace(/"/g, '""')}" (${exportedColumns.map((item) => `"${item.column.replace(/"/g, '""')}"`).join(', ')}) VALUES (${exportedColumns.map((item) => sqlValue(row[item.index])).join(', ')});`);
        }
        offset += batch.values.length;
        setExportProgress(batch.totalRows ? Math.min(100, Math.round(offset / batch.totalRows * 100)) : 100);
        if (!batch.values.length || offset >= batch.totalRows) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (!exportCancelledRef.current) download(`${selectedTable}.${format}`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    } catch (err) { setError(String(err)); }
    finally { setExportProgress(null); }
  };

  const saveSelectedBlob = () => {
    if (!(selectedCell?.value instanceof Uint8Array)) return;
    download(`${selectedTable ?? 'database'}-${selectedCell.column}.bin`, new Blob([selectedCell.value], { type: 'application/octet-stream' }));
  };

  const groupedTables = useMemo(() => {
    const query = tableQuery.trim().toLocaleLowerCase();
    return TABLE_CATEGORIES.map((category) => ({
      ...category,
      tables: tables.filter((table) => tableCategoryId(table.table) === category.id
        && (!query || `${table.table} ${tableDisplayName(table.table)}`.toLocaleLowerCase().includes(query))),
    })).filter((category) => category.tables.length > 0);
  }, [tableQuery, tables]);

  const selectedInfo = tables.find((table) => table.table === selectedTable);
  const visibleColumns = useMemo(() => (data?.columns ?? []).map((column, index) => ({ column, index })).filter((item) => !hiddenColumns.includes(item.column)), [data?.columns, hiddenColumns]);
  const pinnedLeft = (visibleIndex: number) => 48 + visibleColumns.slice(0, visibleIndex).reduce((sum, item) => sum + (columnWidths[item.column] ?? 180), 0);
  const inferredRelations = useMemo(() => {
    if (!selectedInfo) return [];
    return selectedInfo.columns.flatMap((column) => {
      if (!column.name.endsWith('_id') || selectedSchema?.foreignKeys.some((foreignKey) => foreignKey.from === column.name)) return [];
      const stem = column.name.slice(0, -3);
      const target = tables.find((candidate) => (candidate.table === stem || candidate.table === `${stem}s` || candidate.table.endsWith(`_${stem}s`)) && candidate.columns.some((candidateColumn) => candidateColumn.name === 'id'));
      return target ? [{ from: column.name, targetTable: target.table, targetColumn: 'id' }] : [];
    });
  }, [selectedInfo, selectedSchema?.foreignKeys, tables]);
  const reverseRelations = useMemo(() => {
    if (!selectedTable) return [];
    return tables.flatMap((candidate) => {
      try { return getDatabaseTableSchema(candidate.table).foreignKeys.filter((foreignKey) => foreignKey.targetTable === selectedTable).map((foreignKey) => ({ sourceTable: candidate.table, sourceColumn: foreignKey.from, targetColumn: foreignKey.targetColumn })); }
      catch { return []; }
    });
  }, [selectedTable, tables]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.getAttribute('role') === 'textbox';
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && viewMode === 'data') { event.preventDefault(); filterInputRef.current?.focus(); return; }
      if (event.altKey && event.key === 'ArrowLeft' && navigationStack.length) { event.preventDefault(); navigateBack(); return; }
      if (!editing && event.key.toLowerCase() === 'r' && viewMode !== 'sql') { event.preventDefault(); refresh(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && gridSelection && viewMode === 'data') { event.preventDefault(); void copyGridSelection('cell'); return; }
      if (!editing && gridSelection && viewMode === 'data' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        setGridSelection((selection) => selection && ({
          row: Math.max(0, Math.min((data?.values.length ?? 1) - 1, selection.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))),
          visibleColumn: Math.max(0, Math.min(visibleColumns.length - 1, selection.visibleColumn + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))),
        }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const totalPages = Math.max(1, Math.ceil((data?.totalRows ?? 0) / pageSize));
  const firstRow = data?.totalRows ? page * pageSize + 1 : 0;
  const lastRow = Math.min((page + 1) * pageSize, data?.totalRows ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-card px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">数据库浏览器</h2>
        {stats && <span className="ml-2 rounded-full border bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">总占用 {formatBytes(stats.totalBytes)}</span>}
        <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">只读</span>
        <Button variant={viewMode === 'sql' ? 'secondary' : 'ghost'} size="sm" className="ml-2 h-7" onClick={() => setViewMode('sql')}>SQL 工作台</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="刷新"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={exportDatabase} title="导出 SQLite 文件"><Download className="h-3.5 w-3.5" /></Button>
        {selectedTable && data && <>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={exportCsv}>CSV</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void exportAllRows('csv')}>全部 CSV</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void exportAllRows('sql')}>SQL INSERT</Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyJson} title="复制当前页 JSON">{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </>}
      </div>

      {exportProgress !== null && <div className="flex items-center gap-3 border-b bg-primary/5 px-3 py-2 text-xs"><div className="h-1.5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${exportProgress}%` }} /></div><span>{exportProgress}%</span><Button variant="ghost" size="sm" className="h-6" onClick={() => { exportCancelledRef.current = true; }}>取消</Button></div>}

      {error && <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/15">
          <div className="border-b p-3"><div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="搜索数据表…" className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10" />
          </div></div>
          <ScrollArea className="min-h-0 flex-1"><div className="space-y-4 p-2">
            {tables.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">数据库为空</p>}
            {tables.length > 0 && groupedTables.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">没有匹配的数据表</p>}
            {groupedTables.map((category) => <section key={category.id}>
              <div className="flex items-center gap-2 px-2 pb-1.5"><h3 className="text-[11px] font-semibold">{category.label}</h3><span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{category.tables.length}</span></div>
              <div className="space-y-0.5">{category.tables.map((table) => <button key={table.table} type="button" onClick={() => selectTable(table.table)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${selectedTable === table.table ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <Database className="h-3.5 w-3.5 shrink-0 opacity-70" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{tableDisplayName(table.table)}</span><span className="block truncate font-mono text-[9px] opacity-70">{table.table}</span></span><span className="text-[9px] opacity-70">{table.columns.length} 列</span>
              </button>)}</div>
            </section>)}
          </div></ScrollArea>
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">共 {tables.length} 张表</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {viewMode === 'sql' ? <SqlWorkbench /> : selectedTable && data ? <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              {navigationStack.length > 0 && <Button variant="ghost" size="sm" className="h-7" onClick={navigateBack}>← 返回</Button>}
              <div className="mr-auto"><h3 className="text-sm font-semibold">{tableDisplayName(selectedTable)}</h3><p className="font-mono text-[10px] text-muted-foreground">{navigationStack.length > 0 ? `${navigationStack.map((entry) => entry.table).join(' › ')} › ` : ''}{selectedTable}</p></div>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{data.columns.length} 列</span>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{data.totalRows} 行</span>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">约 {formatBytes(selectedStats?.payloadBytes)}</span>
            </div>
            <div className="flex items-center gap-1 border-b px-4 py-2">
              <Button variant={viewMode === 'data' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setViewMode('data')}>数据</Button>
              <Button variant={viewMode === 'structure' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setViewMode('structure')}>结构</Button>
              <Button variant={viewMode === 'analysis' ? 'secondary' : 'ghost'} size="sm" className="h-7" disabled={!analysis} onClick={() => setViewMode('analysis')}>分析</Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setViewMode('sql')}>SQL</Button>
              {viewMode === 'data' && <><div className="mx-2 h-5 border-l" />
                <select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} className="h-7 max-w-40 rounded border bg-background px-2 text-xs"><option value="">选择筛选列</option>{data.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select>
                <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as DatabaseFilterOperator)} className="h-7 rounded border bg-background px-2 text-xs"><option value="contains">包含</option><option value="equals">等于</option><option value="is-null">为空</option><option value="not-null">非空</option></select>
                {filterOperator !== 'is-null' && filterOperator !== 'not-null' && <input ref={filterInputRef} value={filterValue} onChange={(event) => setFilterValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilter(); }} placeholder="筛选值…" className="h-7 w-40 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50" />}
                <Button variant="outline" size="sm" className="h-7" disabled={!filterColumn || ((filterOperator === 'contains' || filterOperator === 'equals') && !filterValue)} onClick={applyFilter}>添加条件</Button>
                {filters.length > 0 && <Button variant="ghost" size="sm" className="h-7" onClick={clearFilter}>清除</Button>}
                <div className="flex-1" /><Button variant="ghost" size="sm" className="h-7" onClick={() => setColumnManagerOpen((open) => !open)}>列管理</Button>
              </>}
            </div>
            {viewMode === 'data' && columnManagerOpen && <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2"><span className="text-[10px] text-muted-foreground">显示列</span>{data.columns.map((column) => <label key={column} className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={!hiddenColumns.includes(column)} onChange={() => setHiddenColumns((hidden) => hidden.includes(column) ? hidden.filter((item) => item !== column) : [...hidden, column])} />{column}</label>)}<div className="flex-1" /><label className="text-[10px]">固定前 <select value={pinnedColumns} onChange={(event) => setPinnedColumns(Number(event.target.value))} className="rounded border bg-background px-1 py-0.5">{Array.from({ length: Math.min(visibleColumns.length, 5) + 1 }, (_, index) => <option key={index} value={index}>{index}</option>)}</select> 列</label><Button variant="ghost" size="sm" className="h-6" onClick={() => { setHiddenColumns([]); setColumnWidths({}); setPinnedColumns(0); }}>重置</Button></div>}
            {viewMode === 'data' && filters.length > 0 && <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-4 py-2"><span className="mr-1 text-[10px] text-muted-foreground">AND</span>{filters.map((filter, index) => <button key={`${filter.column}-${filter.operator}-${index}`} type="button" onClick={() => removeFilter(index)} className="rounded-full border bg-background px-2 py-1 text-[10px] hover:border-destructive hover:text-destructive" title="点击移除此条件"><span className="font-mono">{filter.column}</span> {filter.operator === 'contains' ? '包含' : filter.operator === 'equals' ? '=' : filter.operator === 'is-null' ? '为空' : '非空'} {filter.value ? `“${filter.value}”` : ''} ×</button>)}</div>}
            {viewMode === 'data' && gridSelection && <div className="flex items-center gap-1 border-b px-4 py-1.5 text-[10px] text-muted-foreground"><span>已选择第 {page * pageSize + gridSelection.row + 1} 行 · {visibleColumns[gridSelection.visibleColumn]?.column}</span><div className="flex-1" /><Button variant="ghost" size="sm" className="h-6" onClick={() => void copyGridSelection('cell')}>复制单元格</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => void copyGridSelection('row')}>复制行</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => void copyGridSelection('column')}>复制列</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => void copyGridSelection('markdown')}>Markdown 行</Button></div>}
            {viewMode === 'data' && selectedRows.size > 0 && <div className="flex items-center gap-1 border-b bg-primary/5 px-4 py-1.5 text-[10px]"><span>已选择 {selectedRows.size} 行</span><div className="flex-1" /><Button variant="ghost" size="sm" className="h-6" onClick={() => exportSelectedRows('csv')}>导出 CSV</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => exportSelectedRows('json')}>导出 JSON</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => exportSelectedRows('markdown')}>导出 Markdown</Button><Button variant="ghost" size="sm" className="h-6" onClick={() => setSelectedRows(new Set())}>取消选择</Button></div>}
            {viewMode === 'data' ? <><div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10"><tr className="bg-muted">
                  <th className="sticky left-0 z-20 w-12 bg-muted px-2 py-2 text-left font-mono text-muted-foreground"><input type="checkbox" aria-label="选择当前页全部行" checked={data.values.length > 0 && selectedRows.size === data.values.length} onChange={(event) => setSelectedRows(event.target.checked ? new Set(data.values.map((_, index) => index)) : new Set())} /></th>
                  {visibleColumns.map(({ column }, visibleIndex) => <th key={column} style={{ width: columnWidths[column] ?? 180, minWidth: columnWidths[column] ?? 180, left: visibleIndex < pinnedColumns ? pinnedLeft(visibleIndex) : undefined }} className={`relative whitespace-nowrap bg-muted px-3 py-2 text-left font-semibold ${visibleIndex < pinnedColumns ? 'sticky z-10 border-r' : ''}`}><button type="button" onClick={() => changeSort(column)} className="hover:text-primary" title="点击排序">{column}{sort?.column === column ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button><button type="button" onClick={() => analyzeColumn(column)} className="ml-2 text-[9px] font-normal text-muted-foreground hover:text-primary" title="分析此列">分析</button><button type="button" aria-label={`调整 ${column} 列宽`} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary" onMouseDown={(event) => { event.preventDefault(); resizeColumn(column, event.clientX); }} /></th>)}
                </tr></thead>
                <tbody>{data.values.length === 0 ? <tr><td colSpan={visibleColumns.length + 1} className="px-3 py-8 text-center text-muted-foreground">无数据</td></tr> : data.values.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`} className={`border-t ${rowIndex % 2 === 0 ? 'bg-card' : 'bg-background/50'}`}>
                  <td className="sticky left-0 bg-inherit px-2 py-1.5 font-mono text-muted-foreground"><label className="flex items-center gap-1"><input type="checkbox" checked={selectedRows.has(rowIndex)} onChange={() => setSelectedRows((current) => { const next = new Set(current); if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex); return next; })} />{page * pageSize + rowIndex + 1}</label></td>
                  {visibleColumns.map(({ column, index: columnIndex }, visibleIndex) => {
                    const value = row[columnIndex];
                    const isForeignKey = value !== null && (selectedSchema?.foreignKeys.some((foreignKey) => foreignKey.from === column) || inferredRelations.some((relation) => relation.from === column));
                    const selected = gridSelection?.row === rowIndex && gridSelection.visibleColumn === visibleIndex;
                    return <td key={columnIndex} style={{ width: columnWidths[column] ?? 180, minWidth: columnWidths[column] ?? 180, maxWidth: columnWidths[column] ?? 180, left: visibleIndex < pinnedColumns ? pinnedLeft(visibleIndex) : undefined }} className={`truncate bg-inherit px-3 py-1.5 font-mono outline-none ${visibleIndex < pinnedColumns ? 'sticky z-[5] border-r' : ''} ${selected ? 'ring-2 ring-inset ring-primary' : ''}`} title={isForeignKey ? '单击跳转外键；双击查看完整内容' : '双击查看完整内容'} onClick={() => setGridSelection({ row: rowIndex, visibleColumn: visibleIndex })} onDoubleClick={() => setSelectedCell({ column, value })}>{isForeignKey ? <button type="button" className="max-w-full truncate text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={(event) => { event.stopPropagation(); jumpToForeignKey(column, value); }}>{displayValue(value)} →</button> : value === null ? <span className="italic text-muted-foreground">NULL</span> : displayValue(value)}</td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>显示 {firstRow}–{lastRow}，共 {data.totalRows} 行</span><div className="flex-1" />
              <label>每页 <select value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))} className="rounded border bg-background px-1 py-0.5"><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option><option value={500}>500</option></select></label>
              <Button variant="outline" size="sm" className="h-7" disabled={page === 0 || loading} onClick={() => changePage(page - 1)}>上一页</Button>
              <span>{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-7" disabled={page + 1 >= totalPages || loading} onClick={() => changePage(page + 1)}>下一页</Button>
            </div></> : viewMode === 'analysis' ? <div className="min-h-0 flex-1 overflow-auto p-4">
              {analysis && <div className="space-y-5"><div><h4 className="text-sm font-semibold">列分析：<span className="font-mono">{analysis.column}</span></h4><p className="mt-1 text-xs text-muted-foreground">统计基于当前整张表，不受界面筛选条件影响。</p></div>
                {(analysis.totalRows > 0 && (analysis.nullCount / analysis.totalRows >= 0.5 || analysis.distinctCount / Math.max(1, analysis.totalRows - analysis.nullCount) <= 0.05)) && <div className="space-y-1">{analysis.nullCount / analysis.totalRows >= 0.5 && <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs">NULL 占比达到 {(analysis.nullCount / analysis.totalRows * 100).toFixed(1)}%，请确认字段是否仍有业务价值。</div>}{analysis.distinctCount / Math.max(1, analysis.totalRows - analysis.nullCount) <= 0.05 && <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs">非空值重复率较高：{analysis.totalRows - analysis.nullCount} 条记录只有 {analysis.distinctCount} 个唯一值。</div>}</div>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">NULL</p><p className="mt-1 text-lg font-semibold">{analysis.nullCount}</p><p className="text-[9px] text-muted-foreground">{analysis.totalRows ? (analysis.nullCount / analysis.totalRows * 100).toFixed(1) : '0'}%</p></div><div className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">唯一值</p><p className="mt-1 text-lg font-semibold">{analysis.distinctCount}</p></div><div className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">最小 / 最大</p><p className="mt-1 truncate font-mono text-xs">{displayValue(analysis.min)} / {displayValue(analysis.max)}</p></div><div className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">数值平均</p><p className="mt-1 text-lg font-semibold">{analysis.average === null ? '—' : analysis.average.toFixed(2)}</p></div></div>
                <section><h4 className="mb-2 text-xs font-semibold">文本长度</h4><div className="rounded-lg border p-3 text-xs"><p>最短 {analysis.minLength ?? '—'} · 最长 {analysis.maxLength ?? '—'} · 平均 {analysis.averageLength === null ? '—' : analysis.averageLength.toFixed(1)}</p><div className="mt-3 flex h-24 items-end gap-2">{analysis.lengthDistribution.map((bucket) => { const maximum = Math.max(...analysis.lengthDistribution.map((item) => item.count), 1); return <div key={bucket.label} className="flex min-w-10 flex-1 flex-col items-center gap-1"><span className="text-[9px] text-muted-foreground">{bucket.count}</span><div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, bucket.count / maximum * 64)}px` }} /><span className="text-[9px]">{bucket.label}</span></div>; })}</div></div></section>
                <section><h4 className="mb-2 text-xs font-semibold">高频值</h4><div className="overflow-hidden rounded-lg border">{analysis.topValues.map((item, index) => <div key={index} className="flex border-b px-3 py-2 text-xs last:border-b-0"><span className="min-w-0 flex-1 truncate font-mono">{displayValue(item.value)}</span><span className="tabular-nums text-muted-foreground">{item.count}</span></div>)}</div></section>
                <section><h4 className="mb-2 text-xs font-semibold">JSON 有效性</h4><div className="rounded-lg border px-3 py-2 text-xs">检查 {analysis.jsonChecked} 个疑似 JSON 值 · {analysis.invalidJsonCount ? <span className="text-destructive">{analysis.invalidJsonCount} 个无效</span> : '未发现无效 JSON'}</div></section>
              </div>}
            </div> : <div className="min-h-0 flex-1 overflow-auto p-4">
              {selectedSchema && <div className="space-y-5">
                {diagnostics.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">Schema 诊断</h4><div className="space-y-1">{diagnostics.map((diagnostic, index) => <div key={index} className={`rounded border px-3 py-2 text-xs ${diagnostic.severity === 'warning' ? 'border-warning/40 bg-warning/5' : 'bg-muted/20'}`}>{diagnostic.message}</div>)}</div></section>}
                <section><h4 className="mb-2 text-xs font-semibold">字段</h4><div className="overflow-auto rounded-lg border"><table className="w-full text-xs"><thead><tr className="bg-muted"><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">约束</th><th className="px-3 py-2 text-left">默认值</th></tr></thead><tbody>{selectedSchema.columns.map((column) => <tr key={column.name} className="border-t"><td className="px-3 py-2 font-mono">{column.name}</td><td className="px-3 py-2 font-mono text-muted-foreground">{column.type || '—'}</td><td className="px-3 py-2">{[column.primaryKeyOrder ? `PK ${column.primaryKeyOrder}` : '', column.notNull ? 'NOT NULL' : ''].filter(Boolean).join(' · ') || '—'}</td><td className="px-3 py-2 font-mono">{column.defaultValue === null ? '—' : String(column.defaultValue)}</td></tr>)}</tbody></table></div></section>
                {selectedSchema.foreignKeys.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">外键</h4><div className="space-y-1">{selectedSchema.foreignKeys.map((foreignKey) => <button type="button" onClick={() => navigateToRelatedTable(foreignKey.targetTable)} key={`${foreignKey.id}-${foreignKey.from}`} className="block w-full rounded border px-3 py-2 text-left font-mono text-xs hover:bg-accent">{foreignKey.from} → {foreignKey.targetTable}.{foreignKey.targetColumn} <span className="text-muted-foreground">ON UPDATE {foreignKey.onUpdate} · ON DELETE {foreignKey.onDelete}</span></button>)}</div></section>}
                {inferredRelations.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">推测关系</h4><div className="space-y-1">{inferredRelations.map((relation) => <button key={relation.from} type="button" onClick={() => navigateToRelatedTable(relation.targetTable)} className="block w-full rounded border border-dashed px-3 py-2 text-left font-mono text-xs hover:bg-accent">{relation.from} ⇢ {relation.targetTable}.{relation.targetColumn} <span className="text-muted-foreground">按 *_id 命名推测</span></button>)}</div></section>}
                {reverseRelations.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">反向引用</h4><div className="space-y-1">{reverseRelations.map((relation) => <button key={`${relation.sourceTable}-${relation.sourceColumn}`} type="button" onClick={() => navigateToRelatedTable(relation.sourceTable)} className="block w-full rounded border px-3 py-2 text-left font-mono text-xs hover:bg-accent">{relation.sourceTable}.{relation.sourceColumn} → {selectedTable}.{relation.targetColumn || '主键'}</button>)}</div></section>}
                {selectedSchema.indexes.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">索引</h4><div className="space-y-1">{selectedSchema.indexes.map((index) => <div key={index.name} className="rounded border px-3 py-2 font-mono text-xs">{index.name}{index.unique ? ' · UNIQUE' : ''}<span className="ml-2 text-muted-foreground">{index.origin}</span></div>)}</div></section>}
                <section><h4 className="mb-2 text-xs font-semibold">建表 SQL</h4><pre className="overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-5">{selectedSchema.createSql || '无建表 SQL'}</pre></section>
              </div>}
            </div>}
          </> : selectedTable && loading ? <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />加载中…</div> : <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border bg-muted/30"><Database className="h-7 w-7" /></div><p className="mt-4 text-sm font-medium text-foreground">{tables.length ? '选择一张数据表' : '数据库为空'}</p><p className="mt-1 text-xs">分页浏览、点击列名排序，双击单元格查看完整内容。</p>
            {stats && <div className="mt-6 grid grid-cols-3 gap-3 text-left"><div className="rounded-lg border bg-card p-3"><p className="text-[10px]">数据库占用</p><p className="mt-1 text-lg font-semibold">{formatBytes(stats.totalBytes)}</p></div><div className="rounded-lg border bg-card p-3"><p className="text-[10px]">SQLite 页面</p><p className="mt-1 text-lg font-semibold">{stats.pageCount}</p></div><div className="rounded-lg border bg-card p-3"><p className="text-[10px]">数据表</p><p className="mt-1 text-lg font-semibold">{tables.length}</p></div></div>}
          </div>}
        </main>
      </div>

      {selectedCell && <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm" onMouseDown={() => setSelectedCell(null)}>
        <div className="flex max-h-[75%] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-center border-b px-4 py-3"><div><p className="text-sm font-semibold">单元格内容</p><p className="font-mono text-[10px] text-muted-foreground">{selectedCell.column}</p></div><div className="flex-1" />{selectedCell.value instanceof Uint8Array && <Button variant="ghost" size="sm" onClick={saveSelectedBlob}>保存 BLOB</Button>}<Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(detailedValue(selectedCell.value))}>复制</Button><Button variant="ghost" size="sm" onClick={() => setSelectedCell(null)}>关闭</Button></div>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5">{detailedValue(selectedCell.value)}</pre>
        </div>
      </div>}

      <div className="flex h-7 items-center gap-3 border-t bg-background px-3 text-[10px] text-muted-foreground">{selectedInfo ? <><span>{tableDisplayName(selectedInfo.table)}</span><span>·</span><span>{selectedInfo.columns.length} 个字段</span><span>{selectedStats?.rowCount ?? 0} 行</span><span className="font-mono">{selectedInfo.table}</span></> : stats ? <><span>数据库总占用 {formatBytes(stats.totalBytes)}</span><span>·</span><span>{tables.length} 张表</span></> : null}</div>
    </div>
  );
};
