import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { execSql, getTableInfo, getDatabaseStats, exportDb, isDbReady, type DatabaseStats } from '@/db';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Download, Copy, Check, Database, Search } from '@/components/icons';
import { TABLE_CATEGORIES, tableCategoryId, tableDisplayName } from './tableCatalog';

interface TableInfo {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export const DatabaseBrowser: React.FC = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tableQuery, setTableQuery] = useState('');
  const [stats, setStats] = useState<DatabaseStats | null>(null);

  const loadTables = useCallback(() => {
    if (!isDbReady()) return;
    try {
      const info = getTableInfo();
      setTables(info);
      setStats(getDatabaseStats());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const loadTableData = useCallback((table: string) => {
    if (!isDbReady()) return;
    setLoading(true);
    setError(null);
    try {
      const results = execSql(`SELECT * FROM "${table}" LIMIT 1000`);
      setData(results[0] ?? { columns: [], values: [] });
    } catch (err) {
      setError(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  // DB 异步初始化完成后的轮询加载
  useEffect(() => {
    if (tables.length > 0) return; // already loaded
    const interval = setInterval(() => {
      if (isDbReady()) {
        loadTables();
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [tables.length, loadTables]);

  const handleTableClick = (table: string) => {
    setSelectedTable(table);
    loadTableData(table);
  };

  const handleRefresh = () => {
    loadTables();
    if (selectedTable) loadTableData(selectedTable);
  };

  const handleExport = async () => {
    try {
      const buf = exportDb();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `next-work-dashboard-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleExportCSV = () => {
    if (!data || data.values.length === 0) return;
    const header = data.columns.join(',');
    const rows = data.values.map((row) =>
      row.map((v) => {
        const s = v === null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJSON = () => {
    if (!data) return;
    const json = data.values.map((row) => {
      const obj: Record<string, unknown> = {};
      data.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
    navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rowCount = data ? data.values.length : 0;
  const groupedTables = useMemo(() => {
    const query = tableQuery.trim().toLocaleLowerCase();
    return TABLE_CATEGORIES.map((category) => ({
      ...category,
      tables: tables.filter((table) => tableCategoryId(table.table) === category.id && (!query || `${table.table} ${tableDisplayName(table.table)}`.toLocaleLowerCase().includes(query))),
    })).filter((category) => category.tables.length > 0);
  }, [tableQuery, tables]);
  const selectedInfo = tables.find((table) => table.table === selectedTable);
  const selectedStats = stats?.tables.find((table) => table.table === selectedTable);
  const largestTables = useMemo(() => [...(stats?.tables ?? [])].sort((a, b) => b.payloadBytes - a.payloadBytes).slice(0, 8), [stats]);

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-card">
        <h2 className="text-sm font-semibold text-foreground">数据库浏览器</h2>
        {stats && <span className="ml-2 rounded-full border bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground" title="SQLite 数据库文件精确大小">总占用 {formatBytes(stats.totalBytes)}</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} title="刷新">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport} title="导出 SQLite 文件">
          <Download className="h-3.5 w-3.5" />
        </Button>
        {selectedTable && data && data.values.length > 0 && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExportCSV} title="导出 CSV">
              <span className="text-xs font-mono">CSV</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyJSON} title="复制 JSON">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 bg-destructive/10 border-b">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 分类表导航 */}
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/15">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="搜索数据表…" className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10" />
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-2">
              {tables.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">数据库为空</p>}
              {tables.length > 0 && groupedTables.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">没有匹配的数据表</p>}
              {groupedTables.map((category) => <section key={category.id}>
                <div className="flex items-center gap-2 px-2 pb-1.5">
                  <h3 className="text-[11px] font-semibold text-foreground">{category.label}</h3>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">{category.tables.length}</span>
                </div>
                <div className="space-y-0.5">{category.tables.map((table) => <button key={table.table} type="button" onClick={() => handleTableClick(table.table)} title={`${category.description}\n${table.table}`} className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${selectedTable === table.table ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                  <Database className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{tableDisplayName(table.table)}</span><span className={`block truncate font-mono text-[9px] ${selectedTable === table.table ? 'text-primary-foreground/70' : 'text-muted-foreground/70'}`}>{table.table}</span></span>
                  <span className={`shrink-0 text-right text-[9px] tabular-nums ${selectedTable === table.table ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}><span className="block">{table.columns.length} 列</span><span className="block">{formatBytes(stats?.tables.find((item) => item.table === table.table)?.payloadBytes ?? 0)}</span></span>
                </button>)}</div>
              </section>)}
            </div>
          </ScrollArea>
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">共 {tables.length} 张表 · {TABLE_CATEGORIES.filter((category) => tables.some((table) => tableCategoryId(table.table) === category.id)).length} 个分类</div>
        </aside>

        {/* 主内容 */}
        <ScrollArea className="min-w-0 flex-1">
          <div className="p-4">
          {selectedTable && data ? (
            <>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div><div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{tableDisplayName(selectedTable)}</h3></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{selectedTable}</p></div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border bg-background px-2 py-1">{data.columns.length} 列</span>
                <span className="rounded-full border bg-background px-2 py-1">{selectedStats?.rowCount ?? rowCount} 行</span>
                <span className="rounded-full border bg-background px-2 py-1" title="字段数据载荷估算，不包含索引与 SQLite 页开销">约 {formatBytes(selectedStats?.payloadBytes ?? 0)}</span>
                {rowCount === 1000 && <span className="text-warning">（最多 1000 行）</span>}
                </div>
              </div>

              {/* 数据表格 */}
              <div className="overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      <th className="sticky left-0 bg-muted px-2 py-1.5 text-left font-mono text-muted-foreground w-8">#</th>
                      {data.columns.map((col) => (
                        <th key={col} className="px-3 py-1.5 text-left font-semibold text-muted-foreground text-foreground whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.values.length === 0 ? (
                      <tr>
                        <td colSpan={data.columns.length + 1} className="px-3 py-4 text-center text-muted-foreground">
                          无数据
                        </td>
                      </tr>
                    ) : (
                      data.values.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-t ${
                            i % 2 === 0 ? 'bg-card' : 'bg-background/50'
                          }`}
                        >
                          <td className="sticky left-0 px-2 py-1 font-mono text-muted-foreground bg-inherit">
                            {i + 1}
                          </td>
                          {row.map((val, j) => (
                            <td
                              key={j}
                              className="px-3 py-1 font-mono text-foreground max-w-80 truncate"
                              title={val === null ? 'NULL' : String(val)}
                            >
                              {val === null ? (
                                <span className="text-foreground italic">NULL</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : selectedTable && loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : selectedTable ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              查询失败
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border bg-muted/30"><Database className="h-7 w-7" /></div>
              <p className="mt-4 text-sm font-medium text-foreground">{tables.length > 0 ? '选择一张数据表' : '数据库为空'}</p>
              <p className="mt-1 max-w-xs text-xs leading-5">{tables.length > 0 ? '数据表已按业务功能分类，选择左侧项目查看字段和数据。' : '保存数据后，这里会显示表结构和记录。'}</p>
              {stats && tables.length > 0 && <div className="mt-6 w-full max-w-2xl text-left">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground">数据库总占用</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatBytes(stats.totalBytes)}</p></div>
                  <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground">SQLite 页面</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{stats.pageCount}</p><p className="text-[9px] text-muted-foreground">每页 {formatBytes(stats.pageSize)}</p></div>
                  <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground">空闲页面</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{stats.freePages}</p><p className="text-[9px] text-muted-foreground">约 {formatBytes(stats.freePages * stats.pageSize)}</p></div>
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-3 py-2 text-xs font-semibold text-foreground">数据载荷最大的表</div>
                  {largestTables.map((table) => <button key={table.table} type="button" onClick={() => handleTableClick(table.table)} className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent">
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{tableDisplayName(table.table)}</span><span className="block truncate font-mono text-[9px] text-muted-foreground">{table.table}</span></span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{table.rowCount} 行</span><span className="w-16 text-right text-[10px] font-medium tabular-nums text-foreground">{formatBytes(table.payloadBytes)}</span>
                  </button>)}
                  <p className="border-t px-3 py-2 text-[9px] text-muted-foreground">表级大小为字段载荷估算；数据库总占用为精确值。</p>
                </div>
              </div>}
            </div>
          )}
        </div>
      </ScrollArea>
      </div>

      {/* 底部统计栏 */}
      <div className="flex h-7 items-center gap-3 border-t bg-background px-3 text-[10px] text-muted-foreground">{selectedInfo ? <><span>{tableDisplayName(selectedInfo.table)}</span><span>·</span><span>{selectedInfo.columns.length} 个字段</span><span>{selectedStats?.rowCount ?? 0} 行</span><span>约 {formatBytes(selectedStats?.payloadBytes ?? 0)}</span><span className="font-mono">{selectedInfo.table}</span></> : stats ? <><span>数据库总占用 {formatBytes(stats.totalBytes)}</span><span>·</span><span>{stats.tables.reduce((sum, table) => sum + table.rowCount, 0)} 行</span><span>·</span><span>{stats.tables.length} 张表</span></> : null}</div>
    </div>
  );
};
