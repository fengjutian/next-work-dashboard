import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { ExternalLink, FolderOpen, HardDrive, Loader2, Square, Trash2 } from '@/components/icons';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);

type FileEntry = { type: 'file'; path: string; size: number; modifiedAt: number; extension: string };
type DuplicateFile = { path: string; size: number; modifiedAt: number };
type DuplicateGroup = { type: 'duplicate'; groupId: string; size: number; files: DuplicateFile[] };
type DirectoryEntry = { type: 'directory'; path: string; size: number };
type ScanEvent =
  | FileEntry
  | DuplicateGroup
  | DirectoryEntry
  | { type: 'extension'; extension: string; size: number }
  | { type: 'duplicate-progress'; stage: 'hashing' }
  | { type: 'progress' | 'done'; files: number; bytes: number; errors: number };

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
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={ref} className={className} />;
}

function EmptyState({ children }: PropsWithChildren) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

export function DiskSpacePanel() {
  const [root, setRoot] = useState('');
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ files: 0, bytes: 0, errors: 0 });
  const [largest, setLargest] = useState<FileEntry[]>([]);
  const [extensions, setExtensions] = useState<Record<string, number>>({});
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'scanning' | 'hashing'>('scanning');
  const [exclusionsText, setExclusionsText] = useState(() => localStorage.getItem('disk-space.exclusions') ?? '.git,node_modules,target');
  const scanId = useRef('');

  useEffect(() => window.electronAPI.diskSpace.onEvent((id, event: ScanEvent) => {
    if (id !== scanId.current) return;
    if (event.type === 'file') setLargest((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    else if (event.type === 'directory') setDirectories((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 50));
    else if (event.type === 'duplicate') setDuplicates((value) => [...value, event]);
    else if (event.type === 'duplicate-progress') setPhase('hashing');
    else if (event.type === 'extension') setExtensions((value) => ({ ...value, [event.extension || '(无扩展名)']: event.size }));
    else setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
  }), []);

  useEffect(() => window.electronAPI.diskSpace.onExit((id, result) => {
    if (id !== scanId.current) return;
    setRunning(false);
    if (result.error) setError(result.error);
  }), []);
  useEffect(() => { localStorage.setItem('disk-space.exclusions', exclusionsText); }, [exclusionsText]);

  const choose = async () => {
    const chosen = await window.electronAPI.diskSpace.pickRoot();
    if (chosen) setRoot(chosen);
  };
  const start = async () => {
    if (!root || running) return;
    const exclusions = exclusionsText.split(',').map((value) => value.trim()).filter(Boolean);
    scanId.current = crypto.randomUUID();
    setStats({ files: 0, bytes: 0, errors: 0 });
    setLargest([]); setExtensions({}); setDirectories([]); setDuplicates([]); setSelected([]);
    setPhase('scanning'); setError(''); setRunning(true);
    try { await window.electronAPI.diskSpace.start(scanId.current, root, { exclusions }); }
    catch (cause) { setRunning(false); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const cancel = async () => { await window.electronAPI.diskSpace.cancel(scanId.current); setRunning(false); };
  const openEntry = async (entryPath: string) => {
    try { await window.electronAPI.diskSpace.open(scanId.current, entryPath); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const toggleSelected = (filePath: string) => setSelected((value) => value.includes(filePath) ? value.filter((item) => item !== filePath) : [...value, filePath]);
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

  const extensionData = useMemo(() => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 12), [extensions]);
  const directoryData = useMemo(() => directories.slice(0, 12).reverse(), [directories]);
  const selectedBytes = duplicates.flatMap((group) => group.files).filter((file) => selected.includes(file.path)).reduce((sum, file) => sum + file.size, 0);
  const chartText = '#746075';
  const extensionOption = useMemo<EChartsCoreOption>(() => ({
    color: ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea'],
    tooltip: { trigger: 'item', formatter: (params: { name: string; value: number; percent: number }) => `${params.name}<br/>${formatBytes(params.value)} · ${params.percent}%` },
    series: [{ type: 'pie', radius: ['48%', '76%'], center: ['42%', '50%'], avoidLabelOverlap: true, itemStyle: { borderRadius: 5, borderWidth: 2, borderColor: 'transparent' }, label: { color: chartText, formatter: '{b}\n{d}%' }, data: extensionData.map(([name, value]) => ({ name, value })) }],
  }), [extensionData]);
  const directoryOption = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 12, right: 72, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (items: Array<{ name: string; value: number }>) => `${items[0]?.name}<br/>${formatBytes(items[0]?.value ?? 0)}` },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: directoryData.map((entry) => displayPath(entry.path).split(/[\\/]/).filter(Boolean).at(-1) || displayPath(entry.path)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: chartText, width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: directoryData.map((entry) => entry.size), barMaxWidth: 18, itemStyle: { color: '#7c3aed', borderRadius: [0, 5, 5, 0] }, label: { show: true, position: 'right', color: chartText, formatter: (params: { value: number }) => formatBytes(params.value) } }],
  }), [directoryData]);

  return <div className="h-full min-h-0 overflow-y-auto bg-background p-5">
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">
      <header className="shrink-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1>
        <p className="mt-1 text-sm text-muted-foreground">Rust 本地扫描 · 跳过符号链接 · 清理仅进入系统回收站</p>
      </header>

      <section className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex gap-2">
          <button className="flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={choose}><FolderOpen className="h-4 w-4" />选择目录</button>
          <div className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm" title={root}>{root || '尚未选择目录'}</div>
          {running
            ? <button className="flex shrink-0 items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent" onClick={cancel}><Square className="h-4 w-4" />停止</button>
            : <button className="shrink-0 rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={start}>开始分析</button>}
        </div>
        <label className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="text-muted-foreground">排除目录名</span>
          <input className="min-w-0 rounded-md border bg-background px-3 py-2" value={exclusionsText} disabled={running} onChange={(event) => setExclusionsText(event.target.value)} />
          <span className="text-xs text-muted-foreground">逗号分隔，最多 20 项</span>
        </label>
      </section>

      {running && <div className="flex shrink-0 items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}
      {error && <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <section className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {[['文件', stats.files.toLocaleString()], ['容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4 shadow-sm"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div></div>)}
      </section>

      <section className="grid shrink-0 gap-4 xl:grid-cols-2">
        <article className="flex h-[340px] min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="shrink-0 border-b px-4 py-3 font-medium">文件类型占用</h2>
          <div className="min-h-0 flex-1">{extensionData.length ? <Chart option={extensionOption} className="h-full w-full" /> : <EmptyState>扫描后显示文件类型分布</EmptyState>}</div>
        </article>
        <article className="flex h-[340px] min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="shrink-0 border-b px-4 py-3 font-medium">目录占用排行</h2>
          <div className="min-h-0 flex-1">{directoryData.length ? <Chart option={directoryOption} className="h-full w-full" /> : <EmptyState>扫描后显示目录占用排行</EmptyState>}</div>
        </article>
      </section>

      <section className="flex h-[420px] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <h2 className="shrink-0 border-b px-4 py-3 font-medium">最大文件 <span className="text-xs font-normal text-muted-foreground">前 50</span></h2>
        <div className="min-h-0 flex-1 overflow-auto">
          {largest.length === 0 ? <EmptyState>扫描后显示最大文件</EmptyState> : largest.map((file) => <div key={file.path} className="group grid grid-cols-[minmax(0,1fr)_100px_36px] items-center gap-3 border-b px-4 py-2 text-sm hover:bg-muted/40">
            <span className="truncate font-mono text-xs" title={displayPath(file.path)}>{displayPath(file.path)}</span>
            <span className="text-right tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
            <button className="rounded p-1.5 opacity-60 hover:bg-accent hover:opacity-100" title="使用默认应用打开" onClick={() => openEntry(file.path)}><ExternalLink className="h-4 w-4" /></button>
          </div>)}
        </div>
      </section>

      <section className="flex max-h-[560px] min-h-[180px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <div><h2 className="font-medium">重复文件</h2><p className="text-xs text-muted-foreground">完整哈希并逐字节复核；每组必须保留至少一个副本</p></div>
          <button className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50" disabled={selected.length === 0 || running} onClick={trashSelected}><Trash2 className="h-4 w-4" />移入回收站（{selected.length} · {formatBytes(selectedBytes)}）</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {duplicates.length === 0 && !running && <EmptyState>没有发现重复文件</EmptyState>}
          <div className="space-y-3">{duplicates.map((group) => <div key={group.groupId} className="overflow-hidden rounded-lg border">
            <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{group.files.length} 个相同文件 · 单个 {formatBytes(group.size)} · 最多释放 {formatBytes(group.size * (group.files.length - 1))}</div>
            {group.files.map((file, index) => <div key={file.path} className="grid grid-cols-[24px_minmax(0,1fr)_100px_36px] items-center gap-2 border-t px-3 py-2 text-sm hover:bg-muted/30">
              <input aria-label={`选择 ${displayPath(file.path)}`} type="checkbox" checked={selected.includes(file.path)} onChange={() => toggleSelected(file.path)} />
              <span className="truncate font-mono text-xs" title={displayPath(file.path)}>{displayPath(file.path)}{index === 0 && <span className="ml-2 font-sans text-primary">建议保留</span>}</span>
              <span className="text-right tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
              <button className="rounded p-1.5 opacity-60 hover:bg-accent hover:opacity-100" title="使用默认应用打开" onClick={() => openEntry(file.path)}><ExternalLink className="h-4 w-4" /></button>
            </div>)}
          </div>)}</div>
        </div>
      </section>
    </div>
  </div>;
}
