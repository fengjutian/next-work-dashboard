import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  exportDb,
  getDatabaseStats,
  getDatabaseTablePage,
  getDatabaseTableSchema,
  getDatabaseTableStats,
  getTableInfo,
  isDbReady,
  type DatabaseStats,
  type DatabaseTablePage,
  type DatabaseTableSchema,
  type DatabaseTableStats,
  type DatabaseColumnFilter,
  type DatabaseFilterOperator,
} from '@/db';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, Database, Download, RefreshCw, Search } from '@/components/icons';
import { TABLE_CATEGORIES, tableCategoryId, tableDisplayName } from './tableCatalog';

interface TableInfo {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

type SortState = { column: string; direction: 'asc' | 'desc' } | null;
type CellSelection = { column: string; value: unknown } | null;
type ViewMode = 'data' | 'structure';
type NavigationEntry = { table: string; page: number; sort: SortState; filters: DatabaseColumnFilter[] };

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
    setSelectedTable(table);
    setPage(0);
    setSort(null);
    setFilters([]);
    setFilterColumn('');
    setFilterValue('');
    setFilterOperator('contains');
    setViewMode('data');
    setNavigationStack([]);
    setSelectedCell(null);
    loadTableData(table, 0, pageSize, null, [], undefined, true);
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
    const foreignKey = selectedSchema?.foreignKeys.find((item) => item.from === column);
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
    const csv = [data.columns.map(encode).join(','), ...data.values.map((row) => row.map(encode).join(','))].join('\n');
    download(`${selectedTable}-page-${page + 1}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  };

  const copyJson = async () => {
    if (!data) return;
    const rows = data.values.map((row) => Object.fromEntries(data.columns.map((column, index) => [column, row[index]])));
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
  const totalPages = Math.max(1, Math.ceil((data?.totalRows ?? 0) / pageSize));
  const firstRow = data?.totalRows ? page * pageSize + 1 : 0;
  const lastRow = Math.min((page + 1) * pageSize, data?.totalRows ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-card px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">数据库浏览器</h2>
        {stats && <span className="ml-2 rounded-full border bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">总占用 {formatBytes(stats.totalBytes)}</span>}
        <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">只读</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="刷新"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={exportDatabase} title="导出 SQLite 文件"><Download className="h-3.5 w-3.5" /></Button>
        {selectedTable && data && <>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={exportCsv}>CSV</Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyJson} title="复制当前页 JSON">{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </>}
      </div>

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
          {selectedTable && data ? <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              {navigationStack.length > 0 && <Button variant="ghost" size="sm" className="h-7" onClick={navigateBack}>← 返回</Button>}
              <div className="mr-auto"><h3 className="text-sm font-semibold">{tableDisplayName(selectedTable)}</h3><p className="font-mono text-[10px] text-muted-foreground">{selectedTable}</p></div>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{data.columns.length} 列</span>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{data.totalRows} 行</span>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">约 {formatBytes(selectedStats?.payloadBytes)}</span>
            </div>
            <div className="flex items-center gap-1 border-b px-4 py-2">
              <Button variant={viewMode === 'data' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setViewMode('data')}>数据</Button>
              <Button variant={viewMode === 'structure' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setViewMode('structure')}>结构</Button>
              {viewMode === 'data' && <><div className="mx-2 h-5 border-l" />
                <select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} className="h-7 max-w-40 rounded border bg-background px-2 text-xs"><option value="">选择筛选列</option>{data.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select>
                <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as DatabaseFilterOperator)} className="h-7 rounded border bg-background px-2 text-xs"><option value="contains">包含</option><option value="equals">等于</option><option value="is-null">为空</option><option value="not-null">非空</option></select>
                {filterOperator !== 'is-null' && filterOperator !== 'not-null' && <input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilter(); }} placeholder="筛选值…" className="h-7 w-40 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50" />}
                <Button variant="outline" size="sm" className="h-7" disabled={!filterColumn || ((filterOperator === 'contains' || filterOperator === 'equals') && !filterValue)} onClick={applyFilter}>添加条件</Button>
                {filters.length > 0 && <Button variant="ghost" size="sm" className="h-7" onClick={clearFilter}>清除</Button>}
              </>}
            </div>
            {viewMode === 'data' && filters.length > 0 && <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-4 py-2"><span className="mr-1 text-[10px] text-muted-foreground">AND</span>{filters.map((filter, index) => <button key={`${filter.column}-${filter.operator}-${index}`} type="button" onClick={() => removeFilter(index)} className="rounded-full border bg-background px-2 py-1 text-[10px] hover:border-destructive hover:text-destructive" title="点击移除此条件"><span className="font-mono">{filter.column}</span> {filter.operator === 'contains' ? '包含' : filter.operator === 'equals' ? '=' : filter.operator === 'is-null' ? '为空' : '非空'} {filter.value ? `“${filter.value}”` : ''} ×</button>)}</div>}
            {viewMode === 'data' ? <><div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10"><tr className="bg-muted">
                  <th className="sticky left-0 z-20 w-12 bg-muted px-2 py-2 text-left font-mono text-muted-foreground">#</th>
                  {data.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-semibold"><button type="button" onClick={() => changeSort(column)} className="hover:text-primary" title="点击排序">{column}{sort?.column === column ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}
                </tr></thead>
                <tbody>{data.values.length === 0 ? <tr><td colSpan={data.columns.length + 1} className="px-3 py-8 text-center text-muted-foreground">无数据</td></tr> : data.values.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`} className={`border-t ${rowIndex % 2 === 0 ? 'bg-card' : 'bg-background/50'}`}>
                  <td className="sticky left-0 bg-inherit px-2 py-1.5 font-mono text-muted-foreground">{page * pageSize + rowIndex + 1}</td>
                  {row.map((value, columnIndex) => {
                    const column = data.columns[columnIndex];
                    const isForeignKey = value !== null && selectedSchema?.foreignKeys.some((foreignKey) => foreignKey.from === column);
                    return <td key={columnIndex} className="max-w-80 truncate px-3 py-1.5 font-mono" title={isForeignKey ? '单击跳转外键；双击查看完整内容' : '双击查看完整内容'} onDoubleClick={() => setSelectedCell({ column, value })}>{isForeignKey ? <button type="button" className="max-w-full truncate text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => jumpToForeignKey(column, value)}>{displayValue(value)} →</button> : value === null ? <span className="italic text-muted-foreground">NULL</span> : displayValue(value)}</td>;
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
            </div></> : <div className="min-h-0 flex-1 overflow-auto p-4">
              {selectedSchema && <div className="space-y-5">
                <section><h4 className="mb-2 text-xs font-semibold">字段</h4><div className="overflow-auto rounded-lg border"><table className="w-full text-xs"><thead><tr className="bg-muted"><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">约束</th><th className="px-3 py-2 text-left">默认值</th></tr></thead><tbody>{selectedSchema.columns.map((column) => <tr key={column.name} className="border-t"><td className="px-3 py-2 font-mono">{column.name}</td><td className="px-3 py-2 font-mono text-muted-foreground">{column.type || '—'}</td><td className="px-3 py-2">{[column.primaryKeyOrder ? `PK ${column.primaryKeyOrder}` : '', column.notNull ? 'NOT NULL' : ''].filter(Boolean).join(' · ') || '—'}</td><td className="px-3 py-2 font-mono">{column.defaultValue === null ? '—' : String(column.defaultValue)}</td></tr>)}</tbody></table></div></section>
                {selectedSchema.foreignKeys.length > 0 && <section><h4 className="mb-2 text-xs font-semibold">外键</h4><div className="space-y-1">{selectedSchema.foreignKeys.map((foreignKey) => <div key={`${foreignKey.id}-${foreignKey.from}`} className="rounded border px-3 py-2 font-mono text-xs">{foreignKey.from} → {foreignKey.targetTable}.{foreignKey.targetColumn} <span className="text-muted-foreground">ON UPDATE {foreignKey.onUpdate} · ON DELETE {foreignKey.onDelete}</span></div>)}</div></section>}
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
          <div className="flex items-center border-b px-4 py-3"><div><p className="text-sm font-semibold">单元格内容</p><p className="font-mono text-[10px] text-muted-foreground">{selectedCell.column}</p></div><div className="flex-1" /><Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(detailedValue(selectedCell.value))}>复制</Button><Button variant="ghost" size="sm" onClick={() => setSelectedCell(null)}>关闭</Button></div>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5">{detailedValue(selectedCell.value)}</pre>
        </div>
      </div>}

      <div className="flex h-7 items-center gap-3 border-t bg-background px-3 text-[10px] text-muted-foreground">{selectedInfo ? <><span>{tableDisplayName(selectedInfo.table)}</span><span>·</span><span>{selectedInfo.columns.length} 个字段</span><span>{selectedStats?.rowCount ?? 0} 行</span><span className="font-mono">{selectedInfo.table}</span></> : stats ? <><span>数据库总占用 {formatBytes(stats.totalBytes)}</span><span>·</span><span>{tables.length} 张表</span></> : null}</div>
    </div>
  );
};
