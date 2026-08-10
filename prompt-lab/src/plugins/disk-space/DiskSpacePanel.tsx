import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import type { DiskDirectoryItem, DiskFilePreview, DiskScanEvent, DiskSystemInfo } from '@/types/electron';
import { ChevronDown, ExternalLink, FileText, FolderOpen, HardDrive, Image, Loader2, RefreshCw, Square } from '@/components/icons';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);

type FileEntry = Extract<DiskScanEvent, { type: 'file' }>;
type DirectoryEntry = Extract<DiskScanEvent, { type: 'directory' }>;
const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function displayPath(value: string): string {
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}
function Chart({ option, className }: { option: EChartsCoreOption; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={ref} className={className} />;
}
function EmptyState({ children }: PropsWithChildren) { return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>; }

function UsageCard({ title, subtitle, used, total, color }: { title: string; subtitle: string; used: number; total: number; color: string }) {
  const percent = total ? Math.round(used / total * 100) : 0;
  const option = useMemo<EChartsCoreOption>(() => ({
    color: [color, 'rgba(127,127,127,.12)'], tooltip: { trigger: 'item', formatter: (item: { name: string; value: number }) => `${item.name}<br/>${formatBytes(item.value)}` },
    series: [{ type: 'pie', silent: false, radius: ['72%', '90%'], center: ['50%', '50%'], label: { show: false }, data: [{ name: '已使用', value: used }, { name: '可用', value: Math.max(0, total - used), itemStyle: { color: 'rgba(127,127,127,.12)' } }] }],
    graphic: [{ type: 'text', left: 'center', top: '38%', style: { text: `${percent}%`, fontSize: 24, fontWeight: 650, fill: 'currentColor', textAlign: 'center' } }],
  }), [color, percent, total, used]);
  return <article className="grid min-h-[180px] grid-cols-[170px_minmax(0,1fr)] items-center rounded-2xl border bg-card p-4 shadow-sm">
    <Chart option={option} className="h-[150px] w-[150px]" />
    <div><p className="text-sm text-muted-foreground">{subtitle}</p><h2 className="mt-1 text-lg font-semibold">{title}</h2><p className="mt-5 text-2xl font-semibold tabular-nums">{formatBytes(used)}</p><p className="mt-1 text-xs text-muted-foreground">共 {formatBytes(total)} · 可用 {formatBytes(Math.max(0, total - used))}</p></div>
  </article>;
}

export function DiskSpacePanel() {
  const [system, setSystem] = useState<DiskSystemInfo | null>(null);
  const [root, setRoot] = useState(''); const [currentDirectory, setCurrentDirectory] = useState('');
  const [entries, setEntries] = useState<DiskDirectoryItem[]>([]); const [preview, setPreview] = useState<DiskFilePreview | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false); const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ files: 0, bytes: 0, errors: 0 }); const [largest, setLargest] = useState<FileEntry[]>([]);
  const [extensions, setExtensions] = useState<Record<string, number>>({}); const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [error, setError] = useState(''); const [phase, setPhase] = useState<'scanning' | 'hashing'>('scanning');
  const [exclusionsText, setExclusionsText] = useState(() => localStorage.getItem('disk-space.exclusions') ?? '.git,node_modules,target'); const scanId = useRef('');

  const refreshSystem = async () => { try { setSystem(await window.electronAPI.diskSpace.systemInfo()); } catch (cause) { setError(String(cause)); } };
  useEffect(() => { void refreshSystem(); const timer = window.setInterval(() => void refreshSystem(), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => window.electronAPI.diskSpace.onEvent((id, event) => {
    if (id !== scanId.current) return;
    if (event.type === 'file') setLargest((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    else if (event.type === 'directory') setDirectories((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    else if (event.type === 'duplicate-progress') setPhase('hashing');
    else if (event.type === 'extension') setExtensions((value) => ({ ...value, [event.extension || '(无扩展名)']: event.size }));
    else if (event.type === 'progress' || event.type === 'done') setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
  }), []);
  useEffect(() => window.electronAPI.diskSpace.onExit((id, result) => { if (id === scanId.current) { setRunning(false); if (result.error) setError(result.error); } }), []);
  useEffect(() => { localStorage.setItem('disk-space.exclusions', exclusionsText); }, [exclusionsText]);

  const loadDirectory = async (directory: string) => { if (!root) return; setBrowserLoading(true); setPreview(null); try { setEntries(await window.electronAPI.diskSpace.listDirectory(root, directory)); setCurrentDirectory(directory); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBrowserLoading(false); } };
  const choose = async () => { const chosen = await window.electronAPI.diskSpace.pickRoot(); if (!chosen) return; setRoot(chosen); setCurrentDirectory(chosen); setPreview(null); setBrowserLoading(true); try { setEntries(await window.electronAPI.diskSpace.listDirectory(chosen, chosen)); } catch (cause) { setError(String(cause)); } finally { setBrowserLoading(false); } };
  const start = async () => { if (!root || running) return; scanId.current = crypto.randomUUID(); setStats({ files: 0, bytes: 0, errors: 0 }); setLargest([]); setExtensions({}); setDirectories([]); setPhase('scanning'); setError(''); setRunning(true); try { await window.electronAPI.diskSpace.start(scanId.current, root, { exclusions: exclusionsText.split(',').map((value) => value.trim()).filter(Boolean) }); } catch (cause) { setRunning(false); setError(cause instanceof Error ? cause.message : String(cause)); } };
  const openPreview = async (entry: DiskDirectoryItem) => { if (entry.type === 'directory') { await loadDirectory(entry.path); return; } setBrowserLoading(true); try { setPreview(await window.electronAPI.diskSpace.preview(root, entry.path)); } catch (cause) { setError(String(cause)); } finally { setBrowserLoading(false); } };
  const parentDirectory = currentDirectory && currentDirectory !== root ? currentDirectory.replace(/[\\/][^\\/]+[\\/]?$/, '') : '';
  const extensionData = useMemo(() => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10), [extensions]);
  const extensionOption = useMemo<EChartsCoreOption>(() => ({ color: ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777'], tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${formatBytes(p.value)} · ${p.percent}%` }, series: [{ type: 'pie', radius: ['48%', '76%'], center: ['42%', '50%'], itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: 'transparent' }, label: { color: '#746075', formatter: '{b}\n{d}%' }, data: extensionData.map(([name, value]) => ({ name, value })) }] }), [extensionData]);
  const directoryData = useMemo(() => directories.slice(0, 10).reverse(), [directories]);
  const directoryOption = useMemo<EChartsCoreOption>(() => ({ grid: { left: 12, right: 72, top: 8, bottom: 8, containLabel: true }, tooltip: { trigger: 'axis', formatter: (items: Array<{ name: string; value: number }>) => `${items[0]?.name}<br/>${formatBytes(items[0]?.value ?? 0)}` }, xAxis: { type: 'value', show: false }, yAxis: { type: 'category', data: directoryData.map((item) => displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#746075', width: 130, overflow: 'truncate' } }, series: [{ type: 'bar', data: directoryData.map((item) => item.size), barMaxWidth: 18, itemStyle: { color: '#7c3aed', borderRadius: [0, 5, 5, 0] }, label: { show: true, position: 'right', color: '#746075', formatter: (p: { value: number }) => formatBytes(p.value) } }] }), [directoryData]);

  return <div className="h-full min-h-0 overflow-y-auto bg-background p-5"><div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">
    <header className="flex items-start justify-between"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1><p className="mt-1 text-sm text-muted-foreground">系统资源概览、目录分析与安全文件预览</p></div><button className="rounded-md border p-2 hover:bg-accent" title="刷新系统信息" onClick={() => void refreshSystem()}><RefreshCw className="h-4 w-4" /></button></header>
    {system && <section className="grid gap-4 xl:grid-cols-2"><UsageCard title={`${system.disk.path} 系统磁盘`} subtitle={`${system.hostname} · ${system.platform}`} used={system.disk.used} total={system.disk.total} color="#7c3aed" /><UsageCard title="物理内存" subtitle="实时内存占用" used={system.memory.used} total={system.memory.total} color="#0891b2" /></section>}
    <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex gap-2"><button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void choose()}><FolderOpen className="h-4 w-4" />选择目录</button><div className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm" title={root}>{root || '选择目录后可浏览与分析'}</div>{running ? <button className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm" onClick={() => void window.electronAPI.diskSpace.cancel(scanId.current)}><Square className="h-4 w-4" />停止</button> : <button className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={() => void start()}>分析占用</button>}</div><label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm"><span className="text-muted-foreground">排除目录</span><input className="rounded-md border bg-background px-3 py-2" value={exclusionsText} disabled={running} onChange={(event) => setExclusionsText(event.target.value)} /></label></section>
    {running && <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}{error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {root && <section className="grid min-h-[520px] overflow-hidden rounded-2xl border bg-card shadow-sm xl:grid-cols-[minmax(380px,42%)_minmax(0,1fr)]"><div className="flex min-h-0 flex-col border-r"><div className="flex h-12 items-center gap-2 border-b px-3"><button className="rounded p-1.5 hover:bg-accent disabled:opacity-30" disabled={!parentDirectory} onClick={() => parentDirectory && void loadDirectory(parentDirectory)}><ChevronDown className="h-4 w-4 rotate-90" /></button><span className="min-w-0 flex-1 truncate font-mono text-xs" title={currentDirectory}>{displayPath(currentDirectory)}</span><span className="text-xs text-muted-foreground">{entries.length} 项</span></div><div className="min-h-0 flex-1 overflow-auto">{browserLoading && !preview ? <EmptyState><Loader2 className="mr-2 h-4 w-4" />加载中</EmptyState> : entries.map((entry) => <button key={entry.path} className={`grid w-full grid-cols-[24px_minmax(0,1fr)_90px] items-center gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted/40 ${preview?.path === entry.path ? 'bg-primary/5' : ''}`} onDoubleClick={() => void openPreview(entry)} onClick={() => entry.type === 'file' && void openPreview(entry)}>{entry.type === 'directory' ? <FolderOpen className="h-4 w-4 text-amber-500" /> : entry.extension.match(/png|jpg|jpeg|gif|webp|svg/) ? <Image className="h-4 w-4 text-sky-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}<span className="truncate">{entry.name}</span><span className="text-right text-xs tabular-nums text-muted-foreground">{entry.type === 'directory' ? '文件夹' : formatBytes(entry.size)}</span></button>)}</div></div><div className="flex min-h-0 flex-col bg-muted/10"><div className="flex h-12 items-center justify-between border-b px-4"><span className="truncate text-sm font-medium">{preview?.name || '文件预览'}</span>{preview && <button className="rounded p-1.5 hover:bg-accent" title="使用默认应用打开" onClick={() => void window.electronAPI.diskSpace.open(scanId.current, preview.path)}><ExternalLink className="h-4 w-4" /></button>}</div><div className="min-h-0 flex-1 overflow-auto p-4">{!preview ? <EmptyState>选择文件即可预览，双击文件夹进入</EmptyState> : preview.kind === 'image' && preview.content ? <div className="flex h-full items-center justify-center"><img className="max-h-full max-w-full rounded-lg object-contain shadow" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} /></div> : preview.kind === 'text' ? <div><pre className="whitespace-pre-wrap break-words rounded-lg border bg-background p-4 font-mono text-xs leading-6">{preview.content}</pre>{preview.truncated && <p className="mt-2 text-xs text-amber-600">文件较大，仅展示前 1 MB</p>}</div> : <EmptyState>{preview.message}</EmptyState>}</div>{preview && <div className="border-t px-4 py-2 text-xs text-muted-foreground">{formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}</div>}</div></section>}
    {(running || stats.files > 0) && <><section className="grid grid-cols-3 gap-3">{[['文件', stats.files.toLocaleString()], ['已扫描容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}</section><section className="grid gap-4 xl:grid-cols-2"><article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">文件类型占用</h2>{extensionData.length ? <Chart option={extensionOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article><article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">目录占用排行</h2>{directoryData.length ? <Chart option={directoryOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article></section><section className="max-h-[420px] overflow-auto rounded-xl border bg-card"><h2 className="sticky top-0 border-b bg-card px-4 py-3 font-medium">最大文件 <span className="text-xs text-muted-foreground">前 50</span></h2>{largest.map((file) => <button key={file.path} className="grid w-full grid-cols-[minmax(0,1fr)_100px] gap-3 border-b px-4 py-2 text-left text-sm hover:bg-muted/40" onClick={() => void openPreview({ name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path, path: file.path, type: 'file', size: file.size, modifiedAt: file.modifiedAt, extension: file.extension })}><span className="truncate font-mono text-xs">{displayPath(file.path)}</span><span className="text-right text-muted-foreground">{formatBytes(file.size)}</span></button>)}</section></>}
  </div></div>;
}
