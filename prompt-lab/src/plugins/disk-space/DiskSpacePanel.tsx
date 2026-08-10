import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import * as echarts from 'echarts/core';
import { PieChart, TreemapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { Modal } from 'antd';
import { XMarkdown } from '@ant-design/x-markdown';
import type { DiskDirectoryItem, DiskFilePreview, DiskScanEvent, DiskSystemInfo } from '@/types/electron';
import { ChevronDown, ExternalLink, FileText, FolderOpen, HardDrive, Image, Loader2, RefreshCw, Square } from '@/components/icons';

echarts.use([PieChart, TreemapChart, GridComponent, TooltipComponent, CanvasRenderer]);

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

function compactDirectoryCandidates(entries: DirectoryEntry[], names: RegExp): DirectoryEntry[] {
  const matches = entries.filter((item) => displayPath(item.path).split(/[\\/]/).some((part) => names.test(part)));
  return matches.filter((item) => !matches.some((parent) => {
    if (parent.path === item.path) return false;
    const relative = displayPath(item.path).slice(displayPath(parent.path).length);
    return displayPath(item.path).toLowerCase().startsWith(displayPath(parent.path).toLowerCase()) && /^[\\/]/.test(relative);
  })).sort((a, b) => b.size - a.size).slice(0, 20);
}

type TreemapNode = { name: string; value?: number; path?: string; children?: TreemapNode[] };

function buildDirectoryTree(entries: DirectoryEntry[], rootPath: string): TreemapNode[] {
  const normalized = (value: string) => displayPath(value).replace(/[\\/]+$/, '').toLowerCase();
  const selected = [...entries].sort((a, b) => b.size - a.size).slice(0, 500);
  const nodes = new Map<string, TreemapNode & { size: number }>();
  for (const entry of selected) {
    const key = normalized(entry.path);
    nodes.set(key, { name: displayPath(entry.path).split(/[\\/]/).filter(Boolean).at(-1) || displayPath(entry.path), path: entry.path, size: entry.size, children: [] });
  }
  const roots: Array<TreemapNode & { size: number }> = [];
  for (const [key, node] of nodes) {
    let cursor = key;
    let parent: (TreemapNode & { size: number }) | undefined;
    while (cursor.length > normalized(rootPath).length) {
      cursor = cursor.replace(/[\\/][^\\/]+$/, '');
      parent = nodes.get(cursor);
      if (parent) break;
    }
    if (parent && parent !== node) parent.children!.push(node); else roots.push(node);
  }
  const finalize = (node: TreemapNode & { size: number }): TreemapNode => {
    const children = node.children!.sort((a, b) => (b as typeof node).size - (a as typeof node).size).map((child) => finalize(child as typeof node));
    const childrenTotal = children.reduce((sum, child) => sum + (child.value ?? 0), 0);
    const ownSize = Math.max(0, node.size - childrenTotal);
    if (ownSize > 0 && children.length > 0) children.push({ name: '当前目录文件', value: ownSize, path: node.path });
    return children.length ? { name: node.name, value: node.size, path: node.path, children } : { name: node.name, value: node.size, path: node.path };
  };
  return roots.sort((a, b) => b.size - a.size).map(finalize);
}

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
  const [activeTab, setActiveTab] = useState<'overview' | 'browser' | 'analysis' | 'developer' | 'cleanup'>('overview');
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
    else if (event.type === 'directory') setDirectories((value) => [...value, event].sort((a, b) => b.size - a.size).slice(0, 500));
    else if (event.type === 'duplicate-progress') setPhase('hashing');
    else if (event.type === 'extension') setExtensions((value) => ({ ...value, [event.extension || '(无扩展名)']: event.size }));
    else if (event.type === 'progress' || event.type === 'done') setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
  }), []);
  useEffect(() => window.electronAPI.diskSpace.onExit((id, result) => { if (id === scanId.current) { setRunning(false); if (result.error) setError(result.error); } }), []);
  useEffect(() => { localStorage.setItem('disk-space.exclusions', exclusionsText); }, [exclusionsText]);
  useEffect(() => { setError(''); }, [activeTab]);

  const loadDirectory = async (directory: string) => { if (!root) return; setBrowserLoading(true); setPreview(null); try { setEntries(await window.electronAPI.diskSpace.listDirectory(root, directory)); setCurrentDirectory(directory); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBrowserLoading(false); } };
  const choose = async () => { const chosen = await window.electronAPI.diskSpace.pickRoot(); if (!chosen) return; setRoot(chosen); setCurrentDirectory(chosen); setPreview(null); setBrowserLoading(true); try { setEntries(await window.electronAPI.diskSpace.listDirectory(chosen, chosen)); } catch (cause) { setError(String(cause)); } finally { setBrowserLoading(false); } };
  const start = async () => { if (!root || running) return; const focusedScan = activeTab === 'developer' || activeTab === 'cleanup'; const exclusions = focusedScan ? ['.git'] : exclusionsText.split(',').map((value) => value.trim()).filter(Boolean); scanId.current = crypto.randomUUID(); setStats({ files: 0, bytes: 0, errors: 0 }); setLargest([]); setExtensions({}); setDirectories([]); setPhase('scanning'); setError(''); setRunning(true); try { await window.electronAPI.diskSpace.start(scanId.current, root, { exclusions, skipDuplicates: focusedScan }); } catch (cause) { setRunning(false); setError(cause instanceof Error ? cause.message : String(cause)); } };
  const openPreview = async (entry: DiskDirectoryItem) => { if (entry.type === 'directory') { await loadDirectory(entry.path); return; } setBrowserLoading(true); try { setPreview(await window.electronAPI.diskSpace.preview(root, entry.path)); } catch (cause) { setError(String(cause)); } finally { setBrowserLoading(false); } };
  const parentDirectory = currentDirectory && currentDirectory !== root ? currentDirectory.replace(/[\\/][^\\/]+[\\/]?$/, '') : '';
  const extensionData = useMemo(() => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10), [extensions]);
  const extensionOption = useMemo<EChartsCoreOption>(() => ({ color: ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777'], tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${formatBytes(p.value)} · ${p.percent}%` }, series: [{ type: 'pie', radius: ['48%', '76%'], center: ['42%', '50%'], itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: 'transparent' }, label: { color: '#746075', formatter: '{b}\n{d}%' }, data: extensionData.map(([name, value]) => ({ name, value })) }] }), [extensionData]);
  const directoryData = useMemo(() => buildDirectoryTree(directories, root), [directories, root]);
  const directoryOption = useMemo<EChartsCoreOption>(() => ({ tooltip: { formatter: (item: { name: string; value: number; data?: { path?: string } }) => `${item.name}<br/>${formatBytes(item.value)}<br/>${displayPath(item.data?.path || '')}` }, series: [{ type: 'treemap', roam: true, nodeClick: 'zoomToNode', breadcrumb: { show: true, height: 26 }, label: { show: true, formatter: (item: { name: string; value: number }) => `${item.name}\n${formatBytes(item.value)}` }, upperLabel: { show: true, height: 24 }, itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 }, levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }, { colorSaturation: [0.35, 0.75], upperLabel: { show: true }, itemStyle: { gapWidth: 2, borderWidth: 1 } }, { colorSaturation: [0.25, 0.65], itemStyle: { gapWidth: 1 } }], data: directoryData }] }), [directoryData]);
  const developerItems = useMemo(() => compactDirectoryCandidates(directories, /^(?:node_modules|\.pnpm-store|\.npm|\.yarn|\.cargo|target|\.gradle|\.m2|docker|wsl|ollama|__pycache__)$/i), [directories]);
  const cleanupItems = useMemo(() => compactDirectoryCandidates(directories, /^(?:cache|caches|temp|tmp|logs?|node_modules|target|dist|build|__pycache__)$/i), [directories]);

  return <div className="h-full min-h-0 overflow-y-auto bg-background p-5"><div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">
    <header className="flex items-start justify-between"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1><p className="mt-1 text-sm text-muted-foreground">系统资源概览、目录分析与安全文件预览</p></div><button className="rounded-md border p-2 hover:bg-accent" title="刷新系统信息" onClick={() => void refreshSystem()}><RefreshCw className="h-4 w-4" /></button></header>
    <style>{`section:has(> .border-r) { display: ${activeTab === 'browser' ? 'grid' : 'none'} !important; grid-template-columns: minmax(0, 1fr) !important; } section:has(> .border-r) > div:last-child { display: none !important; } ${activeTab !== 'analysis' ? 'section:has(> .border-r) ~ section { display: none !important; }' : ''}`}</style>
    <nav className="flex gap-1 rounded-xl border bg-card p-1 shadow-sm" aria-label="磁盘空间功能">{([['overview', '资源概览'], ['browser', '目录浏览'], ['analysis', '空间分析'], ['developer', '开发者空间'], ['cleanup', '清理建议']] as const).map(([id, label]) => <button key={id} className={`rounded-lg px-5 py-2 text-sm transition-colors ${activeTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`} onClick={() => setActiveTab(id)}>{label}</button>)}</nav>
    <Modal open={Boolean(preview)} title={preview?.name || '文件预览'} width="min(1100px, 92vw)" footer={preview ? <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}{preview.truncated ? ' · 仅展示前 1 MB' : ''}</span><button className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => void window.electronAPI.diskSpace.open(root, preview.path)}><ExternalLink className="h-4 w-4" />默认应用打开</button></div> : null} onCancel={() => setPreview(null)} destroyOnClose>
      <div className="max-h-[72vh] min-h-[320px] overflow-auto rounded-lg bg-background p-5">{!preview ? null : preview.kind === 'image' && preview.content ? <div className="flex min-h-[320px] items-center justify-center"><img className="max-h-[68vh] max-w-full rounded-lg object-contain shadow" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} /></div> : preview.kind === 'text' && /\.md(?:own)?$/i.test(preview.name) ? <XMarkdown content={preview.content || '_(空文档)_'} className="chat-markdown prose prose-sm max-w-none break-words dark:prose-invert" /> : preview.kind === 'text' ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{preview.content}</pre> : <EmptyState>{preview.message}</EmptyState>}</div>
    </Modal>
    {(activeTab === 'developer' || activeTab === 'cleanup') && <section className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{activeTab === 'developer' ? '开发环境占用' : '可清理候选项'}</h2><p className="mt-1 text-sm text-muted-foreground">{activeTab === 'developer' ? '根据 Rust 扫描结果识别常见开发工具、缓存和构建产物。' : '仅提供检查建议，不会自动删除任何文件。'}</p></div><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root || running} onClick={() => void start()}>{stats.files ? '重新扫描' : '开始扫描'}</button></div>{!root && <button className="mt-5 flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void choose()}><FolderOpen className="h-4 w-4" />选择分析目录</button>}<div className="mt-5 space-y-2">{(activeTab === 'developer' ? developerItems : cleanupItems).map((item) => <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 rounded-lg border px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)}</p><p className="truncate font-mono text-xs text-muted-foreground">{displayPath(item.path)}</p></div><span className="text-right font-medium tabular-nums">{formatBytes(item.size)}</span><span className={`rounded-full px-2 py-1 text-xs ${activeTab === 'cleanup' ? 'bg-amber-500/10 text-amber-700' : 'bg-primary/10 text-primary'}`}>{activeTab === 'cleanup' ? '需要确认' : '开发资源'}</span></div>)}{stats.files > 0 && (activeTab === 'developer' ? developerItems : cleanupItems).length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">当前扫描范围内未发现匹配项</div>}{stats.files === 0 && <div className="py-12 text-center text-sm text-muted-foreground">选择目录并扫描后生成分析结果</div>}</div></section>}
    {activeTab === 'overview' && system && <section className="grid gap-4 xl:grid-cols-2">{system.disks.map((disk, index) => <UsageCard key={disk.path} title={`${disk.path} ${index === 0 ? '系统磁盘' : '本地磁盘'}`} subtitle={`${system.hostname} · ${system.platform}`} used={disk.used} total={disk.total} color={index === 0 ? '#7c3aed' : '#2563eb'} />)}<UsageCard title="物理内存" subtitle="实时内存占用" used={system.memory.used} total={system.memory.total} color="#0891b2" /></section>}
    {activeTab !== 'overview' && <section className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex gap-2"><button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void choose()}><FolderOpen className="h-4 w-4" />选择目录</button><div className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm" title={root}>{root || '选择目录后可浏览与分析'}</div>{activeTab === 'analysis' && (running ? <button className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm" onClick={() => void window.electronAPI.diskSpace.cancel(scanId.current)}><Square className="h-4 w-4" />停止</button> : <button className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={() => void start()}>分析占用</button>)}</div>{activeTab === 'analysis' && <label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm"><span className="text-muted-foreground">排除目录</span><input className="rounded-md border bg-background px-3 py-2" value={exclusionsText} disabled={running} onChange={(event) => setExclusionsText(event.target.value)} /></label>}</section>}
    {running && <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}{error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {root && <section className="grid min-h-[520px] overflow-hidden rounded-2xl border bg-card shadow-sm xl:grid-cols-[minmax(380px,42%)_minmax(0,1fr)]"><div className="flex min-h-0 flex-col border-r"><div className="flex h-12 items-center gap-2 border-b px-3"><button className="rounded p-1.5 hover:bg-accent disabled:opacity-30" disabled={!parentDirectory} onClick={() => parentDirectory && void loadDirectory(parentDirectory)}><ChevronDown className="h-4 w-4 rotate-90" /></button><span className="min-w-0 flex-1 truncate font-mono text-xs" title={currentDirectory}>{displayPath(currentDirectory)}</span><span className="text-xs text-muted-foreground">{entries.length} 项</span></div><div className="min-h-0 flex-1 overflow-auto">{browserLoading && !preview ? <EmptyState><Loader2 className="mr-2 h-4 w-4" />加载中</EmptyState> : entries.map((entry) => <button key={entry.path} className={`grid w-full grid-cols-[24px_minmax(0,1fr)_90px] items-center gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted/40 ${preview?.path === entry.path ? 'bg-primary/5' : ''}`} onDoubleClick={() => void openPreview(entry)} onClick={() => entry.type === 'file' && void openPreview(entry)}>{entry.type === 'directory' ? <FolderOpen className="h-4 w-4 text-amber-500" /> : entry.extension.match(/png|jpg|jpeg|gif|webp|svg/) ? <Image className="h-4 w-4 text-sky-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}<span className="truncate">{entry.name}</span><span className="text-right text-xs tabular-nums text-muted-foreground">{entry.type === 'directory' ? '文件夹' : formatBytes(entry.size)}</span></button>)}</div></div><div className="flex min-h-0 flex-col bg-muted/10"><div className="flex h-12 items-center justify-between border-b px-4"><span className="truncate text-sm font-medium">{preview?.name || '文件预览'}</span>{preview && <button className="rounded p-1.5 hover:bg-accent" title="使用默认应用打开" onClick={() => void window.electronAPI.diskSpace.open(scanId.current, preview.path)}><ExternalLink className="h-4 w-4" /></button>}</div><div className="min-h-0 flex-1 overflow-auto p-4">{!preview ? <EmptyState>选择文件即可预览，双击文件夹进入</EmptyState> : preview.kind === 'image' && preview.content ? <div className="flex h-full items-center justify-center"><img className="max-h-full max-w-full rounded-lg object-contain shadow" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} /></div> : preview.kind === 'text' ? <div><pre className="whitespace-pre-wrap break-words rounded-lg border bg-background p-4 font-mono text-xs leading-6">{preview.content}</pre>{preview.truncated && <p className="mt-2 text-xs text-amber-600">文件较大，仅展示前 1 MB</p>}</div> : <EmptyState>{preview.message}</EmptyState>}</div>{preview && <div className="border-t px-4 py-2 text-xs text-muted-foreground">{formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}</div>}</div></section>}
    {(running || stats.files > 0) && <><section className="grid grid-cols-3 gap-3">{[['文件', stats.files.toLocaleString()], ['已扫描容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}</section><section className="grid gap-4 xl:grid-cols-2"><article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">文件类型占用</h2>{extensionData.length ? <Chart option={extensionOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article><article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">目录占用排行</h2>{directoryData.length ? <Chart option={directoryOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article></section><section className="max-h-[420px] overflow-auto rounded-xl border bg-card"><h2 className="sticky top-0 border-b bg-card px-4 py-3 font-medium">最大文件 <span className="text-xs text-muted-foreground">前 50</span></h2>{largest.map((file) => <button key={file.path} className="grid w-full grid-cols-[minmax(0,1fr)_100px] gap-3 border-b px-4 py-2 text-left text-sm hover:bg-muted/40" onClick={() => void openPreview({ name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path, path: file.path, type: 'file', size: file.size, modifiedAt: file.modifiedAt, extension: file.extension })}><span className="truncate font-mono text-xs">{displayPath(file.path)}</span><span className="text-right text-muted-foreground">{formatBytes(file.size)}</span></button>)}</section></>}
  </div></div>;
}
