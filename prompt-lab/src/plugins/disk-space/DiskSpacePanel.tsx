import React from 'react';
import { FolderOpen, Loader2, Square, HardDrive, Trash2 } from '@/components/icons';

type FileEntry = { type: 'file'; path: string; size: number; modifiedAt: number; extension: string };
type DuplicateFile = { path: string; size: number; modifiedAt: number };
type DuplicateGroup = { type: 'duplicate'; groupId: string; size: number; files: DuplicateFile[] };
type DirectoryEntry = { type: 'directory'; path: string; size: number };
type ScanEvent = FileEntry | DuplicateGroup | DirectoryEntry | { type: 'extension'; extension: string; size: number } | { type: 'duplicate-progress'; stage: 'hashing' } | { type: 'progress' | 'done'; files: number; bytes: number; errors: number };
const formatBytes = (bytes: number) => bytes === 0 ? '0 B' : `${(bytes / 1024 ** Math.floor(Math.log(bytes) / Math.log(1024))).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][Math.floor(Math.log(bytes) / Math.log(1024))]}`;

export function DiskSpacePanel() {
  const [root, setRoot] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [stats, setStats] = React.useState({ files: 0, bytes: 0, errors: 0 });
  const [largest, setLargest] = React.useState<FileEntry[]>([]);
  const [extensions, setExtensions] = React.useState<Record<string, number>>({});
  const [error, setError] = React.useState('');
  const [phase, setPhase] = React.useState<'scanning' | 'hashing'>('scanning');
  const [duplicates, setDuplicates] = React.useState<DuplicateGroup[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [directories, setDirectories] = React.useState<DirectoryEntry[]>([]);
  const [exclusionsText, setExclusionsText] = React.useState(() => localStorage.getItem('disk-space.exclusions') ?? '.git,node_modules,target');
  const scanId = React.useRef('');

  React.useEffect(() => window.electronAPI.diskSpace.onEvent((id, event: ScanEvent) => {
    if (id !== scanId.current) return;
    if (event.type === 'file') {
      setLargest((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    } else if (event.type === 'directory') {
      setDirectories((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    } else if (event.type === 'duplicate') {
      setDuplicates((value) => [...value, event]);
    } else if (event.type === 'duplicate-progress') {
      setPhase('hashing');
    } else if (event.type === 'extension') {
      setExtensions((value) => ({ ...value, [event.extension || '(无扩展名)']: event.size }));
    } else setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
  }), []);
  React.useEffect(() => window.electronAPI.diskSpace.onExit((id, result) => {
    if (id !== scanId.current) return; setRunning(false); if (result.error) setError(result.error);
  }), []);
  React.useEffect(() => { localStorage.setItem('disk-space.exclusions', exclusionsText); }, [exclusionsText]);

  const choose = async () => { const selected = await window.electronAPI.diskSpace.pickRoot(); if (selected) setRoot(selected); };
  const start = async () => {
    if (!root || running) return;
    const exclusions = exclusionsText.split(',').map((value) => value.trim()).filter(Boolean);
    scanId.current = crypto.randomUUID(); setStats({ files: 0, bytes: 0, errors: 0 }); setLargest([]); setExtensions({}); setDirectories([]); setDuplicates([]); setSelected([]); setPhase('scanning'); setError(''); setRunning(true);
    try { await window.electronAPI.diskSpace.start(scanId.current, root, { exclusions }); } catch (cause) { setRunning(false); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const cancel = async () => { await window.electronAPI.diskSpace.cancel(scanId.current); setRunning(false); };
  const topExtensions = Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const selectedBytes = duplicates.flatMap((group) => group.files).filter((file) => selected.includes(file.path)).reduce((sum, file) => sum + file.size, 0);
  const toggleSelected = (filePath: string) => setSelected((value) => value.includes(filePath) ? value.filter((path) => path !== filePath) : [...value, filePath]);
  const trashSelected = async () => {
    if (selected.length === 0) return;
    try {
      const result = await window.electronAPI.diskSpace.trash(scanId.current, selected);
      if (!result.success) return;
      const removed = new Set(result.trashed);
      setDuplicates((groups) => groups.map((group) => ({ ...group, files: group.files.filter((file) => !removed.has(file.path)) })).filter((group) => group.files.length > 1));
      setSelected([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <div className="flex h-full flex-col gap-4 overflow-auto p-5">
    <div><h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1><p className="mt-1 text-sm text-muted-foreground">由 Rust 只读扫描目录；跳过符号链接，不会删除或修改文件。</p></div>
    <div className="flex gap-2"><button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" onClick={choose}><FolderOpen className="h-4 w-4" />选择目录</button><div className="min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-sm">{root || '尚未选择'}</div>{running ? <button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" onClick={cancel}><Square className="h-4 w-4" />停止</button> : <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={start}>开始分析</button>}</div>
    <label className="flex items-center gap-3 text-sm"><span className="shrink-0 text-muted-foreground">排除目录名</span><input className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2" value={exclusionsText} disabled={running} onChange={(event) => setExclusionsText(event.target.value)} placeholder=".git,node_modules,target" /><span className="text-xs text-muted-foreground">逗号分隔，最多 20 项</span></label>
    {running && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}{error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid grid-cols-3 gap-3">{[['文件', stats.files.toLocaleString()], ['容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="grid min-h-0 gap-4 lg:grid-cols-3"><section className="rounded-lg border p-4"><h2 className="mb-3 font-medium">扩展名占用</h2>{topExtensions.map(([name, size]) => <div key={name} className="flex justify-between gap-3 py-1 text-sm"><span className="truncate">{name}</span><span>{formatBytes(size)}</span></div>)}</section><section className="lg:col-span-2 rounded-lg border p-4"><h2 className="mb-3 font-medium">最大文件（前 50）</h2><div className="space-y-1">{largest.map((file) => <div key={file.path} className="flex gap-3 border-b py-2 text-sm"><span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span><span>{formatBytes(file.size)}</span></div>)}</div></section></div>
    <section className="rounded-lg border p-4"><h2 className="mb-3 font-medium">目录占用（前 50）</h2><div className="space-y-2">{directories.map((directory) => <div key={directory.path} className="relative overflow-hidden rounded-md border px-3 py-2 text-sm"><div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${stats.bytes ? Math.max(1, directory.size / stats.bytes * 100) : 0}%` }} /><div className="relative flex gap-3"><span className="min-w-0 flex-1 truncate" title={directory.path}>{directory.path}</span><span>{formatBytes(directory.size)}</span></div></div>)}</div></section>
    <section className="rounded-lg border p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-medium">重复文件</h2><p className="text-xs text-muted-foreground">经过完整哈希和逐字节复核；每组请至少保留一个文件。</p></div><button className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50" disabled={selected.length === 0 || running} onClick={trashSelected}><Trash2 className="h-4 w-4" />移入回收站（{selected.length}，{formatBytes(selectedBytes)}）</button></div>
      {duplicates.length === 0 && !running && <p className="text-sm text-muted-foreground">没有发现重复文件。</p>}
      {duplicates.length > 0 && <p className="mb-3 text-xs text-muted-foreground">注意：硬链接可能显示为重复路径，但移除硬链接不会释放一个完整文件的空间。</p>}
      <div className="space-y-3">{duplicates.map((group) => <div key={group.groupId} className="rounded-md border p-3"><div className="mb-2 text-xs text-muted-foreground">{group.files.length} 个相同文件 · 单个 {formatBytes(group.size)} · 可释放 {formatBytes(group.size * (group.files.length - 1))}</div>{group.files.map((file, index) => <label key={file.path} className="flex items-center gap-2 border-t py-2 text-sm"><input type="checkbox" checked={selected.includes(file.path)} onChange={() => toggleSelected(file.path)} /><span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>{index === 0 && <span className="text-xs text-muted-foreground">建议保留</span>}</label>)}</div>)}</div>
    </section>
  </div>;
}
