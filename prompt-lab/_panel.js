import __vite__cjsImport0_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=ddcc1c25"; const Fragment = __vite__cjsImport0_react_jsxDevRuntime["Fragment"]; const jsxDEV = __vite__cjsImport0_react_jsxDevRuntime["jsxDEV"];
import __vite__cjsImport1_react from "/node_modules/.vite/deps/react.js?v=59b6f232"; const useEffect = __vite__cjsImport1_react["useEffect"]; const useMemo = __vite__cjsImport1_react["useMemo"]; const useState = __vite__cjsImport1_react["useState"];
import { Modal } from "/node_modules/.vite/deps/antd.js?v=31805f61";
import { XMarkdown } from "/node_modules/.vite/deps/@ant-design_x-markdown.js?v=143553d2";
import { ExternalLink, HardDrive, Loader2, RefreshCw } from "/src/components/icons.tsx";
import { createOpenAIProvider } from "/src/core/llm.ts";
import { useStore } from "/src/store/store.ts";
import {
  useDiskScan,
  displayPath
} from "/src/plugins/disk-space/hooks/useDiskScan.ts";
import { Chart, EmptyState } from "/src/plugins/disk-space/tabs/components.tsx";
import {
  buildDirectoryTree,
  compactDirectoryCandidates,
  formatBytes,
  formatDuration
} from "/src/plugins/disk-space/tabs/helpers.ts";
import { AnalysisTab } from "/src/plugins/disk-space/tabs/AnalysisTab.tsx";
import { BrowserTab } from "/src/plugins/disk-space/tabs/BrowserTab.tsx";
import { CleanupTab } from "/src/plugins/disk-space/tabs/CleanupTab.tsx";
import { DeveloperTab } from "/src/plugins/disk-space/tabs/DeveloperTab.tsx";
import { DoctorTab } from "/src/plugins/disk-space/tabs/DoctorTab.tsx";
import { OverviewTab } from "/src/plugins/disk-space/tabs/OverviewTab.tsx";
import { VirtualList } from "/src/plugins/disk-space/tabs/VirtualList.tsx";
export function DiskSpacePanel() {
  const aiApi = useStore((state) => state.aiApi);
  const scan = useDiskScan();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedDuplicates, setSelectedDuplicates] = useState([]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [specialtyProbes, setSpecialtyProbes] = useState([]);
  const [probing, setProbing] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [largeFileThreshold, setLargeFileThreshold] = useState(0);
  const [customThresholdGb, setCustomThresholdGb] = useState("");
  const [largeFileExtension, setLargeFileExtension] = useState("");
  const [largeFileSort, setLargeFileSort] = useState("size");
  const {
    system,
    diskHistory,
    root,
    currentDirectory,
    entries,
    preview,
    browserLoading,
    setPreview,
    scanIdRef,
    rootRef,
    running,
    paused,
    phase,
    scanTelemetry,
    scanErrors,
    stats,
    largest,
    duplicates,
    extensions,
    directories,
    directorySnapshots,
    savedResults,
    usnInfo,
    usnDelta,
    exclusionsText,
    setExclusionsText,
    error,
    setError,
    refreshSystem,
    choose,
    start,
    cancelScan,
    togglePause,
    loadDirectory,
    openPreview,
    restoreSavedResult,
    removeSavedResult,
    removeDirectorySnapshot,
    clearHistory,
    setRunning,
    setPaused,
    setScanErrors,
    setBrowserLoading,
    setEntries,
    setDuplicates,
    cleanupStatus,
    runCleanup,
    clearCleanupStatus,
    directorySnapshotData
  } = scan;
  useEffect(() => {
    setError("");
  }, [activeTab, setError]);
  useEffect(() => {
    if (activeTab !== "developer" || specialtyProbes.length > 0 || probing) return;
    setProbing(true);
    void window.electronAPI.diskSpace.probeSpecialties().then(setSpecialtyProbes).catch((cause) => setError(String(cause))).finally(() => setProbing(false));
  }, [activeTab, probing, specialtyProbes.length, setError]);
  const isFocusedTab = activeTab === "developer" || activeTab === "cleanup";
  useEffect(() => {
    if (cleanupStatus.kind !== "success" || activeTab !== "cleanup") return;
    setSpecialtyProbes([]);
    void refreshSystem();
    if (root && !running) void start(isFocusedTab);
    clearCleanupStatus();
  }, [cleanupStatus, activeTab, root, running, refreshSystem, start, isFocusedTab, clearCleanupStatus]);
  useEffect(() => {
    const navigate = (event) => {
      const directory = event.detail;
      if (!directory || !rootRef.current) return;
      setActiveTab("browser");
      setBrowserLoading(true);
      setPreview(null);
      void window.electronAPI.diskSpace.listDirectory(rootRef.current, directory).then((items) => {
        setEntries(items);
      }).catch((cause) => setError(String(cause))).finally(() => setBrowserLoading(false));
    };
    window.addEventListener("disk-space:navigate", navigate);
    return () => window.removeEventListener("disk-space:navigate", navigate);
  }, [rootRef, setEntries, setError, setPreview]);
  const extensionData = useMemo(
    () => Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 10),
    [extensions]
  );
  const extensionOption = useMemo(() => ({
    color: ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#dc2626", "#db2777"],
    tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>${formatBytes(p.value)} · ${p.percent}%` },
    series: [{
      type: "pie",
      radius: ["48%", "76%"],
      center: ["42%", "50%"],
      itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: "transparent" },
      label: { color: "#746075", formatter: "{b}\n{d}%" },
      data: extensionData.map(([name, value]) => ({ name, value }))
    }]
  }), [extensionData]);
  const directoryData = useMemo(
    () => buildDirectoryTree(directories, root),
    [directories, root]
  );
  const directoryOption = useMemo(() => ({
    tooltip: { formatter: (item) => `${item.name}<br/>${formatBytes(item.value)}<br/>${displayPath(item.data?.path || "")}` },
    series: [{
      type: "treemap",
      roam: true,
      nodeClick: "zoomToNode",
      breadcrumb: { show: true, height: 26 },
      label: { show: true, formatter: (item) => `${item.name}
${formatBytes(item.value)}` },
      upperLabel: { show: true, height: 24 },
      itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 },
      levels: [
        { itemStyle: { borderWidth: 0, gapWidth: 3 } },
        { colorSaturation: [0.35, 0.75], upperLabel: { show: true }, itemStyle: { gapWidth: 2, borderWidth: 1 } },
        { colorSaturation: [0.25, 0.65], itemStyle: { gapWidth: 1 } }
      ],
      data: directoryData
    }]
  }), [directoryData]);
  const developerItems = useMemo(
    () => compactDirectoryCandidates(directories, /^(?:node_modules|\.pnpm-store|\.npm|\.yarn|\.cargo|target|\.gradle|\.m2|docker|wsl|ollama|__pycache__)$/i),
    [directories]
  );
  const cleanupItems = useMemo(
    () => compactDirectoryCandidates(directories, /^(?:cache|caches|temp|tmp|logs?|node_modules|target|dist|build|__pycache__)$/i),
    [directories]
  );
  const historyOption = useMemo(() => {
    const diskNames = [...new Set(diskHistory.flatMap((point) => point.disks.map((disk) => disk.path)))];
    return {
      color: ["#7c3aed", "#2563eb", "#0891b2", "#059669"],
      tooltip: { trigger: "axis", formatter: (items) => items.map((item) => `${item.seriesName}：${formatBytes(item.value)}`).join("<br/>") },
      legend: { top: 4, data: diskNames },
      grid: { left: 16, right: 22, top: 42, bottom: 22, containLabel: true },
      xAxis: { type: "category", boundaryGap: false, data: diskHistory.map((point) => new Date(point.timestamp).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit" })), axisLabel: { color: "#746075" } },
      yAxis: { type: "value", axisLabel: { color: "#746075", formatter: (value) => formatBytes(value) }, splitLine: { lineStyle: { color: "rgba(127,127,127,.12)" } } },
      series: diskNames.map((name) => ({
        name,
        type: "line",
        smooth: true,
        showSymbol: diskHistory.length < 12,
        areaStyle: { opacity: 0.06 },
        data: diskHistory.map((point) => point.disks.find((disk) => disk.path === name)?.used ?? null)
      }))
    };
  }, [diskHistory]);
  const visibleLargest = useMemo(() => {
    const custom = Number(customThresholdGb);
    const threshold = Number.isFinite(custom) && custom > 0 ? custom * 1024 ** 3 : largeFileThreshold;
    return largest.filter((file) => file.size >= threshold && (!largeFileExtension || file.extension.toLowerCase() === largeFileExtension)).sort((a, b) => largeFileSort === "modified" ? b.modifiedAt - a.modifiedAt : largeFileSort === "extension" ? a.extension.localeCompare(b.extension) : b.size - a.size);
  }, [customThresholdGb, largeFileExtension, largeFileSort, largeFileThreshold, largest]);
  const scannedExtensions = useMemo(
    () => [...new Set(largest.map((file) => file.extension).filter(Boolean))].sort(),
    [largest]
  );
  const developerTotal = useMemo(() => developerItems.reduce((sum, item) => sum + item.size, 0), [developerItems]);
  const cleanupTotal = useMemo(() => cleanupItems.reduce((sum, item) => sum + item.size, 0), [cleanupItems]);
  const cleanupAssessments = useMemo(
    () => cleanupItems.map((item) => {
      const name = displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() || "";
      const lowRisk = /^(?:cache|caches|temp|tmp|logs?|__pycache__)$/.test(name);
      const mediumRisk = /^(?:target|dist|build)$/.test(name);
      return {
        ...item,
        risk: lowRisk ? "低风险" : mediumRisk ? "需要确认" : "仅建议检查",
        evidence: lowRisk ? "常见缓存、临时文件或日志目录" : mediumRisk ? "可由构建工具重新生成，但重新构建需要时间" : "可能包含项目依赖或用户仍在使用的数据"
      };
    }),
    [cleanupItems]
  );
  const selectedDuplicateBytes = useMemo(
    () => duplicates.flatMap((group) => group.files).filter((file) => selectedDuplicates.includes(file.path)).reduce((sum, file) => sum + file.size, 0),
    [duplicates, selectedDuplicates]
  );
  const directoryChanges = useMemo(() => {
    const matching = directorySnapshotData.filter((snapshot) => displayPath(snapshot.root).toLowerCase() === displayPath(root).toLowerCase()).slice(-2);
    if (matching.length < 2) return [];
    const [previous, current] = matching;
    const before = new Map(previous.directories.map((item) => [displayPath(item.path).toLowerCase(), item]));
    const after = new Map(current.directories.map((item) => [displayPath(item.path).toLowerCase(), item]));
    return [.../* @__PURE__ */ new Set([...before.keys(), ...after.keys()])].map((key) => {
      const oldItem = before.get(key);
      const newItem = after.get(key);
      return { path: newItem?.path ?? oldItem.path, size: newItem?.size ?? 0, change: (newItem?.size ?? 0) - (oldItem?.size ?? 0) };
    }).filter((item) => Math.abs(item.change) >= 1024 * 1024).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 20);
  }, [directorySnapshotData, root]);
  const generateDiagnosis = async () => {
    const evidence = {
      root,
      scanned: stats,
      largest: largest.slice(0, 10).map((file) => ({ path: displayPath(file.path), size: formatBytes(file.size) })),
      growth: directoryChanges.slice(0, 10).map((item) => ({ path: displayPath(item.path), change: `${item.change > 0 ? "+" : "-"}${formatBytes(Math.abs(item.change))}` })),
      cleanup: cleanupItems.slice(0, 10).map((item) => ({ path: displayPath(item.path), size: formatBytes(item.size), risk: "需要确认" })),
      duplicates: { groups: duplicates.length, reclaimable: formatBytes(duplicates.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0)) }
    };
    const local = `## 本地诊断

- 扫描范围：${root || "尚未选择"}
- 已扫描：${stats.files.toLocaleString()} 个文件，共 ${formatBytes(stats.bytes)}
- 清理候选：${cleanupItems.length} 项，约 ${formatBytes(cleanupTotal)}（全部需要确认）
- 重复文件：${duplicates.length} 组

请先完成扫描；配置 AI 后可生成带证据的原因分析和清理顺序。`;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) {
      setDiagnosis(local);
      return;
    }
    setDiagnosing(true);
    setDiagnosis("");
    try {
      const provider = createOpenAIProvider({ apiKey: aiApi.apiKey, baseUrl: aiApi.baseUrl });
      const messages = [
        { role: "system", content: "你是本地磁盘诊断助手。只依据给定 JSON 证据分析，不得臆测。使用中文 Markdown，依次给出：容量结论、增长来源、按风险排序的清理建议、预计释放空间。每条结论必须引用具体路径和容量；清理候选均需人工确认，不建议删除系统目录。" },
        { role: "user", content: JSON.stringify(evidence) }
      ];
      let text = "";
      for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.2, maxTokens: 1800, stream: true })) {
        if (chunk.delta) {
          text += chunk.delta;
          setDiagnosis(text);
        }
      }
    } catch (cause) {
      setDiagnosis(`${local}

> AI 诊断失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDiagnosing(false);
    }
  };
  const exportScanReport = async () => {
    const content = `# 磁盘扫描报告

- 扫描范围：${displayPath(root)}
- 文件数量：${stats.files.toLocaleString()}
- 扫描容量：${formatBytes(stats.bytes)}
- 读取问题：${stats.errors}
- 重复文件组：${duplicates.length}
- 清理候选：${formatBytes(cleanupTotal)}

## 最大文件

${largest.slice(0, 30).map((file) => `- ${formatBytes(file.size)} · \`${displayPath(file.path)}\``).join("\n")}

## 目录变化

${directoryChanges.map((item) => `- ${item.change > 0 ? "+" : "-"}${formatBytes(Math.abs(item.change))} · \`${displayPath(item.path)}\``).join("\n")}`;
    await window.electronAPI.saveFile(content, `磁盘扫描报告-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`);
  };
  const handleRestore = async (id) => {
    await restoreSavedResult(id);
    setResultsOpen(false);
    setActiveTab("analysis");
  };
  const parentDirectory = currentDirectory && currentDirectory !== root ? currentDirectory.replace(/[\\/][^\\/]+[\\/]?$/, "") : "";
  const summary = {
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
    directoryChanges
  };
  return /* @__PURE__ */ jsxDEV("div", { className: "h-full min-h-0 overflow-y-auto bg-background p-5", children: /* @__PURE__ */ jsxDEV("div", { className: "mx-auto flex w-full max-w-[1700px] flex-col gap-4", children: [
    /* @__PURE__ */ jsxDEV("header", { className: "flex items-start justify-between", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("h1", { className: "flex items-center gap-2 text-xl font-semibold", children: [
          /* @__PURE__ */ jsxDEV(HardDrive, { className: "h-5 w-5" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 295,
            columnNumber: 15
          }, this),
          "磁盘空间"
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 294,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV("p", { className: "mt-1 text-sm text-muted-foreground", children: "系统资源概览、目录分析与安全文件预览" }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 297,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 293,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          className: "rounded-md border p-2 hover:bg-accent",
          title: "刷新系统信息",
          onClick: () => void refreshSystem(),
          children: /* @__PURE__ */ jsxDEV(RefreshCw, { className: "h-4 w-4" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 304,
            columnNumber: 13
          }, this)
        },
        void 0,
        false,
        {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 299,
          columnNumber: 11
        },
        this
      )
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 292,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV("style", { children: `section:has(> .border-r) { display: ${activeTab === "browser" ? "grid" : "none"} !important; grid-template-columns: minmax(0, 1fr) !important; } section:has(> .border-r) > div:last-child { display: none !important; } section:has(> h2.sticky) { display: none !important; } ${activeTab !== "analysis" ? "section:has(> .border-r) ~ section { display: none !important; }" : ""}` }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 307,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV("nav", { className: "flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-sm", "aria-label": "磁盘空间功能", children: [["overview", "资源概览"], ["browser", "目录浏览"], ["analysis", "空间分析"], ["developer", "开发者空间"], ["cleanup", "清理建议"], ["doctor", "磁盘医生"]].map(([id, label]) => /* @__PURE__ */ jsxDEV(
      "button",
      {
        className: `shrink-0 rounded-lg px-5 py-2 text-sm transition-colors ${activeTab === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`,
        onClick: () => setActiveTab(id),
        children: label
      },
      id,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 310,
        columnNumber: 13
      },
      this
    )) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 308,
      columnNumber: 9
    }, this),
    root && /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [
      /* @__PURE__ */ jsxDEV("span", { className: `rounded-full px-2 py-1 ${usnInfo?.supported ? "bg-emerald-500/10 text-emerald-700" : "bg-muted"}`, children: usnInfo?.supported ? `NTFS USN 已启用 · ${usnInfo.method === "native" ? "原生 API" : "兼容模式"}` : "标准优化扫描" }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 321,
        columnNumber: 13
      }, this),
      usnInfo?.supported && usnInfo.volume && /* @__PURE__ */ jsxDEV("span", { children: [
        usnInfo.volume,
        " Journal · Next USN ",
        usnInfo.nextUsn?.toLocaleString()
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 325,
        columnNumber: 15
      }, this),
      usnInfo?.error && /* @__PURE__ */ jsxDEV("span", { title: usnInfo.error, children: "USN 不可用" }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 327,
        columnNumber: 32
      }, this)
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 320,
      columnNumber: 11
    }, this),
    usnInfo?.supported && usnDelta !== null && /* @__PURE__ */ jsxDEV("div", { className: "text-xs text-muted-foreground", children: [
      "相对上次记录，USN 游标前进 ",
      usnDelta.toLocaleString(),
      " 字节；Journal ID 变化时会自动放弃旧游标并执行完整扫描。"
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 331,
      columnNumber: 11
    }, this),
    /* @__PURE__ */ jsxDEV(Modal, { open: Boolean(preview), title: preview?.name || "文件预览", width: "min(1100px, 92vw)", footer: preview ? /* @__PURE__ */ jsxDEV("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-muted-foreground", children: [
        formatBytes(preview.size),
        " · ",
        new Date(preview.modifiedAt).toLocaleString(),
        preview.truncated ? " · 仅展示前 1 MB" : ""
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 336,
        columnNumber: 13
      }, this),
      /* @__PURE__ */ jsxDEV("button", { className: "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent", onClick: () => void window.electronAPI.diskSpace.open(root, preview.path), children: [
        /* @__PURE__ */ jsxDEV(ExternalLink, { className: "h-4 w-4" }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 340,
          columnNumber: 15
        }, this),
        "默认应用打开"
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 339,
        columnNumber: 13
      }, this)
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 335,
      columnNumber: 11
    }, this) : null, onCancel: () => setPreview(null), destroyOnClose: true, children: /* @__PURE__ */ jsxDEV("div", { className: "max-h-[72vh] min-h-[320px] overflow-auto rounded-lg bg-background p-5", children: !preview ? null : preview.kind === "image" && preview.content ? /* @__PURE__ */ jsxDEV("div", { className: "flex min-h-[320px] items-center justify-center", children: /* @__PURE__ */ jsxDEV("img", { className: "max-h-[68vh] max-w-full rounded-lg object-contain shadow", src: `data:${preview.mimeType};base64,${preview.content}`, alt: preview.name }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 347,
      columnNumber: 17
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 346,
      columnNumber: 15
    }, this) : preview.kind === "text" && /\.md(?:own)?$/i.test(preview.name) ? /* @__PURE__ */ jsxDEV(XMarkdown, { content: preview.content || "_(空文档)_", className: "chat-markdown prose prose-sm max-w-none break-words dark:prose-invert" }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 350,
      columnNumber: 15
    }, this) : preview.kind === "text" ? /* @__PURE__ */ jsxDEV("pre", { className: "whitespace-pre-wrap break-words font-mono text-xs leading-6", children: preview.content }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 352,
      columnNumber: 15
    }, this) : /* @__PURE__ */ jsxDEV(EmptyState, { children: preview.message }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 354,
      columnNumber: 15
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 344,
      columnNumber: 11
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 334,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV(Modal, { open: errorsOpen, title: `扫描问题（${scanErrors.length}）`, footer: null, width: "min(900px, 90vw)", onCancel: () => setErrorsOpen(false), children: /* @__PURE__ */ jsxDEV("div", { className: "max-h-[65vh] overflow-auto", children: scanErrors.length ? scanErrors.map((item, index) => /* @__PURE__ */ jsxDEV("div", { className: "border-b py-3", children: [
      /* @__PURE__ */ jsxDEV("p", { className: "break-all font-mono text-xs", children: displayPath(item.path) }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 362,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("p", { className: "mt-1 text-xs text-destructive", children: item.message }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 363,
        columnNumber: 17
      }, this)
    ] }, `${item.path}-${index}`, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 361,
      columnNumber: 15
    }, this)) : /* @__PURE__ */ jsxDEV(EmptyState, { children: "没有记录到权限或读取问题" }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 365,
      columnNumber: 18
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 359,
      columnNumber: 11
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 358,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV(Modal, { open: snapshotsOpen, title: "扫描快照管理", footer: null, width: "min(900px, 90vw)", onCancel: () => setSnapshotsOpen(false), children: /* @__PURE__ */ jsxDEV("div", { className: "max-h-[65vh] overflow-auto", children: directorySnapshots.map((snapshot) => /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-[minmax(0,1fr)_170px_80px] items-center gap-3 border-b py-3", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "min-w-0", children: [
        /* @__PURE__ */ jsxDEV("p", { className: "truncate font-mono text-xs", children: displayPath(snapshot.root) }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 373,
          columnNumber: 19
        }, this),
        /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: [
          "记录 ",
          snapshot.directoryCount,
          " 个主要目录"
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 374,
          columnNumber: 19
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 372,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-muted-foreground", children: new Date(snapshot.timestamp).toLocaleString() }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 376,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("button", { className: "text-xs text-destructive hover:underline", onClick: () => void removeDirectorySnapshot(snapshot.id), children: "删除" }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 377,
        columnNumber: 17
      }, this)
    ] }, snapshot.id, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 371,
      columnNumber: 15
    }, this)) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 369,
      columnNumber: 11
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 368,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV(Modal, { open: resultsOpen, title: "扫描结果存档", footer: null, width: "min(960px, 92vw)", onCancel: () => setResultsOpen(false), children: /* @__PURE__ */ jsxDEV("div", { className: "max-h-[68vh] overflow-auto", children: savedResults.length ? [...savedResults].reverse().map((saved) => /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-[minmax(0,1fr)_120px_170px_130px] items-center gap-3 border-b py-3", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "min-w-0", children: [
        /* @__PURE__ */ jsxDEV("p", { className: "truncate font-mono text-xs", children: displayPath(saved.root) }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 387,
          columnNumber: 19
        }, this),
        /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: [
          saved.stats.files.toLocaleString(),
          " 个文件 · ",
          formatBytes(saved.stats.bytes)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 388,
          columnNumber: 19
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 386,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("span", { className: "text-right text-xs", children: [
        saved.duplicates,
        " 组重复"
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 390,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-muted-foreground", children: new Date(saved.savedAt).toLocaleString() }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 391,
        columnNumber: 17
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "flex justify-end gap-2", children: [
        /* @__PURE__ */ jsxDEV("button", { className: "text-xs text-primary hover:underline", onClick: () => void handleRestore(saved.id), children: "恢复" }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 393,
          columnNumber: 19
        }, this),
        /* @__PURE__ */ jsxDEV("button", { className: "text-xs text-destructive hover:underline", onClick: () => void removeSavedResult(saved.id), children: "删除" }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 394,
          columnNumber: 19
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 392,
        columnNumber: 17
      }, this)
    ] }, saved.id, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 385,
      columnNumber: 15
    }, this)) : /* @__PURE__ */ jsxDEV(EmptyState, { children: "暂无扫描结果存档" }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 397,
      columnNumber: 18
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 383,
      columnNumber: 11
    }, this) }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 382,
      columnNumber: 9
    }, this),
    activeTab === "overview" && /* @__PURE__ */ jsxDEV(
      OverviewTab,
      {
        scan,
        historyOption: summary.historyOption,
        onOpenSnapshots: () => setSnapshotsOpen(true),
        onOpenResults: () => setResultsOpen(true)
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 402,
        columnNumber: 11
      },
      this
    ),
    activeTab === "browser" && /* @__PURE__ */ jsxDEV(
      BrowserTab,
      {
        scan,
        preview,
        setPreview,
        openPreview,
        parentDirectory,
        loadDirectory,
        showAnalysisControls: false,
        isFocusedTab,
        start,
        cancelScan,
        choose
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 410,
        columnNumber: 11
      },
      this
    ),
    activeTab === "analysis" && /* @__PURE__ */ jsxDEV(
      BrowserTab,
      {
        scan,
        preview,
        setPreview,
        openPreview,
        parentDirectory,
        loadDirectory,
        showAnalysisControls: true,
        isFocusedTab,
        start,
        cancelScan,
        choose
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 425,
        columnNumber: 11
      },
      this
    ),
    activeTab === "analysis" && /* @__PURE__ */ jsxDEV(
      AnalysisTab,
      {
        scan,
        selectedDuplicates,
        setSelectedDuplicates,
        largeFileThreshold,
        setLargeFileThreshold,
        customThresholdGb,
        setCustomThresholdGb,
        largeFileExtension,
        setLargeFileExtension,
        largeFileSort,
        setLargeFileSort,
        visibleLargest: summary.visibleLargest,
        scannedExtensions: summary.scannedExtensions,
        directoryChanges: summary.directoryChanges,
        selectedDuplicateBytes: summary.selectedDuplicateBytes,
        openPreview
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 440,
        columnNumber: 11
      },
      this
    ),
    activeTab === "developer" && /* @__PURE__ */ jsxDEV(
      DeveloperTab,
      {
        scan,
        developerItems: summary.developerItems,
        developerTotal: summary.developerTotal,
        isFocusedTab,
        specialtyProbes,
        probing,
        setSpecialtyProbes,
        setProbing,
        start,
        choose
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 460,
        columnNumber: 11
      },
      this
    ),
    activeTab === "cleanup" && /* @__PURE__ */ jsxDEV(
      CleanupTab,
      {
        scan,
        cleanupItems: summary.cleanupItems,
        cleanupTotal: summary.cleanupTotal,
        cleanupAssessments: summary.cleanupAssessments,
        isFocusedTab,
        cleanupStatus,
        runCleanup,
        clearCleanupStatus,
        start,
        choose
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 474,
        columnNumber: 11
      },
      this
    ),
    activeTab === "doctor" && /* @__PURE__ */ jsxDEV(
      DoctorTab,
      {
        scan,
        diagnosis,
        setDiagnosis,
        diagnosing,
        setDiagnosing,
        generateDiagnosis,
        exportScanReport,
        directoryChanges: summary.directoryChanges,
        cleanupTotal: summary.cleanupTotal
      },
      void 0,
      false,
      {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 488,
        columnNumber: 11
      },
      this
    ),
    running && /* @__PURE__ */ jsxDEV("div", { className: "flex justify-end gap-2", children: [
      /* @__PURE__ */ jsxDEV("button", { className: "rounded-md border px-3 py-1.5 text-sm hover:bg-accent", onClick: () => void togglePause(), children: paused ? "继续扫描" : "暂停扫描" }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 503,
        columnNumber: 13
      }, this),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          className: "rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10",
          onClick: () => void cancelScan(),
          children: "停止扫描"
        },
        void 0,
        false,
        {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 506,
          columnNumber: 13
        },
        this
      )
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 502,
      columnNumber: 11
    }, this),
    running && /* @__PURE__ */ jsxDEV("section", { className: "rounded-2xl border bg-card p-4 shadow-sm", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "grid gap-4 sm:grid-cols-4", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: "已运行" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 517,
            columnNumber: 20
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "mt-1 font-semibold", children: formatDuration(scanTelemetry.elapsedMs) }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 517,
            columnNumber: 72
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 517,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: "扫描速度" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 518,
            columnNumber: 20
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "mt-1 font-semibold", children: [
            scanTelemetry.elapsedMs ? Math.round(scanTelemetry.files / (scanTelemetry.elapsedMs / 1e3)).toLocaleString() : 0,
            " 文件/秒"
          ] }, void 0, true, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 518,
            columnNumber: 73
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 518,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: "目录" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 519,
            columnNumber: 20
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "mt-1 font-semibold", children: scanTelemetry.directories.toLocaleString() }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 519,
            columnNumber: 71
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 519,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-muted-foreground", children: "已读取" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 520,
            columnNumber: 20
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "mt-1 font-semibold", children: formatBytes(scanTelemetry.bytes) }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 520,
            columnNumber: 72
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 520,
          columnNumber: 15
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 516,
        columnNumber: 13
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "mt-3 flex items-center gap-2", children: [
        /* @__PURE__ */ jsxDEV(Loader2, { className: "h-4 w-4 shrink-0" }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 523,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("span", { className: "min-w-0 flex-1 truncate font-mono text-xs", title: displayPath(scanTelemetry.currentPath), children: phase === "hashing" ? "正在校验重复文件内容…" : displayPath(scanTelemetry.currentPath) }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 524,
          columnNumber: 15
        }, this),
        scanErrors.length > 0 && /* @__PURE__ */ jsxDEV("button", { className: "text-xs text-destructive underline", onClick: () => setErrorsOpen(true), children: [
          "查看 ",
          scanErrors.length,
          " 个问题"
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 528,
          columnNumber: 17
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 522,
        columnNumber: 13
      }, this)
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 515,
      columnNumber: 11
    }, this),
    running && /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground", children: [
      /* @__PURE__ */ jsxDEV(Loader2, { className: "h-4 w-4" }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 536,
        columnNumber: 126
      }, this),
      phase === "hashing" ? "正在校验重复文件内容…" : "正在扫描目录…"
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 536,
      columnNumber: 21
    }, this),
    error && /* @__PURE__ */ jsxDEV("div", { className: "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive", children: error }, void 0, false, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 537,
      columnNumber: 19
    }, this),
    (running || stats.files > 0) && /* @__PURE__ */ jsxDEV(Fragment, { children: [
      /* @__PURE__ */ jsxDEV("section", { className: "grid grid-cols-3 gap-3", children: [["文件", stats.files.toLocaleString()], ["已扫描容量", formatBytes(stats.bytes)], ["读取失败", stats.errors.toLocaleString()]].map(([label, value]) => /* @__PURE__ */ jsxDEV("div", { className: "rounded-xl border bg-card p-4", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "text-xs text-muted-foreground", children: label }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 544,
          columnNumber: 19
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "mt-1 text-2xl font-semibold", children: value }, void 0, false, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 545,
          columnNumber: 19
        }, this)
      ] }, label, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 543,
        columnNumber: 17
      }, this)) }, void 0, false, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 541,
        columnNumber: 13
      }, this),
      /* @__PURE__ */ jsxDEV("section", { className: "grid gap-4 xl:grid-cols-2", children: [
        /* @__PURE__ */ jsxDEV("article", { className: "h-[330px] rounded-xl border bg-card", children: [
          /* @__PURE__ */ jsxDEV("h2", { className: "border-b px-4 py-3 font-medium", children: "文件类型占用" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 551,
            columnNumber: 17
          }, this),
          extensionData.length ? /* @__PURE__ */ jsxDEV(Chart, { option: summary.extensionOption, className: "h-[280px] w-full" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 552,
            columnNumber: 41
          }, this) : /* @__PURE__ */ jsxDEV(EmptyState, { children: "等待扫描数据" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 552,
            columnNumber: 115
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 550,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("article", { className: "h-[330px] rounded-xl border bg-card", children: [
          /* @__PURE__ */ jsxDEV("h2", { className: "border-b px-4 py-3 font-medium", children: "目录占用排行" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 555,
            columnNumber: 17
          }, this),
          directoryData.length ? /* @__PURE__ */ jsxDEV(Chart, { option: summary.directoryOption, className: "h-[280px] w-full" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 556,
            columnNumber: 41
          }, this) : /* @__PURE__ */ jsxDEV(EmptyState, { children: "等待扫描数据" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 556,
            columnNumber: 115
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 554,
          columnNumber: 15
        }, this)
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 549,
        columnNumber: 13
      }, this),
      /* @__PURE__ */ jsxDEV("section", { className: "h-[420px] rounded-xl border bg-card", children: [
        /* @__PURE__ */ jsxDEV("h2", { className: "border-b bg-card px-4 py-3 font-medium", children: [
          "最大文件 ",
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-muted-foreground", children: "前 50" }, void 0, false, {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 560,
            columnNumber: 75
          }, this)
        ] }, void 0, true, {
          fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
          lineNumber: 560,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV(
          VirtualList,
          {
            items: largest,
            itemSize: 38,
            height: 380,
            renderItem: (file) => /* @__PURE__ */ jsxDEV(
              "button",
              {
                className: "grid h-[38px] w-full grid-cols-[minmax(0,1fr)_100px] items-center gap-3 border-b px-4 text-left text-sm hover:bg-muted/40",
                onClick: () => void openPreview({
                  name: displayPath(file.path).split(/[\\/]/).at(-1) || file.path,
                  path: file.path,
                  type: "file",
                  size: file.size,
                  modifiedAt: file.modifiedAt,
                  extension: file.extension
                }),
                children: [
                  /* @__PURE__ */ jsxDEV("span", { className: "truncate font-mono text-xs", children: displayPath(file.path) }, void 0, false, {
                    fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
                    lineNumber: 579,
                    columnNumber: 21
                  }, this),
                  /* @__PURE__ */ jsxDEV("span", { className: "text-right text-muted-foreground", children: formatBytes(file.size) }, void 0, false, {
                    fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
                    lineNumber: 580,
                    columnNumber: 21
                  }, this)
                ]
              },
              void 0,
              true,
              {
                fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
                lineNumber: 566,
                columnNumber: 19
              },
              this
            )
          },
          void 0,
          false,
          {
            fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
            lineNumber: 561,
            columnNumber: 15
          },
          this
        )
      ] }, void 0, true, {
        fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
        lineNumber: 559,
        columnNumber: 13
      }, this)
    ] }, void 0, true, {
      fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
      lineNumber: 540,
      columnNumber: 11
    }, this)
  ] }, void 0, true, {
    fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
    lineNumber: 291,
    columnNumber: 7
  }, this) }, void 0, false, {
    fileName: "D:/github/next-work-dashboard/prompt-lab/src/plugins/disk-space/DiskSpacePanel.tsx",
    lineNumber: 290,
    columnNumber: 5
  }, this);
}

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkRpc2tTcGFjZVBhbmVsLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB1c2VFZmZlY3QsIHVzZU1lbW8sIHVzZVN0YXRlIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgTW9kYWwgfSBmcm9tICdhbnRkJztcbmltcG9ydCB7IFhNYXJrZG93biB9IGZyb20gJ0BhbnQtZGVzaWduL3gtbWFya2Rvd24nO1xuaW1wb3J0IHR5cGUgeyBEaXNrRGlyZWN0b3J5SXRlbSwgRGlza1NwZWNpYWx0eVByb2JlIH0gZnJvbSAnQC90eXBlcy9lbGVjdHJvbic7XG5pbXBvcnQgeyBFeHRlcm5hbExpbmssIEZvbGRlck9wZW4sIEhhcmREcml2ZSwgTG9hZGVyMiwgUmVmcmVzaEN3IH0gZnJvbSAnQC9jb21wb25lbnRzL2ljb25zJztcbmltcG9ydCB7IGNyZWF0ZU9wZW5BSVByb3ZpZGVyIH0gZnJvbSAnLi4vLi4vY29yZS9sbG0nO1xuaW1wb3J0IHsgdXNlU3RvcmUgfSBmcm9tICcuLi8uLi9zdG9yZS9zdG9yZSc7XG5pbXBvcnQge1xuICB1c2VEaXNrU2NhbixcbiAgZGlzcGxheVBhdGgsXG4gIHR5cGUgRGlyZWN0b3J5RW50cnksXG4gIHR5cGUgRmlsZUVudHJ5LFxuICB0eXBlIFNjYW5FcnJvckl0ZW0sXG4gIHR5cGUgU2NhblRlbGVtZXRyeSxcbiAgdHlwZSBQZXJzaXN0ZWRTY2FuUmVzdWx0LFxufSBmcm9tICcuL2hvb2tzL3VzZURpc2tTY2FuJztcbmltcG9ydCB7IENoYXJ0LCBFbXB0eVN0YXRlIH0gZnJvbSAnLi90YWJzL2NvbXBvbmVudHMnO1xuaW1wb3J0IHtcbiAgYnVpbGREaXJlY3RvcnlUcmVlLFxuICBjb21wYWN0RGlyZWN0b3J5Q2FuZGlkYXRlcyxcbiAgZm9ybWF0Qnl0ZXMsXG4gIGZvcm1hdER1cmF0aW9uLFxuICB0eXBlIFRyZWVtYXBOb2RlLFxufSBmcm9tICcuL3RhYnMvaGVscGVycyc7XG5pbXBvcnQgeyBBbmFseXNpc1RhYiB9IGZyb20gJy4vdGFicy9BbmFseXNpc1RhYic7XG5pbXBvcnQgeyBCcm93c2VyVGFiIH0gZnJvbSAnLi90YWJzL0Jyb3dzZXJUYWInO1xuaW1wb3J0IHsgQ2xlYW51cFRhYiB9IGZyb20gJy4vdGFicy9DbGVhbnVwVGFiJztcbmltcG9ydCB7IERldmVsb3BlclRhYiB9IGZyb20gJy4vdGFicy9EZXZlbG9wZXJUYWInO1xuaW1wb3J0IHsgRG9jdG9yVGFiIH0gZnJvbSAnLi90YWJzL0RvY3RvclRhYic7XG5pbXBvcnQgeyBPdmVydmlld1RhYiB9IGZyb20gJy4vdGFicy9PdmVydmlld1RhYic7XG5pbXBvcnQgeyBWaXJ0dWFsTGlzdCB9IGZyb20gJy4vdGFicy9WaXJ0dWFsTGlzdCc7XG5pbXBvcnQgdHlwZSB7IEFjdGl2ZVRhYiwgRGlyZWN0b3J5Q2hhbmdlLCBTY2FuU3VtbWFyeSB9IGZyb20gJy4vdGFicy9zaGFyZWQnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tIFBhbmVsIC0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIERpc2tTcGFjZVBhbmVsKCkge1xuICBjb25zdCBhaUFwaSA9IHVzZVN0b3JlKChzdGF0ZSkgPT4gc3RhdGUuYWlBcGkpO1xuICBjb25zdCBzY2FuID0gdXNlRGlza1NjYW4oKTtcblxuICAvLyBVSS1vbmx5IHN0YXRl77yI5LiN5bGe5LqO5omr5o+P54q25oCB5py677yJXG4gIGNvbnN0IFthY3RpdmVUYWIsIHNldEFjdGl2ZVRhYl0gPSB1c2VTdGF0ZTxBY3RpdmVUYWI+KCdvdmVydmlldycpO1xuICBjb25zdCBbc2VsZWN0ZWREdXBsaWNhdGVzLCBzZXRTZWxlY3RlZER1cGxpY2F0ZXNdID0gdXNlU3RhdGU8c3RyaW5nW10+KFtdKTtcbiAgY29uc3QgW2Vycm9yc09wZW4sIHNldEVycm9yc09wZW5dID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbc25hcHNob3RzT3Blbiwgc2V0U25hcHNob3RzT3Blbl0gPSB1c2VTdGF0ZShmYWxzZSk7XG4gIGNvbnN0IFtyZXN1bHRzT3Blbiwgc2V0UmVzdWx0c09wZW5dID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbc3BlY2lhbHR5UHJvYmVzLCBzZXRTcGVjaWFsdHlQcm9iZXNdID0gdXNlU3RhdGU8RGlza1NwZWNpYWx0eVByb2JlW10+KFtdKTtcbiAgY29uc3QgW3Byb2JpbmcsIHNldFByb2JpbmddID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbZGlhZ25vc2lzLCBzZXREaWFnbm9zaXNdID0gdXNlU3RhdGUoJycpO1xuICBjb25zdCBbZGlhZ25vc2luZywgc2V0RGlhZ25vc2luZ10gPSB1c2VTdGF0ZShmYWxzZSk7XG4gIGNvbnN0IFtsYXJnZUZpbGVUaHJlc2hvbGQsIHNldExhcmdlRmlsZVRocmVzaG9sZF0gPSB1c2VTdGF0ZSgwKTtcbiAgY29uc3QgW2N1c3RvbVRocmVzaG9sZEdiLCBzZXRDdXN0b21UaHJlc2hvbGRHYl0gPSB1c2VTdGF0ZSgnJyk7XG4gIGNvbnN0IFtsYXJnZUZpbGVFeHRlbnNpb24sIHNldExhcmdlRmlsZUV4dGVuc2lvbl0gPSB1c2VTdGF0ZSgnJyk7XG4gIGNvbnN0IFtsYXJnZUZpbGVTb3J0LCBzZXRMYXJnZUZpbGVTb3J0XSA9IHVzZVN0YXRlPCdzaXplJyB8ICdtb2RpZmllZCcgfCAnZXh0ZW5zaW9uJz4oJ3NpemUnKTtcblxuICBjb25zdCB7XG4gICAgc3lzdGVtLCBkaXNrSGlzdG9yeSwgcm9vdCwgY3VycmVudERpcmVjdG9yeSwgZW50cmllcywgcHJldmlldywgYnJvd3NlckxvYWRpbmcsXG4gICAgc2V0UHJldmlldywgc2NhbklkUmVmLCByb290UmVmLCBydW5uaW5nLCBwYXVzZWQsIHBoYXNlLFxuICAgIHNjYW5UZWxlbWV0cnksIHNjYW5FcnJvcnMsIHN0YXRzLCBsYXJnZXN0LCBkdXBsaWNhdGVzLCBleHRlbnNpb25zLCBkaXJlY3RvcmllcyxcbiAgICBkaXJlY3RvcnlTbmFwc2hvdHMsIHNhdmVkUmVzdWx0cywgdXNuSW5mbywgdXNuRGVsdGEsIGV4Y2x1c2lvbnNUZXh0LCBzZXRFeGNsdXNpb25zVGV4dCxcbiAgICBlcnJvciwgc2V0RXJyb3IsIHJlZnJlc2hTeXN0ZW0sIGNob29zZSwgc3RhcnQsIGNhbmNlbFNjYW4sIHRvZ2dsZVBhdXNlLFxuICAgIGxvYWREaXJlY3RvcnksIG9wZW5QcmV2aWV3LCByZXN0b3JlU2F2ZWRSZXN1bHQsIHJlbW92ZVNhdmVkUmVzdWx0LFxuICAgIHJlbW92ZURpcmVjdG9yeVNuYXBzaG90LCBjbGVhckhpc3RvcnksIHNldFJ1bm5pbmcsIHNldFBhdXNlZCwgc2V0U2NhbkVycm9ycyxcbiAgICBzZXRCcm93c2VyTG9hZGluZywgc2V0RW50cmllcywgc2V0RHVwbGljYXRlcyxcbiAgICBjbGVhbnVwU3RhdHVzLCBydW5DbGVhbnVwLCBjbGVhckNsZWFudXBTdGF0dXMsXG4gICAgZGlyZWN0b3J5U25hcHNob3REYXRhLFxuICB9ID0gc2NhbjtcblxuICAvLyDliIcgdGFiIOa4heepuiBlcnJvclxuICB1c2VFZmZlY3QoKCkgPT4geyBzZXRFcnJvcignJyk7IH0sIFthY3RpdmVUYWIsIHNldEVycm9yXSk7XG5cbiAgLy8gZGV2ZWxvcGVyIHRhYiBzcGVjaWFsdHlQcm9iZXMg5o6i5rWLXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKGFjdGl2ZVRhYiAhPT0gJ2RldmVsb3BlcicgfHwgc3BlY2lhbHR5UHJvYmVzLmxlbmd0aCA+IDAgfHwgcHJvYmluZykgcmV0dXJuO1xuICAgIHNldFByb2JpbmcodHJ1ZSk7XG4gICAgdm9pZCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlXG4gICAgICAucHJvYmVTcGVjaWFsdGllcygpXG4gICAgICAudGhlbihzZXRTcGVjaWFsdHlQcm9iZXMpXG4gICAgICAuY2F0Y2goKGNhdXNlKSA9PiBzZXRFcnJvcihTdHJpbmcoY2F1c2UpKSlcbiAgICAgIC5maW5hbGx5KCgpID0+IHNldFByb2JpbmcoZmFsc2UpKTtcbiAgfSwgW2FjdGl2ZVRhYiwgcHJvYmluZywgc3BlY2lhbHR5UHJvYmVzLmxlbmd0aCwgc2V0RXJyb3JdKTtcblxuICAvLyBjbGVhbnVwIOWujOaIkOWQjuiHquWKqOmHjeaJq1xuICBjb25zdCBpc0ZvY3VzZWRUYWIgPSBhY3RpdmVUYWIgPT09ICdkZXZlbG9wZXInIHx8IGFjdGl2ZVRhYiA9PT0gJ2NsZWFudXAnO1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmIChjbGVhbnVwU3RhdHVzLmtpbmQgIT09ICdzdWNjZXNzJyB8fCBhY3RpdmVUYWIgIT09ICdjbGVhbnVwJykgcmV0dXJuO1xuICAgIHNldFNwZWNpYWx0eVByb2JlcyhbXSk7XG4gICAgdm9pZCByZWZyZXNoU3lzdGVtKCk7XG4gICAgaWYgKHJvb3QgJiYgIXJ1bm5pbmcpIHZvaWQgc3RhcnQoaXNGb2N1c2VkVGFiKTtcbiAgICBjbGVhckNsZWFudXBTdGF0dXMoKTtcbiAgfSwgW2NsZWFudXBTdGF0dXMsIGFjdGl2ZVRhYiwgcm9vdCwgcnVubmluZywgcmVmcmVzaFN5c3RlbSwgc3RhcnQsIGlzRm9jdXNlZFRhYiwgY2xlYXJDbGVhbnVwU3RhdHVzXSk7XG5cbiAgLy8gdHJlZW1hcCDngrnlh7sg4oaSIOi3s+WIsOebruW9lea1j+iniFxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IG5hdmlnYXRlID0gKGV2ZW50OiBFdmVudCkgPT4ge1xuICAgICAgY29uc3QgZGlyZWN0b3J5ID0gKGV2ZW50IGFzIEN1c3RvbUV2ZW50PHN0cmluZz4pLmRldGFpbDtcbiAgICAgIGlmICghZGlyZWN0b3J5IHx8ICFyb290UmVmLmN1cnJlbnQpIHJldHVybjtcbiAgICAgIHNldEFjdGl2ZVRhYignYnJvd3NlcicpO1xuICAgICAgc2V0QnJvd3NlckxvYWRpbmcodHJ1ZSk7XG4gICAgICBzZXRQcmV2aWV3KG51bGwpO1xuICAgICAgdm9pZCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlXG4gICAgICAgIC5saXN0RGlyZWN0b3J5KHJvb3RSZWYuY3VycmVudCwgZGlyZWN0b3J5KVxuICAgICAgICAudGhlbigoaXRlbXMpID0+IHtcbiAgICAgICAgICBzZXRFbnRyaWVzKGl0ZW1zKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKChjYXVzZSkgPT4gc2V0RXJyb3IoU3RyaW5nKGNhdXNlKSkpXG4gICAgICAgIC5maW5hbGx5KCgpID0+IHNldEJyb3dzZXJMb2FkaW5nKGZhbHNlKSk7XG4gICAgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZGlzay1zcGFjZTpuYXZpZ2F0ZScsIG5hdmlnYXRlKTtcbiAgICByZXR1cm4gKCkgPT4gd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Rpc2stc3BhY2U6bmF2aWdhdGUnLCBuYXZpZ2F0ZSk7XG4gIH0sIFtyb290UmVmLCBzZXRFbnRyaWVzLCBzZXRFcnJvciwgc2V0UHJldmlld10pO1xuXG4gIC8vIOWFseS6q+a0vueUn+aVsOaNrlxuICBjb25zdCBleHRlbnNpb25EYXRhID0gdXNlTWVtbzxBcnJheTxbc3RyaW5nLCBudW1iZXJdPj4oXG4gICAgKCkgPT4gT2JqZWN0LmVudHJpZXMoZXh0ZW5zaW9ucykuc29ydCgoYSwgYikgPT4gYlsxXSAtIGFbMV0pLnNsaWNlKDAsIDEwKSxcbiAgICBbZXh0ZW5zaW9uc10sXG4gICk7XG4gIGNvbnN0IGV4dGVuc2lvbk9wdGlvbiA9IHVzZU1lbW8oKCkgPT4gKHtcbiAgICBjb2xvcjogWycjN2MzYWVkJywgJyMyNTYzZWInLCAnIzA4OTFiMicsICcjMDU5NjY5JywgJyNjYThhMDQnLCAnI2VhNTgwYycsICcjZGMyNjI2JywgJyNkYjI3NzcnXSxcbiAgICB0b29sdGlwOiB7IHRyaWdnZXI6ICdpdGVtJywgZm9ybWF0dGVyOiAocDogeyBuYW1lOiBzdHJpbmc7IHZhbHVlOiBudW1iZXI7IHBlcmNlbnQ6IG51bWJlciB9KSA9PiBgJHtwLm5hbWV9PGJyLz4ke2Zvcm1hdEJ5dGVzKHAudmFsdWUpfSDCtyAke3AucGVyY2VudH0lYCB9LFxuICAgIHNlcmllczogW3tcbiAgICAgIHR5cGU6ICdwaWUnLCByYWRpdXM6IFsnNDglJywgJzc2JSddLCBjZW50ZXI6IFsnNDIlJywgJzUwJSddLFxuICAgICAgaXRlbVN0eWxlOiB7IGJvcmRlclJhZGl1czogNiwgYm9yZGVyV2lkdGg6IDIsIGJvcmRlckNvbG9yOiAndHJhbnNwYXJlbnQnIH0sXG4gICAgICBsYWJlbDogeyBjb2xvcjogJyM3NDYwNzUnLCBmb3JtYXR0ZXI6ICd7Yn1cXG57ZH0lJyB9LFxuICAgICAgZGF0YTogZXh0ZW5zaW9uRGF0YS5tYXAoKFtuYW1lLCB2YWx1ZV0pID0+ICh7IG5hbWUsIHZhbHVlIH0pKSxcbiAgICB9XSxcbiAgfSksIFtleHRlbnNpb25EYXRhXSk7XG4gIGNvbnN0IGRpcmVjdG9yeURhdGEgPSB1c2VNZW1vPFRyZWVtYXBOb2RlW10+KFxuICAgICgpID0+IGJ1aWxkRGlyZWN0b3J5VHJlZShkaXJlY3Rvcmllcywgcm9vdCksXG4gICAgW2RpcmVjdG9yaWVzLCByb290XSxcbiAgKTtcbiAgY29uc3QgZGlyZWN0b3J5T3B0aW9uID0gdXNlTWVtbygoKSA9PiAoe1xuICAgIHRvb2x0aXA6IHsgZm9ybWF0dGVyOiAoaXRlbTogeyBuYW1lOiBzdHJpbmc7IHZhbHVlOiBudW1iZXI7IGRhdGE/OiB7IHBhdGg/OiBzdHJpbmcgfSB9KSA9PiBgJHtpdGVtLm5hbWV9PGJyLz4ke2Zvcm1hdEJ5dGVzKGl0ZW0udmFsdWUpfTxici8+JHtkaXNwbGF5UGF0aChpdGVtLmRhdGE/LnBhdGggfHwgJycpfWAgfSxcbiAgICBzZXJpZXM6IFt7XG4gICAgICB0eXBlOiAndHJlZW1hcCcsIHJvYW06IHRydWUsIG5vZGVDbGljazogJ3pvb21Ub05vZGUnLCBicmVhZGNydW1iOiB7IHNob3c6IHRydWUsIGhlaWdodDogMjYgfSxcbiAgICAgIGxhYmVsOiB7IHNob3c6IHRydWUsIGZvcm1hdHRlcjogKGl0ZW06IHsgbmFtZTogc3RyaW5nOyB2YWx1ZTogbnVtYmVyIH0pID0+IGAke2l0ZW0ubmFtZX1cXG4ke2Zvcm1hdEJ5dGVzKGl0ZW0udmFsdWUpfWAgfSxcbiAgICAgIHVwcGVyTGFiZWw6IHsgc2hvdzogdHJ1ZSwgaGVpZ2h0OiAyNCB9LFxuICAgICAgaXRlbVN0eWxlOiB7IGJvcmRlckNvbG9yOiAnI2ZmZicsIGJvcmRlcldpZHRoOiAyLCBnYXBXaWR0aDogMiB9LFxuICAgICAgbGV2ZWxzOiBbXG4gICAgICAgIHsgaXRlbVN0eWxlOiB7IGJvcmRlcldpZHRoOiAwLCBnYXBXaWR0aDogMyB9IH0sXG4gICAgICAgIHsgY29sb3JTYXR1cmF0aW9uOiBbMC4zNSwgMC43NV0sIHVwcGVyTGFiZWw6IHsgc2hvdzogdHJ1ZSB9LCBpdGVtU3R5bGU6IHsgZ2FwV2lkdGg6IDIsIGJvcmRlcldpZHRoOiAxIH0gfSxcbiAgICAgICAgeyBjb2xvclNhdHVyYXRpb246IFswLjI1LCAwLjY1XSwgaXRlbVN0eWxlOiB7IGdhcFdpZHRoOiAxIH0gfSxcbiAgICAgIF0sXG4gICAgICBkYXRhOiBkaXJlY3RvcnlEYXRhLFxuICAgIH1dLFxuICB9KSwgW2RpcmVjdG9yeURhdGFdKTtcbiAgY29uc3QgZGV2ZWxvcGVySXRlbXMgPSB1c2VNZW1vPERpcmVjdG9yeUVudHJ5W10+KFxuICAgICgpID0+IGNvbXBhY3REaXJlY3RvcnlDYW5kaWRhdGVzKGRpcmVjdG9yaWVzLCAvXig/Om5vZGVfbW9kdWxlc3xcXC5wbnBtLXN0b3JlfFxcLm5wbXxcXC55YXJufFxcLmNhcmdvfHRhcmdldHxcXC5ncmFkbGV8XFwubTJ8ZG9ja2VyfHdzbHxvbGxhbWF8X19weWNhY2hlX18pJC9pKSxcbiAgICBbZGlyZWN0b3JpZXNdLFxuICApO1xuICBjb25zdCBjbGVhbnVwSXRlbXMgPSB1c2VNZW1vPERpcmVjdG9yeUVudHJ5W10+KFxuICAgICgpID0+IGNvbXBhY3REaXJlY3RvcnlDYW5kaWRhdGVzKGRpcmVjdG9yaWVzLCAvXig/OmNhY2hlfGNhY2hlc3x0ZW1wfHRtcHxsb2dzP3xub2RlX21vZHVsZXN8dGFyZ2V0fGRpc3R8YnVpbGR8X19weWNhY2hlX18pJC9pKSxcbiAgICBbZGlyZWN0b3JpZXNdLFxuICApO1xuICBjb25zdCBoaXN0b3J5T3B0aW9uID0gdXNlTWVtbygoKSA9PiB7XG4gICAgY29uc3QgZGlza05hbWVzID0gWy4uLm5ldyBTZXQoZGlza0hpc3RvcnkuZmxhdE1hcCgocG9pbnQpID0+IHBvaW50LmRpc2tzLm1hcCgoZGlzaykgPT4gZGlzay5wYXRoKSkpXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29sb3I6IFsnIzdjM2FlZCcsICcjMjU2M2ViJywgJyMwODkxYjInLCAnIzA1OTY2OSddLFxuICAgICAgdG9vbHRpcDogeyB0cmlnZ2VyOiAnYXhpcycsIGZvcm1hdHRlcjogKGl0ZW1zOiBBcnJheTx7IHNlcmllc05hbWU6IHN0cmluZzsgdmFsdWU6IG51bWJlciB9PikgPT4gaXRlbXMubWFwKChpdGVtKSA9PiBgJHtpdGVtLnNlcmllc05hbWV977yaJHtmb3JtYXRCeXRlcyhpdGVtLnZhbHVlKX1gKS5qb2luKCc8YnIvPicpIH0sXG4gICAgICBsZWdlbmQ6IHsgdG9wOiA0LCBkYXRhOiBkaXNrTmFtZXMgfSxcbiAgICAgIGdyaWQ6IHsgbGVmdDogMTYsIHJpZ2h0OiAyMiwgdG9wOiA0MiwgYm90dG9tOiAyMiwgY29udGFpbkxhYmVsOiB0cnVlIH0sXG4gICAgICB4QXhpczogeyB0eXBlOiAnY2F0ZWdvcnknLCBib3VuZGFyeUdhcDogZmFsc2UsIGRhdGE6IGRpc2tIaXN0b3J5Lm1hcCgocG9pbnQpID0+IG5ldyBEYXRlKHBvaW50LnRpbWVzdGFtcCkudG9Mb2NhbGVTdHJpbmcoW10sIHsgbW9udGg6ICcyLWRpZ2l0JywgZGF5OiAnMi1kaWdpdCcsIGhvdXI6ICcyLWRpZ2l0JyB9KSksIGF4aXNMYWJlbDogeyBjb2xvcjogJyM3NDYwNzUnIH0gfSxcbiAgICAgIHlBeGlzOiB7IHR5cGU6ICd2YWx1ZScsIGF4aXNMYWJlbDogeyBjb2xvcjogJyM3NDYwNzUnLCBmb3JtYXR0ZXI6ICh2YWx1ZTogbnVtYmVyKSA9PiBmb3JtYXRCeXRlcyh2YWx1ZSkgfSwgc3BsaXRMaW5lOiB7IGxpbmVTdHlsZTogeyBjb2xvcjogJ3JnYmEoMTI3LDEyNywxMjcsLjEyKScgfSB9IH0sXG4gICAgICBzZXJpZXM6IGRpc2tOYW1lcy5tYXAoKG5hbWUpID0+ICh7XG4gICAgICAgIG5hbWUsIHR5cGU6ICdsaW5lJywgc21vb3RoOiB0cnVlLCBzaG93U3ltYm9sOiBkaXNrSGlzdG9yeS5sZW5ndGggPCAxMiwgYXJlYVN0eWxlOiB7IG9wYWNpdHk6IDAuMDYgfSxcbiAgICAgICAgZGF0YTogZGlza0hpc3RvcnkubWFwKChwb2ludCkgPT4gcG9pbnQuZGlza3MuZmluZCgoZGlzaykgPT4gZGlzay5wYXRoID09PSBuYW1lKT8udXNlZCA/PyBudWxsKSxcbiAgICAgIH0pKSxcbiAgICB9O1xuICB9LCBbZGlza0hpc3RvcnldKTtcbiAgY29uc3QgdmlzaWJsZUxhcmdlc3QgPSB1c2VNZW1vPEZpbGVFbnRyeVtdPigoKSA9PiB7XG4gICAgY29uc3QgY3VzdG9tID0gTnVtYmVyKGN1c3RvbVRocmVzaG9sZEdiKTtcbiAgICBjb25zdCB0aHJlc2hvbGQgPSBOdW1iZXIuaXNGaW5pdGUoY3VzdG9tKSAmJiBjdXN0b20gPiAwID8gY3VzdG9tICogMTAyNCAqKiAzIDogbGFyZ2VGaWxlVGhyZXNob2xkO1xuICAgIHJldHVybiBsYXJnZXN0XG4gICAgICAuZmlsdGVyKChmaWxlKSA9PiBmaWxlLnNpemUgPj0gdGhyZXNob2xkICYmICghbGFyZ2VGaWxlRXh0ZW5zaW9uIHx8IGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkgPT09IGxhcmdlRmlsZUV4dGVuc2lvbikpXG4gICAgICAuc29ydCgoYSwgYikgPT4gKGxhcmdlRmlsZVNvcnQgPT09ICdtb2RpZmllZCcgPyBiLm1vZGlmaWVkQXQgLSBhLm1vZGlmaWVkQXQgOiBsYXJnZUZpbGVTb3J0ID09PSAnZXh0ZW5zaW9uJyA/IGEuZXh0ZW5zaW9uLmxvY2FsZUNvbXBhcmUoYi5leHRlbnNpb24pIDogYi5zaXplIC0gYS5zaXplKSk7XG4gIH0sIFtjdXN0b21UaHJlc2hvbGRHYiwgbGFyZ2VGaWxlRXh0ZW5zaW9uLCBsYXJnZUZpbGVTb3J0LCBsYXJnZUZpbGVUaHJlc2hvbGQsIGxhcmdlc3RdKTtcbiAgY29uc3Qgc2Nhbm5lZEV4dGVuc2lvbnMgPSB1c2VNZW1vPHN0cmluZ1tdPihcbiAgICAoKSA9PiBbLi4ubmV3IFNldChsYXJnZXN0Lm1hcCgoZmlsZSkgPT4gZmlsZS5leHRlbnNpb24pLmZpbHRlcihCb29sZWFuKSldLnNvcnQoKSxcbiAgICBbbGFyZ2VzdF0sXG4gICk7XG4gIGNvbnN0IGRldmVsb3BlclRvdGFsID0gdXNlTWVtbygoKSA9PiBkZXZlbG9wZXJJdGVtcy5yZWR1Y2UoKHN1bSwgaXRlbSkgPT4gc3VtICsgaXRlbS5zaXplLCAwKSwgW2RldmVsb3Blckl0ZW1zXSk7XG4gIGNvbnN0IGNsZWFudXBUb3RhbCA9IHVzZU1lbW8oKCkgPT4gY2xlYW51cEl0ZW1zLnJlZHVjZSgoc3VtLCBpdGVtKSA9PiBzdW0gKyBpdGVtLnNpemUsIDApLCBbY2xlYW51cEl0ZW1zXSk7XG4gIGNvbnN0IGNsZWFudXBBc3Nlc3NtZW50cyA9IHVzZU1lbW8oKCkgPT5cbiAgICBjbGVhbnVwSXRlbXMubWFwKChpdGVtKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gZGlzcGxheVBhdGgoaXRlbS5wYXRoKS5zcGxpdCgvW1xcXFwvXS8pLmZpbHRlcihCb29sZWFuKS5hdCgtMSk/LnRvTG93ZXJDYXNlKCkgfHwgJyc7XG4gICAgICBjb25zdCBsb3dSaXNrID0gL14oPzpjYWNoZXxjYWNoZXN8dGVtcHx0bXB8bG9ncz98X19weWNhY2hlX18pJC8udGVzdChuYW1lKTtcbiAgICAgIGNvbnN0IG1lZGl1bVJpc2sgPSAvXig/OnRhcmdldHxkaXN0fGJ1aWxkKSQvLnRlc3QobmFtZSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5pdGVtLFxuICAgICAgICByaXNrOiBsb3dSaXNrID8gJ+S9jumjjumZqScgOiBtZWRpdW1SaXNrID8gJ+mcgOimgeehruiupCcgOiAn5LuF5bu66K6u5qOA5p+lJyxcbiAgICAgICAgZXZpZGVuY2U6IGxvd1Jpc2tcbiAgICAgICAgICA/ICfluLjop4HnvJPlrZjjgIHkuLTml7bmlofku7bmiJbml6Xlv5fnm67lvZUnXG4gICAgICAgICAgOiBtZWRpdW1SaXNrXG4gICAgICAgICAgICA/ICflj6/nlLHmnoTlu7rlt6Xlhbfph43mlrDnlJ/miJDvvIzkvYbph43mlrDmnoTlu7rpnIDopoHml7bpl7QnXG4gICAgICAgICAgICA6ICflj6/og73ljIXlkKvpobnnm67kvp3otZbmiJbnlKjmiLfku43lnKjkvb/nlKjnmoTmlbDmja4nLFxuICAgICAgfSBhcyB7IHBhdGg6IHN0cmluZzsgc2l6ZTogbnVtYmVyOyByaXNrOiAn5L2O6aOO6ZmpJyB8ICfpnIDopoHnoa7orqQnIHwgJ+S7heW7uuiuruajgOafpSc7IGV2aWRlbmNlOiBzdHJpbmcgfTtcbiAgICB9KSxcbiAgICBbY2xlYW51cEl0ZW1zXSxcbiAgKTtcbiAgY29uc3Qgc2VsZWN0ZWREdXBsaWNhdGVCeXRlcyA9IHVzZU1lbW8oXG4gICAgKCkgPT4gZHVwbGljYXRlcy5mbGF0TWFwKChncm91cCkgPT4gZ3JvdXAuZmlsZXMpLmZpbHRlcigoZmlsZSkgPT4gc2VsZWN0ZWREdXBsaWNhdGVzLmluY2x1ZGVzKGZpbGUucGF0aCkpLnJlZHVjZSgoc3VtLCBmaWxlKSA9PiBzdW0gKyBmaWxlLnNpemUsIDApLFxuICAgIFtkdXBsaWNhdGVzLCBzZWxlY3RlZER1cGxpY2F0ZXNdLFxuICApO1xuICBjb25zdCBkaXJlY3RvcnlDaGFuZ2VzID0gdXNlTWVtbzxEaXJlY3RvcnlDaGFuZ2VbXT4oKCkgPT4ge1xuICAgIGNvbnN0IG1hdGNoaW5nID0gZGlyZWN0b3J5U25hcHNob3REYXRhXG4gICAgICAuZmlsdGVyKChzbmFwc2hvdCkgPT4gZGlzcGxheVBhdGgoc25hcHNob3Qucm9vdCkudG9Mb3dlckNhc2UoKSA9PT0gZGlzcGxheVBhdGgocm9vdCkudG9Mb3dlckNhc2UoKSlcbiAgICAgIC5zbGljZSgtMik7XG4gICAgaWYgKG1hdGNoaW5nLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgICBjb25zdCBbcHJldmlvdXMsIGN1cnJlbnRdID0gbWF0Y2hpbmc7XG4gICAgY29uc3QgYmVmb3JlID0gbmV3IE1hcChwcmV2aW91cy5kaXJlY3Rvcmllcy5tYXAoKGl0ZW0pID0+IFtkaXNwbGF5UGF0aChpdGVtLnBhdGgpLnRvTG93ZXJDYXNlKCksIGl0ZW1dKSk7XG4gICAgY29uc3QgYWZ0ZXIgPSBuZXcgTWFwKGN1cnJlbnQuZGlyZWN0b3JpZXMubWFwKChpdGVtKSA9PiBbZGlzcGxheVBhdGgoaXRlbS5wYXRoKS50b0xvd2VyQ2FzZSgpLCBpdGVtXSkpO1xuICAgIHJldHVybiBbLi4ubmV3IFNldChbLi4uYmVmb3JlLmtleXMoKSwgLi4uYWZ0ZXIua2V5cygpXSldXG4gICAgICAubWFwKChrZXkpID0+IHtcbiAgICAgICAgY29uc3Qgb2xkSXRlbSA9IGJlZm9yZS5nZXQoa2V5KTtcbiAgICAgICAgY29uc3QgbmV3SXRlbSA9IGFmdGVyLmdldChrZXkpO1xuICAgICAgICByZXR1cm4geyBwYXRoOiBuZXdJdGVtPy5wYXRoID8/IG9sZEl0ZW0hLnBhdGgsIHNpemU6IG5ld0l0ZW0/LnNpemUgPz8gMCwgY2hhbmdlOiAobmV3SXRlbT8uc2l6ZSA/PyAwKSAtIChvbGRJdGVtPy5zaXplID8/IDApIH07XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigoaXRlbSkgPT4gTWF0aC5hYnMoaXRlbS5jaGFuZ2UpID49IDEwMjQgKiAxMDI0KVxuICAgICAgLnNvcnQoKGEsIGIpID0+IE1hdGguYWJzKGIuY2hhbmdlKSAtIE1hdGguYWJzKGEuY2hhbmdlKSlcbiAgICAgIC5zbGljZSgwLCAyMCk7XG4gIH0sIFtkaXJlY3RvcnlTbmFwc2hvdERhdGEsIHJvb3RdKTtcblxuICAvLyDor4rmlq3vvIhBSSDosIPnlKjvvIlcbiAgY29uc3QgZ2VuZXJhdGVEaWFnbm9zaXMgPSBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgZXZpZGVuY2UgPSB7XG4gICAgICByb290LCBzY2FubmVkOiBzdGF0cyxcbiAgICAgIGxhcmdlc3Q6IGxhcmdlc3Quc2xpY2UoMCwgMTApLm1hcCgoZmlsZSkgPT4gKHsgcGF0aDogZGlzcGxheVBhdGgoZmlsZS5wYXRoKSwgc2l6ZTogZm9ybWF0Qnl0ZXMoZmlsZS5zaXplKSB9KSksXG4gICAgICBncm93dGg6IGRpcmVjdG9yeUNoYW5nZXMuc2xpY2UoMCwgMTApLm1hcCgoaXRlbSkgPT4gKHsgcGF0aDogZGlzcGxheVBhdGgoaXRlbS5wYXRoKSwgY2hhbmdlOiBgJHtpdGVtLmNoYW5nZSA+IDAgPyAnKycgOiAnLSd9JHtmb3JtYXRCeXRlcyhNYXRoLmFicyhpdGVtLmNoYW5nZSkpfWAgfSkpLFxuICAgICAgY2xlYW51cDogY2xlYW51cEl0ZW1zLnNsaWNlKDAsIDEwKS5tYXAoKGl0ZW0pID0+ICh7IHBhdGg6IGRpc3BsYXlQYXRoKGl0ZW0ucGF0aCksIHNpemU6IGZvcm1hdEJ5dGVzKGl0ZW0uc2l6ZSksIHJpc2s6ICfpnIDopoHnoa7orqQnIH0pKSxcbiAgICAgIGR1cGxpY2F0ZXM6IHsgZ3JvdXBzOiBkdXBsaWNhdGVzLmxlbmd0aCwgcmVjbGFpbWFibGU6IGZvcm1hdEJ5dGVzKGR1cGxpY2F0ZXMucmVkdWNlKChzdW0sIGdyb3VwKSA9PiBzdW0gKyBncm91cC5zaXplICogKGdyb3VwLmZpbGVzLmxlbmd0aCAtIDEpLCAwKSkgfSxcbiAgICB9O1xuICAgIGNvbnN0IGxvY2FsID0gYCMjIOacrOWcsOiviuaWrVxcblxcbi0g5omr5o+P6IyD5Zu077yaJHtyb290IHx8ICflsJrmnKrpgInmi6knfVxcbi0g5bey5omr5o+P77yaJHtzdGF0cy5maWxlcy50b0xvY2FsZVN0cmluZygpfSDkuKrmlofku7bvvIzlhbEgJHtmb3JtYXRCeXRlcyhzdGF0cy5ieXRlcyl9XFxuLSDmuIXnkIblgJnpgInvvJoke2NsZWFudXBJdGVtcy5sZW5ndGh9IOmhue+8jOe6piAke2Zvcm1hdEJ5dGVzKGNsZWFudXBUb3RhbCl977yI5YWo6YOo6ZyA6KaB56Gu6K6k77yJXFxuLSDph43lpI3mlofku7bvvJoke2R1cGxpY2F0ZXMubGVuZ3RofSDnu4RcXG5cXG7or7flhYjlrozmiJDmiavmj4/vvJvphY3nva4gQUkg5ZCO5Y+v55Sf5oiQ5bim6K+B5o2u55qE5Y6f5Zug5YiG5p6Q5ZKM5riF55CG6aG65bqP44CCYDtcbiAgICBpZiAoIWFpQXBpLmFwaUtleSB8fCAhYWlBcGkuYmFzZVVybCB8fCAhYWlBcGkubW9kZWwpIHtcbiAgICAgIHNldERpYWdub3Npcyhsb2NhbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHNldERpYWdub3NpbmcodHJ1ZSk7XG4gICAgc2V0RGlhZ25vc2lzKCcnKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcHJvdmlkZXIgPSBjcmVhdGVPcGVuQUlQcm92aWRlcih7IGFwaUtleTogYWlBcGkuYXBpS2V5LCBiYXNlVXJsOiBhaUFwaS5iYXNlVXJsIH0pO1xuICAgICAgY29uc3QgbWVzc2FnZXMgPSBbXG4gICAgICAgIHsgcm9sZTogJ3N5c3RlbScgYXMgY29uc3QsIGNvbnRlbnQ6ICfkvaDmmK/mnKzlnLDno4Hnm5jor4rmlq3liqnmiYvjgILlj6rkvp3mja7nu5nlrpogSlNPTiDor4Hmja7liIbmnpDvvIzkuI3lvpfoh4bmtYvjgILkvb/nlKjkuK3mlocgTWFya2Rvd27vvIzkvp3mrKHnu5nlh7rvvJrlrrnph4/nu5PorrrjgIHlop7plb/mnaXmupDjgIHmjInpo47pmanmjpLluo/nmoTmuIXnkIblu7rorq7jgIHpooTorqHph4rmlL7nqbrpl7TjgILmr4/mnaHnu5Porrrlv4XpobvlvJXnlKjlhbfkvZPot6/lvoTlkozlrrnph4/vvJvmuIXnkIblgJnpgInlnYfpnIDkurrlt6Xnoa7orqTvvIzkuI3lu7rorq7liKDpmaTns7vnu5/nm67lvZXjgIInIH0sXG4gICAgICAgIHsgcm9sZTogJ3VzZXInIGFzIGNvbnN0LCBjb250ZW50OiBKU09OLnN0cmluZ2lmeShldmlkZW5jZSkgfSxcbiAgICAgIF07XG4gICAgICBsZXQgdGV4dCA9ICcnO1xuICAgICAgZm9yIGF3YWl0IChjb25zdCBjaHVuayBvZiBwcm92aWRlci5jaGF0KG1lc3NhZ2VzLCB7IG1vZGVsOiBhaUFwaS5tb2RlbCwgdGVtcGVyYXR1cmU6IDAuMiwgbWF4VG9rZW5zOiAxODAwLCBzdHJlYW06IHRydWUgfSkpIHtcbiAgICAgICAgaWYgKGNodW5rLmRlbHRhKSB7IHRleHQgKz0gY2h1bmsuZGVsdGE7IHNldERpYWdub3Npcyh0ZXh0KTsgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgICBzZXREaWFnbm9zaXMoYCR7bG9jYWx9XFxuXFxuPiBBSSDor4rmlq3lpLHotKXvvJoke2NhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVzZS5tZXNzYWdlIDogU3RyaW5nKGNhdXNlKX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgc2V0RGlhZ25vc2luZyhmYWxzZSk7XG4gICAgfVxuICB9O1xuICBjb25zdCBleHBvcnRTY2FuUmVwb3J0ID0gYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBgIyDno4Hnm5jmiavmj4/miqXlkYpcXG5cXG4tIOaJq+aPj+iMg+WbtO+8miR7ZGlzcGxheVBhdGgocm9vdCl9XFxuLSDmlofku7bmlbDph4/vvJoke3N0YXRzLmZpbGVzLnRvTG9jYWxlU3RyaW5nKCl9XFxuLSDmiavmj4/lrrnph4/vvJoke2Zvcm1hdEJ5dGVzKHN0YXRzLmJ5dGVzKX1cXG4tIOivu+WPlumXrumimO+8miR7c3RhdHMuZXJyb3JzfVxcbi0g6YeN5aSN5paH5Lu257uE77yaJHtkdXBsaWNhdGVzLmxlbmd0aH1cXG4tIOa4heeQhuWAmemAie+8miR7Zm9ybWF0Qnl0ZXMoY2xlYW51cFRvdGFsKX1cXG5cXG4jIyDmnIDlpKfmlofku7ZcXG5cXG4ke2xhcmdlc3Quc2xpY2UoMCwgMzApLm1hcCgoZmlsZSkgPT4gYC0gJHtmb3JtYXRCeXRlcyhmaWxlLnNpemUpfSDCtyBcXGAke2Rpc3BsYXlQYXRoKGZpbGUucGF0aCl9XFxgYCkuam9pbignXFxuJyl9XFxuXFxuIyMg55uu5b2V5Y+Y5YyWXFxuXFxuJHtkaXJlY3RvcnlDaGFuZ2VzLm1hcCgoaXRlbSkgPT4gYC0gJHtpdGVtLmNoYW5nZSA+IDAgPyAnKycgOiAnLSd9JHtmb3JtYXRCeXRlcyhNYXRoLmFicyhpdGVtLmNoYW5nZSkpfSDCtyBcXGAke2Rpc3BsYXlQYXRoKGl0ZW0ucGF0aCl9XFxgYCkuam9pbignXFxuJyl9YDtcbiAgICBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuc2F2ZUZpbGUoY29udGVudCwgYOejgeebmOaJq+aPj+aKpeWRii0ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCl9Lm1kYCk7XG4gIH07XG5cbiAgLy8gcmVzdG9yZVNhdmVkUmVzdWx0IOWMheijhe+8muaBouWkjeWQjuWIh+WIsCBhbmFseXNpcyB0YWIg5bm25YWz6ZetIG1vZGFsXG4gIGNvbnN0IGhhbmRsZVJlc3RvcmUgPSBhc3luYyAoaWQ6IHN0cmluZykgPT4ge1xuICAgIGF3YWl0IHJlc3RvcmVTYXZlZFJlc3VsdChpZCk7XG4gICAgc2V0UmVzdWx0c09wZW4oZmFsc2UpO1xuICAgIHNldEFjdGl2ZVRhYignYW5hbHlzaXMnKTtcbiAgfTtcblxuICAvLyBwYXJlbnREaXJlY3Rvcnkg57uZIEJyb3dzZXJUYWIg55SoXG4gIGNvbnN0IHBhcmVudERpcmVjdG9yeSA9XG4gICAgY3VycmVudERpcmVjdG9yeSAmJiBjdXJyZW50RGlyZWN0b3J5ICE9PSByb290XG4gICAgICA/IGN1cnJlbnREaXJlY3RvcnkucmVwbGFjZSgvW1xcXFwvXVteXFxcXC9dK1tcXFxcL10/JC8sICcnKVxuICAgICAgOiAnJztcblxuICBjb25zdCBzdW1tYXJ5OiBTY2FuU3VtbWFyeSA9IHtcbiAgICBleHRlbnNpb25EYXRhLFxuICAgIGV4dGVuc2lvbk9wdGlvbixcbiAgICBkaXJlY3RvcnlEYXRhLFxuICAgIGRpcmVjdG9yeU9wdGlvbixcbiAgICBkZXZlbG9wZXJJdGVtcyxcbiAgICBjbGVhbnVwSXRlbXMsXG4gICAgZGV2ZWxvcGVyVG90YWwsXG4gICAgY2xlYW51cFRvdGFsLFxuICAgIGhpc3RvcnlPcHRpb24sXG4gICAgdmlzaWJsZUxhcmdlc3QsXG4gICAgc2Nhbm5lZEV4dGVuc2lvbnMsXG4gICAgc2VsZWN0ZWREdXBsaWNhdGVCeXRlcyxcbiAgICBjbGVhbnVwQXNzZXNzbWVudHMsXG4gICAgZGlyZWN0b3J5Q2hhbmdlcyxcbiAgfTtcblxuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3NOYW1lPVwiaC1mdWxsIG1pbi1oLTAgb3ZlcmZsb3cteS1hdXRvIGJnLWJhY2tncm91bmQgcC01XCI+XG4gICAgICA8ZGl2IGNsYXNzTmFtZT1cIm14LWF1dG8gZmxleCB3LWZ1bGwgbWF4LXctWzE3MDBweF0gZmxleC1jb2wgZ2FwLTRcIj5cbiAgICAgICAgPGhlYWRlciBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLXN0YXJ0IGp1c3RpZnktYmV0d2VlblwiPlxuICAgICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8aDEgY2xhc3NOYW1lPVwiZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIgdGV4dC14bCBmb250LXNlbWlib2xkXCI+XG4gICAgICAgICAgICAgIDxIYXJkRHJpdmUgY2xhc3NOYW1lPVwiaC01IHctNVwiIC8+56OB55uY56m66Ze0XG4gICAgICAgICAgICA8L2gxPlxuICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXNtIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPuezu+e7n+i1hOa6kOamguiniOOAgeebruW9leWIhuaekOS4juWuieWFqOaWh+S7tumihOiniDwvcD5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzc05hbWU9XCJyb3VuZGVkLW1kIGJvcmRlciBwLTIgaG92ZXI6YmctYWNjZW50XCJcbiAgICAgICAgICAgIHRpdGxlPVwi5Yi35paw57O757uf5L+h5oGvXCJcbiAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaFN5c3RlbSgpfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxSZWZyZXNoQ3cgY2xhc3NOYW1lPVwiaC00IHctNFwiIC8+XG4gICAgICAgICAgPC9idXR0b24+XG4gICAgICAgIDwvaGVhZGVyPlxuICAgICAgICA8c3R5bGU+e2BzZWN0aW9uOmhhcyg+IC5ib3JkZXItcikgeyBkaXNwbGF5OiAke2FjdGl2ZVRhYiA9PT0gJ2Jyb3dzZXInID8gJ2dyaWQnIDogJ25vbmUnfSAhaW1wb3J0YW50OyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IG1pbm1heCgwLCAxZnIpICFpbXBvcnRhbnQ7IH0gc2VjdGlvbjpoYXMoPiAuYm9yZGVyLXIpID4gZGl2Omxhc3QtY2hpbGQgeyBkaXNwbGF5OiBub25lICFpbXBvcnRhbnQ7IH0gc2VjdGlvbjpoYXMoPiBoMi5zdGlja3kpIHsgZGlzcGxheTogbm9uZSAhaW1wb3J0YW50OyB9ICR7YWN0aXZlVGFiICE9PSAnYW5hbHlzaXMnID8gJ3NlY3Rpb246aGFzKD4gLmJvcmRlci1yKSB+IHNlY3Rpb24geyBkaXNwbGF5OiBub25lICFpbXBvcnRhbnQ7IH0nIDogJyd9YH08L3N0eWxlPlxuICAgICAgICA8bmF2IGNsYXNzTmFtZT1cImZsZXggZ2FwLTEgb3ZlcmZsb3cteC1hdXRvIHJvdW5kZWQteGwgYm9yZGVyIGJnLWNhcmQgcC0xIHNoYWRvdy1zbVwiIGFyaWEtbGFiZWw9XCLno4Hnm5jnqbrpl7Tlip/og71cIj5cbiAgICAgICAgICB7KFtbJ292ZXJ2aWV3JywgJ+i1hOa6kOamguiniCddLCBbJ2Jyb3dzZXInLCAn55uu5b2V5rWP6KeIJ10sIFsnYW5hbHlzaXMnLCAn56m66Ze05YiG5p6QJ10sIFsnZGV2ZWxvcGVyJywgJ+W8gOWPkeiAheepuumXtCddLCBbJ2NsZWFudXAnLCAn5riF55CG5bu66K6uJ10sIFsnZG9jdG9yJywgJ+ejgeebmOWMu+eUnyddXSBhcyBjb25zdCkubWFwKChbaWQsIGxhYmVsXSkgPT4gKFxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICBrZXk9e2lkfVxuICAgICAgICAgICAgICBjbGFzc05hbWU9e2BzaHJpbmstMCByb3VuZGVkLWxnIHB4LTUgcHktMiB0ZXh0LXNtIHRyYW5zaXRpb24tY29sb3JzICR7YWN0aXZlVGFiID09PSBpZCA/ICdiZy1wcmltYXJ5IHRleHQtcHJpbWFyeS1mb3JlZ3JvdW5kIHNoYWRvdy1zbScgOiAndGV4dC1tdXRlZC1mb3JlZ3JvdW5kIGhvdmVyOmJnLWFjY2VudCBob3Zlcjp0ZXh0LWZvcmVncm91bmQnfWB9XG4gICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldEFjdGl2ZVRhYihpZCBhcyBBY3RpdmVUYWIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICB7bGFiZWx9XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9uYXY+XG4gICAgICAgIHtyb290ICYmIChcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0yIHRleHQteHMgdGV4dC1tdXRlZC1mb3JlZ3JvdW5kXCI+XG4gICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9e2Byb3VuZGVkLWZ1bGwgcHgtMiBweS0xICR7dXNuSW5mbz8uc3VwcG9ydGVkID8gJ2JnLWVtZXJhbGQtNTAwLzEwIHRleHQtZW1lcmFsZC03MDAnIDogJ2JnLW11dGVkJ31gfT5cbiAgICAgICAgICAgICAge3VzbkluZm8/LnN1cHBvcnRlZCA/IGBOVEZTIFVTTiDlt7LlkK/nlKggwrcgJHt1c25JbmZvLm1ldGhvZCA9PT0gJ25hdGl2ZScgPyAn5Y6f55SfIEFQSScgOiAn5YW85a655qih5byPJ31gIDogJ+agh+WHhuS8mOWMluaJq+aPjyd9XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICB7dXNuSW5mbz8uc3VwcG9ydGVkICYmIHVzbkluZm8udm9sdW1lICYmIChcbiAgICAgICAgICAgICAgPHNwYW4+e3VzbkluZm8udm9sdW1lfSBKb3VybmFsIMK3IE5leHQgVVNOIHt1c25JbmZvLm5leHRVc24/LnRvTG9jYWxlU3RyaW5nKCl9PC9zcGFuPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIHt1c25JbmZvPy5lcnJvciAmJiA8c3BhbiB0aXRsZT17dXNuSW5mby5lcnJvcn0+VVNOIOS4jeWPr+eUqDwvc3Bhbj59XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICl9XG4gICAgICAgIHt1c25JbmZvPy5zdXBwb3J0ZWQgJiYgdXNuRGVsdGEgIT09IG51bGwgJiYgKFxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj7nm7jlr7nkuIrmrKHorrDlvZXvvIxVU04g5ri45qCH5YmN6L+bIHt1c25EZWx0YS50b0xvY2FsZVN0cmluZygpfSDlrZfoioLvvJtKb3VybmFsIElEIOWPmOWMluaXtuS8muiHquWKqOaUvuW8g+aXp+a4uOagh+W5tuaJp+ihjOWujOaVtOaJq+aPj+OAgjwvZGl2PlxuICAgICAgICApfVxuXG4gICAgICAgIDxNb2RhbCBvcGVuPXtCb29sZWFuKHByZXZpZXcpfSB0aXRsZT17cHJldmlldz8ubmFtZSB8fCAn5paH5Lu26aKE6KeIJ30gd2lkdGg9XCJtaW4oMTEwMHB4LCA5MnZ3KVwiIGZvb3Rlcj17cHJldmlldyA/IChcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlblwiPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj5cbiAgICAgICAgICAgICAge2Zvcm1hdEJ5dGVzKHByZXZpZXcuc2l6ZSl9IMK3IHtuZXcgRGF0ZShwcmV2aWV3Lm1vZGlmaWVkQXQpLnRvTG9jYWxlU3RyaW5nKCl9e3ByZXZpZXcudHJ1bmNhdGVkID8gJyDCtyDku4XlsZXnpLrliY0gMSBNQicgOiAnJ31cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPVwiZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIgcm91bmRlZC1tZCBib3JkZXIgcHgtMyBweS0xLjUgdGV4dC1zbSBob3ZlcjpiZy1hY2NlbnRcIiBvbkNsaWNrPXsoKSA9PiB2b2lkIHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2Uub3Blbihyb290LCBwcmV2aWV3LnBhdGgpfT5cbiAgICAgICAgICAgICAgPEV4dGVybmFsTGluayBjbGFzc05hbWU9XCJoLTQgdy00XCIgLz7pu5jorqTlupTnlKjmiZPlvIBcbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICApIDogbnVsbH0gb25DYW5jZWw9eygpID0+IHNldFByZXZpZXcobnVsbCl9IGRlc3Ryb3lPbkNsb3NlPlxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibWF4LWgtWzcydmhdIG1pbi1oLVszMjBweF0gb3ZlcmZsb3ctYXV0byByb3VuZGVkLWxnIGJnLWJhY2tncm91bmQgcC01XCI+XG4gICAgICAgICAgICB7IXByZXZpZXcgPyBudWxsIDogcHJldmlldy5raW5kID09PSAnaW1hZ2UnICYmIHByZXZpZXcuY29udGVudCA/IChcbiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IG1pbi1oLVszMjBweF0gaXRlbXMtY2VudGVyIGp1c3RpZnktY2VudGVyXCI+XG4gICAgICAgICAgICAgICAgPGltZyBjbGFzc05hbWU9XCJtYXgtaC1bNjh2aF0gbWF4LXctZnVsbCByb3VuZGVkLWxnIG9iamVjdC1jb250YWluIHNoYWRvd1wiIHNyYz17YGRhdGE6JHtwcmV2aWV3Lm1pbWVUeXBlfTtiYXNlNjQsJHtwcmV2aWV3LmNvbnRlbnR9YH0gYWx0PXtwcmV2aWV3Lm5hbWV9IC8+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSA6IHByZXZpZXcua2luZCA9PT0gJ3RleHQnICYmIC9cXC5tZCg/Om93bik/JC9pLnRlc3QocHJldmlldy5uYW1lKSA/IChcbiAgICAgICAgICAgICAgPFhNYXJrZG93biBjb250ZW50PXtwcmV2aWV3LmNvbnRlbnQgfHwgJ18o56m65paH5qGjKV8nfSBjbGFzc05hbWU9XCJjaGF0LW1hcmtkb3duIHByb3NlIHByb3NlLXNtIG1heC13LW5vbmUgYnJlYWstd29yZHMgZGFyazpwcm9zZS1pbnZlcnRcIiAvPlxuICAgICAgICAgICAgKSA6IHByZXZpZXcua2luZCA9PT0gJ3RleHQnID8gKFxuICAgICAgICAgICAgICA8cHJlIGNsYXNzTmFtZT1cIndoaXRlc3BhY2UtcHJlLXdyYXAgYnJlYWstd29yZHMgZm9udC1tb25vIHRleHQteHMgbGVhZGluZy02XCI+e3ByZXZpZXcuY29udGVudH08L3ByZT5cbiAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgIDxFbXB0eVN0YXRlPntwcmV2aWV3Lm1lc3NhZ2V9PC9FbXB0eVN0YXRlPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9Nb2RhbD5cbiAgICAgICAgPE1vZGFsIG9wZW49e2Vycm9yc09wZW59IHRpdGxlPXtg5omr5o+P6Zeu6aKY77yIJHtzY2FuRXJyb3JzLmxlbmd0aH3vvIlgfSBmb290ZXI9e251bGx9IHdpZHRoPVwibWluKDkwMHB4LCA5MHZ3KVwiIG9uQ2FuY2VsPXsoKSA9PiBzZXRFcnJvcnNPcGVuKGZhbHNlKX0+XG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtYXgtaC1bNjV2aF0gb3ZlcmZsb3ctYXV0b1wiPlxuICAgICAgICAgICAge3NjYW5FcnJvcnMubGVuZ3RoID8gc2NhbkVycm9ycy5tYXAoKGl0ZW06IFNjYW5FcnJvckl0ZW0sIGluZGV4KSA9PiAoXG4gICAgICAgICAgICAgIDxkaXYga2V5PXtgJHtpdGVtLnBhdGh9LSR7aW5kZXh9YH0gY2xhc3NOYW1lPVwiYm9yZGVyLWIgcHktM1wiPlxuICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cImJyZWFrLWFsbCBmb250LW1vbm8gdGV4dC14c1wiPntkaXNwbGF5UGF0aChpdGVtLnBhdGgpfTwvcD5cbiAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJtdC0xIHRleHQteHMgdGV4dC1kZXN0cnVjdGl2ZVwiPntpdGVtLm1lc3NhZ2V9PC9wPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpIDogPEVtcHR5U3RhdGU+5rKh5pyJ6K6w5b2V5Yiw5p2D6ZmQ5oiW6K+75Y+W6Zeu6aKYPC9FbXB0eVN0YXRlPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9Nb2RhbD5cbiAgICAgICAgPE1vZGFsIG9wZW49e3NuYXBzaG90c09wZW59IHRpdGxlPVwi5omr5o+P5b+r54Wn566h55CGXCIgZm9vdGVyPXtudWxsfSB3aWR0aD1cIm1pbig5MDBweCwgOTB2dylcIiBvbkNhbmNlbD17KCkgPT4gc2V0U25hcHNob3RzT3BlbihmYWxzZSl9PlxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibWF4LWgtWzY1dmhdIG92ZXJmbG93LWF1dG9cIj5cbiAgICAgICAgICAgIHtkaXJlY3RvcnlTbmFwc2hvdHMubWFwKChzbmFwc2hvdCkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17c25hcHNob3QuaWR9IGNsYXNzTmFtZT1cImdyaWQgZ3JpZC1jb2xzLVttaW5tYXgoMCwxZnIpXzE3MHB4XzgwcHhdIGl0ZW1zLWNlbnRlciBnYXAtMyBib3JkZXItYiBweS0zXCI+XG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtaW4tdy0wXCI+XG4gICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0cnVuY2F0ZSBmb250LW1vbm8gdGV4dC14c1wiPntkaXNwbGF5UGF0aChzbmFwc2hvdC5yb290KX08L3A+XG4gICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPuiusOW9lSB7c25hcHNob3QuZGlyZWN0b3J5Q291bnR9IOS4quS4u+imgeebruW9lTwvcD5cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPntuZXcgRGF0ZShzbmFwc2hvdC50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKCl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LWRlc3RydWN0aXZlIGhvdmVyOnVuZGVybGluZVwiIG9uQ2xpY2s9eygpID0+IHZvaWQgcmVtb3ZlRGlyZWN0b3J5U25hcHNob3Qoc25hcHNob3QuaWQpfT7liKDpmaQ8L2J1dHRvbj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9Nb2RhbD5cbiAgICAgICAgPE1vZGFsIG9wZW49e3Jlc3VsdHNPcGVufSB0aXRsZT1cIuaJq+aPj+e7k+aenOWtmOaho1wiIGZvb3Rlcj17bnVsbH0gd2lkdGg9XCJtaW4oOTYwcHgsIDkydncpXCIgb25DYW5jZWw9eygpID0+IHNldFJlc3VsdHNPcGVuKGZhbHNlKX0+XG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtYXgtaC1bNjh2aF0gb3ZlcmZsb3ctYXV0b1wiPlxuICAgICAgICAgICAge3NhdmVkUmVzdWx0cy5sZW5ndGggPyBbLi4uc2F2ZWRSZXN1bHRzXS5yZXZlcnNlKCkubWFwKChzYXZlZCkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17c2F2ZWQuaWR9IGNsYXNzTmFtZT1cImdyaWQgZ3JpZC1jb2xzLVttaW5tYXgoMCwxZnIpXzEyMHB4XzE3MHB4XzEzMHB4XSBpdGVtcy1jZW50ZXIgZ2FwLTMgYm9yZGVyLWIgcHktM1wiPlxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibWluLXctMFwiPlxuICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidHJ1bmNhdGUgZm9udC1tb25vIHRleHQteHNcIj57ZGlzcGxheVBhdGgoc2F2ZWQucm9vdCl9PC9wPlxuICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj57c2F2ZWQuc3RhdHMuZmlsZXMudG9Mb2NhbGVTdHJpbmcoKX0g5Liq5paH5Lu2IMK3IHtmb3JtYXRCeXRlcyhzYXZlZC5zdGF0cy5ieXRlcyl9PC9wPlxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInRleHQtcmlnaHQgdGV4dC14c1wiPntzYXZlZC5kdXBsaWNhdGVzfSDnu4Tph43lpI08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj57bmV3IERhdGUoc2F2ZWQuc2F2ZWRBdCkudG9Mb2NhbGVTdHJpbmcoKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGp1c3RpZnktZW5kIGdhcC0yXCI+XG4gICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1wcmltYXJ5IGhvdmVyOnVuZGVybGluZVwiIG9uQ2xpY2s9eygpID0+IHZvaWQgaGFuZGxlUmVzdG9yZShzYXZlZC5pZCl9PuaBouWkjTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtZGVzdHJ1Y3RpdmUgaG92ZXI6dW5kZXJsaW5lXCIgb25DbGljaz17KCkgPT4gdm9pZCByZW1vdmVTYXZlZFJlc3VsdChzYXZlZC5pZCl9PuWIoOmZpDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpIDogPEVtcHR5U3RhdGU+5pqC5peg5omr5o+P57uT5p6c5a2Y5qGjPC9FbXB0eVN0YXRlPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9Nb2RhbD5cblxuICAgICAgICB7YWN0aXZlVGFiID09PSAnb3ZlcnZpZXcnICYmIChcbiAgICAgICAgICA8T3ZlcnZpZXdUYWJcbiAgICAgICAgICAgIHNjYW49e3NjYW59XG4gICAgICAgICAgICBoaXN0b3J5T3B0aW9uPXtzdW1tYXJ5Lmhpc3RvcnlPcHRpb259XG4gICAgICAgICAgICBvbk9wZW5TbmFwc2hvdHM9eygpID0+IHNldFNuYXBzaG90c09wZW4odHJ1ZSl9XG4gICAgICAgICAgICBvbk9wZW5SZXN1bHRzPXsoKSA9PiBzZXRSZXN1bHRzT3Blbih0cnVlKX1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuICAgICAgICB7YWN0aXZlVGFiID09PSAnYnJvd3NlcicgJiYgKFxuICAgICAgICAgIDxCcm93c2VyVGFiXG4gICAgICAgICAgICBzY2FuPXtzY2FufVxuICAgICAgICAgICAgcHJldmlldz17cHJldmlld31cbiAgICAgICAgICAgIHNldFByZXZpZXc9e3NldFByZXZpZXd9XG4gICAgICAgICAgICBvcGVuUHJldmlldz17b3BlblByZXZpZXd9XG4gICAgICAgICAgICBwYXJlbnREaXJlY3Rvcnk9e3BhcmVudERpcmVjdG9yeX1cbiAgICAgICAgICAgIGxvYWREaXJlY3Rvcnk9e2xvYWREaXJlY3Rvcnl9XG4gICAgICAgICAgICBzaG93QW5hbHlzaXNDb250cm9scz17ZmFsc2V9XG4gICAgICAgICAgICBpc0ZvY3VzZWRUYWI9e2lzRm9jdXNlZFRhYn1cbiAgICAgICAgICAgIHN0YXJ0PXtzdGFydH1cbiAgICAgICAgICAgIGNhbmNlbFNjYW49e2NhbmNlbFNjYW59XG4gICAgICAgICAgICBjaG9vc2U9e2Nob29zZX1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuICAgICAgICB7YWN0aXZlVGFiID09PSAnYW5hbHlzaXMnICYmIChcbiAgICAgICAgICA8QnJvd3NlclRhYlxuICAgICAgICAgICAgc2Nhbj17c2Nhbn1cbiAgICAgICAgICAgIHByZXZpZXc9e3ByZXZpZXd9XG4gICAgICAgICAgICBzZXRQcmV2aWV3PXtzZXRQcmV2aWV3fVxuICAgICAgICAgICAgb3BlblByZXZpZXc9e29wZW5QcmV2aWV3fVxuICAgICAgICAgICAgcGFyZW50RGlyZWN0b3J5PXtwYXJlbnREaXJlY3Rvcnl9XG4gICAgICAgICAgICBsb2FkRGlyZWN0b3J5PXtsb2FkRGlyZWN0b3J5fVxuICAgICAgICAgICAgc2hvd0FuYWx5c2lzQ29udHJvbHM9e3RydWV9XG4gICAgICAgICAgICBpc0ZvY3VzZWRUYWI9e2lzRm9jdXNlZFRhYn1cbiAgICAgICAgICAgIHN0YXJ0PXtzdGFydH1cbiAgICAgICAgICAgIGNhbmNlbFNjYW49e2NhbmNlbFNjYW59XG4gICAgICAgICAgICBjaG9vc2U9e2Nob29zZX1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuICAgICAgICB7YWN0aXZlVGFiID09PSAnYW5hbHlzaXMnICYmIChcbiAgICAgICAgICA8QW5hbHlzaXNUYWJcbiAgICAgICAgICAgIHNjYW49e3NjYW59XG4gICAgICAgICAgICBzZWxlY3RlZER1cGxpY2F0ZXM9e3NlbGVjdGVkRHVwbGljYXRlc31cbiAgICAgICAgICAgIHNldFNlbGVjdGVkRHVwbGljYXRlcz17c2V0U2VsZWN0ZWREdXBsaWNhdGVzfVxuICAgICAgICAgICAgbGFyZ2VGaWxlVGhyZXNob2xkPXtsYXJnZUZpbGVUaHJlc2hvbGR9XG4gICAgICAgICAgICBzZXRMYXJnZUZpbGVUaHJlc2hvbGQ9e3NldExhcmdlRmlsZVRocmVzaG9sZH1cbiAgICAgICAgICAgIGN1c3RvbVRocmVzaG9sZEdiPXtjdXN0b21UaHJlc2hvbGRHYn1cbiAgICAgICAgICAgIHNldEN1c3RvbVRocmVzaG9sZEdiPXtzZXRDdXN0b21UaHJlc2hvbGRHYn1cbiAgICAgICAgICAgIGxhcmdlRmlsZUV4dGVuc2lvbj17bGFyZ2VGaWxlRXh0ZW5zaW9ufVxuICAgICAgICAgICAgc2V0TGFyZ2VGaWxlRXh0ZW5zaW9uPXtzZXRMYXJnZUZpbGVFeHRlbnNpb259XG4gICAgICAgICAgICBsYXJnZUZpbGVTb3J0PXtsYXJnZUZpbGVTb3J0fVxuICAgICAgICAgICAgc2V0TGFyZ2VGaWxlU29ydD17c2V0TGFyZ2VGaWxlU29ydH1cbiAgICAgICAgICAgIHZpc2libGVMYXJnZXN0PXtzdW1tYXJ5LnZpc2libGVMYXJnZXN0fVxuICAgICAgICAgICAgc2Nhbm5lZEV4dGVuc2lvbnM9e3N1bW1hcnkuc2Nhbm5lZEV4dGVuc2lvbnN9XG4gICAgICAgICAgICBkaXJlY3RvcnlDaGFuZ2VzPXtzdW1tYXJ5LmRpcmVjdG9yeUNoYW5nZXN9XG4gICAgICAgICAgICBzZWxlY3RlZER1cGxpY2F0ZUJ5dGVzPXtzdW1tYXJ5LnNlbGVjdGVkRHVwbGljYXRlQnl0ZXN9XG4gICAgICAgICAgICBvcGVuUHJldmlldz17b3BlblByZXZpZXd9XG4gICAgICAgICAgLz5cbiAgICAgICAgKX1cbiAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ2RldmVsb3BlcicgJiYgKFxuICAgICAgICAgIDxEZXZlbG9wZXJUYWJcbiAgICAgICAgICAgIHNjYW49e3NjYW59XG4gICAgICAgICAgICBkZXZlbG9wZXJJdGVtcz17c3VtbWFyeS5kZXZlbG9wZXJJdGVtc31cbiAgICAgICAgICAgIGRldmVsb3BlclRvdGFsPXtzdW1tYXJ5LmRldmVsb3BlclRvdGFsfVxuICAgICAgICAgICAgaXNGb2N1c2VkVGFiPXtpc0ZvY3VzZWRUYWJ9XG4gICAgICAgICAgICBzcGVjaWFsdHlQcm9iZXM9e3NwZWNpYWx0eVByb2Jlc31cbiAgICAgICAgICAgIHByb2Jpbmc9e3Byb2Jpbmd9XG4gICAgICAgICAgICBzZXRTcGVjaWFsdHlQcm9iZXM9e3NldFNwZWNpYWx0eVByb2Jlc31cbiAgICAgICAgICAgIHNldFByb2Jpbmc9e3NldFByb2Jpbmd9XG4gICAgICAgICAgICBzdGFydD17c3RhcnR9XG4gICAgICAgICAgICBjaG9vc2U9e2Nob29zZX1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuICAgICAgICB7YWN0aXZlVGFiID09PSAnY2xlYW51cCcgJiYgKFxuICAgICAgICAgIDxDbGVhbnVwVGFiXG4gICAgICAgICAgICBzY2FuPXtzY2FufVxuICAgICAgICAgICAgY2xlYW51cEl0ZW1zPXtzdW1tYXJ5LmNsZWFudXBJdGVtc31cbiAgICAgICAgICAgIGNsZWFudXBUb3RhbD17c3VtbWFyeS5jbGVhbnVwVG90YWx9XG4gICAgICAgICAgICBjbGVhbnVwQXNzZXNzbWVudHM9e3N1bW1hcnkuY2xlYW51cEFzc2Vzc21lbnRzfVxuICAgICAgICAgICAgaXNGb2N1c2VkVGFiPXtpc0ZvY3VzZWRUYWJ9XG4gICAgICAgICAgICBjbGVhbnVwU3RhdHVzPXtjbGVhbnVwU3RhdHVzfVxuICAgICAgICAgICAgcnVuQ2xlYW51cD17cnVuQ2xlYW51cH1cbiAgICAgICAgICAgIGNsZWFyQ2xlYW51cFN0YXR1cz17Y2xlYXJDbGVhbnVwU3RhdHVzfVxuICAgICAgICAgICAgc3RhcnQ9e3N0YXJ0fVxuICAgICAgICAgICAgY2hvb3NlPXtjaG9vc2V9XG4gICAgICAgICAgLz5cbiAgICAgICAgKX1cbiAgICAgICAge2FjdGl2ZVRhYiA9PT0gJ2RvY3RvcicgJiYgKFxuICAgICAgICAgIDxEb2N0b3JUYWJcbiAgICAgICAgICAgIHNjYW49e3NjYW59XG4gICAgICAgICAgICBkaWFnbm9zaXM9e2RpYWdub3Npc31cbiAgICAgICAgICAgIHNldERpYWdub3Npcz17c2V0RGlhZ25vc2lzfVxuICAgICAgICAgICAgZGlhZ25vc2luZz17ZGlhZ25vc2luZ31cbiAgICAgICAgICAgIHNldERpYWdub3Npbmc9e3NldERpYWdub3Npbmd9XG4gICAgICAgICAgICBnZW5lcmF0ZURpYWdub3Npcz17Z2VuZXJhdGVEaWFnbm9zaXN9XG4gICAgICAgICAgICBleHBvcnRTY2FuUmVwb3J0PXtleHBvcnRTY2FuUmVwb3J0fVxuICAgICAgICAgICAgZGlyZWN0b3J5Q2hhbmdlcz17c3VtbWFyeS5kaXJlY3RvcnlDaGFuZ2VzfVxuICAgICAgICAgICAgY2xlYW51cFRvdGFsPXtzdW1tYXJ5LmNsZWFudXBUb3RhbH1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuXG4gICAgICAgIHtydW5uaW5nICYmIChcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgganVzdGlmeS1lbmQgZ2FwLTJcIj5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPVwicm91bmRlZC1tZCBib3JkZXIgcHgtMyBweS0xLjUgdGV4dC1zbSBob3ZlcjpiZy1hY2NlbnRcIiBvbkNsaWNrPXsoKSA9PiB2b2lkIHRvZ2dsZVBhdXNlKCl9PlxuICAgICAgICAgICAgICB7cGF1c2VkID8gJ+e7p+e7reaJq+aPjycgOiAn5pqC5YGc5omr5o+PJ31cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICBjbGFzc05hbWU9XCJyb3VuZGVkLW1kIGJvcmRlciBib3JkZXItZGVzdHJ1Y3RpdmUvNDAgcHgtMyBweS0xLjUgdGV4dC1zbSB0ZXh0LWRlc3RydWN0aXZlIGhvdmVyOmJnLWRlc3RydWN0aXZlLzEwXCJcbiAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gdm9pZCBjYW5jZWxTY2FuKCl9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIOWBnOatouaJq+aPj1xuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICl9XG4gICAgICAgIHtydW5uaW5nICYmIChcbiAgICAgICAgICA8c2VjdGlvbiBjbGFzc05hbWU9XCJyb3VuZGVkLTJ4bCBib3JkZXIgYmctY2FyZCBwLTQgc2hhZG93LXNtXCI+XG4gICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImdyaWQgZ2FwLTQgc206Z3JpZC1jb2xzLTRcIj5cbiAgICAgICAgICAgICAgPGRpdj48cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPuW3sui/kOihjDwvcD48cCBjbGFzc05hbWU9XCJtdC0xIGZvbnQtc2VtaWJvbGRcIj57Zm9ybWF0RHVyYXRpb24oc2NhblRlbGVtZXRyeS5lbGFwc2VkTXMpfTwvcD48L2Rpdj5cbiAgICAgICAgICAgICAgPGRpdj48cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPuaJq+aPj+mAn+W6pjwvcD48cCBjbGFzc05hbWU9XCJtdC0xIGZvbnQtc2VtaWJvbGRcIj57c2NhblRlbGVtZXRyeS5lbGFwc2VkTXMgPyBNYXRoLnJvdW5kKHNjYW5UZWxlbWV0cnkuZmlsZXMgLyAoc2NhblRlbGVtZXRyeS5lbGFwc2VkTXMgLyAxMDAwKSkudG9Mb2NhbGVTdHJpbmcoKSA6IDB9IOaWh+S7ti/np5I8L3A+PC9kaXY+XG4gICAgICAgICAgICAgIDxkaXY+PHAgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj7nm67lvZU8L3A+PHAgY2xhc3NOYW1lPVwibXQtMSBmb250LXNlbWlib2xkXCI+e3NjYW5UZWxlbWV0cnkuZGlyZWN0b3JpZXMudG9Mb2NhbGVTdHJpbmcoKX08L3A+PC9kaXY+XG4gICAgICAgICAgICAgIDxkaXY+PHAgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj7lt7Lor7vlj5Y8L3A+PHAgY2xhc3NOYW1lPVwibXQtMSBmb250LXNlbWlib2xkXCI+e2Zvcm1hdEJ5dGVzKHNjYW5UZWxlbWV0cnkuYnl0ZXMpfTwvcD48L2Rpdj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtdC0zIGZsZXggaXRlbXMtY2VudGVyIGdhcC0yXCI+XG4gICAgICAgICAgICAgIDxMb2FkZXIyIGNsYXNzTmFtZT1cImgtNCB3LTQgc2hyaW5rLTBcIiAvPlxuICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJtaW4tdy0wIGZsZXgtMSB0cnVuY2F0ZSBmb250LW1vbm8gdGV4dC14c1wiIHRpdGxlPXtkaXNwbGF5UGF0aChzY2FuVGVsZW1ldHJ5LmN1cnJlbnRQYXRoKX0+XG4gICAgICAgICAgICAgICAge3BoYXNlID09PSAnaGFzaGluZycgPyAn5q2j5Zyo5qCh6aqM6YeN5aSN5paH5Lu25YaF5a654oCmJyA6IGRpc3BsYXlQYXRoKHNjYW5UZWxlbWV0cnkuY3VycmVudFBhdGgpfVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICAgIHtzY2FuRXJyb3JzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LWRlc3RydWN0aXZlIHVuZGVybGluZVwiIG9uQ2xpY2s9eygpID0+IHNldEVycm9yc09wZW4odHJ1ZSl9PlxuICAgICAgICAgICAgICAgICAg5p+l55yLIHtzY2FuRXJyb3JzLmxlbmd0aH0g5Liq6Zeu6aKYXG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8L3NlY3Rpb24+XG4gICAgICAgICl9XG5cbiAgICAgICAge3J1bm5pbmcgJiYgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiByb3VuZGVkLW1kIGJnLXByaW1hcnkvNSBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj48TG9hZGVyMiBjbGFzc05hbWU9XCJoLTQgdy00XCIgLz57cGhhc2UgPT09ICdoYXNoaW5nJyA/ICfmraPlnKjmoKHpqozph43lpI3mlofku7blhoXlrrnigKYnIDogJ+ato+WcqOaJq+aPj+ebruW9leKApid9PC9kaXY+fVxuICAgICAgICB7ZXJyb3IgJiYgPGRpdiBjbGFzc05hbWU9XCJyb3VuZGVkLW1kIGJvcmRlciBib3JkZXItZGVzdHJ1Y3RpdmUvNDAgYmctZGVzdHJ1Y3RpdmUvMTAgcC0zIHRleHQtc20gdGV4dC1kZXN0cnVjdGl2ZVwiPntlcnJvcn08L2Rpdj59XG5cbiAgICAgICAgeyhydW5uaW5nIHx8IHN0YXRzLmZpbGVzID4gMCkgJiYgKFxuICAgICAgICAgIDw+XG4gICAgICAgICAgICA8c2VjdGlvbiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0zIGdhcC0zXCI+XG4gICAgICAgICAgICAgIHsoW1sn5paH5Lu2Jywgc3RhdHMuZmlsZXMudG9Mb2NhbGVTdHJpbmcoKV0sIFsn5bey5omr5o+P5a656YePJywgZm9ybWF0Qnl0ZXMoc3RhdHMuYnl0ZXMpXSwgWyfor7vlj5blpLHotKUnLCBzdGF0cy5lcnJvcnMudG9Mb2NhbGVTdHJpbmcoKV1dIGFzIGNvbnN0KS5tYXAoKFtsYWJlbCwgdmFsdWVdKSA9PiAoXG4gICAgICAgICAgICAgICAgPGRpdiBrZXk9e2xhYmVsfSBjbGFzc05hbWU9XCJyb3VuZGVkLXhsIGJvcmRlciBiZy1jYXJkIHAtNFwiPlxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtbXV0ZWQtZm9yZWdyb3VuZFwiPntsYWJlbH08L2Rpdj5cbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LTJ4bCBmb250LXNlbWlib2xkXCI+e3ZhbHVlfTwvZGl2PlxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgIDwvc2VjdGlvbj5cbiAgICAgICAgICAgIDxzZWN0aW9uIGNsYXNzTmFtZT1cImdyaWQgZ2FwLTQgeGw6Z3JpZC1jb2xzLTJcIj5cbiAgICAgICAgICAgICAgPGFydGljbGUgY2xhc3NOYW1lPVwiaC1bMzMwcHhdIHJvdW5kZWQteGwgYm9yZGVyIGJnLWNhcmRcIj5cbiAgICAgICAgICAgICAgICA8aDIgY2xhc3NOYW1lPVwiYm9yZGVyLWIgcHgtNCBweS0zIGZvbnQtbWVkaXVtXCI+5paH5Lu257G75Z6L5Y2g55SoPC9oMj5cbiAgICAgICAgICAgICAgICB7ZXh0ZW5zaW9uRGF0YS5sZW5ndGggPyA8Q2hhcnQgb3B0aW9uPXtzdW1tYXJ5LmV4dGVuc2lvbk9wdGlvbn0gY2xhc3NOYW1lPVwiaC1bMjgwcHhdIHctZnVsbFwiIC8+IDogPEVtcHR5U3RhdGU+562J5b6F5omr5o+P5pWw5o2uPC9FbXB0eVN0YXRlPn1cbiAgICAgICAgICAgICAgPC9hcnRpY2xlPlxuICAgICAgICAgICAgICA8YXJ0aWNsZSBjbGFzc05hbWU9XCJoLVszMzBweF0gcm91bmRlZC14bCBib3JkZXIgYmctY2FyZFwiPlxuICAgICAgICAgICAgICAgIDxoMiBjbGFzc05hbWU9XCJib3JkZXItYiBweC00IHB5LTMgZm9udC1tZWRpdW1cIj7nm67lvZXljaDnlKjmjpLooYw8L2gyPlxuICAgICAgICAgICAgICAgIHtkaXJlY3RvcnlEYXRhLmxlbmd0aCA/IDxDaGFydCBvcHRpb249e3N1bW1hcnkuZGlyZWN0b3J5T3B0aW9ufSBjbGFzc05hbWU9XCJoLVsyODBweF0gdy1mdWxsXCIgLz4gOiA8RW1wdHlTdGF0ZT7nrYnlvoXmiavmj4/mlbDmja48L0VtcHR5U3RhdGU+fVxuICAgICAgICAgICAgICA8L2FydGljbGU+XG4gICAgICAgICAgICA8L3NlY3Rpb24+XG4gICAgICAgICAgICA8c2VjdGlvbiBjbGFzc05hbWU9XCJoLVs0MjBweF0gcm91bmRlZC14bCBib3JkZXIgYmctY2FyZFwiPlxuICAgICAgICAgICAgICA8aDIgY2xhc3NOYW1lPVwiYm9yZGVyLWIgYmctY2FyZCBweC00IHB5LTMgZm9udC1tZWRpdW1cIj7mnIDlpKfmlofku7YgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LW11dGVkLWZvcmVncm91bmRcIj7liY0gNTA8L3NwYW4+PC9oMj5cbiAgICAgICAgICAgICAgPFZpcnR1YWxMaXN0XG4gICAgICAgICAgICAgICAgaXRlbXM9e2xhcmdlc3R9XG4gICAgICAgICAgICAgICAgaXRlbVNpemU9ezM4fVxuICAgICAgICAgICAgICAgIGhlaWdodD17MzgwfVxuICAgICAgICAgICAgICAgIHJlbmRlckl0ZW09eyhmaWxlKSA9PiAoXG4gICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT1cImdyaWQgaC1bMzhweF0gdy1mdWxsIGdyaWQtY29scy1bbWlubWF4KDAsMWZyKV8xMDBweF0gaXRlbXMtY2VudGVyIGdhcC0zIGJvcmRlci1iIHB4LTQgdGV4dC1sZWZ0IHRleHQtc20gaG92ZXI6YmctbXV0ZWQvNDBcIlxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgIHZvaWQgb3BlblByZXZpZXcoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogZGlzcGxheVBhdGgoZmlsZS5wYXRoKS5zcGxpdCgvW1xcXFwvXS8pLmF0KC0xKSB8fCBmaWxlLnBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiBmaWxlLnBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZmlsZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaXplOiBmaWxlLnNpemUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RpZmllZEF0OiBmaWxlLm1vZGlmaWVkQXQsXG4gICAgICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IGZpbGUuZXh0ZW5zaW9uLFxuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidHJ1bmNhdGUgZm9udC1tb25vIHRleHQteHNcIj57ZGlzcGxheVBhdGgoZmlsZS5wYXRoKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInRleHQtcmlnaHQgdGV4dC1tdXRlZC1mb3JlZ3JvdW5kXCI+e2Zvcm1hdEJ5dGVzKGZpbGUuc2l6ZSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvc2VjdGlvbj5cbiAgICAgICAgICA8Lz5cbiAgICAgICAgKX1cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgdHlwZSB7IEZpbGVFbnRyeSwgRGlyZWN0b3J5RW50cnksIFNjYW5UZWxlbWV0cnksIFBlcnNpc3RlZFNjYW5SZXN1bHQgfTtcbiJdLCJtYXBwaW5ncyI6IkFBc1NjLFNBcVBKLFVBclBJO0FBdFNkLFNBQVMsV0FBVyxTQUFTLGdCQUFnQjtBQUM3QyxTQUFTLGFBQWE7QUFDdEIsU0FBUyxpQkFBaUI7QUFFMUIsU0FBUyxjQUEwQixXQUFXLFNBQVMsaUJBQWlCO0FBQ3hFLFNBQVMsNEJBQTRCO0FBQ3JDLFNBQVMsZ0JBQWdCO0FBQ3pCO0FBQUEsRUFDRTtBQUFBLEVBQ0E7QUFBQSxPQU1LO0FBQ1AsU0FBUyxPQUFPLGtCQUFrQjtBQUNsQztBQUFBLEVBQ0U7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxPQUVLO0FBQ1AsU0FBUyxtQkFBbUI7QUFDNUIsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxvQkFBb0I7QUFDN0IsU0FBUyxpQkFBaUI7QUFDMUIsU0FBUyxtQkFBbUI7QUFDNUIsU0FBUyxtQkFBbUI7QUFLckIsZ0JBQVMsaUJBQWlCO0FBQy9CLFFBQU0sUUFBUSxTQUFTLENBQUMsVUFBVSxNQUFNLEtBQUs7QUFDN0MsUUFBTSxPQUFPLFlBQVk7QUFHekIsUUFBTSxDQUFDLFdBQVcsWUFBWSxJQUFJLFNBQW9CLFVBQVU7QUFDaEUsUUFBTSxDQUFDLG9CQUFvQixxQkFBcUIsSUFBSSxTQUFtQixDQUFDLENBQUM7QUFDekUsUUFBTSxDQUFDLFlBQVksYUFBYSxJQUFJLFNBQVMsS0FBSztBQUNsRCxRQUFNLENBQUMsZUFBZSxnQkFBZ0IsSUFBSSxTQUFTLEtBQUs7QUFDeEQsUUFBTSxDQUFDLGFBQWEsY0FBYyxJQUFJLFNBQVMsS0FBSztBQUNwRCxRQUFNLENBQUMsaUJBQWlCLGtCQUFrQixJQUFJLFNBQStCLENBQUMsQ0FBQztBQUMvRSxRQUFNLENBQUMsU0FBUyxVQUFVLElBQUksU0FBUyxLQUFLO0FBQzVDLFFBQU0sQ0FBQyxXQUFXLFlBQVksSUFBSSxTQUFTLEVBQUU7QUFDN0MsUUFBTSxDQUFDLFlBQVksYUFBYSxJQUFJLFNBQVMsS0FBSztBQUNsRCxRQUFNLENBQUMsb0JBQW9CLHFCQUFxQixJQUFJLFNBQVMsQ0FBQztBQUM5RCxRQUFNLENBQUMsbUJBQW1CLG9CQUFvQixJQUFJLFNBQVMsRUFBRTtBQUM3RCxRQUFNLENBQUMsb0JBQW9CLHFCQUFxQixJQUFJLFNBQVMsRUFBRTtBQUMvRCxRQUFNLENBQUMsZUFBZSxnQkFBZ0IsSUFBSSxTQUE0QyxNQUFNO0FBRTVGLFFBQU07QUFBQSxJQUNKO0FBQUEsSUFBUTtBQUFBLElBQWE7QUFBQSxJQUFNO0FBQUEsSUFBa0I7QUFBQSxJQUFTO0FBQUEsSUFBUztBQUFBLElBQy9EO0FBQUEsSUFBWTtBQUFBLElBQVc7QUFBQSxJQUFTO0FBQUEsSUFBUztBQUFBLElBQVE7QUFBQSxJQUNqRDtBQUFBLElBQWU7QUFBQSxJQUFZO0FBQUEsSUFBTztBQUFBLElBQVM7QUFBQSxJQUFZO0FBQUEsSUFBWTtBQUFBLElBQ25FO0FBQUEsSUFBb0I7QUFBQSxJQUFjO0FBQUEsSUFBUztBQUFBLElBQVU7QUFBQSxJQUFnQjtBQUFBLElBQ3JFO0FBQUEsSUFBTztBQUFBLElBQVU7QUFBQSxJQUFlO0FBQUEsSUFBUTtBQUFBLElBQU87QUFBQSxJQUFZO0FBQUEsSUFDM0Q7QUFBQSxJQUFlO0FBQUEsSUFBYTtBQUFBLElBQW9CO0FBQUEsSUFDaEQ7QUFBQSxJQUF5QjtBQUFBLElBQWM7QUFBQSxJQUFZO0FBQUEsSUFBVztBQUFBLElBQzlEO0FBQUEsSUFBbUI7QUFBQSxJQUFZO0FBQUEsSUFDL0I7QUFBQSxJQUFlO0FBQUEsSUFBWTtBQUFBLElBQzNCO0FBQUEsRUFDRixJQUFJO0FBR0osWUFBVSxNQUFNO0FBQUUsYUFBUyxFQUFFO0FBQUEsRUFBRyxHQUFHLENBQUMsV0FBVyxRQUFRLENBQUM7QUFHeEQsWUFBVSxNQUFNO0FBQ2QsUUFBSSxjQUFjLGVBQWUsZ0JBQWdCLFNBQVMsS0FBSyxRQUFTO0FBQ3hFLGVBQVcsSUFBSTtBQUNmLFNBQUssT0FBTyxZQUFZLFVBQ3JCLGlCQUFpQixFQUNqQixLQUFLLGtCQUFrQixFQUN2QixNQUFNLENBQUMsVUFBVSxTQUFTLE9BQU8sS0FBSyxDQUFDLENBQUMsRUFDeEMsUUFBUSxNQUFNLFdBQVcsS0FBSyxDQUFDO0FBQUEsRUFDcEMsR0FBRyxDQUFDLFdBQVcsU0FBUyxnQkFBZ0IsUUFBUSxRQUFRLENBQUM7QUFHekQsUUFBTSxlQUFlLGNBQWMsZUFBZSxjQUFjO0FBQ2hFLFlBQVUsTUFBTTtBQUNkLFFBQUksY0FBYyxTQUFTLGFBQWEsY0FBYyxVQUFXO0FBQ2pFLHVCQUFtQixDQUFDLENBQUM7QUFDckIsU0FBSyxjQUFjO0FBQ25CLFFBQUksUUFBUSxDQUFDLFFBQVMsTUFBSyxNQUFNLFlBQVk7QUFDN0MsdUJBQW1CO0FBQUEsRUFDckIsR0FBRyxDQUFDLGVBQWUsV0FBVyxNQUFNLFNBQVMsZUFBZSxPQUFPLGNBQWMsa0JBQWtCLENBQUM7QUFHcEcsWUFBVSxNQUFNO0FBQ2QsVUFBTSxXQUFXLENBQUMsVUFBaUI7QUFDakMsWUFBTSxZQUFhLE1BQThCO0FBQ2pELFVBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxRQUFTO0FBQ3BDLG1CQUFhLFNBQVM7QUFDdEIsd0JBQWtCLElBQUk7QUFDdEIsaUJBQVcsSUFBSTtBQUNmLFdBQUssT0FBTyxZQUFZLFVBQ3JCLGNBQWMsUUFBUSxTQUFTLFNBQVMsRUFDeEMsS0FBSyxDQUFDLFVBQVU7QUFDZixtQkFBVyxLQUFLO0FBQUEsTUFDbEIsQ0FBQyxFQUNBLE1BQU0sQ0FBQyxVQUFVLFNBQVMsT0FBTyxLQUFLLENBQUMsQ0FBQyxFQUN4QyxRQUFRLE1BQU0sa0JBQWtCLEtBQUssQ0FBQztBQUFBLElBQzNDO0FBQ0EsV0FBTyxpQkFBaUIsdUJBQXVCLFFBQVE7QUFDdkQsV0FBTyxNQUFNLE9BQU8sb0JBQW9CLHVCQUF1QixRQUFRO0FBQUEsRUFDekUsR0FBRyxDQUFDLFNBQVMsWUFBWSxVQUFVLFVBQVUsQ0FBQztBQUc5QyxRQUFNLGdCQUFnQjtBQUFBLElBQ3BCLE1BQU0sT0FBTyxRQUFRLFVBQVUsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUN4RSxDQUFDLFVBQVU7QUFBQSxFQUNiO0FBQ0EsUUFBTSxrQkFBa0IsUUFBUSxPQUFPO0FBQUEsSUFDckMsT0FBTyxDQUFDLFdBQVcsV0FBVyxXQUFXLFdBQVcsV0FBVyxXQUFXLFdBQVcsU0FBUztBQUFBLElBQzlGLFNBQVMsRUFBRSxTQUFTLFFBQVEsV0FBVyxDQUFDLE1BQXdELEdBQUcsRUFBRSxJQUFJLFFBQVEsWUFBWSxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxJQUFJO0FBQUEsSUFDeEosUUFBUSxDQUFDO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFBTyxRQUFRLENBQUMsT0FBTyxLQUFLO0FBQUEsTUFBRyxRQUFRLENBQUMsT0FBTyxLQUFLO0FBQUEsTUFDMUQsV0FBVyxFQUFFLGNBQWMsR0FBRyxhQUFhLEdBQUcsYUFBYSxjQUFjO0FBQUEsTUFDekUsT0FBTyxFQUFFLE9BQU8sV0FBVyxXQUFXLFlBQVk7QUFBQSxNQUNsRCxNQUFNLGNBQWMsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLE9BQU8sRUFBRSxNQUFNLE1BQU0sRUFBRTtBQUFBLElBQzlELENBQUM7QUFBQSxFQUNILElBQUksQ0FBQyxhQUFhLENBQUM7QUFDbkIsUUFBTSxnQkFBZ0I7QUFBQSxJQUNwQixNQUFNLG1CQUFtQixhQUFhLElBQUk7QUFBQSxJQUMxQyxDQUFDLGFBQWEsSUFBSTtBQUFBLEVBQ3BCO0FBQ0EsUUFBTSxrQkFBa0IsUUFBUSxPQUFPO0FBQUEsSUFDckMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxTQUFvRSxHQUFHLEtBQUssSUFBSSxRQUFRLFlBQVksS0FBSyxLQUFLLENBQUMsUUFBUSxZQUFZLEtBQUssTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHO0FBQUEsSUFDbkwsUUFBUSxDQUFDO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFBVyxNQUFNO0FBQUEsTUFBTSxXQUFXO0FBQUEsTUFBYyxZQUFZLEVBQUUsTUFBTSxNQUFNLFFBQVEsR0FBRztBQUFBLE1BQzNGLE9BQU8sRUFBRSxNQUFNLE1BQU0sV0FBVyxDQUFDLFNBQTBDLEdBQUcsS0FBSyxJQUFJO0FBQUEsRUFBSyxZQUFZLEtBQUssS0FBSyxDQUFDLEdBQUc7QUFBQSxNQUN0SCxZQUFZLEVBQUUsTUFBTSxNQUFNLFFBQVEsR0FBRztBQUFBLE1BQ3JDLFdBQVcsRUFBRSxhQUFhLFFBQVEsYUFBYSxHQUFHLFVBQVUsRUFBRTtBQUFBLE1BQzlELFFBQVE7QUFBQSxRQUNOLEVBQUUsV0FBVyxFQUFFLGFBQWEsR0FBRyxVQUFVLEVBQUUsRUFBRTtBQUFBLFFBQzdDLEVBQUUsaUJBQWlCLENBQUMsTUFBTSxJQUFJLEdBQUcsWUFBWSxFQUFFLE1BQU0sS0FBSyxHQUFHLFdBQVcsRUFBRSxVQUFVLEdBQUcsYUFBYSxFQUFFLEVBQUU7QUFBQSxRQUN4RyxFQUFFLGlCQUFpQixDQUFDLE1BQU0sSUFBSSxHQUFHLFdBQVcsRUFBRSxVQUFVLEVBQUUsRUFBRTtBQUFBLE1BQzlEO0FBQUEsTUFDQSxNQUFNO0FBQUEsSUFDUixDQUFDO0FBQUEsRUFDSCxJQUFJLENBQUMsYUFBYSxDQUFDO0FBQ25CLFFBQU0saUJBQWlCO0FBQUEsSUFDckIsTUFBTSwyQkFBMkIsYUFBYSwwR0FBMEc7QUFBQSxJQUN4SixDQUFDLFdBQVc7QUFBQSxFQUNkO0FBQ0EsUUFBTSxlQUFlO0FBQUEsSUFDbkIsTUFBTSwyQkFBMkIsYUFBYSwrRUFBK0U7QUFBQSxJQUM3SCxDQUFDLFdBQVc7QUFBQSxFQUNkO0FBQ0EsUUFBTSxnQkFBZ0IsUUFBUSxNQUFNO0FBQ2xDLFVBQU0sWUFBWSxDQUFDLEdBQUcsSUFBSSxJQUFJLFlBQVksUUFBUSxDQUFDLFVBQVUsTUFBTSxNQUFNLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNuRyxXQUFPO0FBQUEsTUFDTCxPQUFPLENBQUMsV0FBVyxXQUFXLFdBQVcsU0FBUztBQUFBLE1BQ2xELFNBQVMsRUFBRSxTQUFTLFFBQVEsV0FBVyxDQUFDLFVBQXdELE1BQU0sSUFBSSxDQUFDLFNBQVMsR0FBRyxLQUFLLFVBQVUsSUFBSSxZQUFZLEtBQUssS0FBSyxDQUFDLEVBQUUsRUFBRSxLQUFLLE9BQU8sRUFBRTtBQUFBLE1BQ25MLFFBQVEsRUFBRSxLQUFLLEdBQUcsTUFBTSxVQUFVO0FBQUEsTUFDbEMsTUFBTSxFQUFFLE1BQU0sSUFBSSxPQUFPLElBQUksS0FBSyxJQUFJLFFBQVEsSUFBSSxjQUFjLEtBQUs7QUFBQSxNQUNyRSxPQUFPLEVBQUUsTUFBTSxZQUFZLGFBQWEsT0FBTyxNQUFNLFlBQVksSUFBSSxDQUFDLFVBQVUsSUFBSSxLQUFLLE1BQU0sU0FBUyxFQUFFLGVBQWUsQ0FBQyxHQUFHLEVBQUUsT0FBTyxXQUFXLEtBQUssV0FBVyxNQUFNLFVBQVUsQ0FBQyxDQUFDLEdBQUcsV0FBVyxFQUFFLE9BQU8sVUFBVSxFQUFFO0FBQUEsTUFDdE4sT0FBTyxFQUFFLE1BQU0sU0FBUyxXQUFXLEVBQUUsT0FBTyxXQUFXLFdBQVcsQ0FBQyxVQUFrQixZQUFZLEtBQUssRUFBRSxHQUFHLFdBQVcsRUFBRSxXQUFXLEVBQUUsT0FBTyx3QkFBd0IsRUFBRSxFQUFFO0FBQUEsTUFDeEssUUFBUSxVQUFVLElBQUksQ0FBQyxVQUFVO0FBQUEsUUFDL0I7QUFBQSxRQUFNLE1BQU07QUFBQSxRQUFRLFFBQVE7QUFBQSxRQUFNLFlBQVksWUFBWSxTQUFTO0FBQUEsUUFBSSxXQUFXLEVBQUUsU0FBUyxLQUFLO0FBQUEsUUFDbEcsTUFBTSxZQUFZLElBQUksQ0FBQyxVQUFVLE1BQU0sTUFBTSxLQUFLLENBQUMsU0FBUyxLQUFLLFNBQVMsSUFBSSxHQUFHLFFBQVEsSUFBSTtBQUFBLE1BQy9GLEVBQUU7QUFBQSxJQUNKO0FBQUEsRUFDRixHQUFHLENBQUMsV0FBVyxDQUFDO0FBQ2hCLFFBQU0saUJBQWlCLFFBQXFCLE1BQU07QUFDaEQsVUFBTSxTQUFTLE9BQU8saUJBQWlCO0FBQ3ZDLFVBQU0sWUFBWSxPQUFPLFNBQVMsTUFBTSxLQUFLLFNBQVMsSUFBSSxTQUFTLFFBQVEsSUFBSTtBQUMvRSxXQUFPLFFBQ0osT0FBTyxDQUFDLFNBQVMsS0FBSyxRQUFRLGNBQWMsQ0FBQyxzQkFBc0IsS0FBSyxVQUFVLFlBQVksTUFBTSxtQkFBbUIsRUFDdkgsS0FBSyxDQUFDLEdBQUcsTUFBTyxrQkFBa0IsYUFBYSxFQUFFLGFBQWEsRUFBRSxhQUFhLGtCQUFrQixjQUFjLEVBQUUsVUFBVSxjQUFjLEVBQUUsU0FBUyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUs7QUFBQSxFQUMzSyxHQUFHLENBQUMsbUJBQW1CLG9CQUFvQixlQUFlLG9CQUFvQixPQUFPLENBQUM7QUFDdEYsUUFBTSxvQkFBb0I7QUFBQSxJQUN4QixNQUFNLENBQUMsR0FBRyxJQUFJLElBQUksUUFBUSxJQUFJLENBQUMsU0FBUyxLQUFLLFNBQVMsRUFBRSxPQUFPLE9BQU8sQ0FBQyxDQUFDLEVBQUUsS0FBSztBQUFBLElBQy9FLENBQUMsT0FBTztBQUFBLEVBQ1Y7QUFDQSxRQUFNLGlCQUFpQixRQUFRLE1BQU0sZUFBZSxPQUFPLENBQUMsS0FBSyxTQUFTLE1BQU0sS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQztBQUMvRyxRQUFNLGVBQWUsUUFBUSxNQUFNLGFBQWEsT0FBTyxDQUFDLEtBQUssU0FBUyxNQUFNLEtBQUssTUFBTSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUM7QUFDekcsUUFBTSxxQkFBcUI7QUFBQSxJQUFRLE1BQ2pDLGFBQWEsSUFBSSxDQUFDLFNBQVM7QUFDekIsWUFBTSxPQUFPLFlBQVksS0FBSyxJQUFJLEVBQUUsTUFBTSxPQUFPLEVBQUUsT0FBTyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsWUFBWSxLQUFLO0FBQzVGLFlBQU0sVUFBVSxnREFBZ0QsS0FBSyxJQUFJO0FBQ3pFLFlBQU0sYUFBYSwwQkFBMEIsS0FBSyxJQUFJO0FBQ3RELGFBQU87QUFBQSxRQUNMLEdBQUc7QUFBQSxRQUNILE1BQU0sVUFBVSxRQUFRLGFBQWEsU0FBUztBQUFBLFFBQzlDLFVBQVUsVUFDTixtQkFDQSxhQUNFLHlCQUNBO0FBQUEsTUFDUjtBQUFBLElBQ0YsQ0FBQztBQUFBLElBQ0QsQ0FBQyxZQUFZO0FBQUEsRUFDZjtBQUNBLFFBQU0seUJBQXlCO0FBQUEsSUFDN0IsTUFBTSxXQUFXLFFBQVEsQ0FBQyxVQUFVLE1BQU0sS0FBSyxFQUFFLE9BQU8sQ0FBQyxTQUFTLG1CQUFtQixTQUFTLEtBQUssSUFBSSxDQUFDLEVBQUUsT0FBTyxDQUFDLEtBQUssU0FBUyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDbEosQ0FBQyxZQUFZLGtCQUFrQjtBQUFBLEVBQ2pDO0FBQ0EsUUFBTSxtQkFBbUIsUUFBMkIsTUFBTTtBQUN4RCxVQUFNLFdBQVcsc0JBQ2QsT0FBTyxDQUFDLGFBQWEsWUFBWSxTQUFTLElBQUksRUFBRSxZQUFZLE1BQU0sWUFBWSxJQUFJLEVBQUUsWUFBWSxDQUFDLEVBQ2pHLE1BQU0sRUFBRTtBQUNYLFFBQUksU0FBUyxTQUFTLEVBQUcsUUFBTyxDQUFDO0FBQ2pDLFVBQU0sQ0FBQyxVQUFVLE9BQU8sSUFBSTtBQUM1QixVQUFNLFNBQVMsSUFBSSxJQUFJLFNBQVMsWUFBWSxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksS0FBSyxJQUFJLEVBQUUsWUFBWSxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQ3ZHLFVBQU0sUUFBUSxJQUFJLElBQUksUUFBUSxZQUFZLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxLQUFLLElBQUksRUFBRSxZQUFZLEdBQUcsSUFBSSxDQUFDLENBQUM7QUFDckcsV0FBTyxDQUFDLEdBQUcsb0JBQUksSUFBSSxDQUFDLEdBQUcsT0FBTyxLQUFLLEdBQUcsR0FBRyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFDcEQsSUFBSSxDQUFDLFFBQVE7QUFDWixZQUFNLFVBQVUsT0FBTyxJQUFJLEdBQUc7QUFDOUIsWUFBTSxVQUFVLE1BQU0sSUFBSSxHQUFHO0FBQzdCLGFBQU8sRUFBRSxNQUFNLFNBQVMsUUFBUSxRQUFTLE1BQU0sTUFBTSxTQUFTLFFBQVEsR0FBRyxTQUFTLFNBQVMsUUFBUSxNQUFNLFNBQVMsUUFBUSxHQUFHO0FBQUEsSUFDL0gsQ0FBQyxFQUNBLE9BQU8sQ0FBQyxTQUFTLEtBQUssSUFBSSxLQUFLLE1BQU0sS0FBSyxPQUFPLElBQUksRUFDckQsS0FBSyxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUksRUFBRSxNQUFNLElBQUksS0FBSyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQ3RELE1BQU0sR0FBRyxFQUFFO0FBQUEsRUFDaEIsR0FBRyxDQUFDLHVCQUF1QixJQUFJLENBQUM7QUFHaEMsUUFBTSxvQkFBb0IsWUFBWTtBQUNwQyxVQUFNLFdBQVc7QUFBQSxNQUNmO0FBQUEsTUFBTSxTQUFTO0FBQUEsTUFDZixTQUFTLFFBQVEsTUFBTSxHQUFHLEVBQUUsRUFBRSxJQUFJLENBQUMsVUFBVSxFQUFFLE1BQU0sWUFBWSxLQUFLLElBQUksR0FBRyxNQUFNLFlBQVksS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFBLE1BQzVHLFFBQVEsaUJBQWlCLE1BQU0sR0FBRyxFQUFFLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLFlBQVksS0FBSyxJQUFJLEdBQUcsUUFBUSxHQUFHLEtBQUssU0FBUyxJQUFJLE1BQU0sR0FBRyxHQUFHLFlBQVksS0FBSyxJQUFJLEtBQUssTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFO0FBQUEsTUFDckssU0FBUyxhQUFhLE1BQU0sR0FBRyxFQUFFLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLFlBQVksS0FBSyxJQUFJLEdBQUcsTUFBTSxZQUFZLEtBQUssSUFBSSxHQUFHLE1BQU0sT0FBTyxFQUFFO0FBQUEsTUFDL0gsWUFBWSxFQUFFLFFBQVEsV0FBVyxRQUFRLGFBQWEsWUFBWSxXQUFXLE9BQU8sQ0FBQyxLQUFLLFVBQVUsTUFBTSxNQUFNLFFBQVEsTUFBTSxNQUFNLFNBQVMsSUFBSSxDQUFDLENBQUMsRUFBRTtBQUFBLElBQ3ZKO0FBQ0EsVUFBTSxRQUFRO0FBQUE7QUFBQSxTQUFxQixRQUFRLE1BQU07QUFBQSxRQUFXLE1BQU0sTUFBTSxlQUFlLENBQUMsVUFBVSxZQUFZLE1BQU0sS0FBSyxDQUFDO0FBQUEsU0FBWSxhQUFhLE1BQU0sUUFBUSxZQUFZLFlBQVksQ0FBQztBQUFBLFNBQW9CLFdBQVcsTUFBTTtBQUFBO0FBQUE7QUFDL04sUUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLE1BQU0sV0FBVyxDQUFDLE1BQU0sT0FBTztBQUNuRCxtQkFBYSxLQUFLO0FBQ2xCO0FBQUEsSUFDRjtBQUNBLGtCQUFjLElBQUk7QUFDbEIsaUJBQWEsRUFBRTtBQUNmLFFBQUk7QUFDRixZQUFNLFdBQVcscUJBQXFCLEVBQUUsUUFBUSxNQUFNLFFBQVEsU0FBUyxNQUFNLFFBQVEsQ0FBQztBQUN0RixZQUFNLFdBQVc7QUFBQSxRQUNmLEVBQUUsTUFBTSxVQUFtQixTQUFTLHVIQUF1SDtBQUFBLFFBQzNKLEVBQUUsTUFBTSxRQUFpQixTQUFTLEtBQUssVUFBVSxRQUFRLEVBQUU7QUFBQSxNQUM3RDtBQUNBLFVBQUksT0FBTztBQUNYLHVCQUFpQixTQUFTLFNBQVMsS0FBSyxVQUFVLEVBQUUsT0FBTyxNQUFNLE9BQU8sYUFBYSxLQUFLLFdBQVcsTUFBTSxRQUFRLEtBQUssQ0FBQyxHQUFHO0FBQzFILFlBQUksTUFBTSxPQUFPO0FBQUUsa0JBQVEsTUFBTTtBQUFPLHVCQUFhLElBQUk7QUFBQSxRQUFHO0FBQUEsTUFDOUQ7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLG1CQUFhLEdBQUcsS0FBSztBQUFBO0FBQUEsWUFBaUIsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxJQUNoRyxVQUFFO0FBQ0Esb0JBQWMsS0FBSztBQUFBLElBQ3JCO0FBQUEsRUFDRjtBQUNBLFFBQU0sbUJBQW1CLFlBQVk7QUFDbkMsVUFBTSxVQUFVO0FBQUE7QUFBQSxTQUFzQixZQUFZLElBQUksQ0FBQztBQUFBLFNBQVksTUFBTSxNQUFNLGVBQWUsQ0FBQztBQUFBLFNBQVksWUFBWSxNQUFNLEtBQUssQ0FBQztBQUFBLFNBQVksTUFBTSxNQUFNO0FBQUEsVUFBYSxXQUFXLE1BQU07QUFBQSxTQUFZLFlBQVksWUFBWSxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFBa0IsUUFBUSxNQUFNLEdBQUcsRUFBRSxFQUFFLElBQUksQ0FBQyxTQUFTLEtBQUssWUFBWSxLQUFLLElBQUksQ0FBQyxRQUFRLFlBQVksS0FBSyxJQUFJLENBQUMsSUFBSSxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFBa0IsaUJBQWlCLElBQUksQ0FBQyxTQUFTLEtBQUssS0FBSyxTQUFTLElBQUksTUFBTSxHQUFHLEdBQUcsWUFBWSxLQUFLLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQyxRQUFRLFlBQVksS0FBSyxJQUFJLENBQUMsSUFBSSxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQ2hnQixVQUFNLE9BQU8sWUFBWSxTQUFTLFNBQVMsV0FBVSxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFLENBQUMsS0FBSztBQUFBLEVBQ2pHO0FBR0EsUUFBTSxnQkFBZ0IsT0FBTyxPQUFlO0FBQzFDLFVBQU0sbUJBQW1CLEVBQUU7QUFDM0IsbUJBQWUsS0FBSztBQUNwQixpQkFBYSxVQUFVO0FBQUEsRUFDekI7QUFHQSxRQUFNLGtCQUNKLG9CQUFvQixxQkFBcUIsT0FDckMsaUJBQWlCLFFBQVEsdUJBQXVCLEVBQUUsSUFDbEQ7QUFFTixRQUFNLFVBQXVCO0FBQUEsSUFDM0I7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUVBLFNBQ0UsdUJBQUMsU0FBSSxXQUFVLG9EQUNiLGlDQUFDLFNBQUksV0FBVSxxREFDYjtBQUFBLDJCQUFDLFlBQU8sV0FBVSxvQ0FDaEI7QUFBQSw2QkFBQyxTQUNDO0FBQUEsK0JBQUMsUUFBRyxXQUFVLGlEQUNaO0FBQUEsaUNBQUMsYUFBVSxXQUFVLGFBQXJCO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQStCO0FBQUEsVUFBRTtBQUFBLGFBRG5DO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFFQTtBQUFBLFFBQ0EsdUJBQUMsT0FBRSxXQUFVLHNDQUFxQyxrQ0FBbEQ7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUFvRTtBQUFBLFdBSnRFO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFLQTtBQUFBLE1BQ0E7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUNDLFdBQVU7QUFBQSxVQUNWLE9BQU07QUFBQSxVQUNOLFNBQVMsTUFBTSxLQUFLLGNBQWM7QUFBQSxVQUVsQyxpQ0FBQyxhQUFVLFdBQVUsYUFBckI7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBK0I7QUFBQTtBQUFBLFFBTGpDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1BO0FBQUEsU0FiRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBY0E7QUFBQSxJQUNBLHVCQUFDLFdBQU8saURBQXVDLGNBQWMsWUFBWSxTQUFTLE1BQU0sbU1BQW1NLGNBQWMsYUFBYSxxRUFBcUUsRUFBRSxNQUE3WDtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQWdZO0FBQUEsSUFDaFksdUJBQUMsU0FBSSxXQUFVLHNFQUFxRSxjQUFXLFVBQzNGLFdBQUMsQ0FBQyxZQUFZLE1BQU0sR0FBRyxDQUFDLFdBQVcsTUFBTSxHQUFHLENBQUMsWUFBWSxNQUFNLEdBQUcsQ0FBQyxhQUFhLE9BQU8sR0FBRyxDQUFDLFdBQVcsTUFBTSxHQUFHLENBQUMsVUFBVSxNQUFNLENBQUMsRUFBWSxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssTUFDNUo7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUVDLFdBQVcsMkRBQTJELGNBQWMsS0FBSyxpREFBaUQsNkRBQTZEO0FBQUEsUUFDdk0sU0FBUyxNQUFNLGFBQWEsRUFBZTtBQUFBLFFBRTFDO0FBQUE7QUFBQSxNQUpJO0FBQUEsTUFEUDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBTUEsQ0FDRCxLQVRIO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FVQTtBQUFBLElBQ0MsUUFDQyx1QkFBQyxTQUFJLFdBQVUseURBQ2I7QUFBQSw2QkFBQyxVQUFLLFdBQVcsMEJBQTBCLFNBQVMsWUFBWSx1Q0FBdUMsVUFBVSxJQUM5RyxtQkFBUyxZQUFZLGtCQUFrQixRQUFRLFdBQVcsV0FBVyxXQUFXLE1BQU0sS0FBSyxZQUQ5RjtBQUFBO0FBQUE7QUFBQTtBQUFBLGFBRUE7QUFBQSxNQUNDLFNBQVMsYUFBYSxRQUFRLFVBQzdCLHVCQUFDLFVBQU07QUFBQSxnQkFBUTtBQUFBLFFBQU87QUFBQSxRQUFxQixRQUFRLFNBQVMsZUFBZTtBQUFBLFdBQTNFO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFBNkU7QUFBQSxNQUU5RSxTQUFTLFNBQVMsdUJBQUMsVUFBSyxPQUFPLFFBQVEsT0FBTyx1QkFBNUI7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUFtQztBQUFBLFNBUHhEO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FRQTtBQUFBLElBRUQsU0FBUyxhQUFhLGFBQWEsUUFDbEMsdUJBQUMsU0FBSSxXQUFVLGlDQUFnQztBQUFBO0FBQUEsTUFBaUIsU0FBUyxlQUFlO0FBQUEsTUFBRTtBQUFBLFNBQTFGO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBNEg7QUFBQSxJQUc5SCx1QkFBQyxTQUFNLE1BQU0sUUFBUSxPQUFPLEdBQUcsT0FBTyxTQUFTLFFBQVEsUUFBUSxPQUFNLHFCQUFvQixRQUFRLFVBQy9GLHVCQUFDLFNBQUksV0FBVSxxQ0FDYjtBQUFBLDZCQUFDLFVBQUssV0FBVSxpQ0FDYjtBQUFBLG9CQUFZLFFBQVEsSUFBSTtBQUFBLFFBQUU7QUFBQSxRQUFJLElBQUksS0FBSyxRQUFRLFVBQVUsRUFBRSxlQUFlO0FBQUEsUUFBRyxRQUFRLFlBQVksaUJBQWlCO0FBQUEsV0FEckg7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUVBO0FBQUEsTUFDQSx1QkFBQyxZQUFPLFdBQVUsaUZBQWdGLFNBQVMsTUFBTSxLQUFLLE9BQU8sWUFBWSxVQUFVLEtBQUssTUFBTSxRQUFRLElBQUksR0FDeEs7QUFBQSwrQkFBQyxnQkFBYSxXQUFVLGFBQXhCO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFBa0M7QUFBQSxRQUFFO0FBQUEsV0FEdEM7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUVBO0FBQUEsU0FORjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBT0EsSUFDRSxNQUFNLFVBQVUsTUFBTSxXQUFXLElBQUksR0FBRyxnQkFBYyxNQUN4RCxpQ0FBQyxTQUFJLFdBQVUseUVBQ1osV0FBQyxVQUFVLE9BQU8sUUFBUSxTQUFTLFdBQVcsUUFBUSxVQUNyRCx1QkFBQyxTQUFJLFdBQVUsa0RBQ2IsaUNBQUMsU0FBSSxXQUFVLDREQUEyRCxLQUFLLFFBQVEsUUFBUSxRQUFRLFdBQVcsUUFBUSxPQUFPLElBQUksS0FBSyxRQUFRLFFBQWxKO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBd0osS0FEMUo7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQUVBLElBQ0UsUUFBUSxTQUFTLFVBQVUsaUJBQWlCLEtBQUssUUFBUSxJQUFJLElBQy9ELHVCQUFDLGFBQVUsU0FBUyxRQUFRLFdBQVcsV0FBVyxXQUFVLDJFQUE1RDtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQW9JLElBQ2xJLFFBQVEsU0FBUyxTQUNuQix1QkFBQyxTQUFJLFdBQVUsK0RBQStELGtCQUFRLFdBQXRGO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBOEYsSUFFOUYsdUJBQUMsY0FBWSxrQkFBUSxXQUFyQjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQTZCLEtBVmpDO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FZQSxLQXRCRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBdUJBO0FBQUEsSUFDQSx1QkFBQyxTQUFNLE1BQU0sWUFBWSxPQUFPLFFBQVEsV0FBVyxNQUFNLEtBQUssUUFBUSxNQUFNLE9BQU0sb0JBQW1CLFVBQVUsTUFBTSxjQUFjLEtBQUssR0FDdEksaUNBQUMsU0FBSSxXQUFVLDhCQUNaLHFCQUFXLFNBQVMsV0FBVyxJQUFJLENBQUMsTUFBcUIsVUFDeEQsdUJBQUMsU0FBa0MsV0FBVSxpQkFDM0M7QUFBQSw2QkFBQyxPQUFFLFdBQVUsK0JBQStCLHNCQUFZLEtBQUssSUFBSSxLQUFqRTtBQUFBO0FBQUE7QUFBQTtBQUFBLGFBQW1FO0FBQUEsTUFDbkUsdUJBQUMsT0FBRSxXQUFVLGlDQUFpQyxlQUFLLFdBQW5EO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFBMkQ7QUFBQSxTQUZuRCxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBL0I7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQUdBLENBQ0QsSUFBSSx1QkFBQyxjQUFXLDRCQUFaO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBd0IsS0FOL0I7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQU9BLEtBUkY7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQVNBO0FBQUEsSUFDQSx1QkFBQyxTQUFNLE1BQU0sZUFBZSxPQUFNLFVBQVMsUUFBUSxNQUFNLE9BQU0sb0JBQW1CLFVBQVUsTUFBTSxpQkFBaUIsS0FBSyxHQUN0SCxpQ0FBQyxTQUFJLFdBQVUsOEJBQ1osNkJBQW1CLElBQUksQ0FBQyxhQUN2Qix1QkFBQyxTQUFzQixXQUFVLDhFQUMvQjtBQUFBLDZCQUFDLFNBQUksV0FBVSxXQUNiO0FBQUEsK0JBQUMsT0FBRSxXQUFVLDhCQUE4QixzQkFBWSxTQUFTLElBQUksS0FBcEU7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUFzRTtBQUFBLFFBQ3RFLHVCQUFDLE9BQUUsV0FBVSxpQ0FBZ0M7QUFBQTtBQUFBLFVBQUksU0FBUztBQUFBLFVBQWU7QUFBQSxhQUF6RTtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBQStFO0FBQUEsV0FGakY7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUdBO0FBQUEsTUFDQSx1QkFBQyxVQUFLLFdBQVUsaUNBQWlDLGNBQUksS0FBSyxTQUFTLFNBQVMsRUFBRSxlQUFlLEtBQTdGO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFBK0Y7QUFBQSxNQUMvRix1QkFBQyxZQUFPLFdBQVUsNENBQTJDLFNBQVMsTUFBTSxLQUFLLHdCQUF3QixTQUFTLEVBQUUsR0FBRyxrQkFBdkg7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUF5SDtBQUFBLFNBTmpILFNBQVMsSUFBbkI7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQU9BLENBQ0QsS0FWSDtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBV0EsS0FaRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBYUE7QUFBQSxJQUNBLHVCQUFDLFNBQU0sTUFBTSxhQUFhLE9BQU0sVUFBUyxRQUFRLE1BQU0sT0FBTSxvQkFBbUIsVUFBVSxNQUFNLGVBQWUsS0FBSyxHQUNsSCxpQ0FBQyxTQUFJLFdBQVUsOEJBQ1osdUJBQWEsU0FBUyxDQUFDLEdBQUcsWUFBWSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsVUFDdEQsdUJBQUMsU0FBbUIsV0FBVSxxRkFDNUI7QUFBQSw2QkFBQyxTQUFJLFdBQVUsV0FDYjtBQUFBLCtCQUFDLE9BQUUsV0FBVSw4QkFBOEIsc0JBQVksTUFBTSxJQUFJLEtBQWpFO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFBbUU7QUFBQSxRQUNuRSx1QkFBQyxPQUFFLFdBQVUsaUNBQWlDO0FBQUEsZ0JBQU0sTUFBTSxNQUFNLGVBQWU7QUFBQSxVQUFFO0FBQUEsVUFBUSxZQUFZLE1BQU0sTUFBTSxLQUFLO0FBQUEsYUFBdEg7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUF3SDtBQUFBLFdBRjFIO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFHQTtBQUFBLE1BQ0EsdUJBQUMsVUFBSyxXQUFVLHNCQUFzQjtBQUFBLGNBQU07QUFBQSxRQUFXO0FBQUEsV0FBdkQ7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUEyRDtBQUFBLE1BQzNELHVCQUFDLFVBQUssV0FBVSxpQ0FBaUMsY0FBSSxLQUFLLE1BQU0sT0FBTyxFQUFFLGVBQWUsS0FBeEY7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUEwRjtBQUFBLE1BQzFGLHVCQUFDLFNBQUksV0FBVSwwQkFDYjtBQUFBLCtCQUFDLFlBQU8sV0FBVSx3Q0FBdUMsU0FBUyxNQUFNLEtBQUssY0FBYyxNQUFNLEVBQUUsR0FBRyxrQkFBdEc7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUF3RztBQUFBLFFBQ3hHLHVCQUFDLFlBQU8sV0FBVSw0Q0FBMkMsU0FBUyxNQUFNLEtBQUssa0JBQWtCLE1BQU0sRUFBRSxHQUFHLGtCQUE5RztBQUFBO0FBQUE7QUFBQTtBQUFBLGVBQWdIO0FBQUEsV0FGbEg7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUdBO0FBQUEsU0FWUSxNQUFNLElBQWhCO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FXQSxDQUNELElBQUksdUJBQUMsY0FBVyx3QkFBWjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBQW9CLEtBZDNCO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FlQSxLQWhCRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBaUJBO0FBQUEsSUFFQyxjQUFjLGNBQ2I7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUNDO0FBQUEsUUFDQSxlQUFlLFFBQVE7QUFBQSxRQUN2QixpQkFBaUIsTUFBTSxpQkFBaUIsSUFBSTtBQUFBLFFBQzVDLGVBQWUsTUFBTSxlQUFlLElBQUk7QUFBQTtBQUFBLE1BSjFDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUtBO0FBQUEsSUFFRCxjQUFjLGFBQ2I7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUNDO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLHNCQUFzQjtBQUFBLFFBQ3RCO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUE7QUFBQSxNQVhGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQVlBO0FBQUEsSUFFRCxjQUFjLGNBQ2I7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUNDO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLHNCQUFzQjtBQUFBLFFBQ3RCO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUE7QUFBQSxNQVhGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQVlBO0FBQUEsSUFFRCxjQUFjLGNBQ2I7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUNDO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsZ0JBQWdCLFFBQVE7QUFBQSxRQUN4QixtQkFBbUIsUUFBUTtBQUFBLFFBQzNCLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsd0JBQXdCLFFBQVE7QUFBQSxRQUNoQztBQUFBO0FBQUEsTUFoQkY7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBaUJBO0FBQUEsSUFFRCxjQUFjLGVBQ2I7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUNDO0FBQUEsUUFDQSxnQkFBZ0IsUUFBUTtBQUFBLFFBQ3hCLGdCQUFnQixRQUFRO0FBQUEsUUFDeEI7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQTtBQUFBLE1BVkY7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBV0E7QUFBQSxJQUVELGNBQWMsYUFDYjtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQ0M7QUFBQSxRQUNBLGNBQWMsUUFBUTtBQUFBLFFBQ3RCLGNBQWMsUUFBUTtBQUFBLFFBQ3RCLG9CQUFvQixRQUFRO0FBQUEsUUFDNUI7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBO0FBQUEsTUFWRjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFXQTtBQUFBLElBRUQsY0FBYyxZQUNiO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFDQztBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0Esa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixjQUFjLFFBQVE7QUFBQTtBQUFBLE1BVHhCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQVVBO0FBQUEsSUFHRCxXQUNDLHVCQUFDLFNBQUksV0FBVSwwQkFDYjtBQUFBLDZCQUFDLFlBQU8sV0FBVSx5REFBd0QsU0FBUyxNQUFNLEtBQUssWUFBWSxHQUN2RyxtQkFBUyxTQUFTLFVBRHJCO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFFQTtBQUFBLE1BQ0E7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUNDLFdBQVU7QUFBQSxVQUNWLFNBQVMsTUFBTSxLQUFLLFdBQVc7QUFBQSxVQUNoQztBQUFBO0FBQUEsUUFIRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFLQTtBQUFBLFNBVEY7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQVVBO0FBQUEsSUFFRCxXQUNDLHVCQUFDLGFBQVEsV0FBVSw0Q0FDakI7QUFBQSw2QkFBQyxTQUFJLFdBQVUsNkJBQ2I7QUFBQSwrQkFBQyxTQUFJO0FBQUEsaUNBQUMsT0FBRSxXQUFVLGlDQUFnQyxtQkFBN0M7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBZ0Q7QUFBQSxVQUFJLHVCQUFDLE9BQUUsV0FBVSxzQkFBc0IseUJBQWUsY0FBYyxTQUFTLEtBQXpFO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQTJFO0FBQUEsYUFBcEk7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUF3STtBQUFBLFFBQ3hJLHVCQUFDLFNBQUk7QUFBQSxpQ0FBQyxPQUFFLFdBQVUsaUNBQWdDLG9CQUE3QztBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUFpRDtBQUFBLFVBQUksdUJBQUMsT0FBRSxXQUFVLHNCQUFzQjtBQUFBLDBCQUFjLFlBQVksS0FBSyxNQUFNLGNBQWMsU0FBUyxjQUFjLFlBQVksSUFBSyxFQUFFLGVBQWUsSUFBSTtBQUFBLFlBQUU7QUFBQSxlQUFySjtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUEwSjtBQUFBLGFBQXBOO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFBd047QUFBQSxRQUN4Tix1QkFBQyxTQUFJO0FBQUEsaUNBQUMsT0FBRSxXQUFVLGlDQUFnQyxrQkFBN0M7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBK0M7QUFBQSxVQUFJLHVCQUFDLE9BQUUsV0FBVSxzQkFBc0Isd0JBQWMsWUFBWSxlQUFlLEtBQTVFO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQThFO0FBQUEsYUFBdEk7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUEwSTtBQUFBLFFBQzFJLHVCQUFDLFNBQUk7QUFBQSxpQ0FBQyxPQUFFLFdBQVUsaUNBQWdDLG1CQUE3QztBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUFnRDtBQUFBLFVBQUksdUJBQUMsT0FBRSxXQUFVLHNCQUFzQixzQkFBWSxjQUFjLEtBQUssS0FBbEU7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBb0U7QUFBQSxhQUE3SDtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBQWlJO0FBQUEsV0FKbkk7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUtBO0FBQUEsTUFDQSx1QkFBQyxTQUFJLFdBQVUsZ0NBQ2I7QUFBQSwrQkFBQyxXQUFRLFdBQVUsc0JBQW5CO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFBc0M7QUFBQSxRQUN0Qyx1QkFBQyxVQUFLLFdBQVUsNkNBQTRDLE9BQU8sWUFBWSxjQUFjLFdBQVcsR0FDckcsb0JBQVUsWUFBWSxnQkFBZ0IsWUFBWSxjQUFjLFdBQVcsS0FEOUU7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUVBO0FBQUEsUUFDQyxXQUFXLFNBQVMsS0FDbkIsdUJBQUMsWUFBTyxXQUFVLHNDQUFxQyxTQUFTLE1BQU0sY0FBYyxJQUFJLEdBQUc7QUFBQTtBQUFBLFVBQ3JGLFdBQVc7QUFBQSxVQUFPO0FBQUEsYUFEeEI7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUVBO0FBQUEsV0FSSjtBQUFBO0FBQUE7QUFBQTtBQUFBLGFBVUE7QUFBQSxTQWpCRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBa0JBO0FBQUEsSUFHRCxXQUFXLHVCQUFDLFNBQUksV0FBVSwyRkFBMEY7QUFBQSw2QkFBQyxXQUFRLFdBQVUsYUFBbkI7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQUE2QjtBQUFBLE1BQUcsVUFBVSxZQUFZLGdCQUFnQjtBQUFBLFNBQS9LO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBeUw7QUFBQSxJQUNwTSxTQUFTLHVCQUFDLFNBQUksV0FBVSwwRkFBMEYsbUJBQXpHO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FBK0c7QUFBQSxLQUV2SCxXQUFXLE1BQU0sUUFBUSxNQUN6QixtQ0FDRTtBQUFBLDZCQUFDLGFBQVEsV0FBVSwwQkFDZixXQUFDLENBQUMsTUFBTSxNQUFNLE1BQU0sZUFBZSxDQUFDLEdBQUcsQ0FBQyxTQUFTLFlBQVksTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSxPQUFPLGVBQWUsQ0FBQyxDQUFDLEVBQVksSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLLE1BQ2pKLHVCQUFDLFNBQWdCLFdBQVUsaUNBQ3pCO0FBQUEsK0JBQUMsU0FBSSxXQUFVLGlDQUFpQyxtQkFBaEQ7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUFzRDtBQUFBLFFBQ3RELHVCQUFDLFNBQUksV0FBVSwrQkFBK0IsbUJBQTlDO0FBQUE7QUFBQTtBQUFBO0FBQUEsZUFBb0Q7QUFBQSxXQUY1QyxPQUFWO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUFHQSxDQUNELEtBTkg7QUFBQTtBQUFBO0FBQUE7QUFBQSxhQU9BO0FBQUEsTUFDQSx1QkFBQyxhQUFRLFdBQVUsNkJBQ2pCO0FBQUEsK0JBQUMsYUFBUSxXQUFVLHVDQUNqQjtBQUFBLGlDQUFDLFFBQUcsV0FBVSxrQ0FBaUMsc0JBQS9DO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQXFEO0FBQUEsVUFDcEQsY0FBYyxTQUFTLHVCQUFDLFNBQU0sUUFBUSxRQUFRLGlCQUFpQixXQUFVLHNCQUFsRDtBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUFxRSxJQUFLLHVCQUFDLGNBQVcsc0JBQVo7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBa0I7QUFBQSxhQUZ0SDtBQUFBO0FBQUE7QUFBQTtBQUFBLGVBR0E7QUFBQSxRQUNBLHVCQUFDLGFBQVEsV0FBVSx1Q0FDakI7QUFBQSxpQ0FBQyxRQUFHLFdBQVUsa0NBQWlDLHNCQUEvQztBQUFBO0FBQUE7QUFBQTtBQUFBLGlCQUFxRDtBQUFBLFVBQ3BELGNBQWMsU0FBUyx1QkFBQyxTQUFNLFFBQVEsUUFBUSxpQkFBaUIsV0FBVSxzQkFBbEQ7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFBcUUsSUFBSyx1QkFBQyxjQUFXLHNCQUFaO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQWtCO0FBQUEsYUFGdEg7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUdBO0FBQUEsV0FSRjtBQUFBO0FBQUE7QUFBQTtBQUFBLGFBU0E7QUFBQSxNQUNBLHVCQUFDLGFBQVEsV0FBVSx1Q0FDakI7QUFBQSwrQkFBQyxRQUFHLFdBQVUsMENBQXlDO0FBQUE7QUFBQSxVQUFLLHVCQUFDLFVBQUssV0FBVSxpQ0FBZ0Msb0JBQWhEO0FBQUE7QUFBQTtBQUFBO0FBQUEsaUJBQW9EO0FBQUEsYUFBaEg7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUF1SDtBQUFBLFFBQ3ZIO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFDQyxPQUFPO0FBQUEsWUFDUCxVQUFVO0FBQUEsWUFDVixRQUFRO0FBQUEsWUFDUixZQUFZLENBQUMsU0FDWDtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFdBQVU7QUFBQSxnQkFDVixTQUFTLE1BQ1AsS0FBSyxZQUFZO0FBQUEsa0JBQ2YsTUFBTSxZQUFZLEtBQUssSUFBSSxFQUFFLE1BQU0sT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLEtBQUs7QUFBQSxrQkFDM0QsTUFBTSxLQUFLO0FBQUEsa0JBQ1gsTUFBTTtBQUFBLGtCQUNOLE1BQU0sS0FBSztBQUFBLGtCQUNYLFlBQVksS0FBSztBQUFBLGtCQUNqQixXQUFXLEtBQUs7QUFBQSxnQkFDbEIsQ0FBQztBQUFBLGdCQUdIO0FBQUEseUNBQUMsVUFBSyxXQUFVLDhCQUE4QixzQkFBWSxLQUFLLElBQUksS0FBbkU7QUFBQTtBQUFBO0FBQUE7QUFBQSx5QkFBcUU7QUFBQSxrQkFDckUsdUJBQUMsVUFBSyxXQUFVLG9DQUFvQyxzQkFBWSxLQUFLLElBQUksS0FBekU7QUFBQTtBQUFBO0FBQUE7QUFBQSx5QkFBMkU7QUFBQTtBQUFBO0FBQUEsY0FkN0U7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFlBZUE7QUFBQTtBQUFBLFVBcEJKO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxRQXNCQTtBQUFBLFdBeEJGO0FBQUE7QUFBQTtBQUFBO0FBQUEsYUF5QkE7QUFBQSxTQTVDRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFdBNkNBO0FBQUEsT0F0U0o7QUFBQTtBQUFBO0FBQUE7QUFBQSxTQXdTQSxLQXpTRjtBQUFBO0FBQUE7QUFBQTtBQUFBLFNBMFNBO0FBRUo7IiwibmFtZXMiOltdfQ==