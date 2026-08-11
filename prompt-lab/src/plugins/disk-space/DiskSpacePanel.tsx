import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, PieChart, TreemapChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { Modal } from 'antd';
import { XMarkdown } from '@ant-design/x-markdown';
import { createOpenAIProvider } from '../../core/llm';
import { useStore } from '../../store/store';
import type { DiskDirectoryItem, DiskSpecialtyProbe } from '@/types/electron';
import { ChevronDown, ExternalLink, FileText, FolderOpen, HardDrive, Image, Loader2, RefreshCw, Square } from '@/components/icons';
import {
  useDiskScan,
  displayPath,
  type DirectoryEntry,
  type DiskHistoryPoint,
  type FileEntry,
  type PersistedScanResult,
  type ScanErrorItem,
  type ScanTelemetry,
} from './hooks/useDiskScan';

echarts.use([LineChart, PieChart, TreemapChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ActiveTab = 'overview' | 'browser' | 'analysis' | 'developer' | 'cleanup' | 'doctor';

// ---------------- 工具 ----------------

const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function Chart({ option, className }: { option: EChartsCoreOption; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    chart.on('click', (params) => {
      const data = typeof params.data === 'object' && params.data !== null ? params.data as { path?: string } : undefined;
      if (data?.path) window.dispatchEvent(new CustomEvent('disk-space:navigate', { detail: data.path }));
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={ref} className={className} />;
}
function EmptyState({ children }: PropsWithChildren) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

function compactDirectoryCandidates(entries: DirectoryEntry[], names: RegExp): DirectoryEntry[] {
  const matches = entries.filter((item) =>
    displayPath(item.path).split(/[\\/]/).some((part) => names.test(part)),
  );
  return matches
    .filter((item) => !matches.some((parent) => {
      if (parent.path === item.path) return false;
      const relative = displayPath(item.path).slice(displayPath(parent.path).length);
      return displayPath(item.path).toLowerCase().startsWith(displayPath(parent.path).toLowerCase()) && /^[\\/]/.test(relative);
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);
}

type TreemapNode = { name: string; value?: number; path?: string; children?: TreemapNode[] };
function buildDirectoryTree(entries: DirectoryEntry[], rootPath: string): TreemapNode[] {
  const normalized = (value: string) => displayPath(value).replace(/[\\/]+$/, '').toLowerCase();
  const selected = [...entries].sort((a, b) => b.size - a.size).slice(0, 500);
  const nodes = new Map<string, TreemapNode & { size: number }>();
  for (const entry of selected) {
    const key = normalized(entry.path);
    nodes.set(key, {
      name: displayPath(entry.path).split(/[\\/]/).filter(Boolean).at(-1) || displayPath(entry.path),
      path: entry.path,
      size: entry.size,
      children: [],
    });
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
    if (parent && parent !== node) parent.children!.push(node);
    else roots.push(node);
  }
  const finalize = (node: TreemapNode & { size: number }): TreemapNode => {
    const children = node.children!
      .sort((a, b) => (b as typeof node).size - (a as typeof node).size)
      .map((child) => finalize(child as typeof node));
    const childrenTotal = children.reduce((sum, child) => sum + (child.value ?? 0), 0);
    const ownSize = Math.max(0, node.size - childrenTotal);
    if (ownSize > 0 && children.length > 0) {
      children.push({ name: '当前目录文件', value: ownSize, path: node.path });
    }
    return children.length
      ? { name: node.name, value: node.size, path: node.path, children }
      : { name: node.name, value: node.size, path: node.path };
  };
  return roots.sort((a, b) => b.size - a.size).map(finalize);
}

function UsageCard({
  title, subtitle, used, total, color,
}: { title: string; subtitle: string; used: number; total: number; color: string }) {
  const percent = total ? Math.round((used / total) * 100) : 0;
  const option = useMemo<EChartsCoreOption>(() => ({
    color: [color, 'rgba(127,127,127,.12)'],
    tooltip: { trigger: 'item', formatter: (item: { name: string; value: number }) => `${item.name}<br/>${formatBytes(item.value)}` },
    series: [{
      type: 'pie', silent: false, radius: ['72%', '90%'], center: ['50%', '50%'], label: { show: false },
      data: [
        { name: '已使用', value: used },
        { name: '可用', value: Math.max(0, total - used), itemStyle: { color: 'rgba(127,127,127,.12)' } },
      ],
    }],
    graphic: [{
      type: 'text', left: 'center', top: '38%',
      style: { text: `${percent}%`, fontSize: 24, fontWeight: 650, fill: 'currentColor', textAlign: 'center' },
    }],
  }), [color, percent, total, used]);
  return (
    <article className="grid min-h-[180px] grid-cols-[170px_minmax(0,1fr)] items-center rounded-2xl border bg-card p-4 shadow-sm">
      <Chart option={option} className="h-[150px] w-[150px]" />
      <div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        <p className="mt-5 text-2xl font-semibold tabular-nums">{formatBytes(used)}</p>
        <p className="mt-1 text-xs text-muted-foreground">共 {formatBytes(total)} · 可用 {formatBytes(Math.max(0, total - used))}</p>
      </div>
    </article>
  );
}

// ---------------- Panel ----------------

export function DiskSpacePanel() {
  const aiApi = useStore((state) => state.aiApi);
  const scan = useDiskScan();

  // UI-only state（不参与扫描状态机，留在 panel）
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [selectedDuplicates, setSelectedDuplicates] = useState<string[]>([]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [specialtyProbes, setSpecialtyProbes] = useState<DiskSpecialtyProbe[]>([]);
  const [probing, setProbing] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [largeFileThreshold, setLargeFileThreshold] = useState(0);
  const [customThresholdGb, setCustomThresholdGb] = useState('');
  const [largeFileExtension, setLargeFileExtension] = useState('');
  const [largeFileSort, setLargeFileSort] = useState<'size' | 'modified' | 'extension'>('size');

  const {
    system, diskHistory, root, currentDirectory, entries, preview, browserLoading,
    setPreview, setCurrentDirectory, scanIdRef, rootRef, running, paused, phase,
    scanTelemetry, scanErrors, stats, largest, duplicates, extensions, directories,
    directorySnapshots, savedResults, usnInfo, usnDelta, exclusionsText, setExclusionsText,
    error, setError, refreshSystem, choose, start, cancelScan, togglePause,
    loadDirectory, openPreview, restoreSavedResult, removeSavedResult,
    removeDirectorySnapshot, clearHistory, setRunning, setPaused, setScanErrors,
    setBrowserLoading, setEntries, setDuplicates,
  } = scan;

  // 切 tab 清空 error
  useEffect(() => { setError(''); }, [activeTab, setError]);

  // developer tab specialtyProbes 探测
  useEffect(() => {
    if (activeTab !== 'developer' || specialtyProbes.length > 0 || probing) return;
    setProbing(true);
    void window.electronAPI.diskSpace
      .probeSpecialties()
      .then(setSpecialtyProbes)
      .catch((cause) => setError(String(cause)))
      .finally(() => setProbing(false));
  }, [activeTab, probing, specialtyProbes.length, setError]);

  // cleanup 完成后自动重扫：替换 error 字符串匹配
  const isFocusedTab = activeTab === 'developer' || activeTab === 'cleanup';
  useEffect(() => {
    if (activeTab !== 'cleanup' || !/清理完成$/.test(error)) return;
    setSpecialtyProbes([]);
    void refreshSystem();
    if (root && !running) void start(isFocusedTab);
  }, [error, activeTab, root, running, refreshSystem, start, isFocusedTab]);

  // treemap 点击 → 跳到目录浏览
  useEffect(() => {
    const navigate = (event: Event) => {
      const directory = (event as CustomEvent<string>).detail;
      if (!directory || !rootRef.current) return;
      setActiveTab('browser');
      setBrowserLoading(true);
      setPreview(null);
      void window.electronAPI.diskSpace
        .listDirectory(rootRef.current, directory)
        .then((items) => {
          setEntries(items);
          setCurrentDirectory(directory);
        })
        .catch((cause) => setError(String(cause)))
        .finally(() => setBrowserLoading(false));
    };
    window.addEventListener('disk-space:navigate', navigate);
    return () => window.removeEventListener('disk-space:navigate', navigate);
  }, [rootRef, setCurrentDirectory, setEntries, setError, setPreview]);

  // derived
  const parentDirectory =
    currentDirectory && currentDirectory !== root
      ? currentDirectory.replace(/[\\/][^\\/]+[\\/]?$/, '')
      : '';
  const extensionData = useMemo(
    () => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10),
    [extensions],
  );
  const extensionOption = useMemo<EChartsCoreOption>(
    () => ({
      color: ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777'],
      tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${formatBytes(p.value)} · ${p.percent}%` },
      series: [{
        type: 'pie', radius: ['48%', '76%'], center: ['42%', '50%'],
        itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
        label: { color: '#746075', formatter: '{b}\n{d}%' },
        data: extensionData.map(([name, value]) => ({ name, value })),
      }],
    }),
    [extensionData],
  );
  const directoryData = useMemo(() => buildDirectoryTree(directories, root), [directories, root]);
  const directoryOption = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { formatter: (item: { name: string; value: number; data?: { path?: string } }) => `${item.name}<br/>${formatBytes(item.value)}<br/>${displayPath(item.data?.path || '')}` },
      series: [{
        type: 'treemap', roam: true, nodeClick: 'zoomToNode', breadcrumb: { show: true, height: 26 },
        label: { show: true, formatter: (item: { name: string; value: number }) => `${item.name}\n${formatBytes(item.value)}` },
        upperLabel: { show: true, height: 24 },
        itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 3 } },
          { colorSaturation: [0.35, 0.75], upperLabel: { show: true }, itemStyle: { gapWidth: 2, borderWidth: 1 } },
          { colorSaturation: [0.25, 0.65], itemStyle: { gapWidth: 1 } },
        ],
        data: directoryData,
      }],
    }),
    [directoryData],
  );
  const developerItems = useMemo(
    () => compactDirectoryCandidates(directories, /^(?:node_modules|\.pnpm-store|\.npm|\.yarn|\.cargo|target|\.gradle|\.m2|docker|wsl|ollama|__pycache__)$/i),
    [directories],
  );
  const cleanupItems = useMemo(
    () => compactDirectoryCandidates(directories, /^(?:cache|caches|temp|tmp|logs?|node_modules|target|dist|build|__pycache__)$/i),
    [directories],
  );
  const historyOption = useMemo<EChartsCoreOption>(() => {
    const diskNames = [...new Set(diskHistory.flatMap((point) => point.disks.map((disk) => disk.path)))];
    return {
      color: ['#7c3aed', '#2563eb', '#0891b2', '#059669'],
      tooltip: { trigger: 'axis', formatter: (items: Array<{ seriesName: string; value: number }>) => items.map((item) => `${item.seriesName}：${formatBytes(item.value)}`).join('<br/>') },
      legend: { top: 4, data: diskNames },
      grid: { left: 16, right: 22, top: 42, bottom: 22, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: diskHistory.map((point) => new Date(point.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit' })), axisLabel: { color: '#746075' } },
      yAxis: { type: 'value', axisLabel: { color: '#746075', formatter: (value: number) => formatBytes(value) }, splitLine: { lineStyle: { color: 'rgba(127,127,127,.12)' } } },
      series: diskNames.map((name) => ({
        name, type: 'line', smooth: true, showSymbol: diskHistory.length < 12, areaStyle: { opacity: 0.06 },
        data: diskHistory.map((point) => point.disks.find((disk) => disk.path === name)?.used ?? null),
      })),
    };
  }, [diskHistory]);
  const visibleLargest = useMemo(() => {
    const custom = Number(customThresholdGb);
    const threshold = Number.isFinite(custom) && custom > 0 ? custom * 1024 ** 3 : largeFileThreshold;
    return largest
      .filter((file) => file.size >= threshold && (!largeFileExtension || file.extension.toLowerCase() === largeFileExtension))
      .sort((a, b) => (largeFileSort === 'modified' ? b.modifiedAt - a.modifiedAt : largeFileSort === 'extension' ? a.extension.localeCompare(b.extension) : b.size - a.size));
  }, [customThresholdGb, largeFileExtension, largeFileSort, largeFileThreshold, largest]);
  const scannedExtensions = useMemo(
    () => [...new Set(largest.map((file) => file.extension).filter(Boolean))].sort(),
    [largest],
  );
  const developerTotal = developerItems.reduce((sum, item) => sum + item.size, 0);
  const cleanupTotal = cleanupItems.reduce((sum, item) => sum + item.size, 0);
  const cleanupAssessments = useMemo(
    () =>
      cleanupItems.map((item) => {
        const name = displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() || '';
        const lowRisk = /^(?:cache|caches|temp|tmp|logs?|__pycache__)$/.test(name);
        const mediumRisk = /^(?:target|dist|build)$/.test(name);
        return {
          ...item,
          risk: lowRisk ? '低风险' : mediumRisk ? '需要确认' : '仅建议检查',
          evidence: lowRisk
            ? '常见缓存、临时文件或日志目录'
            : mediumRisk
              ? '可由构建工具重新生成，但重新构建需要时间'
              : '可能包含项目依赖或用户仍在使用的数据',
        };
      }),
    [cleanupItems],
  );
  const selectedDuplicateBytes = duplicates
    .flatMap((group) => group.files)
    .filter((file) => selectedDuplicates.includes(file.path))
    .reduce((sum, file) => sum + file.size, 0);
  const directoryChanges = useMemo(() => {
    const matching = directorySnapshots
      .filter((snapshot) => displayPath(snapshot.root).toLowerCase() === displayPath(root).toLowerCase())
      .slice(-2);
    if (matching.length < 2) return [];
    const [previous, current] = matching;
    const before = new Map(previous.directories.map((item) => [displayPath(item.path).toLowerCase(), item]));
    const after = new Map(current.directories.map((item) => [displayPath(item.path).toLowerCase(), item]));
    return [...new Set([...before.keys(), ...after.keys()])]
      .map((key) => {
        const oldItem = before.get(key);
        const newItem = after.get(key);
        return { path: newItem?.path ?? oldItem!.path, size: newItem?.size ?? 0, change: (newItem?.size ?? 0) - (oldItem?.size ?? 0) };
      })
      .filter((item) => Math.abs(item.change) >= 1024 * 1024)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 20);
  }, [directorySnapshots, root]);

  // 诊断（AI 调用）
  const generateDiagnosis = async () => {
    const evidence = {
      root, scanned: stats,
      largest: largest.slice(0, 10).map((file) => ({ path: displayPath(file.path), size: formatBytes(file.size) })),
      growth: directoryChanges.slice(0, 10).map((item) => ({ path: displayPath(item.path), change: `${item.change > 0 ? '+' : '-'}${formatBytes(Math.abs(item.change))}` })),
      cleanup: cleanupItems.slice(0, 10).map((item) => ({ path: displayPath(item.path), size: formatBytes(item.size), risk: '需要确认' })),
      duplicates: { groups: duplicates.length, reclaimable: formatBytes(duplicates.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0)) },
    };
    const local = `## 本地诊断\n\n- 扫描范围：${root || '尚未选择'}\n- 已扫描：${stats.files.toLocaleString()} 个文件，共 ${formatBytes(stats.bytes)}\n- 清理候选：${cleanupItems.length} 项，约 ${formatBytes(cleanupTotal)}（全部需要确认）\n- 重复文件：${duplicates.length} 组\n\n请先完成扫描；配置 AI 后可生成带证据的原因分析和清理顺序。`;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) {
      setDiagnosis(local);
      return;
    }
    setDiagnosing(true);
    setDiagnosis('');
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages = [
        { role: 'system' as const, content: '你是本地磁盘诊断助手。只依据给定 JSON 证据分析，不得臆测。使用中文 Markdown，依次给出：容量结论、增长来源、按风险排序的清理建议、预计释放空间。每条结论必须引用具体路径和容量；清理候选均需人工确认，不建议删除系统目录。' },
        { role: 'user' as const, content: JSON.stringify(evidence) },
      ];
      let text = '';
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.2, maxTokens: 1800, stream: true })) {
        if (chunk.delta) { text += chunk.delta; setDiagnosis(text); }
      }
    } catch (cause) {
      setDiagnosis(`${local}\n\n> AI 诊断失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDiagnosing(false);
    }
  };
  const exportScanReport = async () => {
    const content = `# 磁盘扫描报告\n\n- 扫描范围：${displayPath(root)}\n- 文件数量：${stats.files.toLocaleString()}\n- 扫描容量：${formatBytes(stats.bytes)}\n- 读取问题：${stats.errors}\n- 重复文件组：${duplicates.length}\n- 清理候选：${formatBytes(cleanupTotal)}\n\n## 最大文件\n\n${largest.slice(0, 30).map((file) => `- ${formatBytes(file.size)} · \`${displayPath(file.path)}\``).join('\n')}\n\n## 目录变化\n\n${directoryChanges.map((item) => `- ${item.change > 0 ? '+' : '-'}${formatBytes(Math.abs(item.change))} · \`${displayPath(item.path)}\``).join('\n')}`;
    await window.electronAPI.saveFile(content, `磁盘扫描报告-${new Date().toISOString().slice(0, 10)}.md`);
  };

  // restoreSavedResult 包装：恢复后切到 analysis tab 并关闭 modal
  const handleRestore = (saved: PersistedScanResult) => {
    restoreSavedResult(saved);
    setResultsOpen(false);
    setActiveTab('analysis');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background p-5">
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><HardDrive className="h-5 w-5" />磁盘空间</h1>
            <p className="mt-1 text-sm text-muted-foreground">系统资源概览、目录分析与安全文件预览</p>
          </div>
          <button className="rounded-md border p-2 hover:bg-accent" title="刷新系统信息" onClick={() => void refreshSystem()}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </header>
        <style>{`section:has(> .border-r) { display: ${activeTab === 'browser' ? 'grid' : 'none'} !important; grid-template-columns: minmax(0, 1fr) !important; } section:has(> .border-r) > div:last-child { display: none !important; } section:has(> h2.sticky) { display: none !important; } ${activeTab !== 'analysis' ? 'section:has(> .border-r) ~ section { display: none !important; }' : ''}`}</style>
        <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-sm" aria-label="磁盘空间功能">
          {([['overview', '资源概览'], ['browser', '目录浏览'], ['analysis', '空间分析'], ['developer', '开发者空间'], ['cleanup', '清理建议'], ['doctor', '磁盘医生']] as const).map(([id, label]) => (
            <button key={id} className={`shrink-0 rounded-lg px-5 py-2 text-sm transition-colors ${activeTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`} onClick={() => setActiveTab(id)}>{label}</button>
          ))}
        </nav>
        {root && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`rounded-full px-2 py-1 ${usnInfo?.supported ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted'}`}>
              {usnInfo?.supported ? `NTFS USN 已启用 · ${usnInfo.method === 'native' ? '原生 API' : '兼容模式'}` : '标准优化扫描'}
            </span>
            {usnInfo?.supported && usnInfo.volume && <span>{usnInfo.volume} Journal · Next USN {usnInfo.nextUsn?.toLocaleString()}</span>}
            {usnInfo?.error && <span title={usnInfo.error}>USN 不可用</span>}
          </div>
        )}
        {usnInfo?.supported && usnDelta !== null && (
          <div className="text-xs text-muted-foreground">相对上次记录，USN 游标前进 {usnDelta.toLocaleString()} 字节；Journal ID 变化时会自动放弃旧游标并执行完整扫描。</div>
        )}

        <Modal open={Boolean(preview)} title={preview?.name || '文件预览'} width="min(1100px, 92vw)" footer={preview ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}{preview.truncated ? ' · 仅展示前 1 MB' : ''}</span>
            <button className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => void window.electronAPI.diskSpace.open(root, preview.path)}>
              <ExternalLink className="h-4 w-4" />默认应用打开
            </button>
          </div>
        ) : null} onCancel={() => setPreview(null)} destroyOnClose>
          <div className="max-h-[72vh] min-h-[320px] overflow-auto rounded-lg bg-background p-5">
            {!preview ? null : preview.kind === 'image' && preview.content ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <img className="max-h-[68vh] max-w-full rounded-lg object-contain shadow" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} />
              </div>
            ) : preview.kind === 'text' && /\.md(?:own)?$/i.test(preview.name) ? (
              <XMarkdown content={preview.content || '_(空文档)_'} className="chat-markdown prose prose-sm max-w-none break-words dark:prose-invert" />
            ) : preview.kind === 'text' ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{preview.content}</pre>
            ) : (
              <EmptyState>{preview.message}</EmptyState>
            )}
          </div>
        </Modal>
        <Modal open={errorsOpen} title={`扫描问题（${scanErrors.length}）`} footer={null} width="min(900px, 90vw)" onCancel={() => setErrorsOpen(false)}>
          <div className="max-h-[65vh] overflow-auto">
            {scanErrors.length ? scanErrors.map((item: ScanErrorItem, index) => (
              <div key={`${item.path}-${index}`} className="border-b py-3">
                <p className="break-all font-mono text-xs">{displayPath(item.path)}</p>
                <p className="mt-1 text-xs text-destructive">{item.message}</p>
              </div>
            )) : <EmptyState>没有记录到权限或读取问题</EmptyState>}
          </div>
        </Modal>
        <Modal open={snapshotsOpen} title="扫描快照管理" footer={null} width="min(900px, 90vw)" onCancel={() => setSnapshotsOpen(false)}>
          <div className="max-h-[65vh] overflow-auto">
            {directorySnapshots.map((snapshot) => (
              <div key={`${snapshot.root}-${snapshot.timestamp}`} className="grid grid-cols-[minmax(0,1fr)_170px_80px] items-center gap-3 border-b py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{displayPath(snapshot.root)}</p>
                  <p className="text-xs text-muted-foreground">记录 {snapshot.directories.length} 个主要目录</p>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(snapshot.timestamp).toLocaleString()}</span>
                <button className="text-xs text-destructive hover:underline" onClick={() => removeDirectorySnapshot(snapshot.timestamp, snapshot.root)}>删除</button>
              </div>
            ))}
          </div>
        </Modal>
        <Modal open={resultsOpen} title="扫描结果存档" footer={null} width="min(960px, 92vw)" onCancel={() => setResultsOpen(false)}>
          <div className="max-h-[68vh] overflow-auto">
            {savedResults.length ? [...savedResults].reverse().map((saved) => (
              <div key={saved.id} className="grid grid-cols-[minmax(0,1fr)_120px_170px_130px] items-center gap-3 border-b py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{displayPath(saved.root)}</p>
                  <p className="text-xs text-muted-foreground">{saved.stats.files.toLocaleString()} 个文件 · {formatBytes(saved.stats.bytes)}</p>
                </div>
                <span className="text-right text-xs">{saved.duplicates.length} 组重复</span>
                <span className="text-xs text-muted-foreground">{new Date(saved.savedAt).toLocaleString()}</span>
                <div className="flex justify-end gap-2">
                  <button className="text-xs text-primary hover:underline" onClick={() => handleRestore(saved)}>恢复</button>
                  <button className="text-xs text-destructive hover:underline" onClick={() => removeSavedResult(saved.id)}>删除</button>
                </div>
              </div>
            )) : <EmptyState>暂无扫描结果存档</EmptyState>}
          </div>
        </Modal>

        {activeTab === 'overview' && directorySnapshots.length > 0 && (
          <div className="flex justify-end">
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => setSnapshotsOpen(true)}>管理扫描快照</button>
          </div>
        )}
        {activeTab === 'overview' && savedResults.length > 0 && (
          <div className="flex justify-end">
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => setResultsOpen(true)}>查看扫描存档（{savedResults.length}）</button>
          </div>
        )}

        {activeTab === 'developer' && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">专项环境探测</h2>
                <p className="text-xs text-muted-foreground">调用只读官方命令，不修改 Docker、WSL 或开发工具数据</p>
              </div>
              <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50" disabled={probing} onClick={() => setSpecialtyProbes([])}>
                {probing ? '探测中…' : '重新探测'}
              </button>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {specialtyProbes.map((probe) => (
                <details key={probe.id} className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">{probe.label}<span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${probe.available ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{probe.available ? '已检测' : '未检测'}</span></summary>
                  <p className="mt-2 text-xs text-muted-foreground">{probe.summary}</p>
                  {probe.details.length > 0 && <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs">{probe.details.join('\n')}</pre>}
                </details>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'cleanup' && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="font-medium">官方清理动作</h2>
            <p className="mt-1 text-xs text-muted-foreground">每次执行都会显示系统确认框、实际命令和影响说明</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {([['docker-build-cache', 'Docker Build Cache', '需要确认'], ['npm-cache', 'npm 缓存', '低风险'], ['pnpm-store', 'pnpm Store', '低风险']] as const).map(([action, label, risk]) => (
                <div key={action} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{risk}</span>
                  </div>
                  <button className="mt-4 w-full rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void window.electronAPI.diskSpace.runCleanup(action, root).then((result) => { if (result.success) setError(`${label} 清理完成`); }).catch((cause) => setError(String(cause)))}>
                    查看影响并执行
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'cleanup' && cleanupAssessments.length > 0 && (
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3">
              <h2 className="font-medium">候选风险与识别依据</h2>
              <p className="text-xs text-muted-foreground">路径扫描仅用于建议；文件夹不会在此处直接删除</p>
            </div>
            {cleanupAssessments.map((item) => (
              <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-3 border-b px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs" title={displayPath(item.path)}>{displayPath(item.path)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.evidence}</p>
                </div>
                <span className="text-right text-sm font-medium">{formatBytes(item.size)}</span>
                <span className={`text-right text-xs font-medium ${item.risk === '低风险' ? 'text-emerald-700' : item.risk === '需要确认' ? 'text-amber-700' : 'text-red-700'}`}>{item.risk}</span>
              </div>
            ))}
          </section>
        )}

        {activeTab === 'doctor' && (
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">AI 磁盘医生</h2>
                <p className="mt-1 text-sm text-muted-foreground">只发送容量、路径和变化摘要，不读取或上传文件内容</p>
              </div>
              <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={diagnosing || stats.files === 0} onClick={() => void generateDiagnosis()}>{diagnosing ? '正在诊断…' : '生成诊断报告'}</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">扫描容量</p><p className="mt-1 font-semibold">{formatBytes(stats.bytes)}</p></div>
              <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">增长来源</p><p className="mt-1 font-semibold">{directoryChanges.filter((item) => item.change > 0).length}</p></div>
              <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">清理候选</p><p className="mt-1 font-semibold">{formatBytes(cleanupTotal)}</p></div>
              <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">重复可释放</p><p className="mt-1 font-semibold">{formatBytes(duplicates.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0))}</p></div>
            </div>
            <div className="mt-5 min-h-[300px] rounded-lg border bg-background p-5">
              {diagnosis ? (
                <XMarkdown content={diagnosis} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />
              ) : (
                <EmptyState>{stats.files ? '点击"生成诊断报告"，分析结果将引用真实扫描证据' : '请先在空间分析中完成一次扫描'}</EmptyState>
              )}
            </div>
          </section>
        )}
        {activeTab === 'doctor' && stats.files > 0 && (
          <div className="flex justify-end gap-2">
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void exportScanReport()}>导出扫描报告</button>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50" disabled={!diagnosis} onClick={() => void window.electronAPI.saveFile(diagnosis, `磁盘医生-${new Date().toISOString().slice(0, 10)}.md`)}>导出诊断 Markdown</button>
          </div>
        )}

        {running && (
          <div className="flex justify-end gap-2">
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => void togglePause()}>{paused ? '继续扫描' : '暂停扫描'}</button>
            <button className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10" onClick={() => void cancelScan()}>停止扫描</button>
          </div>
        )}
        {running && (
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">已运行</p><p className="mt-1 font-semibold">{formatDuration(scanTelemetry.elapsedMs)}</p></div>
              <div><p className="text-xs text-muted-foreground">扫描速度</p><p className="mt-1 font-semibold">{scanTelemetry.elapsedMs ? Math.round(scanTelemetry.files / (scanTelemetry.elapsedMs / 1000)).toLocaleString() : 0} 文件/秒</p></div>
              <div><p className="text-xs text-muted-foreground">目录</p><p className="mt-1 font-semibold">{scanTelemetry.directories.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted-foreground">已读取</p><p className="mt-1 font-semibold">{formatBytes(scanTelemetry.bytes)}</p></div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={displayPath(scanTelemetry.currentPath)}>{phase === 'hashing' ? '正在校验重复文件内容…' : displayPath(scanTelemetry.currentPath)}</span>
              {scanErrors.length > 0 && <button className="text-xs text-destructive underline" onClick={() => setErrorsOpen(true)}>查看 {scanErrors.length} 个问题</button>}
            </div>
          </section>
        )}

        {activeTab === 'analysis' && stats.files > 0 && (
          <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <label className="grid gap-1 text-xs text-muted-foreground">自定义最小容量（GB）<input className="w-40 rounded-md border bg-background px-3 py-2 text-sm text-foreground" type="number" min="0" step="0.1" value={customThresholdGb} placeholder="例如 2.5" onChange={(event) => setCustomThresholdGb(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">文件类型<select className="w-40 rounded-md border bg-background px-3 py-2 text-sm text-foreground" value={largeFileExtension} onChange={(event) => setLargeFileExtension(event.target.value)}><option value="">全部类型</option>{scannedExtensions.map((extension) => <option key={extension} value={extension}>.{extension}</option>)}</select></label>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => { setCustomThresholdGb(''); setLargeFileExtension(''); setLargeFileThreshold(0); }}>重置筛选</button>
          </section>
        )}
        {activeTab === 'analysis' && stats.files > 0 && (
          <div className="flex justify-end gap-1">
            {([['size', '按大小'], ['modified', '按修改时间'], ['extension', '按扩展名']] as const).map(([value, label]) => (
              <button key={value} className={`rounded-md border px-3 py-1.5 text-xs ${largeFileSort === value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`} onClick={() => setLargeFileSort(value)}>{label}</button>
            ))}
          </div>
        )}
        {activeTab === 'analysis' && duplicates.length > 0 && (
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
              <div>
                <h2 className="font-medium">重复文件工作台</h2>
                <p className="text-xs text-muted-foreground">完整哈希并逐字节复核；每组第一项建议保留</p>
              </div>
              <button className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-40" disabled={!scanIdRef.current || selectedDuplicates.length === 0 || running} onClick={async () => {
                const result = await window.electronAPI.diskSpace.trash(scanIdRef.current, selectedDuplicates);
                if (!result.success) return;
                const removed = new Set(result.trashed);
                setDuplicates((current) => current.map((group) => ({ ...group, files: group.files.filter((file) => !removed.has(file.path)) })).filter((group) => group.files.length > 1));
                setSelectedDuplicates([]);
              }}>移入回收站（{selectedDuplicates.length} · {formatBytes(selectedDuplicateBytes)}）</button>
            </div>
            <div className="max-h-[520px] overflow-auto p-4">
              {duplicates.map((group) => (
                <div key={group.groupId} className="mb-3 overflow-hidden rounded-lg border">
                  <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{group.files.length} 个相同文件 · 单个 {formatBytes(group.size)} · 最多释放 {formatBytes(group.size * (group.files.length - 1))}</div>
                  {group.files.map((file, index) => (
                    <label key={file.path} className="grid grid-cols-[24px_minmax(0,1fr)_110px] items-center gap-2 border-t px-3 py-2 text-sm hover:bg-muted/30">
                      <input type="checkbox" disabled={index === 0} checked={selectedDuplicates.includes(file.path)} onChange={() => setSelectedDuplicates((current) => current.includes(file.path) ? current.filter((path) => path !== file.path) : [...current, file.path])} />
                      <span className="truncate font-mono text-xs" title={displayPath(file.path)}>{displayPath(file.path)}{index === 0 && <span className="ml-2 font-sans text-primary">建议保留</span>}</span>
                      <span className="text-right text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'overview' && (diskHistory.length > 0 || directorySnapshots.length > 0) && (
          <section className="flex items-center justify-between rounded-xl border bg-card px-5 py-3 shadow-sm">
            <div className="text-sm">
              <span className="font-medium">本地历史数据</span>
              <span className="ml-3 text-xs text-muted-foreground">磁盘快照 {diskHistory.length} · 目录快照 {directorySnapshots.length}</span>
            </div>
            <button className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={() => clearHistory()}>清空历史</button>
          </section>
        )}
        {(activeTab === 'developer' || activeTab === 'cleanup') && stats.files > 0 && (
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs text-muted-foreground">识别容量</p><p className="mt-1 text-2xl font-semibold">{formatBytes(activeTab === 'developer' ? developerTotal : cleanupTotal)}</p></div>
            <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs text-muted-foreground">候选目录</p><p className="mt-1 text-2xl font-semibold">{(activeTab === 'developer' ? developerItems : cleanupItems).length}</p></div>
            <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs text-muted-foreground">风险策略</p><p className="mt-1 text-base font-semibold">{activeTab === 'cleanup' ? '全部需要人工确认' : '只读分析'}</p></div>
          </section>
        )}
        {activeTab === 'analysis' && stats.files > 0 && (
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-medium">目录容量变化</h2>
                <p className="text-xs text-muted-foreground">与同一目录上一次完整扫描比较</p>
              </div>
              <span className="text-xs text-muted-foreground">保留最近 20 次扫描</span>
            </div>
            {directoryChanges.length ? (
              <div className="max-h-[360px] overflow-auto">
                {directoryChanges.map((item) => (
                  <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_120px_120px] items-center gap-3 border-b px-5 py-2.5 text-sm">
                    <span className="truncate font-mono text-xs" title={displayPath(item.path)}>{displayPath(item.path)}</span>
                    <span className="text-right tabular-nums text-muted-foreground">当前 {formatBytes(item.size)}</span>
                    <span className={`text-right font-medium tabular-nums ${item.change > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{item.change > 0 ? '+' : '−'}{formatBytes(Math.abs(item.change))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">完成同一目录的第二次扫描后，将显示具体增长来源</div>
            )}
          </section>
        )}
        {activeTab === 'analysis' && stats.files > 0 && (
          <section className="max-h-[430px] overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
              <div>
                <h2 className="font-medium">大文件分析</h2>
                <p className="text-xs text-muted-foreground">共显示 {visibleLargest.length} 个文件</p>
              </div>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {([[0, '全部'], [1024 ** 3, '> 1 GB'], [5 * 1024 ** 3, '> 5 GB'], [10 * 1024 ** 3, '> 10 GB']] as const).map(([value, label]) => (
                  <button key={label} className={`rounded-md px-3 py-1.5 text-xs ${largeFileThreshold === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setLargeFileThreshold(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="max-h-[360px] overflow-auto">
              {visibleLargest.length ? visibleLargest.map((file) => (
                <button key={file.path} className="grid w-full grid-cols-[minmax(0,1fr)_110px_150px] items-center gap-3 border-b px-5 py-2.5 text-left text-sm hover:bg-muted/40" onClick={() => void openPreview({ name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path, path: file.path, type: 'file', size: file.size, modifiedAt: file.modifiedAt, extension: file.extension })}>
                  <span className="truncate font-mono text-xs" title={displayPath(file.path)}>{displayPath(file.path)}</span>
                  <span className="text-right font-medium tabular-nums">{formatBytes(file.size)}</span>
                  <span className="text-right text-xs text-muted-foreground">{new Date(file.modifiedAt).toLocaleDateString()}</span>
                </button>
              )) : <div className="py-12 text-center text-sm text-muted-foreground">没有符合当前大小条件的文件</div>}
            </div>
          </section>
        )}
        {activeTab === 'overview' && (
          <section className="h-[300px] overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-medium">磁盘使用趋势</h2>
                <p className="text-xs text-muted-foreground">每小时记录一次，最多保留最近 7 天</p>
              </div>
              <span className="text-xs text-muted-foreground">{diskHistory.length} 个快照</span>
            </div>
            <div className="h-[245px]">{diskHistory.length ? <Chart option={historyOption} className="h-full w-full" /> : <EmptyState>首次记录后将在这里显示磁盘变化</EmptyState>}</div>
          </section>
        )}
        {(activeTab === 'developer' || activeTab === 'cleanup') && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{activeTab === 'developer' ? '开发环境占用' : '可清理候选项'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{activeTab === 'developer' ? '根据 Rust 扫描结果识别常见开发工具、缓存和构建产物。' : '仅提供检查建议，不会自动删除任何文件。'}</p>
              </div>
              <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root || running} onClick={() => void start(isFocusedTab)}>{stats.files ? '重新扫描' : '开始扫描'}</button>
            </div>
            {!root && <button className="mt-5 flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void choose()}><FolderOpen className="h-4 w-4" />选择分析目录</button>}
            <div className="mt-5 space-y-2">
              {(activeTab === 'developer' ? developerItems : cleanupItems).map((item) => (
                <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 rounded-lg border px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{displayPath(item.path)}</p>
                  </div>
                  <span className="text-right font-medium tabular-nums">{formatBytes(item.size)}</span>
                  <span className={`rounded-full px-2 py-1 text-xs ${activeTab === 'cleanup' ? 'bg-amber-500/10 text-amber-700' : 'bg-primary/10 text-primary'}`}>{activeTab === 'cleanup' ? '需要确认' : '开发资源'}</span>
                </div>
              ))}
              {stats.files > 0 && (activeTab === 'developer' ? developerItems : cleanupItems).length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">当前扫描范围内未发现匹配项</div>}
              {stats.files === 0 && <div className="py-12 text-center text-sm text-muted-foreground">选择目录并扫描后生成分析结果</div>}
            </div>
          </section>
        )}
        {activeTab === 'overview' && system && (
          <section className="grid gap-4 xl:grid-cols-2">
            {system.disks.map((disk, index) => (
              <UsageCard key={disk.path} title={`${disk.path} ${index === 0 ? '系统磁盘' : '本地磁盘'}`} subtitle={`${system.hostname} · ${system.platform}`} used={disk.used} total={disk.total} color={index === 0 ? '#7c3aed' : '#2563eb'} />
            ))}
            <UsageCard title="物理内存" subtitle="实时内存占用" used={system.memory.used} total={system.memory.total} color="#0891b2" />
          </section>
        )}
        {activeTab !== 'overview' && (
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex gap-2">
              <button className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void choose()}><FolderOpen className="h-4 w-4" />选择目录</button>
              <div className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm" title={root}>{root || '选择目录后可浏览与分析'}</div>
              {activeTab === 'analysis' && (running ? (
                <button className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm" onClick={() => void cancelScan()}><Square className="h-4 w-4" />停止</button>
              ) : (
                <button className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={() => void start(isFocusedTab)}>分析占用</button>
              ))}
            </div>
            {activeTab === 'analysis' && (
              <label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm">
                <span className="text-muted-foreground">排除目录</span>
                <input className="rounded-md border bg-background px-3 py-2" value={exclusionsText} disabled={running} onChange={(event) => setExclusionsText(event.target.value)} />
              </label>
            )}
          </section>
        )}
        {running && <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {root && (
          <section className="grid min-h-[520px] overflow-hidden rounded-2xl border bg-card shadow-sm xl:grid-cols-[minmax(380px,42%)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-r">
              <div className="flex h-12 items-center gap-2 border-b px-3">
                <button className="rounded p-1.5 hover:bg-accent disabled:opacity-30" disabled={!parentDirectory} onClick={() => parentDirectory && void loadDirectory(parentDirectory)}>
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </button>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={currentDirectory}>{displayPath(currentDirectory)}</span>
                <span className="text-xs text-muted-foreground">{entries.length} 项</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {browserLoading && !preview ? <EmptyState><Loader2 className="mr-2 h-4 w-4" />加载中</EmptyState> : entries.map((entry: DiskDirectoryItem) => (
                  <button key={entry.path} className={`grid w-full grid-cols-[24px_minmax(0,1fr)_90px] items-center gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted/40 ${preview?.path === entry.path ? 'bg-primary/5' : ''}`} onDoubleClick={() => void openPreview(entry)} onClick={() => entry.type === 'file' && void openPreview(entry)}>
                    {entry.type === 'directory' ? <FolderOpen className="h-4 w-4 text-amber-500" /> : entry.extension.match(/png|jpg|jpeg|gif|webp|svg/) ? <Image className="h-4 w-4 text-sky-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                    <span className="truncate">{entry.name}</span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">{entry.type === 'directory' ? '文件夹' : formatBytes(entry.size)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-col bg-muted/10">
              <div className="flex h-12 items-center justify-between border-b px-4">
                <span className="truncate text-sm font-medium">{preview?.name || '文件预览'}</span>
                {preview && (
                  <button className="rounded p-1.5 hover:bg-accent" title="使用默认应用打开" onClick={() => void window.electronAPI.diskSpace.open(scanIdRef.current, preview.path)}>
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {!preview ? (
                  <EmptyState>在左侧选择文件查看安全预览</EmptyState>
                ) : preview.kind === 'image' && preview.content ? (
                  <div className="flex items-center justify-center"><img className="max-h-full max-w-full rounded-lg object-contain" src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.name} /></div>
                ) : preview.kind === 'text' && /\.md(?:own)?$/i.test(preview.name) ? (
                  <XMarkdown content={preview.content || '_(空文档)_'} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />
                ) : preview.kind === 'text' ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{preview.content}</pre>
                ) : (
                  <EmptyState>{preview.message}</EmptyState>
                )}
              </div>
            </div>
          </section>
        )}
        {(running || stats.files > 0) && (
          <>
            <section className="grid grid-cols-3 gap-3">
              {([['文件', stats.files.toLocaleString()], ['已扫描容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>
              ))}
            </section>
            <section className="grid gap-4 xl:grid-cols-2">
              <article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">文件类型占用</h2>{extensionData.length ? <Chart option={extensionOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article>
              <article className="h-[330px] rounded-xl border bg-card"><h2 className="border-b px-4 py-3 font-medium">目录占用排行</h2>{directoryData.length ? <Chart option={directoryOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}</article>
            </section>
            <section className="max-h-[420px] overflow-auto rounded-xl border bg-card">
              <h2 className="sticky top-0 border-b bg-card px-4 py-3 font-medium">最大文件 <span className="text-xs text-muted-foreground">前 50</span></h2>
              {largest.map((file) => (
                <button key={file.path} className="grid w-full grid-cols-[minmax(0,1fr)_100px] gap-3 border-b px-4 py-2 text-left text-sm hover:bg-muted/40" onClick={() => void openPreview({ name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path, path: file.path, type: 'file', size: file.size, modifiedAt: file.modifiedAt, extension: file.extension })}>
                  <span className="truncate font-mono text-xs">{displayPath(file.path)}</span>
                  <span className="text-right text-muted-foreground">{formatBytes(file.size)}</span>
                </button>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// 避免未使用变量警告
export type { DiskHistoryPoint, FileEntry, PersistedScanResult, ScanTelemetry, DirectoryEntry };
