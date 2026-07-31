import React, { useEffect, useState, useCallback } from 'react';
import { getDb, execSql, getTableInfo, exportDb, isDbReady } from '@/db';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Download, Copy, Check } from '@/components/icons';

interface TableInfo {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

export const DatabaseBrowser: React.FC = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTables = useCallback(() => {
    if (!isDbReady()) return;
    try {
      const info = getTableInfo();
      setTables(info);
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

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-card">
        <h2 className="text-sm font-semibold text-foreground">数据库浏览器</h2>
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
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border-b">
          {error}
        </div>
      )}

      {/* 表列表 */}
      <div className="flex gap-0.5 px-3 py-2 border-b bg-background overflow-x-auto">
        {tables.length === 0 ? (
          <span className="text-xs text-muted-foreground py-1">暂无表 — 数据库为空</span>
        ) : (
          tables.map((t) => (
            <button
              key={t.table}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                selectedTable === t.table
                  ? 'bg-primary text-white'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => handleTableClick(t.table)}
            >
              {t.table}
            </button>
          ))
        )}
      </div>

      {/* 主内容 */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {selectedTable && data ? (
            <>
              {/* 统计 */}
              <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground">
                <span>{data.columns.length} 列</span>
                <span>·</span>
                <span>{rowCount} 行</span>
                {rowCount === 1000 && <span className="text-amber-500">（最多 1000 行）</span>}
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
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : selectedTable ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              查询失败
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {tables.length > 0 ? '选择一张表查看数据' : '数据库为空，保存数据后将显示表结构'}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部统计栏 */}
      {tables.length > 0 && (
        <div className="h-7 flex items-center px-3 border-t bg-background text-xs text-muted-foreground gap-3">
          <span>{tables.length} 张表</span>
        </div>
      )}
    </div>
  );
};
