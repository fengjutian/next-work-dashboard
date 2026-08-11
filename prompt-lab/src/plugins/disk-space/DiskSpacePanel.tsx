import { useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { XMarkdown } from '@ant-design/x-markdown';
import type { DiskDirectoryItem, DiskSpecialtyProbe } from '@/types/electron';
import { ExternalLink, FolderOpen, HardDrive, Loader2, RefreshCw } from '@/components/icons';
import { createOpenAIProvider } from '../../core/llm';
import { useStore } from '../../store/store';
import {
  useDiskScan,
  displayPath,
  type DirectoryEntry,
  type FileEntry,
  type ScanErrorItem,
  type ScanTelemetry,
  type PersistedScanResult,
} from './hooks/useDiskScan';
import { Chart, EmptyState } from './tabs/components';
import {
  buildDirectoryTree,
  compactDirectoryCandidates,
  formatBytes,
  formatDuration,
  type TreemapNode,
} from './tabs/helpers';
import { AnalysisTab } from './tabs/AnalysisTab';
import { BrowserTab } from './tabs/BrowserTab';
import { CleanupTab } from './tabs/CleanupTab';
import { DeveloperTab } from './tabs/DeveloperTab';
import { DoctorTab } from './tabs/DoctorTab';
import { OverviewTab } from './tabs/OverviewTab';
import { VirtualList } from './tabs/VirtualList';
import type { ActiveTab, DirectoryChange, ScanSummary } from './tabs/shared';

// ---------------- Panel ----------------

export function DiskSpacePanel() {
  const aiApi = useStore((state) => state.aiApi);
  const scan = useDiskScan();

  // UI-only state（不属于扫描状态机）
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
    setPreview, scanIdRef, rootRef, running, paused, phase,
    scanTelemetry, scanErrors, stats, largest, duplicates, extensions, directories,
    directorySnapshots, savedResults, usnInfo, usnDelta, exclusionsText, setExclusionsText,
    error, setError, refreshSystem, choose, pickRoot, start, cancelScan, togglePause,
    loadDirectory, openPreview, restoreSavedResult, removeSavedResult,
    removeDirectorySnapshot, clearHistory, setRunning, setPaused, setScanErrors,
    setBrowserLoading, setEntries, setDuplicates,
    cleanupStatus, runCleanup, clearCleanupStatus,
    directorySnapshotData,
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

  // cleanup 完成后自动重扫
  const isFocusedTab = activeTab === 'developer' || activeTab === 'cleanup';
  useEffect(() => {
    if (cleanupStatus.kind !== 'success' || activeTab !== 'cleanup') return;
    setSpecialtyProbes([]);
    void refreshSystem();
    if (root && !running) void start(isFocusedTab);
    clearCleanupStatus();
  }, [cleanupStatus, activeTab, root, running, refreshSystem, start, isFocusedTab, clearCleanupStatus]);

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
        })
        .catch((cause) => setError(String(cause)))
        .finally(() => setBrowserLoading(false));
    };
    window.addEventListener('disk-space:navigate', navigate);
    return () => window.removeEventListener('disk-space:navigate', navigate);
  }, [rootRef, setEntries, setError, setPreview]);

  // 共享派生数据
  const extensionData = useMemo<Array<[string, number]>>(
    () => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10),
    [extensions],
  );
  const extensionOption = useMemo(() => ({
    color: ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777'],
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${formatBytes(p.value)} · ${p.percent}%` },
    series: [{
      type: 'pie', radius: ['48%', '76%'], center: ['42%', '50%'],
      itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
      label: { color: '#746075', formatter: '{b}\n{d}%' },
      data: extensionData.map(([name, value]) => ({ name, value })),
    }],
  }), [extensionData]);
  const directoryData = useMemo<TreemapNode[]>(
    () => buildDirectoryTree(directories, root),
    [directories, root],
  );
  const directoryOption = useMemo(() => ({
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
  }), [directoryData]);
  const developerItems = useMemo<DirectoryEntry[]>(
    () => compactDirectoryCandidates(directories, /^(?:node_modules|\.pnpm-store|\.npm|\.yarn|\.cargo|target|\.gradle|\.m2|docker|wsl|ollama|__pycache__)$/i),
    [directories],
  );
  const cleanupItems = useMemo<DirectoryEntry[]>(
    () => compactDirectoryCandidates(directories, /^(?:cache|caches|temp|tmp|logs?|node_modules|target|dist|build|__pycache__)$/i),
    [directories],
  );
  const historyOption = useMemo(() => {
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
  const visibleLargest = useMemo<FileEntry[]>(() => {
    const custom = Number(customThresholdGb);
    const threshold = Number.isFinite(custom) && custom > 0 ? custom * 1024 ** 3 : largeFileThreshold;
    return largest
      .filter((file) => file.size >= threshold && (!largeFileExtension || file.extension.toLowerCase() === largeFileExtension))
      .sort((a, b) => (largeFileSort === 'modified' ? b.modifiedAt - a.modifiedAt : largeFileSort === 'extension' ? a.extension.localeCompare(b.extension) : b.size - a.size));
  }, [customThresholdGb, largeFileExtension, largeFileSort, largeFileThreshold, largest]);
  const scannedExtensions = useMemo<string[]>(
    () => [...new Set(largest.map((file) => file.extension).filter(Boolean))].sort(),
    [largest],
  );
  const developerTotal = useMemo(() => developerItems.reduce((sum, item) => sum + item.size, 0), [developerItems]);
  const cleanupTotal = useMemo(() => cleanupItems.reduce((sum, item) => sum + item.size, 0), [cleanupItems]);
  const cleanupAssessments = useMemo(() =>
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
      } as { path: string; size: number; risk: '低风险' | '需要确认' | '仅建议检查'; evidence: string };
    }),
    [cleanupItems],
  );
  const selectedDuplicateBytes = useMemo(
    () => duplicates.flatMap((group) => group.files).filter((file) => selectedDuplicates.includes(file.path)).reduce((sum, file) => sum + file.size, 0),
    [duplicates, selectedDuplicates],
  );
  const directoryChanges = useMemo<DirectoryChange[]>(() => {
    const matching = directorySnapshotData
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
  }, [directorySnapshotData, root]);

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
  const handleRestore = async (id: string) => {
    await restoreSavedResult(id);
    setResultsOpen(false);
    setActiveTab('analysis');
  };

  // parentDirectory 给 BrowserTab 用
  const parentDirectory =
    currentDirectory && currentDirectory !== root
      ? currentDirectory.replace(/[\\/][^\\/]+[\\/]?$/, '')
      : '';

  const summary: ScanSummary = {
    extensionData,
    extensionOption,
    directoryData,
    directoryOption,
    developerItems,
    cleanupItems,
    developerTotal,
    cleanupTotal,
    historyOption,
    visibleLargest,
    scannedExtensions,
    selectedDuplicateBytes,
    cleanupAssessments,
    directoryChanges,
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background p-5">
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <HardDrive className="h-5 w-5" />磁盘空间
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">系统资源概览、目录分析与安全文件预览</p>
          </div>
          <button
            className="rounded-md border p-2 hover:bg-accent"
            title="刷新系统信息"
            onClick={() => void refreshSystem()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </header>
        <style>{`section:has(> .border-r) { display: ${activeTab === 'browser' ? 'grid' : 'none'} !important; grid-template-columns: minmax(0, 1fr) !important; } section:has(> .border-r) > div:last-child { display: none !important; } section:has(> h2.sticky) { display: none !important; } ${activeTab !== 'analysis' ? 'section:has(> .border-r) ~ section { display: none !important; }' : ''}`}</style>
        <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-sm" aria-label="磁盘空间功能">
          {([['overview', '资源概览'], ['browser', '目录浏览'], ['analysis', '空间分析'], ['developer', '开发者空间'], ['cleanup', '清理建议'], ['doctor', '磁盘医生']] as const).map(([id, label]) => (
            <button
              key={id}
              className={`shrink-0 rounded-lg px-5 py-2 text-sm transition-colors ${activeTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              onClick={() => setActiveTab(id as ActiveTab)}
            >
              {label}
            </button>
          ))}
        </nav>
        {root && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`rounded-full px-2 py-1 ${usnInfo?.supported ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted'}`}>
              {usnInfo?.supported ? `NTFS USN 已启用 · ${usnInfo.method === 'native' ? '原生 API' : '兼容模式'}` : '标准优化扫描'}
            </span>
            {usnInfo?.supported && usnInfo.volume && (
              <span>{usnInfo.volume} Journal · Next USN {usnInfo.nextUsn?.toLocaleString()}</span>
            )}
            {usnInfo?.error && <span title={usnInfo.error}>USN 不可用</span>}
          </div>
        )}
        {usnInfo?.supported && usnDelta !== null && (
          <div className="text-xs text-muted-foreground">相对上次记录，USN 游标前进 {usnDelta.toLocaleString()} 字节；Journal ID 变化时会自动放弃旧游标并执行完整扫描。</div>
        )}

        <Modal open={Boolean(preview)} title={preview?.name || '文件预览'} width="min(1100px, 92vw)" footer={preview ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}{preview.truncated ? ' · 仅展示前 1 MB' : ''}
            </span>
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
              <div key={snapshot.id} className="grid grid-cols-[minmax(0,1fr)_170px_80px] items-center gap-3 border-b py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{displayPath(snapshot.root)}</p>
                  <p className="text-xs text-muted-foreground">记录 {snapshot.directoryCount} 个主要目录</p>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(snapshot.timestamp).toLocaleString()}</span>
                <button className="text-xs text-destructive hover:underline" onClick={() => void removeDirectorySnapshot(snapshot.id)}>删除</button>
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
                <span className="text-right text-xs">{saved.duplicates} 组重复</span>
                <span className="text-xs text-muted-foreground">{new Date(saved.savedAt).toLocaleString()}</span>
                <div className="flex justify-end gap-2">
                  <button className="text-xs text-primary hover:underline" onClick={() => void handleRestore(saved.id)}>恢复</button>
                  <button className="text-xs text-destructive hover:underline" onClick={() => void removeSavedResult(saved.id)}>删除</button>
                </div>
              </div>
            )) : <EmptyState>暂无扫描结果存档</EmptyState>}
          </div>
        </Modal>

        {activeTab === 'overview' && (
          <OverviewTab
            scan={scan}
            historyOption={summary.historyOption}
            onOpenSnapshots={() => setSnapshotsOpen(true)}
            onOpenResults={() => setResultsOpen(true)}
          />
        )}
        {activeTab === 'browser' && (
          <BrowserTab
            scan={scan}
            preview={preview}
            setPreview={setPreview}
            openPreview={openPreview}
            parentDirectory={parentDirectory}
            loadDirectory={loadDirectory}
            showAnalysisControls={false}
            isFocusedTab={isFocusedTab}
            start={start}
            cancelScan={cancelScan}
            choose={choose}
          />
        )}
        {activeTab === 'analysis' && (
          <BrowserTab
            scan={scan}
            preview={preview}
            setPreview={setPreview}
            openPreview={openPreview}
            parentDirectory={parentDirectory}
            loadDirectory={loadDirectory}
            showAnalysisControls={true}
            isFocusedTab={isFocusedTab}
            start={start}
            cancelScan={cancelScan}
            choose={choose}
          />
        )}
        {activeTab === 'analysis' && (
          <AnalysisTab
            scan={scan}
            selectedDuplicates={selectedDuplicates}
            setSelectedDuplicates={setSelectedDuplicates}
            largeFileThreshold={largeFileThreshold}
            setLargeFileThreshold={setLargeFileThreshold}
            customThresholdGb={customThresholdGb}
            setCustomThresholdGb={setCustomThresholdGb}
            largeFileExtension={largeFileExtension}
            setLargeFileExtension={setLargeFileExtension}
            largeFileSort={largeFileSort}
            setLargeFileSort={setLargeFileSort}
            visibleLargest={summary.visibleLargest}
            scannedExtensions={summary.scannedExtensions}
            directoryChanges={summary.directoryChanges}
            selectedDuplicateBytes={summary.selectedDuplicateBytes}
            openPreview={openPreview}
          />
        )}
        {activeTab === 'developer' && (
          <DeveloperTab
            scan={scan}
            developerItems={summary.developerItems}
            developerTotal={summary.developerTotal}
            isFocusedTab={isFocusedTab}
            specialtyProbes={specialtyProbes}
            probing={probing}
            setSpecialtyProbes={setSpecialtyProbes}
            setProbing={setProbing}
            start={start}
            pickRoot={pickRoot}
          />
        )}
        {activeTab === 'cleanup' && (
          <CleanupTab
            scan={scan}
            cleanupItems={summary.cleanupItems}
            cleanupTotal={summary.cleanupTotal}
            cleanupAssessments={summary.cleanupAssessments}
            isFocusedTab={isFocusedTab}
            cleanupStatus={cleanupStatus}
            runCleanup={runCleanup}
            clearCleanupStatus={clearCleanupStatus}
            start={start}
            pickRoot={pickRoot}
          />
        )}
        {activeTab === 'doctor' && (
          <DoctorTab
            scan={scan}
            diagnosis={diagnosis}
            setDiagnosis={setDiagnosis}
            diagnosing={diagnosing}
            setDiagnosing={setDiagnosing}
            generateDiagnosis={generateDiagnosis}
            exportScanReport={exportScanReport}
            directoryChanges={summary.directoryChanges}
            cleanupTotal={summary.cleanupTotal}
          />
        )}

        {running && (
          <div className="flex justify-end gap-2">
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={() => void togglePause()}>
              {paused ? '继续扫描' : '暂停扫描'}
            </button>
            <button
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              onClick={() => void cancelScan()}
            >
              停止扫描
            </button>
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
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={displayPath(scanTelemetry.currentPath)}>
                {phase === 'hashing' ? '正在校验重复文件内容…' : displayPath(scanTelemetry.currentPath)}
              </span>
              {scanErrors.length > 0 && (
                <button className="text-xs text-destructive underline" onClick={() => setErrorsOpen(true)}>
                  查看 {scanErrors.length} 个问题
                </button>
              )}
            </div>
          </section>
        )}

        {running && <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />{phase === 'hashing' ? '正在校验重复文件内容…' : '正在扫描目录…'}</div>}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {(running || stats.files > 0) && (
          <>
            <section className="grid grid-cols-3 gap-3">
              {([['文件', stats.files.toLocaleString()], ['已扫描容量', formatBytes(stats.bytes)], ['读取失败', stats.errors.toLocaleString()]] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-card p-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold">{value}</div>
                </div>
              ))}
            </section>
            <section className="grid gap-4 xl:grid-cols-2">
              <article className="h-[330px] rounded-xl border bg-card">
                <h2 className="border-b px-4 py-3 font-medium">文件类型占用</h2>
                {extensionData.length ? <Chart option={summary.extensionOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}
              </article>
              <article className="h-[330px] rounded-xl border bg-card">
                <h2 className="border-b px-4 py-3 font-medium">目录占用排行</h2>
                {directoryData.length ? <Chart option={summary.directoryOption} className="h-[280px] w-full" /> : <EmptyState>等待扫描数据</EmptyState>}
              </article>
            </section>
            <section className="h-[420px] rounded-xl border bg-card">
              <h2 className="border-b bg-card px-4 py-3 font-medium">最大文件 <span className="text-xs text-muted-foreground">前 50</span></h2>
              <VirtualList
                items={largest}
                itemSize={38}
                height={380}
                renderItem={(file) => (
                  <button
                    className="grid h-[38px] w-full grid-cols-[minmax(0,1fr)_100px] items-center gap-3 border-b px-4 text-left text-sm hover:bg-muted/40"
                    onClick={() =>
                      void openPreview({
                        name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path,
                        path: file.path,
                        type: 'file',
                        size: file.size,
                        modifiedAt: file.modifiedAt,
                        extension: file.extension,
                      })
                    }
                  >
                    <span className="truncate font-mono text-xs">{displayPath(file.path)}</span>
                    <span className="text-right text-muted-foreground">{formatBytes(file.size)}</span>
                  </button>
                )}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export type { FileEntry, DirectoryEntry, ScanTelemetry, PersistedScanResult };
