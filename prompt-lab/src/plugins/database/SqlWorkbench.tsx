import React, { useRef, useState } from 'react';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { runReadonlyDatabaseSql, type DatabaseReadonlyQueryResult } from '@/db';
import { Button } from '@/components/ui/button';

const HISTORY_KEY = 'database-browser.sql-history.v1';
const PAGE_SIZE = 200;

interface QueryHistoryItem { sql: string; executedAt: number; elapsedMs: number; rowCount: number }

function loadHistory(): QueryHistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as QueryHistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch { return []; }
}

function valueText(value: unknown): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return `<BLOB ${value.byteLength} bytes>`;
  return String(value);
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const SqlWorkbench: React.FC = () => {
  const [sql, setSql] = useState('SELECT name, type\nFROM sqlite_master\nORDER BY type, name;');
  const sqlRef = useRef(sql);
  const executeRef = useRef<(offset?: number) => void>(() => undefined);
  const [result, setResult] = useState<DatabaseReadonlyQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<QueryHistoryItem[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);

  const execute = (offset = 0) => {
    const query = sqlRef.current.trim();
    if (!query) return;
    setRunning(true);
    setError(null);
    try {
      const nextResult = runReadonlyDatabaseSql(query, { offset, limit: PAGE_SIZE });
      setResult(nextResult);
      if (offset === 0) {
        const nextHistory = [{ sql: query, executedAt: Date.now(), elapsedMs: nextResult.elapsedMs, rowCount: nextResult.values.length }, ...history.filter((item) => item.sql !== query)].slice(0, 50);
        setHistory(nextHistory);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };
  executeRef.current = execute;

  const onMount: OnMount = (editor, monaco) => {
    editor.addAction({
      id: 'database.execute-readonly-query', label: '执行只读 SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => executeRef.current(0),
    });
  };

  const exportResult = (format: 'csv' | 'json' | 'markdown') => {
    if (!result) return;
    if (format === 'json') {
      const rows = result.values.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
      download('query-result.json', JSON.stringify(rows, null, 2), 'application/json');
      return;
    }
    const separator = format === 'csv' ? ',' : ' | ';
    const escape = (value: unknown) => {
      const text = valueText(value);
      if (format === 'markdown') return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [result.columns.map(escape).join(separator)];
    if (format === 'markdown') lines.push(result.columns.map(() => '---').join(separator));
    lines.push(...result.values.map((row) => row.map(escape).join(separator)));
    download(`query-result.${format === 'markdown' ? 'md' : 'csv'}`, lines.join('\n'), 'text/plain;charset=utf-8');
  };

  return <div className="flex min-h-0 flex-1">
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button size="sm" className="h-7" disabled={running} onClick={() => execute(0)}>{running ? '执行中…' : '执行 Ctrl+Enter'}</Button>
        <span className="text-[10px] text-muted-foreground">只允许 SELECT、WITH、EXPLAIN 和安全 PRAGMA · 每页最多 {PAGE_SIZE} 行</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setHistoryOpen((open) => !open)}>历史 {history.length}</Button>
      </div>
      <div className="h-52 shrink-0 border-b">
        <MonacoEditor value={sql} onChange={(value) => { const next = value ?? ''; sqlRef.current = next; setSql(next); }} onMount={onMount} language="sql" theme={document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'} options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: 'on' }} />
      </div>
      {error && <div className="border-b bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">{error}</div>}
      {result ? <>
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>{result.values.length} 行</span><span>·</span><span>{result.elapsedMs.toFixed(1)} ms</span><span>·</span><span>偏移 {result.offset}</span><div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7" onClick={() => exportResult('csv')}>CSV</Button><Button variant="ghost" size="sm" className="h-7" onClick={() => exportResult('json')}>JSON</Button><Button variant="ghost" size="sm" className="h-7" onClick={() => exportResult('markdown')}>Markdown</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0"><tr className="bg-muted">{result.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 text-left">{column}</th>)}</tr></thead><tbody>{result.values.map((row, rowIndex) => <tr key={rowIndex} className="border-t">{row.map((value, columnIndex) => <td key={columnIndex} className="max-w-80 truncate px-3 py-1.5 font-mono" title={valueText(value)}>{value === null ? <span className="italic text-muted-foreground">NULL</span> : valueText(value)}</td>)}</tr>)}</tbody></table></div>
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2"><Button variant="outline" size="sm" className="h-7" disabled={result.offset === 0} onClick={() => execute(Math.max(0, result.offset - PAGE_SIZE))}>上一页</Button><Button variant="outline" size="sm" className="h-7" disabled={!result.hasMore} onClick={() => execute(result.offset + PAGE_SIZE)}>下一页</Button></div>
      </> : <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">执行查询后，结果会显示在这里。</div>}
    </div>
    {historyOpen && <aside className="w-72 shrink-0 overflow-auto border-l bg-muted/10"><div className="flex items-center border-b px-3 py-2"><h4 className="text-xs font-semibold">查询历史</h4><div className="flex-1" /><Button variant="ghost" size="sm" className="h-6" onClick={() => { setHistory([]); localStorage.removeItem(HISTORY_KEY); }}>清空</Button></div>{history.map((item) => <button key={`${item.executedAt}-${item.sql}`} type="button" onClick={() => { sqlRef.current = item.sql; setSql(item.sql); }} className="block w-full border-b px-3 py-2 text-left hover:bg-accent"><span className="block truncate font-mono text-[10px]">{item.sql}</span><span className="mt-1 block text-[9px] text-muted-foreground">{new Date(item.executedAt).toLocaleString()} · {item.elapsedMs.toFixed(1)} ms · {item.rowCount} 行</span></button>)}</aside>}
  </div>;
};
