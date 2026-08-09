import React from 'react';
import { FolderOpen, Loader2, Square, HardDrive } from '@/components/icons';

type FileEntry = { type: 'file'; path: string; size: number; modifiedAt: number; extension: string };
type ScanEvent = FileEntry | { type: 'extension'; extension: string; size: number } | { type: 'progress' | 'done'; files: number; bytes: number; errors: number };
const formatBytes = (bytes: number) => bytes === 0 ? '0 B' : `${(bytes / 1024 ** Math.floor(Math.log(bytes) / Math.log(1024))).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][Math.floor(Math.log(bytes) / Math.log(1024))]}`;

export function DiskSpacePanel() {
  const [root, setRoot] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [stats, setStats] = React.useState({ files: 0, bytes: 0, errors: 0 });
  const [largest, setLargest] = React.useState<FileEntry[]>([]);
  const [extensions, setExtensions] = React.useState<Record<string, number>>({});
  const [error, setError] = React.useState('');
  const scanId = React.useRef('');

  React.useEffect(() => window.electronAPI.diskSpace.onEvent((id, event: ScanEvent) => {
    if (id !== scanId.current) return;
    if (event.type === 'file') {
      setLargest((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    } else if (event.type === 'extension') {
      setExtensions((value) => ({ ...value, [event.extension || '(无扩展名)']: event.size }));
    } else setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
  }), []);
  React.useEffect(() => window.electronAPI.diskSpace.onExit((id, result) => {
    if (id !== scanId.current) return; setRunning(false); if (result.error) setError(result.error);
  }), []);

  const choose = async () => { const selected = await window.electronAPI.diskSpace.pickRoot(); if (selected) setRoot(selected); };
  const start = async () => {
    if (!root || running) return;
    scanId.current = crypto.randomUUID(); setStats({ files: 0, bytes: 0, errors: 0 }); setLargest([]); setExtensions({}); setError(''); setRunning(true);
    try { await window.electronAPI.diskSpace.start(scanId.current, root); } catch (cause) { setRunning(false); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const cancel = async () => { await window.electronAPI.diskSpace.cancel(scanId.current); setRunning(false); };
  const topExtensions = Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return <div className="flex h-full flex-col gap-4 overflow-auto p-5">
    <div><h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1><p className="mt-1 text-sm text-muted-foreground">由 Rust 只读扫描目录；跳过符号链接，不会删除或修改文件。</p></div>
    <div className="flex gap-2"><button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" onClick={choose}><FolderOpen className="h-4 w-4" />选择目录</button><div className="min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-sm">{root || '尚未选择'}</div>{running ? <button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" onClick={cancel}><Square className="h-4 w-4" />停止</button> : <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={start}>开始分析</button>}</div>
    {running && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />正在扫描…</div>}{error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid grid-cols-3 gap-3">{[['文件', stats.files.toLocaleString()], ['容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="grid min-h-0 gap-4 lg:grid-cols-3"><section className="rounded-lg border p-4"><h2 className="mb-3 font-medium">扩展名占用</h2>{topExtensions.map(([name, size]) => <div key={name} className="flex justify-between gap-3 py-1 text-sm"><span className="truncate">{name}</span><span>{formatBytes(size)}</span></div>)}</section><section className="lg:col-span-2 rounded-lg border p-4"><h2 className="mb-3 font-medium">最大文件（前 50）</h2><div className="space-y-1">{largest.map((file) => <div key={file.path} className="flex gap-3 border-b py-2 text-sm"><span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span><span>{formatBytes(file.size)}</span></div>)}</div></section></div>
  </div>;
}
