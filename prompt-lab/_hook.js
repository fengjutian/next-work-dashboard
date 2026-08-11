import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=59b6f232"; const useCallback = __vite__cjsImport0_react["useCallback"]; const useEffect = __vite__cjsImport0_react["useEffect"]; const useRef = __vite__cjsImport0_react["useRef"]; const useState = __vite__cjsImport0_react["useState"];
const SCAN_ERROR_LABELS = {
  "permission-denied": "拒绝访问",
  "not-found": "路径失效",
  busy: "文件占用",
  io: "I/O 错误"
};
const TOP_FILES = 50;
const TOP_DIRECTORIES = 500;
const SCAN_ERROR_CAP = 100;
const DISK_HISTORY_CAP = 168;
const SAVED_RESULTS_CAP = 5;
const SNAPSHOTS_CAP = 20;
class TopN {
  constructor(capacity, sizeOf) {
    this.capacity = capacity;
    this.sizeOf = sizeOf;
  }
  data = [];
  get size() {
    return this.data.length;
  }
  push(item) {
    if (this.data.length < this.capacity) {
      this.data.push(item);
      this.bubbleUp(this.data.length - 1);
      return;
    }
    if (this.sizeOf(item) > this.sizeOf(this.data[0])) {
      this.data[0] = item;
      this.sinkDown(0);
    }
  }
  toSortedDesc() {
    return [...this.data].sort((a, b) => this.sizeOf(b) - this.sizeOf(a));
  }
  reset() {
    this.data.length = 0;
  }
  load(items) {
    this.data.length = 0;
    for (const item of items) this.push(item);
  }
  bubbleUp(i) {
    while (i > 0) {
      const parent = i - 1 >> 1;
      const cur = this.sizeOf(this.data[i]);
      const par = this.sizeOf(this.data[parent]);
      if (cur < par) {
        const tmp = this.data[i];
        this.data[i] = this.data[parent];
        this.data[parent] = tmp;
        i = parent;
      } else break;
    }
  }
  sinkDown(i) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.sizeOf(this.data[l]) < this.sizeOf(this.data[smallest])) smallest = l;
      if (r < n && this.sizeOf(this.data[r]) < this.sizeOf(this.data[smallest])) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[i];
      this.data[i] = this.data[smallest];
      this.data[smallest] = tmp;
      i = smallest;
    }
  }
}
function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "");
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function displayPath(value) {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}
export function useDiskScan() {
  const [system, setSystem] = useState(null);
  const [diskHistory, setDiskHistory] = useState(
    () => readJson("disk-space.history", [])
  );
  const [root, setRoot] = useState("");
  const rootRef = useRef("");
  const [currentDirectory, setCurrentDirectory] = useState("");
  const [entries, setEntries] = useState([]);
  const [preview, setPreview] = useState(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const scanIdRef = useRef("");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState("scanning");
  const [scanTelemetry, setScanTelemetry] = useState({
    currentPath: "",
    directories: 0,
    files: 0,
    bytes: 0,
    elapsedMs: 0
  });
  const [scanErrors, setScanErrors] = useState([]);
  const [stats, setStats] = useState({ files: 0, bytes: 0, errors: 0 });
  const [largest, setLargest] = useState([]);
  const largestRef = useRef([]);
  const largestTopRef = useRef(new TopN(TOP_FILES, (item) => item.size));
  const largestDirtyRef = useRef(false);
  const scannedDirectoriesRef = useRef([]);
  const [directories, setDirectories] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const duplicatesRef = useRef([]);
  const [extensions, setExtensions] = useState({});
  const extensionsRef = useRef({});
  const [directorySnapshots, setDirectorySnapshots] = useState([]);
  const [directorySnapshotData, setDirectorySnapshotData] = useState([]);
  const [savedResults, setSavedResults] = useState([]);
  const [usnInfo, setUsnInfo] = useState(null);
  const [usnDelta, setUsnDelta] = useState(null);
  const [exclusionsText, setExclusionsTextState] = useState(
    () => localStorage.getItem("disk-space.exclusions") ?? ".git,node_modules,target"
  );
  const setExclusionsText = useCallback((value) => {
    setExclusionsTextState(value);
    localStorage.setItem("disk-space.exclusions", value);
  }, []);
  const [error, setError] = useState("");
  const [cleanupStatus, setCleanupStatus] = useState({ kind: "idle" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const legacyResults = readJson("disk-space.results", null);
      const legacySnapshots = readJson("disk-space.directory-snapshots", null);
      if (legacyResults && legacyResults.length > 0) {
        for (const saved of legacyResults) {
          try {
            await window.electronAPI.diskSpace.saveArchive({
              id: saved.id,
              root: saved.root,
              savedAt: saved.savedAt,
              stats: saved.stats,
              duplicates: saved.duplicates.length,
              data: {
                id: saved.id,
                root: saved.root,
                savedAt: saved.savedAt,
                stats: saved.stats,
                directories: saved.directories,
                largest: saved.largest,
                extensions: saved.extensions,
                duplicates: saved.duplicates
              }
            });
          } catch {
          }
        }
        localStorage.removeItem("disk-space.results");
      }
      if (legacySnapshots && legacySnapshots.length > 0) {
        for (const snapshot of legacySnapshots) {
          const id = `${snapshot.root.replace(/[\\/:*?"<>|]/g, "_")}__${snapshot.timestamp}`;
          try {
            await window.electronAPI.diskSpace.saveSnapshot({
              id,
              root: snapshot.root,
              timestamp: snapshot.timestamp,
              directoryCount: snapshot.directories.length,
              data: snapshot
            });
          } catch {
          }
        }
        localStorage.removeItem("disk-space.directory-snapshots");
      }
      try {
        const [archive, snapshots] = await Promise.all([
          window.electronAPI.diskSpace.listArchive(),
          window.electronAPI.diskSpace.listSnapshots()
        ]);
        if (cancelled) return;
        setSavedResults(archive);
        setDirectorySnapshots(snapshots);
        const fullData = await Promise.all(
          snapshots.map((meta) => window.electronAPI.diskSpace.loadSnapshot(meta.id))
        );
        if (cancelled) return;
        setDirectorySnapshotData(
          fullData.filter((value) => value !== null)
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError]);
  const flushLargest = useCallback(() => {
    largestDirtyRef.current = false;
    const sorted = largestTopRef.current.toSortedDesc();
    largestRef.current = sorted;
    setLargest(sorted);
  }, []);
  const refreshSystemImpl = useCallback(async () => {
    try {
      const next = await window.electronAPI.diskSpace.systemInfo();
      setSystem(next);
      setDiskHistory((current) => {
        const now = Date.now();
        const latest = current.at(-1);
        if (latest && now - latest.timestamp < 60 * 60 * 1e3) return current;
        const history = [
          ...current,
          {
            timestamp: now,
            disks: next.disks.map((disk) => ({ path: disk.path, used: disk.used }))
          }
        ].slice(-DISK_HISTORY_CAP);
        writeJson("disk-space.history", history);
        return history;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    refreshSystemImpl();
    const timer = window.setInterval(() => {
      void refreshSystemImpl();
    }, 3e4);
    return () => window.clearInterval(timer);
  }, [refreshSystemImpl]);
  useEffect(() => {
    const unsubscribe = window.electronAPI.diskSpace.onEvent((id, event) => {
      if (id !== scanIdRef.current) return;
      if (event.type === "files") {
        for (const item of event.items) largestTopRef.current.push(item);
        if (!largestDirtyRef.current) {
          largestDirtyRef.current = true;
          requestAnimationFrame(flushLargest);
        }
      } else if (event.type === "directories") {
        const next = event.items.slice(0, TOP_DIRECTORIES);
        scannedDirectoriesRef.current = next;
        setDirectories(next);
      } else if (event.type === "duplicate-progress") {
        setPhase("hashing");
      } else if (event.type === "scan-status") {
        setScanTelemetry(event);
      } else if (event.type === "scan-error") {
        setScanErrors(
          (value) => [
            ...value,
            {
              path: event.path,
              category: event.category,
              message: `【${SCAN_ERROR_LABELS[event.category]}】${event.message}`
            }
          ].slice(-SCAN_ERROR_CAP)
        );
      } else if (event.type === "duplicate") {
        const next = [...duplicatesRef.current, event];
        duplicatesRef.current = next;
        setDuplicates(next);
      } else if (event.type === "extension") {
        const next = { ...extensionsRef.current, [event.extension || "(无扩展名)"]: event.size };
        extensionsRef.current = next;
        setExtensions(next);
      } else if (event.type === "progress" || event.type === "done") {
        setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
        if (event.type === "done" && rootRef.current) {
          flushLargest();
          const id2 = crypto.randomUUID();
          const fullData = {
            id: id2,
            root: rootRef.current,
            savedAt: Date.now(),
            stats: { files: event.files, bytes: event.bytes, errors: event.errors },
            directories: scannedDirectoriesRef.current.slice(0, TOP_DIRECTORIES),
            largest: largestRef.current.slice(0, TOP_FILES),
            extensions: { ...extensionsRef.current },
            duplicates: duplicatesRef.current.slice(0, 100)
          };
          const meta = {
            id: id2,
            root: fullData.root,
            savedAt: fullData.savedAt,
            stats: fullData.stats,
            duplicates: fullData.duplicates.length
          };
          void window.electronAPI.diskSpace.saveArchive({ ...meta, data: fullData }).then((next) => setSavedResults(next)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
          writeJson("disk-space.last-result", { id: id2, root: fullData.root });
          const snapshotData = {
            timestamp: fullData.savedAt,
            root: fullData.root,
            directories: scannedDirectoriesRef.current.map((item) => ({
              path: item.path,
              size: item.size
            }))
          };
          const snapshotId = `${fullData.root.replace(/[\\/:*?"<>|]/g, "_")}__${fullData.savedAt}`;
          const snapshotMeta = {
            id: snapshotId,
            root: fullData.root,
            timestamp: fullData.savedAt,
            directoryCount: snapshotData.directories.length
          };
          void window.electronAPI.diskSpace.saveSnapshot({ ...snapshotMeta, data: snapshotData }).then((next) => {
            setDirectorySnapshots(next);
            setDirectorySnapshotData((current) => [...current, snapshotData].slice(-SNAPSHOTS_CAP));
          }).catch(() => {
          });
        }
      }
    });
    return unsubscribe;
  }, [flushLargest]);
  useEffect(() => {
    const unsubscribe = window.electronAPI.diskSpace.onExit((id, result) => {
      if (id !== scanIdRef.current) return;
      setRunning(false);
      setPaused(false);
      if (result.error) setError(result.error);
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!root) {
      setUsnInfo(null);
      setUsnDelta(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.diskSpace.usnInfo(root).then((info) => {
      if (cancelled) return;
      setUsnInfo(info);
      if (info.supported && info.volume && info.nextUsn !== void 0) {
        const cursors = readJson("disk-space.usn-cursors", {});
        const previous = cursors[info.volume];
        setUsnDelta(
          previous && previous.journalId === info.journalId ? Math.max(0, info.nextUsn - previous.nextUsn) : null
        );
        cursors[info.volume] = {
          journalId: info.journalId,
          nextUsn: info.nextUsn,
          recordedAt: Date.now()
        };
        writeJson("disk-space.usn-cursors", cursors);
      }
    }).catch((cause) => {
      if (cancelled) return;
      setUsnInfo({ supported: false, error: String(cause) });
    });
    return () => {
      cancelled = true;
    };
  }, [root]);
  const refreshSystem = refreshSystemImpl;
  const choose = useCallback(async () => {
    const previousScanId = scanIdRef.current;
    if (previousScanId && running) {
      void window.electronAPI.diskSpace.cancel(previousScanId);
      scanIdRef.current = "";
      setRunning(false);
      setPaused(false);
    }
    const chosen = await window.electronAPI.diskSpace.pickRoot();
    if (!chosen) return;
    rootRef.current = chosen;
    setRoot(chosen);
    setCurrentDirectory(chosen);
    setPreview(null);
    setBrowserLoading(true);
    try {
      setEntries(await window.electronAPI.diskSpace.listDirectory(chosen, chosen));
      const saved = readJson("disk-space.last-result", null);
      if (saved && displayPath(saved.root).toLowerCase() === displayPath(chosen).toLowerCase()) {
        scannedDirectoriesRef.current = saved.directories;
        largestRef.current = saved.largest;
        largestTopRef.current.load(saved.largest);
        largestDirtyRef.current = false;
        extensionsRef.current = saved.extensions;
        duplicatesRef.current = saved.duplicates ?? [];
        setStats(saved.stats);
        setDirectories(saved.directories);
        setLargest(saved.largest);
        setExtensions(saved.extensions);
        setDuplicates(saved.duplicates ?? []);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBrowserLoading(false);
    }
  }, [running]);
  const start = useCallback(
    async (focusedScan) => {
      if (!root || running) return;
      const exclusions = focusedScan ? [".git"] : exclusionsText.split(",").map((value) => value.trim()).filter(Boolean);
      rootRef.current = root;
      scannedDirectoriesRef.current = [];
      largestRef.current = [];
      largestTopRef.current.reset();
      largestDirtyRef.current = false;
      extensionsRef.current = {};
      duplicatesRef.current = [];
      scanIdRef.current = crypto.randomUUID();
      setStats({ files: 0, bytes: 0, errors: 0 });
      setScanTelemetry({ currentPath: root, directories: 0, files: 0, bytes: 0, elapsedMs: 0 });
      setScanErrors([]);
      setLargest([]);
      setExtensions({});
      setDirectories([]);
      setDuplicates([]);
      setPhase("scanning");
      setError("");
      setPaused(false);
      setRunning(true);
      try {
        await window.electronAPI.diskSpace.start(scanIdRef.current, root, {
          exclusions,
          skipDuplicates: focusedScan
        });
      } catch (cause) {
        setRunning(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [root, running, exclusionsText]
  );
  const cancelScan = useCallback(async () => {
    if (!scanIdRef.current) return;
    await window.electronAPI.diskSpace.cancel(scanIdRef.current);
    scanIdRef.current = "";
    setRunning(false);
    setPaused(false);
  }, []);
  const togglePause = useCallback(async () => {
    if (!scanIdRef.current) return;
    const success = paused ? await window.electronAPI.diskSpace.resume(scanIdRef.current) : await window.electronAPI.diskSpace.pause(scanIdRef.current);
    if (success) setPaused(!paused);
  }, [paused]);
  const loadDirectory = useCallback(
    async (directory) => {
      if (!root) return;
      setBrowserLoading(true);
      setPreview(null);
      try {
        setEntries(await window.electronAPI.diskSpace.listDirectory(root, directory));
        setCurrentDirectory(directory);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBrowserLoading(false);
      }
    },
    [root]
  );
  const openPreview = useCallback(
    async (entry) => {
      if (entry.type === "directory") {
        await loadDirectory(entry.path);
        return;
      }
      setBrowserLoading(true);
      try {
        setPreview(await window.electronAPI.diskSpace.preview(root, entry.path));
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBrowserLoading(false);
      }
    },
    [root, loadDirectory]
  );
  const restoreSavedResult = useCallback(async (id) => {
    try {
      const data = await window.electronAPI.diskSpace.loadArchive(id);
      if (!data) throw new Error("存档不存在或已损坏");
      const duplicates2 = (data.duplicates ?? []).map((group) => ({
        type: "duplicate",
        groupId: group.groupId,
        size: group.size,
        files: group.files
      }));
      rootRef.current = data.root;
      scannedDirectoriesRef.current = data.directories;
      largestRef.current = data.largest;
      largestTopRef.current.load(data.largest);
      largestDirtyRef.current = false;
      extensionsRef.current = data.extensions;
      duplicatesRef.current = duplicates2;
      setRoot(data.root);
      setCurrentDirectory(data.root);
      setStats(data.stats);
      setDirectories(data.directories);
      setLargest(data.largest);
      setExtensions(data.extensions);
      setDuplicates(duplicates2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);
  const removeSavedResult = useCallback(async (id) => {
    try {
      const next = await window.electronAPI.diskSpace.deleteArchive(id);
      setSavedResults(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);
  const removeDirectorySnapshot = useCallback(
    async (id) => {
      try {
        const next = await window.electronAPI.diskSpace.deleteSnapshot(id);
        setDirectorySnapshots(next);
        setDirectorySnapshotData((current) => {
          const meta = next.find((entry) => entry.id === id);
          if (!meta) return current;
          return current.filter(
            (snapshot) => !(snapshot.timestamp === meta.timestamp && snapshot.root === meta.root)
          );
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [setError]
  );
  const clearHistory = useCallback(async () => {
    localStorage.removeItem("disk-space.history");
    setDiskHistory([]);
    try {
      await window.electronAPI.diskSpace.clearArchive();
      setDirectorySnapshots([]);
      setDirectorySnapshotData([]);
      setSavedResults([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);
  const runCleanup = useCallback(async (action) => {
    if (cleanupStatus.kind === "running") return;
    setCleanupStatus({ kind: "running", action });
    try {
      const result = await window.electronAPI.diskSpace.runCleanup(action, root);
      if (result.success) {
        setCleanupStatus({ kind: "success", action, message: result.output ?? "清理完成" });
      } else if (result.canceled) {
        setCleanupStatus({ kind: "idle" });
      } else {
        setCleanupStatus({ kind: "error", action, message: result.output ?? "清理失败" });
      }
    } catch (cause) {
      setCleanupStatus({
        kind: "error",
        action,
        message: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }, [cleanupStatus.kind, root]);
  const clearCleanupStatus = useCallback(() => {
    setCleanupStatus({ kind: "idle" });
  }, []);
  return {
    system,
    diskHistory,
    root,
    currentDirectory,
    entries,
    preview,
    browserLoading,
    setPreview,
    setCurrentDirectory,
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
    directorySnapshotData,
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
    clearCleanupStatus
  };
}

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInVzZURpc2tTY2FuLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiB1c2VEaXNrU2NhbiDigJTigJQg56OB55uY56m66Ze05o+S5Lu255qE5qC45b+D5omr5o+PIGhvb2vjgIJcclxuICpcclxuICog6ZuG5Lit5omA5pyJ6Z2eIFVJIOmAu+i+ke+8mklQQyDkuovku7bnm5HlkKzjgIHmiavmj4/nlJ/lkb3lkajmnJ/jgIFUb3BOIOe7tOaKpOOAgWxvY2FsU3RvcmFnZVxyXG4gKiDmjIHkuYXljJbvvIhoaXN0b3J5IC8gc25hcHNob3RzIC8gcmVzdWx0cyAvIGV4Y2x1c2lvbnMgLyB1c24tY3Vyc29yc++8ieOAgVVTTiDmuLjmoIfjgIJcclxuICogVUkg54q25oCB77yIYWN0aXZlVGFiIC8gc2VsZWN0ZWREdXBsaWNhdGVzIC8gbW9kYWwgb3BlbiDnirbmgIEgLyBsYXJnZUZpbGUg562b6YCJXHJcbiAqIC8gc3BlY2lhbHR5UHJvYmVzIC8g6K+K5pat77yJ5LuN55SxIHBhbmVsIOaIliB0YWIg57uE5Lu26Ieq5bex57u05oqk44CCXHJcbiAqXHJcbiAqIOiuvuiuoeWOn+WIme+8mlxyXG4gKiAtIOS4jeS+nei1liBzdG9yZSDmiJYgQUnvvIjov5nkupvnlLEgdGFiIOe7hOS7tuaMiemcgOazqOWFpe+8ieOAglxyXG4gKiAtIOaatOmcsiByZWYgKyBzdGF0ZSArIGFjdGlvbnPvvJtyZWYg57uZ5ZCM5q2l5Ymv5L2c55So55So77yMc3RhdGUg57uZ5riy5p+T55So44CCXHJcbiAqIC0gY2hvb3NlKCkgLyBzdGFydCgpIC8gY2FuY2VsU2NhbigpIC8gdG9nZ2xlUGF1c2UoKSDnrYnliqjkvZzluYLnrYnkuJToh6rljIXlkKvjgIJcclxuICovXHJcbmltcG9ydCB7IHVzZUNhbGxiYWNrLCB1c2VFZmZlY3QsIHVzZVJlZiwgdXNlU3RhdGUsIHR5cGUgTXV0YWJsZVJlZk9iamVjdCB9IGZyb20gJ3JlYWN0JztcclxuaW1wb3J0IHR5cGUge1xyXG4gIERpc2tBcmNoaXZlRW50cnksXHJcbiAgRGlza0RpcmVjdG9yeUl0ZW0sXHJcbiAgRGlza0RpcmVjdG9yeVNuYXBzaG90RGF0YSxcclxuICBEaXNrRmlsZVByZXZpZXcsXHJcbiAgRGlza1BlcnNpc3RlZFJlc3VsdCxcclxuICBEaXNrU2NhbkV2ZW50LFxyXG4gIERpc2tTbmFwc2hvdEVudHJ5LFxyXG4gIERpc2tTeXN0ZW1JbmZvLFxyXG4gIERpc2tVc25JbmZvLFxyXG59IGZyb20gJ0AvdHlwZXMvZWxlY3Ryb24nO1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLSDnsbvlnovliKvlkI0gLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZXhwb3J0IHR5cGUgRmlsZUVudHJ5ID0gRXh0cmFjdDxEaXNrU2NhbkV2ZW50LCB7IHR5cGU6ICdmaWxlcycgfT5bJ2l0ZW1zJ11bbnVtYmVyXTtcclxuZXhwb3J0IHR5cGUgRGlyZWN0b3J5RW50cnkgPSBFeHRyYWN0PERpc2tTY2FuRXZlbnQsIHsgdHlwZTogJ2RpcmVjdG9yaWVzJyB9PlsnaXRlbXMnXVtudW1iZXJdO1xyXG5leHBvcnQgdHlwZSBEdXBsaWNhdGVHcm91cCA9IEV4dHJhY3Q8RGlza1NjYW5FdmVudCwgeyB0eXBlOiAnZHVwbGljYXRlJyB9PjtcclxuXHJcbmV4cG9ydCB0eXBlIERpc2tIaXN0b3J5UG9pbnQgPSB7XHJcbiAgdGltZXN0YW1wOiBudW1iZXI7XHJcbiAgZGlza3M6IEFycmF5PHsgcGF0aDogc3RyaW5nOyB1c2VkOiBudW1iZXIgfT47XHJcbn07XHJcbmV4cG9ydCB0eXBlIERpcmVjdG9yeVNuYXBzaG90ID0ge1xyXG4gIHRpbWVzdGFtcDogbnVtYmVyO1xyXG4gIHJvb3Q6IHN0cmluZztcclxuICBkaXJlY3RvcmllczogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IHNpemU6IG51bWJlciB9PjtcclxufTtcclxuZXhwb3J0IHR5cGUgUGVyc2lzdGVkU2NhblJlc3VsdCA9IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb3Q6IHN0cmluZztcclxuICBzYXZlZEF0OiBudW1iZXI7XHJcbiAgc3RhdHM6IHsgZmlsZXM6IG51bWJlcjsgYnl0ZXM6IG51bWJlcjsgZXJyb3JzOiBudW1iZXIgfTtcclxuICBkaXJlY3RvcmllczogRGlyZWN0b3J5RW50cnlbXTtcclxuICBsYXJnZXN0OiBGaWxlRW50cnlbXTtcclxuICBleHRlbnNpb25zOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xyXG4gIGR1cGxpY2F0ZXM6IER1cGxpY2F0ZUdyb3VwW107XHJcbn07XHJcbmV4cG9ydCB0eXBlIFNjYW5FcnJvckl0ZW0gPSB7XHJcbiAgcGF0aDogc3RyaW5nO1xyXG4gIGNhdGVnb3J5OiAncGVybWlzc2lvbi1kZW5pZWQnIHwgJ25vdC1mb3VuZCcgfCAnYnVzeScgfCAnaW8nO1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxufTtcclxuZXhwb3J0IHR5cGUgU2NhblRlbGVtZXRyeSA9IHtcclxuICBjdXJyZW50UGF0aDogc3RyaW5nO1xyXG4gIGRpcmVjdG9yaWVzOiBudW1iZXI7XHJcbiAgZmlsZXM6IG51bWJlcjtcclxuICBieXRlczogbnVtYmVyO1xyXG4gIGVsYXBzZWRNczogbnVtYmVyO1xyXG59O1xyXG5leHBvcnQgdHlwZSBTY2FuUGhhc2UgPSAnc2Nhbm5pbmcnIHwgJ2hhc2hpbmcnO1xyXG5cclxuLy8g5riF55CG5Yqo5L2c54q25oCB5py677ya5pu/5o2i5Y6fIGVycm9yIOWtl+espuS4suWMuemFje+8iFwi5riF55CG5a6M5oiQJFwi77yJ55qE5Y+N5qih5byP44CCXHJcbi8vIOS7u+S9leaXtuWIu+WPquiDveWkhOS6juS7peS4i+eKtuaAgeS5i+S4gO+8m+WIh+aNoueKtuaAgeaXtumpseWKqOWJr+S9nOeUqO+8iOiHquWKqOmHjeaJq+OAgVRvYXN077yJ44CCXHJcbmV4cG9ydCB0eXBlIENsZWFudXBTdGF0dXMgPVxyXG4gIHwgeyBraW5kOiAnaWRsZScgfVxyXG4gIHwgeyBraW5kOiAncnVubmluZyc7IGFjdGlvbjogQ2xlYW51cEFjdGlvbklkIH1cclxuICB8IHsga2luZDogJ3N1Y2Nlc3MnOyBhY3Rpb246IENsZWFudXBBY3Rpb25JZDsgbWVzc2FnZTogc3RyaW5nIH1cclxuICB8IHsga2luZDogJ2Vycm9yJzsgYWN0aW9uOiBDbGVhbnVwQWN0aW9uSWQ7IG1lc3NhZ2U6IHN0cmluZyB9O1xyXG5leHBvcnQgdHlwZSBDbGVhbnVwQWN0aW9uSWQgPSAnZG9ja2VyLWJ1aWxkLWNhY2hlJyB8ICducG0tY2FjaGUnIHwgJ3BucG0tc3RvcmUnO1xyXG5cclxuY29uc3QgU0NBTl9FUlJPUl9MQUJFTFM6IFJlY29yZDxTY2FuRXJyb3JJdGVtWydjYXRlZ29yeSddLCBzdHJpbmc+ID0ge1xyXG4gICdwZXJtaXNzaW9uLWRlbmllZCc6ICfmi5Lnu53orr/pl64nLFxyXG4gICdub3QtZm91bmQnOiAn6Lev5b6E5aSx5pWIJyxcclxuICBidXN5OiAn5paH5Lu25Y2g55SoJyxcclxuICBpbzogJ0kvTyDplJnor68nLFxyXG59O1xyXG5jb25zdCBUT1BfRklMRVMgPSA1MDtcclxuY29uc3QgVE9QX0RJUkVDVE9SSUVTID0gNTAwO1xyXG5jb25zdCBTQ0FOX0VSUk9SX0NBUCA9IDEwMDtcclxuY29uc3QgRElTS19ISVNUT1JZX0NBUCA9IDE2ODsgLy8gNyDlpKkgw5cgMjQg5bCP5pe2XHJcbmNvbnN0IFNBVkVEX1JFU1VMVFNfQ0FQID0gNTtcclxuY29uc3QgU05BUFNIT1RTX0NBUCA9IDIwO1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLSBUb3BOIOWuueWZqCAtLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vKipcclxuICog57u05oqkIGNhcGFjaXR5IOS4quacgOWkp+WFg+e0oOeahOWwj+mhtuWghuOAguWuuemHj+acqua7oSBPKGxvZyBuKSBwdXNo77yb5ruh5ZCOIE8oMSkg5ouS57udXHJcbiAqIOaIliBPKGxvZyBuKSDmm7/mjaLloIbpobbjgILnmb7kuIfnuqfkuovku7bkuIvpgb/lhY3mr4/mnaHpg70gWy4uLmFycl0uc29ydCgpLnNsaWNlKDAsIE4p44CCXHJcbiAqL1xyXG5jbGFzcyBUb3BOPFQ+IHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGRhdGE6IFRbXSA9IFtdO1xyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjYXBhY2l0eTogbnVtYmVyLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBzaXplT2Y6IChpdGVtOiBUKSA9PiBudW1iZXIsXHJcbiAgKSB7fVxyXG4gIGdldCBzaXplKCk6IG51bWJlciB7XHJcbiAgICByZXR1cm4gdGhpcy5kYXRhLmxlbmd0aDtcclxuICB9XHJcbiAgcHVzaChpdGVtOiBUKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy5kYXRhLmxlbmd0aCA8IHRoaXMuY2FwYWNpdHkpIHtcclxuICAgICAgdGhpcy5kYXRhLnB1c2goaXRlbSk7XHJcbiAgICAgIHRoaXMuYnViYmxlVXAodGhpcy5kYXRhLmxlbmd0aCAtIDEpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5zaXplT2YoaXRlbSkgPiB0aGlzLnNpemVPZih0aGlzLmRhdGFbMF0hKSkge1xyXG4gICAgICB0aGlzLmRhdGFbMF0gPSBpdGVtO1xyXG4gICAgICB0aGlzLnNpbmtEb3duKDApO1xyXG4gICAgfVxyXG4gIH1cclxuICB0b1NvcnRlZERlc2MoKTogVFtdIHtcclxuICAgIHJldHVybiBbLi4udGhpcy5kYXRhXS5zb3J0KChhLCBiKSA9PiB0aGlzLnNpemVPZihiKSAtIHRoaXMuc2l6ZU9mKGEpKTtcclxuICB9XHJcbiAgcmVzZXQoKTogdm9pZCB7XHJcbiAgICB0aGlzLmRhdGEubGVuZ3RoID0gMDtcclxuICB9XHJcbiAgbG9hZChpdGVtczogVFtdKTogdm9pZCB7XHJcbiAgICB0aGlzLmRhdGEubGVuZ3RoID0gMDtcclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykgdGhpcy5wdXNoKGl0ZW0pO1xyXG4gIH1cclxuICBwcml2YXRlIGJ1YmJsZVVwKGk6IG51bWJlcik6IHZvaWQge1xyXG4gICAgd2hpbGUgKGkgPiAwKSB7XHJcbiAgICAgIGNvbnN0IHBhcmVudCA9IChpIC0gMSkgPj4gMTtcclxuICAgICAgY29uc3QgY3VyID0gdGhpcy5zaXplT2YodGhpcy5kYXRhW2ldISk7XHJcbiAgICAgIGNvbnN0IHBhciA9IHRoaXMuc2l6ZU9mKHRoaXMuZGF0YVtwYXJlbnRdISk7XHJcbiAgICAgIGlmIChjdXIgPCBwYXIpIHtcclxuICAgICAgICBjb25zdCB0bXAgPSB0aGlzLmRhdGFbaV0hO1xyXG4gICAgICAgIHRoaXMuZGF0YVtpXSA9IHRoaXMuZGF0YVtwYXJlbnRdITtcclxuICAgICAgICB0aGlzLmRhdGFbcGFyZW50XSA9IHRtcDtcclxuICAgICAgICBpID0gcGFyZW50O1xyXG4gICAgICB9IGVsc2UgYnJlYWs7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHByaXZhdGUgc2lua0Rvd24oaTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCBuID0gdGhpcy5kYXRhLmxlbmd0aDtcclxuICAgIC8vIOagh+WHhuWwj+mhtuWghuS4i+a7pO+8muW+queOr+WIsOWghuW6j+eos+WumuS4uuatouOAglxyXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnN0YW50LWNvbmRpdGlvblxyXG4gICAgd2hpbGUgKHRydWUpIHtcclxuICAgICAgY29uc3QgbCA9IDIgKiBpICsgMTtcclxuICAgICAgY29uc3QgciA9IDIgKiBpICsgMjtcclxuICAgICAgbGV0IHNtYWxsZXN0ID0gaTtcclxuICAgICAgaWYgKGwgPCBuICYmIHRoaXMuc2l6ZU9mKHRoaXMuZGF0YVtsXSEpIDwgdGhpcy5zaXplT2YodGhpcy5kYXRhW3NtYWxsZXN0XSEpKSBzbWFsbGVzdCA9IGw7XHJcbiAgICAgIGlmIChyIDwgbiAmJiB0aGlzLnNpemVPZih0aGlzLmRhdGFbcl0hKSA8IHRoaXMuc2l6ZU9mKHRoaXMuZGF0YVtzbWFsbGVzdF0hKSkgc21hbGxlc3QgPSByO1xyXG4gICAgICBpZiAoc21hbGxlc3QgPT09IGkpIGJyZWFrO1xyXG4gICAgICBjb25zdCB0bXAgPSB0aGlzLmRhdGFbaV0hO1xyXG4gICAgICB0aGlzLmRhdGFbaV0gPSB0aGlzLmRhdGFbc21hbGxlc3RdITtcclxuICAgICAgdGhpcy5kYXRhW3NtYWxsZXN0XSA9IHRtcDtcclxuICAgICAgaSA9IHNtYWxsZXN0O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLSBsb2NhbFN0b3JhZ2Ug5bel5YW3IC0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmZ1bmN0aW9uIHJlYWRKc29uPFQ+KGtleTogc3RyaW5nLCBmYWxsYmFjazogVCk6IFQge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpIHx8ICcnKSBhcyBUO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbGxiYWNrO1xyXG4gIH1cclxufVxyXG5mdW5jdGlvbiB3cml0ZUpzb24oa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdm9pZCB7XHJcbiAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oa2V5LCBKU09OLnN0cmluZ2lmeSh2YWx1ZSkpO1xyXG59XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tIGRpc3BsYXlQYXRoIOW3peWFtyAtLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vKiogV2luZG93cyDplb/ot6/lvoTliY3nvIAgXFxcXD9cXCDmiJYgXFxcXD9cXFVOQ1xcIOi/mOWOn+aIkOWPr+ingeW9ouW8j+OAgiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZGlzcGxheVBhdGgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoJ1xcXFxcXFxcP1xcXFxVTkNcXFxcJykpIHJldHVybiBgXFxcXFxcXFwke3ZhbHVlLnNsaWNlKDgpfWA7XHJcbiAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ1xcXFxcXFxcP1xcXFwnKSA/IHZhbHVlLnNsaWNlKDQpIDogdmFsdWU7XHJcbn1cclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0gSG9vayDmjqXlj6MgLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBVc2VEaXNrU2NhblJlc3VsdCB7XHJcbiAgLy8gc3lzdGVtIC8gaGlzdG9yeVxyXG4gIHN5c3RlbTogRGlza1N5c3RlbUluZm8gfCBudWxsO1xyXG4gIGRpc2tIaXN0b3J5OiBEaXNrSGlzdG9yeVBvaW50W107XHJcblxyXG4gIC8vIHJvb3QgKyBkaXJlY3RvcnlcclxuICByb290OiBzdHJpbmc7XHJcbiAgY3VycmVudERpcmVjdG9yeTogc3RyaW5nO1xyXG4gIGVudHJpZXM6IERpc2tEaXJlY3RvcnlJdGVtW107XHJcbiAgcHJldmlldzogRGlza0ZpbGVQcmV2aWV3IHwgbnVsbDtcclxuICBicm93c2VyTG9hZGluZzogYm9vbGVhbjtcclxuICBzZXRQcmV2aWV3OiAocHJldmlldzogRGlza0ZpbGVQcmV2aWV3IHwgbnVsbCkgPT4gdm9pZDtcclxuICBzZXRDdXJyZW50RGlyZWN0b3J5OiAocGF0aDogc3RyaW5nKSA9PiB2b2lkO1xyXG5cclxuICAvLyBzY2FuIGxpZmVjeWNsZVxyXG4gIHNjYW5JZFJlZjogTXV0YWJsZVJlZk9iamVjdDxzdHJpbmc+O1xyXG4gIHJvb3RSZWY6IE11dGFibGVSZWZPYmplY3Q8c3RyaW5nPjtcclxuICBydW5uaW5nOiBib29sZWFuO1xyXG4gIHBhdXNlZDogYm9vbGVhbjtcclxuICBwaGFzZTogU2NhblBoYXNlO1xyXG4gIHNjYW5UZWxlbWV0cnk6IFNjYW5UZWxlbWV0cnk7XHJcbiAgc2NhbkVycm9yczogU2NhbkVycm9ySXRlbVtdO1xyXG4gIHN0YXRzOiB7IGZpbGVzOiBudW1iZXI7IGJ5dGVzOiBudW1iZXI7IGVycm9yczogbnVtYmVyIH07XHJcblxyXG4gIC8vIHJlc3VsdHNcclxuICBsYXJnZXN0OiBGaWxlRW50cnlbXTtcclxuICBkdXBsaWNhdGVzOiBEdXBsaWNhdGVHcm91cFtdO1xyXG4gIGV4dGVuc2lvbnM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XHJcbiAgZGlyZWN0b3JpZXM6IERpcmVjdG9yeUVudHJ5W107XHJcblxyXG4gIC8vIGhpc3RvcnkgLyBhcmNoaXZlXHJcbiAgZGlyZWN0b3J5U25hcHNob3RzOiBEaXNrU25hcHNob3RFbnRyeVtdO1xyXG4gIC8vIHNuYXBzaG90IOWujOaVtOaVsOaNru+8muS4jiBkaXJlY3RvcnlTbmFwc2hvdHMg5LiA5LiA5a+55bqU77ybZGlyZWN0b3J5Q2hhbmdlcyDmtL7nlJ/nlKjjgIJcclxuICAvLyDlkK/liqjml7blvILmraXku44gdXNlckRhdGEg5Yqg6L2977yMZG9uZSDml7bnm7TmjqUgcHVzaCDmlrDmlbDmja7jgIJcclxuICBkaXJlY3RvcnlTbmFwc2hvdERhdGE6IERpcmVjdG9yeVNuYXBzaG90W107XHJcbiAgc2F2ZWRSZXN1bHRzOiBEaXNrQXJjaGl2ZUVudHJ5W107XHJcblxyXG4gIC8vIFVTTlxyXG4gIHVzbkluZm86IERpc2tVc25JbmZvIHwgbnVsbDtcclxuICB1c25EZWx0YTogbnVtYmVyIHwgbnVsbDtcclxuXHJcbiAgLy8gY29uZmlnXHJcbiAgZXhjbHVzaW9uc1RleHQ6IHN0cmluZztcclxuICBzZXRFeGNsdXNpb25zVGV4dDogKHZhbHVlOiBzdHJpbmcpID0+IHZvaWQ7XHJcblxyXG4gIC8vIGVycm9yIOKAlCDnlLEgaG9vayDlhoXpg6jnu7TmiqTvvIhjYXRjaCDliIbmlK/nu5/kuIDlhpnlhaXvvIlcclxuICBlcnJvcjogc3RyaW5nO1xyXG4gIHNldEVycm9yOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkO1xyXG5cclxuICAvLyBhY3Rpb25zXHJcbiAgcmVmcmVzaFN5c3RlbTogKCkgPT4gUHJvbWlzZTx2b2lkPjtcclxuICBjaG9vc2U6ICgpID0+IFByb21pc2U8dm9pZD47XHJcbiAgc3RhcnQ6IChmb2N1c2VkU2NhbjogYm9vbGVhbikgPT4gUHJvbWlzZTx2b2lkPjtcclxuICBjYW5jZWxTY2FuOiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xyXG4gIHRvZ2dsZVBhdXNlOiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xyXG4gIGxvYWREaXJlY3Rvcnk6IChwYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XHJcbiAgb3BlblByZXZpZXc6IChlbnRyeTogRGlza0RpcmVjdG9yeUl0ZW0pID0+IFByb21pc2U8dm9pZD47XHJcbiAgLy8gYXJjaGl2ZSDmk43kvZzmlLnmiJAgYXN5bmPvvJrlhoXpg6jku44gdXNlckRhdGEg5paH5Lu25Yqg6L295a6M5pW05pWw5o2uXHJcbiAgcmVzdG9yZVNhdmVkUmVzdWx0OiAoaWQ6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcclxuICByZW1vdmVTYXZlZFJlc3VsdDogKGlkOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XHJcbiAgcmVtb3ZlRGlyZWN0b3J5U25hcHNob3Q6IChpZDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+O1xyXG4gIGNsZWFySGlzdG9yeTogKCkgPT4gUHJvbWlzZTx2b2lkPjtcclxuICBzZXRSdW5uaW5nOiAocnVubmluZzogYm9vbGVhbikgPT4gdm9pZDtcclxuICBzZXRQYXVzZWQ6IChwYXVzZWQ6IGJvb2xlYW4pID0+IHZvaWQ7XHJcbiAgc2V0U2NhbkVycm9yczogUmVhY3QuRGlzcGF0Y2g8UmVhY3QuU2V0U3RhdGVBY3Rpb248U2NhbkVycm9ySXRlbVtdPj47XHJcbiAgc2V0QnJvd3NlckxvYWRpbmc6IChsb2FkaW5nOiBib29sZWFuKSA9PiB2b2lkO1xyXG4gIHNldEVudHJpZXM6IChlbnRyaWVzOiBEaXNrRGlyZWN0b3J5SXRlbVtdKSA9PiB2b2lkO1xyXG4gIHNldER1cGxpY2F0ZXM6IFJlYWN0LkRpc3BhdGNoPFJlYWN0LlNldFN0YXRlQWN0aW9uPER1cGxpY2F0ZUdyb3VwW10+PjtcclxuXHJcbiAgLy8gY2xlYW51cCDnirbmgIHmnLpcclxuICBjbGVhbnVwU3RhdHVzOiBDbGVhbnVwU3RhdHVzO1xyXG4gIHJ1bkNsZWFudXA6IChhY3Rpb246IENsZWFudXBBY3Rpb25JZCkgPT4gUHJvbWlzZTx2b2lkPjtcclxuICBjbGVhckNsZWFudXBTdGF0dXM6ICgpID0+IHZvaWQ7XHJcbn1cclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0gSG9vayDlrp7njrAgLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHVzZURpc2tTY2FuKCk6IFVzZURpc2tTY2FuUmVzdWx0IHtcclxuICAvLyBzeXN0ZW0gLyBoaXN0b3J5XHJcbiAgY29uc3QgW3N5c3RlbSwgc2V0U3lzdGVtXSA9IHVzZVN0YXRlPERpc2tTeXN0ZW1JbmZvIHwgbnVsbD4obnVsbCk7XHJcbiAgY29uc3QgW2Rpc2tIaXN0b3J5LCBzZXREaXNrSGlzdG9yeV0gPSB1c2VTdGF0ZTxEaXNrSGlzdG9yeVBvaW50W10+KCgpID0+XHJcbiAgICByZWFkSnNvbjxEaXNrSGlzdG9yeVBvaW50W10+KCdkaXNrLXNwYWNlLmhpc3RvcnknLCBbXSksXHJcbiAgKTtcclxuXHJcbiAgLy8gcm9vdCArIGRpcmVjdG9yeVxyXG4gIGNvbnN0IFtyb290LCBzZXRSb290XSA9IHVzZVN0YXRlKCcnKTtcclxuICBjb25zdCByb290UmVmID0gdXNlUmVmKCcnKTtcclxuICBjb25zdCBbY3VycmVudERpcmVjdG9yeSwgc2V0Q3VycmVudERpcmVjdG9yeV0gPSB1c2VTdGF0ZSgnJyk7XHJcbiAgY29uc3QgW2VudHJpZXMsIHNldEVudHJpZXNdID0gdXNlU3RhdGU8RGlza0RpcmVjdG9yeUl0ZW1bXT4oW10pO1xyXG4gIGNvbnN0IFtwcmV2aWV3LCBzZXRQcmV2aWV3XSA9IHVzZVN0YXRlPERpc2tGaWxlUHJldmlldyB8IG51bGw+KG51bGwpO1xyXG4gIGNvbnN0IFticm93c2VyTG9hZGluZywgc2V0QnJvd3NlckxvYWRpbmddID0gdXNlU3RhdGUoZmFsc2UpO1xyXG5cclxuICAvLyBzY2FuIGxpZmVjeWNsZVxyXG4gIGNvbnN0IHNjYW5JZFJlZiA9IHVzZVJlZignJyk7XHJcbiAgY29uc3QgW3J1bm5pbmcsIHNldFJ1bm5pbmddID0gdXNlU3RhdGUoZmFsc2UpO1xyXG4gIGNvbnN0IFtwYXVzZWQsIHNldFBhdXNlZF0gPSB1c2VTdGF0ZShmYWxzZSk7XHJcbiAgY29uc3QgW3BoYXNlLCBzZXRQaGFzZV0gPSB1c2VTdGF0ZTxTY2FuUGhhc2U+KCdzY2FubmluZycpO1xyXG4gIGNvbnN0IFtzY2FuVGVsZW1ldHJ5LCBzZXRTY2FuVGVsZW1ldHJ5XSA9IHVzZVN0YXRlPFNjYW5UZWxlbWV0cnk+KHtcclxuICAgIGN1cnJlbnRQYXRoOiAnJyxcclxuICAgIGRpcmVjdG9yaWVzOiAwLFxyXG4gICAgZmlsZXM6IDAsXHJcbiAgICBieXRlczogMCxcclxuICAgIGVsYXBzZWRNczogMCxcclxuICB9KTtcclxuICBjb25zdCBbc2NhbkVycm9ycywgc2V0U2NhbkVycm9yc10gPSB1c2VTdGF0ZTxTY2FuRXJyb3JJdGVtW10+KFtdKTtcclxuICBjb25zdCBbc3RhdHMsIHNldFN0YXRzXSA9IHVzZVN0YXRlKHsgZmlsZXM6IDAsIGJ5dGVzOiAwLCBlcnJvcnM6IDAgfSk7XHJcblxyXG4gIC8vIHJlc3VsdHNcclxuICBjb25zdCBbbGFyZ2VzdCwgc2V0TGFyZ2VzdF0gPSB1c2VTdGF0ZTxGaWxlRW50cnlbXT4oW10pO1xyXG4gIGNvbnN0IGxhcmdlc3RSZWYgPSB1c2VSZWY8RmlsZUVudHJ5W10+KFtdKTtcclxuICBjb25zdCBsYXJnZXN0VG9wUmVmID0gdXNlUmVmKG5ldyBUb3BOPEZpbGVFbnRyeT4oVE9QX0ZJTEVTLCAoaXRlbSkgPT4gaXRlbS5zaXplKSk7XHJcbiAgY29uc3QgbGFyZ2VzdERpcnR5UmVmID0gdXNlUmVmKGZhbHNlKTtcclxuICBjb25zdCBzY2FubmVkRGlyZWN0b3JpZXNSZWYgPSB1c2VSZWY8RGlyZWN0b3J5RW50cnlbXT4oW10pO1xyXG4gIGNvbnN0IFtkaXJlY3Rvcmllcywgc2V0RGlyZWN0b3JpZXNdID0gdXNlU3RhdGU8RGlyZWN0b3J5RW50cnlbXT4oW10pO1xyXG4gIGNvbnN0IFtkdXBsaWNhdGVzLCBzZXREdXBsaWNhdGVzXSA9IHVzZVN0YXRlPER1cGxpY2F0ZUdyb3VwW10+KFtdKTtcclxuICBjb25zdCBkdXBsaWNhdGVzUmVmID0gdXNlUmVmPER1cGxpY2F0ZUdyb3VwW10+KFtdKTtcclxuICBjb25zdCBbZXh0ZW5zaW9ucywgc2V0RXh0ZW5zaW9uc10gPSB1c2VTdGF0ZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pih7fSk7XHJcbiAgY29uc3QgZXh0ZW5zaW9uc1JlZiA9IHVzZVJlZjxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pih7fSk7XHJcblxyXG4gIC8vIGFyY2hpdmXvvJrlhYPmlbDmja7lrZggdXNlckRhdGEvc2Nhbi1hcmNoaXZlL++8jOWujOaVtOaVsOaNruaMiSBpZCDmh5LliqDovb3jgIJcclxuICAvLyDov5nph4zlj6rmjIHlhYPmlbDmja7liJfooajvvJvosIPnlKjmlrnlnKjpnIDopoHlrozmlbTmlbDmja7ml7bpgJrov4cgbG9hZEFyY2hpdmUgLyBsb2FkU25hcHNob3Qg5ouJ5Y+W44CCXHJcbiAgY29uc3QgW2RpcmVjdG9yeVNuYXBzaG90cywgc2V0RGlyZWN0b3J5U25hcHNob3RzXSA9IHVzZVN0YXRlPERpc2tTbmFwc2hvdEVudHJ5W10+KFtdKTtcclxuICBjb25zdCBbZGlyZWN0b3J5U25hcHNob3REYXRhLCBzZXREaXJlY3RvcnlTbmFwc2hvdERhdGFdID0gdXNlU3RhdGU8RGlyZWN0b3J5U25hcHNob3RbXT4oW10pO1xyXG4gIGNvbnN0IFtzYXZlZFJlc3VsdHMsIHNldFNhdmVkUmVzdWx0c10gPSB1c2VTdGF0ZTxEaXNrQXJjaGl2ZUVudHJ5W10+KFtdKTtcclxuXHJcbiAgLy8gVVNOXHJcbiAgY29uc3QgW3VzbkluZm8sIHNldFVzbkluZm9dID0gdXNlU3RhdGU8RGlza1VzbkluZm8gfCBudWxsPihudWxsKTtcclxuICBjb25zdCBbdXNuRGVsdGEsIHNldFVzbkRlbHRhXSA9IHVzZVN0YXRlPG51bWJlciB8IG51bGw+KG51bGwpO1xyXG5cclxuICAvLyBjb25maWdcclxuICBjb25zdCBbZXhjbHVzaW9uc1RleHQsIHNldEV4Y2x1c2lvbnNUZXh0U3RhdGVdID0gdXNlU3RhdGUoXHJcbiAgICAoKSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGlzay1zcGFjZS5leGNsdXNpb25zJykgPz8gJy5naXQsbm9kZV9tb2R1bGVzLHRhcmdldCcsXHJcbiAgKTtcclxuICBjb25zdCBzZXRFeGNsdXNpb25zVGV4dCA9IHVzZUNhbGxiYWNrKCh2YWx1ZTogc3RyaW5nKSA9PiB7XHJcbiAgICBzZXRFeGNsdXNpb25zVGV4dFN0YXRlKHZhbHVlKTtcclxuICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKCdkaXNrLXNwYWNlLmV4Y2x1c2lvbnMnLCB2YWx1ZSk7XHJcbiAgfSwgW10pO1xyXG5cclxuICAvLyBlcnJvclxyXG4gIGNvbnN0IFtlcnJvciwgc2V0RXJyb3JdID0gdXNlU3RhdGUoJycpO1xyXG5cclxuICAvLyBjbGVhbnVwIOeKtuaAgeaculxyXG4gIGNvbnN0IFtjbGVhbnVwU3RhdHVzLCBzZXRDbGVhbnVwU3RhdHVzXSA9IHVzZVN0YXRlPENsZWFudXBTdGF0dXM+KHsga2luZDogJ2lkbGUnIH0pO1xyXG5cclxuICAvLyDkuIDmrKHmgKflia/kvZznlKjvvJrmjILovb3ml7bku44gdXNlckRhdGEg5ouJ5Y+WIGFyY2hpdmUgLyBzbmFwc2hvdCDlhYPmlbDmja7vvIxcclxuICAvLyDlubbmiorogIHniYjmnKwgbG9jYWxTdG9yYWdlIOaVsOaNrui/geenu+WIsCB1c2VyRGF0YSDlkI7muIXnqbrjgIJcclxuICB1c2VFZmZlY3QoKCkgPT4ge1xyXG4gICAgbGV0IGNhbmNlbGxlZCA9IGZhbHNlO1xyXG4gICAgKGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gMSkg6ICB5pWw5o2u6L+B56e7XHJcbiAgICAgIGNvbnN0IGxlZ2FjeVJlc3VsdHMgPSByZWFkSnNvbjxQZXJzaXN0ZWRTY2FuUmVzdWx0W10gfCBudWxsPignZGlzay1zcGFjZS5yZXN1bHRzJywgbnVsbCk7XHJcbiAgICAgIGNvbnN0IGxlZ2FjeVNuYXBzaG90cyA9IHJlYWRKc29uPERpcmVjdG9yeVNuYXBzaG90W10gfCBudWxsPignZGlzay1zcGFjZS5kaXJlY3Rvcnktc25hcHNob3RzJywgbnVsbCk7XHJcbiAgICAgIGlmIChsZWdhY3lSZXN1bHRzICYmIGxlZ2FjeVJlc3VsdHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGZvciAoY29uc3Qgc2F2ZWQgb2YgbGVnYWN5UmVzdWx0cykge1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5zYXZlQXJjaGl2ZSh7XHJcbiAgICAgICAgICAgICAgaWQ6IHNhdmVkLmlkLFxyXG4gICAgICAgICAgICAgIHJvb3Q6IHNhdmVkLnJvb3QsXHJcbiAgICAgICAgICAgICAgc2F2ZWRBdDogc2F2ZWQuc2F2ZWRBdCxcclxuICAgICAgICAgICAgICBzdGF0czogc2F2ZWQuc3RhdHMsXHJcbiAgICAgICAgICAgICAgZHVwbGljYXRlczogc2F2ZWQuZHVwbGljYXRlcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgICAgICAgaWQ6IHNhdmVkLmlkLFxyXG4gICAgICAgICAgICAgICAgcm9vdDogc2F2ZWQucm9vdCxcclxuICAgICAgICAgICAgICAgIHNhdmVkQXQ6IHNhdmVkLnNhdmVkQXQsXHJcbiAgICAgICAgICAgICAgICBzdGF0czogc2F2ZWQuc3RhdHMsXHJcbiAgICAgICAgICAgICAgICBkaXJlY3Rvcmllczogc2F2ZWQuZGlyZWN0b3JpZXMsXHJcbiAgICAgICAgICAgICAgICBsYXJnZXN0OiBzYXZlZC5sYXJnZXN0LFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogc2F2ZWQuZXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgICAgIGR1cGxpY2F0ZXM6IHNhdmVkLmR1cGxpY2F0ZXMsXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9IGNhdGNoIHsgLyog6L+B56e75aSx6LSl5b+955Wl77yM5LiN6Zi75aGe5paw5rWB56iLICovIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oJ2Rpc2stc3BhY2UucmVzdWx0cycpO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChsZWdhY3lTbmFwc2hvdHMgJiYgbGVnYWN5U25hcHNob3RzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBmb3IgKGNvbnN0IHNuYXBzaG90IG9mIGxlZ2FjeVNuYXBzaG90cykge1xyXG4gICAgICAgICAgY29uc3QgaWQgPSBgJHtzbmFwc2hvdC5yb290LnJlcGxhY2UoL1tcXFxcLzoqP1wiPD58XS9nLCAnXycpfV9fJHtzbmFwc2hvdC50aW1lc3RhbXB9YDtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2Uuc2F2ZVNuYXBzaG90KHtcclxuICAgICAgICAgICAgICBpZCxcclxuICAgICAgICAgICAgICByb290OiBzbmFwc2hvdC5yb290LFxyXG4gICAgICAgICAgICAgIHRpbWVzdGFtcDogc25hcHNob3QudGltZXN0YW1wLFxyXG4gICAgICAgICAgICAgIGRpcmVjdG9yeUNvdW50OiBzbmFwc2hvdC5kaXJlY3Rvcmllcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgZGF0YTogc25hcHNob3QsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKCdkaXNrLXNwYWNlLmRpcmVjdG9yeS1zbmFwc2hvdHMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMikg5Yqg6L29IHVzZXJEYXRhIOWFg+aVsOaNrlxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IFthcmNoaXZlLCBzbmFwc2hvdHNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICAgICAgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5saXN0QXJjaGl2ZSgpLFxyXG4gICAgICAgICAgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5saXN0U25hcHNob3RzKCksXHJcbiAgICAgICAgXSk7XHJcbiAgICAgICAgaWYgKGNhbmNlbGxlZCkgcmV0dXJuO1xyXG4gICAgICAgIHNldFNhdmVkUmVzdWx0cyhhcmNoaXZlKTtcclxuICAgICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdHMoc25hcHNob3RzKTtcclxuICAgICAgICAvLyDlubbooYzmi4nmr4/kuKogc25hcHNob3Qg55qE5a6M5pW05pWw5o2u77yMZGlyZWN0b3J5Q2hhbmdlcyDmtL7nlJ/pnIDopoFcclxuICAgICAgICBjb25zdCBmdWxsRGF0YSA9IGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICAgICAgc25hcHNob3RzLm1hcCgobWV0YSkgPT4gd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5sb2FkU25hcHNob3QobWV0YS5pZCkpLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgaWYgKGNhbmNlbGxlZCkgcmV0dXJuO1xyXG4gICAgICAgIHNldERpcmVjdG9yeVNuYXBzaG90RGF0YShcclxuICAgICAgICAgIGZ1bGxEYXRhLmZpbHRlcigodmFsdWUpOiB2YWx1ZSBpcyBEaXNrRGlyZWN0b3J5U25hcHNob3REYXRhID0+IHZhbHVlICE9PSBudWxsKSxcclxuICAgICAgICApO1xyXG4gICAgICB9IGNhdGNoIChjYXVzZSkge1xyXG4gICAgICAgIHNldEVycm9yKGNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVzZS5tZXNzYWdlIDogU3RyaW5nKGNhdXNlKSk7XHJcbiAgICAgIH1cclxuICAgIH0pKCk7XHJcbiAgICByZXR1cm4gKCkgPT4geyBjYW5jZWxsZWQgPSB0cnVlOyB9O1xyXG4gIH0sIFtzZXRFcnJvcl0pO1xyXG5cclxuICAvLyBUb3BOIGZsdXNoIOKAlOKAlCDmiorloIbph4znmoQgdG9wIDUwIOWQjOatpeWIsCBzdGF0ZS9sYXJnZXN0UmVmXHJcbiAgY29uc3QgZmx1c2hMYXJnZXN0ID0gdXNlQ2FsbGJhY2soKCkgPT4ge1xyXG4gICAgbGFyZ2VzdERpcnR5UmVmLmN1cnJlbnQgPSBmYWxzZTtcclxuICAgIGNvbnN0IHNvcnRlZCA9IGxhcmdlc3RUb3BSZWYuY3VycmVudC50b1NvcnRlZERlc2MoKTtcclxuICAgIGxhcmdlc3RSZWYuY3VycmVudCA9IHNvcnRlZDtcclxuICAgIHNldExhcmdlc3Qoc29ydGVkKTtcclxuICB9LCBbXSk7XHJcblxyXG4gIC8vIOS4gOasoeaAp+WJr+S9nOeUqO+8muiHquWKqOi9ruivoiByZWZyZXNoU3lzdGVt77yI5q+PIDMwc++8iVxyXG4gIGNvbnN0IHJlZnJlc2hTeXN0ZW1JbXBsID0gdXNlQ2FsbGJhY2soYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgbmV4dCA9IGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2Uuc3lzdGVtSW5mbygpO1xyXG4gICAgICBzZXRTeXN0ZW0obmV4dCk7XHJcbiAgICAgIHNldERpc2tIaXN0b3J5KChjdXJyZW50KSA9PiB7XHJcbiAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICBjb25zdCBsYXRlc3QgPSBjdXJyZW50LmF0KC0xKTtcclxuICAgICAgICBpZiAobGF0ZXN0ICYmIG5vdyAtIGxhdGVzdC50aW1lc3RhbXAgPCA2MCAqIDYwICogMTAwMCkgcmV0dXJuIGN1cnJlbnQ7XHJcbiAgICAgICAgY29uc3QgaGlzdG9yeSA9IFtcclxuICAgICAgICAgIC4uLmN1cnJlbnQsXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbm93LFxyXG4gICAgICAgICAgICBkaXNrczogbmV4dC5kaXNrcy5tYXAoKGRpc2spID0+ICh7IHBhdGg6IGRpc2sucGF0aCwgdXNlZDogZGlzay51c2VkIH0pKSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXS5zbGljZSgtRElTS19ISVNUT1JZX0NBUCk7XHJcbiAgICAgICAgd3JpdGVKc29uKCdkaXNrLXNwYWNlLmhpc3RvcnknLCBoaXN0b3J5KTtcclxuICAgICAgICByZXR1cm4gaGlzdG9yeTtcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChjYXVzZSkge1xyXG4gICAgICBzZXRFcnJvcihjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSkpO1xyXG4gICAgfVxyXG4gIH0sIFtdKTtcclxuICB1c2VFZmZlY3QoKCkgPT4ge1xyXG4gICAgcmVmcmVzaFN5c3RlbUltcGwoKTtcclxuICAgIGNvbnN0IHRpbWVyID0gd2luZG93LnNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgdm9pZCByZWZyZXNoU3lzdGVtSW1wbCgpO1xyXG4gICAgfSwgMzBfMDAwKTtcclxuICAgIHJldHVybiAoKSA9PiB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aW1lcik7XHJcbiAgfSwgW3JlZnJlc2hTeXN0ZW1JbXBsXSk7XHJcblxyXG4gIC8vIElQQyDkuovku7bnm5HlkKzvvJpvbkV2ZW50XHJcbiAgdXNlRWZmZWN0KCgpID0+IHtcclxuICAgIGNvbnN0IHVuc3Vic2NyaWJlID0gd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5vbkV2ZW50KChpZCwgZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGlkICE9PSBzY2FuSWRSZWYuY3VycmVudCkgcmV0dXJuO1xyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gJ2ZpbGVzJykge1xyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBldmVudC5pdGVtcykgbGFyZ2VzdFRvcFJlZi5jdXJyZW50LnB1c2goaXRlbSk7XHJcbiAgICAgICAgaWYgKCFsYXJnZXN0RGlydHlSZWYuY3VycmVudCkge1xyXG4gICAgICAgICAgbGFyZ2VzdERpcnR5UmVmLmN1cnJlbnQgPSB0cnVlO1xyXG4gICAgICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZsdXNoTGFyZ2VzdCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnR5cGUgPT09ICdkaXJlY3RvcmllcycpIHtcclxuICAgICAgICBjb25zdCBuZXh0ID0gZXZlbnQuaXRlbXMuc2xpY2UoMCwgVE9QX0RJUkVDVE9SSUVTKTtcclxuICAgICAgICBzY2FubmVkRGlyZWN0b3JpZXNSZWYuY3VycmVudCA9IG5leHQ7XHJcbiAgICAgICAgc2V0RGlyZWN0b3JpZXMobmV4dCk7XHJcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQudHlwZSA9PT0gJ2R1cGxpY2F0ZS1wcm9ncmVzcycpIHtcclxuICAgICAgICBzZXRQaGFzZSgnaGFzaGluZycpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnR5cGUgPT09ICdzY2FuLXN0YXR1cycpIHtcclxuICAgICAgICBzZXRTY2FuVGVsZW1ldHJ5KGV2ZW50KTtcclxuICAgICAgfSBlbHNlIGlmIChldmVudC50eXBlID09PSAnc2Nhbi1lcnJvcicpIHtcclxuICAgICAgICBzZXRTY2FuRXJyb3JzKCh2YWx1ZSkgPT5cclxuICAgICAgICAgIFtcclxuICAgICAgICAgICAgLi4udmFsdWUsXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICAgICAgICAgIGNhdGVnb3J5OiBldmVudC5jYXRlZ29yeSxcclxuICAgICAgICAgICAgICBtZXNzYWdlOiBg44CQJHtTQ0FOX0VSUk9SX0xBQkVMU1tldmVudC5jYXRlZ29yeV1944CRJHtldmVudC5tZXNzYWdlfWAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLnNsaWNlKC1TQ0FOX0VSUk9SX0NBUCksXHJcbiAgICAgICAgKTtcclxuICAgICAgfSBlbHNlIGlmIChldmVudC50eXBlID09PSAnZHVwbGljYXRlJykge1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSBbLi4uZHVwbGljYXRlc1JlZi5jdXJyZW50LCBldmVudF07XHJcbiAgICAgICAgZHVwbGljYXRlc1JlZi5jdXJyZW50ID0gbmV4dDtcclxuICAgICAgICBzZXREdXBsaWNhdGVzKG5leHQpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnR5cGUgPT09ICdleHRlbnNpb24nKSB7XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IHsgLi4uZXh0ZW5zaW9uc1JlZi5jdXJyZW50LCBbZXZlbnQuZXh0ZW5zaW9uIHx8ICco5peg5omp5bGV5ZCNKSddOiBldmVudC5zaXplIH07XHJcbiAgICAgICAgZXh0ZW5zaW9uc1JlZi5jdXJyZW50ID0gbmV4dDtcclxuICAgICAgICBzZXRFeHRlbnNpb25zKG5leHQpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnR5cGUgPT09ICdwcm9ncmVzcycgfHwgZXZlbnQudHlwZSA9PT0gJ2RvbmUnKSB7XHJcbiAgICAgICAgc2V0U3RhdHMoeyBmaWxlczogZXZlbnQuZmlsZXMsIGJ5dGVzOiBldmVudC5ieXRlcywgZXJyb3JzOiBldmVudC5lcnJvcnMgfSk7XHJcbiAgICAgICAgaWYgKGV2ZW50LnR5cGUgPT09ICdkb25lJyAmJiByb290UmVmLmN1cnJlbnQpIHtcclxuICAgICAgICAgIGZsdXNoTGFyZ2VzdCgpO1xyXG4gICAgICAgICAgY29uc3QgaWQgPSBjcnlwdG8ucmFuZG9tVVVJRCgpO1xyXG4gICAgICAgICAgY29uc3QgZnVsbERhdGE6IERpc2tQZXJzaXN0ZWRSZXN1bHQgPSB7XHJcbiAgICAgICAgICAgIGlkLFxyXG4gICAgICAgICAgICByb290OiByb290UmVmLmN1cnJlbnQsXHJcbiAgICAgICAgICAgIHNhdmVkQXQ6IERhdGUubm93KCksXHJcbiAgICAgICAgICAgIHN0YXRzOiB7IGZpbGVzOiBldmVudC5maWxlcywgYnl0ZXM6IGV2ZW50LmJ5dGVzLCBlcnJvcnM6IGV2ZW50LmVycm9ycyB9LFxyXG4gICAgICAgICAgICBkaXJlY3Rvcmllczogc2Nhbm5lZERpcmVjdG9yaWVzUmVmLmN1cnJlbnQuc2xpY2UoMCwgVE9QX0RJUkVDVE9SSUVTKSxcclxuICAgICAgICAgICAgbGFyZ2VzdDogbGFyZ2VzdFJlZi5jdXJyZW50LnNsaWNlKDAsIFRPUF9GSUxFUyksXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHsgLi4uZXh0ZW5zaW9uc1JlZi5jdXJyZW50IH0sXHJcbiAgICAgICAgICAgIGR1cGxpY2F0ZXM6IGR1cGxpY2F0ZXNSZWYuY3VycmVudC5zbGljZSgwLCAxMDApLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIGNvbnN0IG1ldGE6IERpc2tBcmNoaXZlRW50cnkgPSB7XHJcbiAgICAgICAgICAgIGlkLFxyXG4gICAgICAgICAgICByb290OiBmdWxsRGF0YS5yb290LFxyXG4gICAgICAgICAgICBzYXZlZEF0OiBmdWxsRGF0YS5zYXZlZEF0LFxyXG4gICAgICAgICAgICBzdGF0czogZnVsbERhdGEuc3RhdHMsXHJcbiAgICAgICAgICAgIGR1cGxpY2F0ZXM6IGZ1bGxEYXRhLmR1cGxpY2F0ZXMubGVuZ3RoLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIC8vIOW8guatpeWGmSB1c2VyRGF0YSDmlofku7bvvJvkuI3pmLvloZ7muLLmn5PjgIJcclxuICAgICAgICAgIHZvaWQgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZVxyXG4gICAgICAgICAgICAuc2F2ZUFyY2hpdmUoeyAuLi5tZXRhLCBkYXRhOiBmdWxsRGF0YSB9KVxyXG4gICAgICAgICAgICAudGhlbigobmV4dCkgPT4gc2V0U2F2ZWRSZXN1bHRzKG5leHQpKVxyXG4gICAgICAgICAgICAuY2F0Y2goKGNhdXNlKSA9PiBzZXRFcnJvcihjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSkpKTtcclxuXHJcbiAgICAgICAgICAvLyBsYXN0LXJlc3VsdCDnvJPlrZjvvJrlj6rlrZggaWQgKyByb29077yM5oGi5aSN5pe25oyJIGlkIOWKoOi9veOAglxyXG4gICAgICAgICAgd3JpdGVKc29uKCdkaXNrLXNwYWNlLmxhc3QtcmVzdWx0JywgeyBpZCwgcm9vdDogZnVsbERhdGEucm9vdCB9KTtcclxuXHJcbiAgICAgICAgICBjb25zdCBzbmFwc2hvdERhdGE6IERpc2tEaXJlY3RvcnlTbmFwc2hvdERhdGEgPSB7XHJcbiAgICAgICAgICAgIHRpbWVzdGFtcDogZnVsbERhdGEuc2F2ZWRBdCxcclxuICAgICAgICAgICAgcm9vdDogZnVsbERhdGEucm9vdCxcclxuICAgICAgICAgICAgZGlyZWN0b3JpZXM6IHNjYW5uZWREaXJlY3Rvcmllc1JlZi5jdXJyZW50Lm1hcCgoaXRlbSkgPT4gKHtcclxuICAgICAgICAgICAgICBwYXRoOiBpdGVtLnBhdGgsXHJcbiAgICAgICAgICAgICAgc2l6ZTogaXRlbS5zaXplLFxyXG4gICAgICAgICAgICB9KSksXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgY29uc3Qgc25hcHNob3RJZCA9IGAke2Z1bGxEYXRhLnJvb3QucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csICdfJyl9X18ke2Z1bGxEYXRhLnNhdmVkQXR9YDtcclxuICAgICAgICAgIGNvbnN0IHNuYXBzaG90TWV0YTogRGlza1NuYXBzaG90RW50cnkgPSB7XHJcbiAgICAgICAgICAgIGlkOiBzbmFwc2hvdElkLFxyXG4gICAgICAgICAgICByb290OiBmdWxsRGF0YS5yb290LFxyXG4gICAgICAgICAgICB0aW1lc3RhbXA6IGZ1bGxEYXRhLnNhdmVkQXQsXHJcbiAgICAgICAgICAgIGRpcmVjdG9yeUNvdW50OiBzbmFwc2hvdERhdGEuZGlyZWN0b3JpZXMubGVuZ3RoLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIHZvaWQgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZVxyXG4gICAgICAgICAgICAuc2F2ZVNuYXBzaG90KHsgLi4uc25hcHNob3RNZXRhLCBkYXRhOiBzbmFwc2hvdERhdGEgfSlcclxuICAgICAgICAgICAgLnRoZW4oKG5leHQpID0+IHtcclxuICAgICAgICAgICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdHMobmV4dCk7XHJcbiAgICAgICAgICAgICAgLy8g5ZCM5q2l5oqK5a6M5pW05pWw5o2uIHB1c2gg5Yiw5YaF5a2YIHN0YXRl77yMZGlyZWN0b3J5Q2hhbmdlcyDmtL7nlJ/lj6/nm7TmjqXnlKhcclxuICAgICAgICAgICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdERhdGEoKGN1cnJlbnQpID0+IFsuLi5jdXJyZW50LCBzbmFwc2hvdERhdGFdLnNsaWNlKC1TTkFQU0hPVFNfQ0FQKSk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB7IC8qIOW/q+eFp+Wksei0peS4jeiHtOWRvSAqLyB9KTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHVuc3Vic2NyaWJlO1xyXG4gIH0sIFtmbHVzaExhcmdlc3RdKTtcclxuXHJcbiAgLy8gSVBDIOS6i+S7tuebkeWQrO+8mm9uRXhpdFxyXG4gIHVzZUVmZmVjdCgoKSA9PiB7XHJcbiAgICBjb25zdCB1bnN1YnNjcmliZSA9IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2Uub25FeGl0KChpZCwgcmVzdWx0KSA9PiB7XHJcbiAgICAgIGlmIChpZCAhPT0gc2NhbklkUmVmLmN1cnJlbnQpIHJldHVybjtcclxuICAgICAgc2V0UnVubmluZyhmYWxzZSk7XHJcbiAgICAgIHNldFBhdXNlZChmYWxzZSk7XHJcbiAgICAgIGlmIChyZXN1bHQuZXJyb3IpIHNldEVycm9yKHJlc3VsdC5lcnJvcik7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB1bnN1YnNjcmliZTtcclxuICB9LCBbXSk7XHJcblxyXG4gIC8vIFVTTiBpbmZvXHJcbiAgdXNlRWZmZWN0KCgpID0+IHtcclxuICAgIGlmICghcm9vdCkge1xyXG4gICAgICBzZXRVc25JbmZvKG51bGwpO1xyXG4gICAgICBzZXRVc25EZWx0YShudWxsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgbGV0IGNhbmNlbGxlZCA9IGZhbHNlO1xyXG4gICAgdm9pZCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlXHJcbiAgICAgIC51c25JbmZvKHJvb3QpXHJcbiAgICAgIC50aGVuKChpbmZvKSA9PiB7XHJcbiAgICAgICAgaWYgKGNhbmNlbGxlZCkgcmV0dXJuO1xyXG4gICAgICAgIHNldFVzbkluZm8oaW5mbyk7XHJcbiAgICAgICAgaWYgKGluZm8uc3VwcG9ydGVkICYmIGluZm8udm9sdW1lICYmIGluZm8ubmV4dFVzbiAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICBjb25zdCBjdXJzb3JzID0gcmVhZEpzb248XHJcbiAgICAgICAgICAgIFJlY29yZDxzdHJpbmcsIHsgam91cm5hbElkPzogbnVtYmVyOyBuZXh0VXNuOiBudW1iZXI7IHJlY29yZGVkQXQ6IG51bWJlciB9PlxyXG4gICAgICAgICAgPignZGlzay1zcGFjZS51c24tY3Vyc29ycycsIHt9KTtcclxuICAgICAgICAgIGNvbnN0IHByZXZpb3VzID0gY3Vyc29yc1tpbmZvLnZvbHVtZV07XHJcbiAgICAgICAgICBzZXRVc25EZWx0YShcclxuICAgICAgICAgICAgcHJldmlvdXMgJiYgcHJldmlvdXMuam91cm5hbElkID09PSBpbmZvLmpvdXJuYWxJZFxyXG4gICAgICAgICAgICAgID8gTWF0aC5tYXgoMCwgaW5mby5uZXh0VXNuIC0gcHJldmlvdXMubmV4dFVzbilcclxuICAgICAgICAgICAgICA6IG51bGwsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgY3Vyc29yc1tpbmZvLnZvbHVtZV0gPSB7XHJcbiAgICAgICAgICAgIGpvdXJuYWxJZDogaW5mby5qb3VybmFsSWQsXHJcbiAgICAgICAgICAgIG5leHRVc246IGluZm8ubmV4dFVzbixcclxuICAgICAgICAgICAgcmVjb3JkZWRBdDogRGF0ZS5ub3coKSxcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICB3cml0ZUpzb24oJ2Rpc2stc3BhY2UudXNuLWN1cnNvcnMnLCBjdXJzb3JzKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICAgIC5jYXRjaCgoY2F1c2UpID0+IHtcclxuICAgICAgICBpZiAoY2FuY2VsbGVkKSByZXR1cm47XHJcbiAgICAgICAgc2V0VXNuSW5mbyh7IHN1cHBvcnRlZDogZmFsc2UsIGVycm9yOiBTdHJpbmcoY2F1c2UpIH0pO1xyXG4gICAgICB9KTtcclxuICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgIGNhbmNlbGxlZCA9IHRydWU7XHJcbiAgICB9O1xyXG4gIH0sIFtyb290XSk7XHJcblxyXG4gIC8vIGFjdGlvbnNcclxuICBjb25zdCByZWZyZXNoU3lzdGVtID0gcmVmcmVzaFN5c3RlbUltcGw7XHJcbiAgY29uc3QgY2hvb3NlID0gdXNlQ2FsbGJhY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgcHJldmlvdXNTY2FuSWQgPSBzY2FuSWRSZWYuY3VycmVudDtcclxuICAgIGlmIChwcmV2aW91c1NjYW5JZCAmJiBydW5uaW5nKSB7XHJcbiAgICAgIHZvaWQgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5jYW5jZWwocHJldmlvdXNTY2FuSWQpO1xyXG4gICAgICBzY2FuSWRSZWYuY3VycmVudCA9ICcnO1xyXG4gICAgICBzZXRSdW5uaW5nKGZhbHNlKTtcclxuICAgICAgc2V0UGF1c2VkKGZhbHNlKTtcclxuICAgIH1cclxuICAgIGNvbnN0IGNob3NlbiA9IGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UucGlja1Jvb3QoKTtcclxuICAgIGlmICghY2hvc2VuKSByZXR1cm47XHJcbiAgICByb290UmVmLmN1cnJlbnQgPSBjaG9zZW47XHJcbiAgICBzZXRSb290KGNob3Nlbik7XHJcbiAgICBzZXRDdXJyZW50RGlyZWN0b3J5KGNob3Nlbik7XHJcbiAgICBzZXRQcmV2aWV3KG51bGwpO1xyXG4gICAgc2V0QnJvd3NlckxvYWRpbmcodHJ1ZSk7XHJcbiAgICB0cnkge1xyXG4gICAgICBzZXRFbnRyaWVzKGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UubGlzdERpcmVjdG9yeShjaG9zZW4sIGNob3NlbikpO1xyXG4gICAgICBjb25zdCBzYXZlZCA9IHJlYWRKc29uPG51bGwgfCB7XHJcbiAgICAgICAgcm9vdDogc3RyaW5nO1xyXG4gICAgICAgIHN0YXRzOiB7IGZpbGVzOiBudW1iZXI7IGJ5dGVzOiBudW1iZXI7IGVycm9yczogbnVtYmVyIH07XHJcbiAgICAgICAgZGlyZWN0b3JpZXM6IERpcmVjdG9yeUVudHJ5W107XHJcbiAgICAgICAgbGFyZ2VzdDogRmlsZUVudHJ5W107XHJcbiAgICAgICAgZXh0ZW5zaW9uczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcclxuICAgICAgICBkdXBsaWNhdGVzPzogRHVwbGljYXRlR3JvdXBbXTtcclxuICAgICAgfT4oJ2Rpc2stc3BhY2UubGFzdC1yZXN1bHQnLCBudWxsKTtcclxuICAgICAgaWYgKHNhdmVkICYmIGRpc3BsYXlQYXRoKHNhdmVkLnJvb3QpLnRvTG93ZXJDYXNlKCkgPT09IGRpc3BsYXlQYXRoKGNob3NlbikudG9Mb3dlckNhc2UoKSkge1xyXG4gICAgICAgIHNjYW5uZWREaXJlY3Rvcmllc1JlZi5jdXJyZW50ID0gc2F2ZWQuZGlyZWN0b3JpZXM7XHJcbiAgICAgICAgbGFyZ2VzdFJlZi5jdXJyZW50ID0gc2F2ZWQubGFyZ2VzdDtcclxuICAgICAgICBsYXJnZXN0VG9wUmVmLmN1cnJlbnQubG9hZChzYXZlZC5sYXJnZXN0KTtcclxuICAgICAgICBsYXJnZXN0RGlydHlSZWYuY3VycmVudCA9IGZhbHNlO1xyXG4gICAgICAgIGV4dGVuc2lvbnNSZWYuY3VycmVudCA9IHNhdmVkLmV4dGVuc2lvbnM7XHJcbiAgICAgICAgZHVwbGljYXRlc1JlZi5jdXJyZW50ID0gc2F2ZWQuZHVwbGljYXRlcyA/PyBbXTtcclxuICAgICAgICBzZXRTdGF0cyhzYXZlZC5zdGF0cyk7XHJcbiAgICAgICAgc2V0RGlyZWN0b3JpZXMoc2F2ZWQuZGlyZWN0b3JpZXMpO1xyXG4gICAgICAgIHNldExhcmdlc3Qoc2F2ZWQubGFyZ2VzdCk7XHJcbiAgICAgICAgc2V0RXh0ZW5zaW9ucyhzYXZlZC5leHRlbnNpb25zKTtcclxuICAgICAgICBzZXREdXBsaWNhdGVzKHNhdmVkLmR1cGxpY2F0ZXMgPz8gW10pO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChjYXVzZSkge1xyXG4gICAgICBzZXRFcnJvcihTdHJpbmcoY2F1c2UpKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIHNldEJyb3dzZXJMb2FkaW5nKGZhbHNlKTtcclxuICAgIH1cclxuICB9LCBbcnVubmluZ10pO1xyXG5cclxuICBjb25zdCBzdGFydCA9IHVzZUNhbGxiYWNrKFxyXG4gICAgYXN5bmMgKGZvY3VzZWRTY2FuOiBib29sZWFuKSA9PiB7XHJcbiAgICAgIGlmICghcm9vdCB8fCBydW5uaW5nKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IGV4Y2x1c2lvbnMgPSBmb2N1c2VkU2NhblxyXG4gICAgICAgID8gWycuZ2l0J11cclxuICAgICAgICA6IGV4Y2x1c2lvbnNUZXh0XHJcbiAgICAgICAgICAgIC5zcGxpdCgnLCcpXHJcbiAgICAgICAgICAgIC5tYXAoKHZhbHVlKSA9PiB2YWx1ZS50cmltKCkpXHJcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICAgIHJvb3RSZWYuY3VycmVudCA9IHJvb3Q7XHJcbiAgICAgIHNjYW5uZWREaXJlY3Rvcmllc1JlZi5jdXJyZW50ID0gW107XHJcbiAgICAgIGxhcmdlc3RSZWYuY3VycmVudCA9IFtdO1xyXG4gICAgICBsYXJnZXN0VG9wUmVmLmN1cnJlbnQucmVzZXQoKTtcclxuICAgICAgbGFyZ2VzdERpcnR5UmVmLmN1cnJlbnQgPSBmYWxzZTtcclxuICAgICAgZXh0ZW5zaW9uc1JlZi5jdXJyZW50ID0ge307XHJcbiAgICAgIGR1cGxpY2F0ZXNSZWYuY3VycmVudCA9IFtdO1xyXG4gICAgICBzY2FuSWRSZWYuY3VycmVudCA9IGNyeXB0by5yYW5kb21VVUlEKCk7XHJcbiAgICAgIHNldFN0YXRzKHsgZmlsZXM6IDAsIGJ5dGVzOiAwLCBlcnJvcnM6IDAgfSk7XHJcbiAgICAgIHNldFNjYW5UZWxlbWV0cnkoeyBjdXJyZW50UGF0aDogcm9vdCwgZGlyZWN0b3JpZXM6IDAsIGZpbGVzOiAwLCBieXRlczogMCwgZWxhcHNlZE1zOiAwIH0pO1xyXG4gICAgICBzZXRTY2FuRXJyb3JzKFtdKTtcclxuICAgICAgc2V0TGFyZ2VzdChbXSk7XHJcbiAgICAgIHNldEV4dGVuc2lvbnMoe30pO1xyXG4gICAgICBzZXREaXJlY3RvcmllcyhbXSk7XHJcbiAgICAgIHNldER1cGxpY2F0ZXMoW10pO1xyXG4gICAgICBzZXRQaGFzZSgnc2Nhbm5pbmcnKTtcclxuICAgICAgc2V0RXJyb3IoJycpO1xyXG4gICAgICBzZXRQYXVzZWQoZmFsc2UpO1xyXG4gICAgICBzZXRSdW5uaW5nKHRydWUpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2Uuc3RhcnQoc2NhbklkUmVmLmN1cnJlbnQsIHJvb3QsIHtcclxuICAgICAgICAgIGV4Y2x1c2lvbnMsXHJcbiAgICAgICAgICBza2lwRHVwbGljYXRlczogZm9jdXNlZFNjYW4sXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICAgICAgc2V0UnVubmluZyhmYWxzZSk7XHJcbiAgICAgICAgc2V0RXJyb3IoY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpKTtcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIFtyb290LCBydW5uaW5nLCBleGNsdXNpb25zVGV4dF0sXHJcbiAgKTtcclxuXHJcbiAgY29uc3QgY2FuY2VsU2NhbiA9IHVzZUNhbGxiYWNrKGFzeW5jICgpID0+IHtcclxuICAgIGlmICghc2NhbklkUmVmLmN1cnJlbnQpIHJldHVybjtcclxuICAgIGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UuY2FuY2VsKHNjYW5JZFJlZi5jdXJyZW50KTtcclxuICAgIHNjYW5JZFJlZi5jdXJyZW50ID0gJyc7XHJcbiAgICBzZXRSdW5uaW5nKGZhbHNlKTtcclxuICAgIHNldFBhdXNlZChmYWxzZSk7XHJcbiAgfSwgW10pO1xyXG5cclxuICBjb25zdCB0b2dnbGVQYXVzZSA9IHVzZUNhbGxiYWNrKGFzeW5jICgpID0+IHtcclxuICAgIGlmICghc2NhbklkUmVmLmN1cnJlbnQpIHJldHVybjtcclxuICAgIGNvbnN0IHN1Y2Nlc3MgPSBwYXVzZWRcclxuICAgICAgPyBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlLnJlc3VtZShzY2FuSWRSZWYuY3VycmVudClcclxuICAgICAgOiBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlLnBhdXNlKHNjYW5JZFJlZi5jdXJyZW50KTtcclxuICAgIGlmIChzdWNjZXNzKSBzZXRQYXVzZWQoIXBhdXNlZCk7XHJcbiAgfSwgW3BhdXNlZF0pO1xyXG5cclxuICBjb25zdCBsb2FkRGlyZWN0b3J5ID0gdXNlQ2FsbGJhY2soXHJcbiAgICBhc3luYyAoZGlyZWN0b3J5OiBzdHJpbmcpID0+IHtcclxuICAgICAgaWYgKCFyb290KSByZXR1cm47XHJcbiAgICAgIHNldEJyb3dzZXJMb2FkaW5nKHRydWUpO1xyXG4gICAgICBzZXRQcmV2aWV3KG51bGwpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHNldEVudHJpZXMoYXdhaXQgd2luZG93LmVsZWN0cm9uQVBJLmRpc2tTcGFjZS5saXN0RGlyZWN0b3J5KHJvb3QsIGRpcmVjdG9yeSkpO1xyXG4gICAgICAgIHNldEN1cnJlbnREaXJlY3RvcnkoZGlyZWN0b3J5KTtcclxuICAgICAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgICAgICBzZXRFcnJvcihjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSkpO1xyXG4gICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgIHNldEJyb3dzZXJMb2FkaW5nKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIFtyb290XSxcclxuICApO1xyXG5cclxuICBjb25zdCBvcGVuUHJldmlldyA9IHVzZUNhbGxiYWNrKFxyXG4gICAgYXN5bmMgKGVudHJ5OiBEaXNrRGlyZWN0b3J5SXRlbSkgPT4ge1xyXG4gICAgICBpZiAoZW50cnkudHlwZSA9PT0gJ2RpcmVjdG9yeScpIHtcclxuICAgICAgICBhd2FpdCBsb2FkRGlyZWN0b3J5KGVudHJ5LnBhdGgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBzZXRCcm93c2VyTG9hZGluZyh0cnVlKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBzZXRQcmV2aWV3KGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UucHJldmlldyhyb290LCBlbnRyeS5wYXRoKSk7XHJcbiAgICAgIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICAgICAgc2V0RXJyb3IoU3RyaW5nKGNhdXNlKSk7XHJcbiAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgc2V0QnJvd3NlckxvYWRpbmcoZmFsc2UpO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgW3Jvb3QsIGxvYWREaXJlY3RvcnldLFxyXG4gICk7XHJcblxyXG4gIC8vIOaBouWkjeWtmOaho++8muWFiOaMiSBpZCDlvILmraXliqDovb3lrozmlbTmlbDmja7vvIzlho3lhpnlhaUgcmVmICsgc3RhdGXjgIJcclxuICBjb25zdCByZXN0b3JlU2F2ZWRSZXN1bHQgPSB1c2VDYWxsYmFjayhhc3luYyAoaWQ6IHN0cmluZykgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UubG9hZEFyY2hpdmUoaWQpO1xyXG4gICAgICBpZiAoIWRhdGEpIHRocm93IG5ldyBFcnJvcign5a2Y5qGj5LiN5a2Y5Zyo5oiW5bey5o2f5Z2PJyk7XHJcbiAgICAgIC8vIOS4u+i/m+eoi+W6j+WIl+WMluWOu+aOieS6hiAndHlwZScg5a2X5q6177yb5oGi5aSN5pe26KGl5Zue5Lul5ruh6LazIER1cGxpY2F0ZUdyb3VwIOexu+Wei+OAglxyXG4gICAgICBjb25zdCBkdXBsaWNhdGVzOiBEdXBsaWNhdGVHcm91cFtdID0gKGRhdGEuZHVwbGljYXRlcyA/PyBbXSkubWFwKChncm91cCkgPT4gKHtcclxuICAgICAgICB0eXBlOiAnZHVwbGljYXRlJyBhcyBjb25zdCxcclxuICAgICAgICBncm91cElkOiBncm91cC5ncm91cElkLFxyXG4gICAgICAgIHNpemU6IGdyb3VwLnNpemUsXHJcbiAgICAgICAgZmlsZXM6IGdyb3VwLmZpbGVzLFxyXG4gICAgICB9KSk7XHJcbiAgICAgIHJvb3RSZWYuY3VycmVudCA9IGRhdGEucm9vdDtcclxuICAgICAgc2Nhbm5lZERpcmVjdG9yaWVzUmVmLmN1cnJlbnQgPSBkYXRhLmRpcmVjdG9yaWVzIGFzIERpcmVjdG9yeUVudHJ5W107XHJcbiAgICAgIGxhcmdlc3RSZWYuY3VycmVudCA9IGRhdGEubGFyZ2VzdCBhcyBGaWxlRW50cnlbXTtcclxuICAgICAgbGFyZ2VzdFRvcFJlZi5jdXJyZW50LmxvYWQoZGF0YS5sYXJnZXN0IGFzIEZpbGVFbnRyeVtdKTtcclxuICAgICAgbGFyZ2VzdERpcnR5UmVmLmN1cnJlbnQgPSBmYWxzZTtcclxuICAgICAgZXh0ZW5zaW9uc1JlZi5jdXJyZW50ID0gZGF0YS5leHRlbnNpb25zO1xyXG4gICAgICBkdXBsaWNhdGVzUmVmLmN1cnJlbnQgPSBkdXBsaWNhdGVzO1xyXG4gICAgICBzZXRSb290KGRhdGEucm9vdCk7XHJcbiAgICAgIHNldEN1cnJlbnREaXJlY3RvcnkoZGF0YS5yb290KTtcclxuICAgICAgc2V0U3RhdHMoZGF0YS5zdGF0cyk7XHJcbiAgICAgIHNldERpcmVjdG9yaWVzKGRhdGEuZGlyZWN0b3JpZXMgYXMgRGlyZWN0b3J5RW50cnlbXSk7XHJcbiAgICAgIHNldExhcmdlc3QoZGF0YS5sYXJnZXN0IGFzIEZpbGVFbnRyeVtdKTtcclxuICAgICAgc2V0RXh0ZW5zaW9ucyhkYXRhLmV4dGVuc2lvbnMpO1xyXG4gICAgICBzZXREdXBsaWNhdGVzKGR1cGxpY2F0ZXMpO1xyXG4gICAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgICAgc2V0RXJyb3IoY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpKTtcclxuICAgIH1cclxuICB9LCBbc2V0RXJyb3JdKTtcclxuXHJcbiAgY29uc3QgcmVtb3ZlU2F2ZWRSZXN1bHQgPSB1c2VDYWxsYmFjayhhc3luYyAoaWQ6IHN0cmluZykgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgbmV4dCA9IGF3YWl0IHdpbmRvdy5lbGVjdHJvbkFQSS5kaXNrU3BhY2UuZGVsZXRlQXJjaGl2ZShpZCk7XHJcbiAgICAgIHNldFNhdmVkUmVzdWx0cyhuZXh0KTtcclxuICAgIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICAgIHNldEVycm9yKGNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVzZS5tZXNzYWdlIDogU3RyaW5nKGNhdXNlKSk7XHJcbiAgICB9XHJcbiAgfSwgW3NldEVycm9yXSk7XHJcblxyXG4gIGNvbnN0IHJlbW92ZURpcmVjdG9yeVNuYXBzaG90ID0gdXNlQ2FsbGJhY2soXHJcbiAgICBhc3luYyAoaWQ6IHN0cmluZykgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlLmRlbGV0ZVNuYXBzaG90KGlkKTtcclxuICAgICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdHMobmV4dCk7XHJcbiAgICAgICAgc2V0RGlyZWN0b3J5U25hcHNob3REYXRhKChjdXJyZW50KSA9PiB7XHJcbiAgICAgICAgICAvLyDpgJrov4flhYPmlbDmja7lrprkvY3vvJrmib4gdGltZXN0YW1wIOWMuemFjeeahCBzbmFwc2hvdFxyXG4gICAgICAgICAgY29uc3QgbWV0YSA9IG5leHQuZmluZCgoZW50cnkpID0+IGVudHJ5LmlkID09PSBpZCk7XHJcbiAgICAgICAgICBpZiAoIW1ldGEpIHJldHVybiBjdXJyZW50O1xyXG4gICAgICAgICAgcmV0dXJuIGN1cnJlbnQuZmlsdGVyKFxyXG4gICAgICAgICAgICAoc25hcHNob3QpID0+ICEoc25hcHNob3QudGltZXN0YW1wID09PSBtZXRhLnRpbWVzdGFtcCAmJiBzbmFwc2hvdC5yb290ID09PSBtZXRhLnJvb3QpLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgICAgICBzZXRFcnJvcihjYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY2F1c2UubWVzc2FnZSA6IFN0cmluZyhjYXVzZSkpO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgW3NldEVycm9yXSxcclxuICApO1xyXG5cclxuICBjb25zdCBjbGVhckhpc3RvcnkgPSB1c2VDYWxsYmFjayhhc3luYyAoKSA9PiB7XHJcbiAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgnZGlzay1zcGFjZS5oaXN0b3J5Jyk7XHJcbiAgICBzZXREaXNrSGlzdG9yeShbXSk7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlLmNsZWFyQXJjaGl2ZSgpO1xyXG4gICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdHMoW10pO1xyXG4gICAgICBzZXREaXJlY3RvcnlTbmFwc2hvdERhdGEoW10pO1xyXG4gICAgICBzZXRTYXZlZFJlc3VsdHMoW10pO1xyXG4gICAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgICAgc2V0RXJyb3IoY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpKTtcclxuICAgIH1cclxuICB9LCBbc2V0RXJyb3JdKTtcclxuXHJcbiAgY29uc3QgcnVuQ2xlYW51cCA9IHVzZUNhbGxiYWNrKGFzeW5jIChhY3Rpb246IENsZWFudXBBY3Rpb25JZCkgPT4ge1xyXG4gICAgaWYgKGNsZWFudXBTdGF0dXMua2luZCA9PT0gJ3J1bm5pbmcnKSByZXR1cm47XHJcbiAgICBzZXRDbGVhbnVwU3RhdHVzKHsga2luZDogJ3J1bm5pbmcnLCBhY3Rpb24gfSk7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB3aW5kb3cuZWxlY3Ryb25BUEkuZGlza1NwYWNlLnJ1bkNsZWFudXAoYWN0aW9uLCByb290KTtcclxuICAgICAgaWYgKHJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgc2V0Q2xlYW51cFN0YXR1cyh7IGtpbmQ6ICdzdWNjZXNzJywgYWN0aW9uLCBtZXNzYWdlOiByZXN1bHQub3V0cHV0ID8/ICfmuIXnkIblrozmiJAnIH0pO1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxlZCkge1xyXG4gICAgICAgIHNldENsZWFudXBTdGF0dXMoeyBraW5kOiAnaWRsZScgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc2V0Q2xlYW51cFN0YXR1cyh7IGtpbmQ6ICdlcnJvcicsIGFjdGlvbiwgbWVzc2FnZTogcmVzdWx0Lm91dHB1dCA/PyAn5riF55CG5aSx6LSlJyB9KTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgICAgc2V0Q2xlYW51cFN0YXR1cyh7XHJcbiAgICAgICAga2luZDogJ2Vycm9yJyxcclxuICAgICAgICBhY3Rpb24sXHJcbiAgICAgICAgbWVzc2FnZTogY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGNhdXNlLm1lc3NhZ2UgOiBTdHJpbmcoY2F1c2UpLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9LCBbY2xlYW51cFN0YXR1cy5raW5kLCByb290XSk7XHJcblxyXG4gIGNvbnN0IGNsZWFyQ2xlYW51cFN0YXR1cyA9IHVzZUNhbGxiYWNrKCgpID0+IHtcclxuICAgIHNldENsZWFudXBTdGF0dXMoeyBraW5kOiAnaWRsZScgfSk7XHJcbiAgfSwgW10pO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgc3lzdGVtLFxyXG4gICAgZGlza0hpc3RvcnksXHJcbiAgICByb290LFxyXG4gICAgY3VycmVudERpcmVjdG9yeSxcclxuICAgIGVudHJpZXMsXHJcbiAgICBwcmV2aWV3LFxyXG4gICAgYnJvd3NlckxvYWRpbmcsXHJcbiAgICBzZXRQcmV2aWV3LFxyXG4gICAgc2V0Q3VycmVudERpcmVjdG9yeSxcclxuICAgIHNjYW5JZFJlZixcclxuICAgIHJvb3RSZWYsXHJcbiAgICBydW5uaW5nLFxyXG4gICAgcGF1c2VkLFxyXG4gICAgcGhhc2UsXHJcbiAgICBzY2FuVGVsZW1ldHJ5LFxyXG4gICAgc2NhbkVycm9ycyxcclxuICAgIHN0YXRzLFxyXG4gICAgbGFyZ2VzdCxcclxuICAgIGR1cGxpY2F0ZXMsXHJcbiAgICBleHRlbnNpb25zLFxyXG4gICAgZGlyZWN0b3JpZXMsXHJcbiAgICBkaXJlY3RvcnlTbmFwc2hvdHMsXHJcbiAgICBkaXJlY3RvcnlTbmFwc2hvdERhdGEsXHJcbiAgICBzYXZlZFJlc3VsdHMsXHJcbiAgICB1c25JbmZvLFxyXG4gICAgdXNuRGVsdGEsXHJcbiAgICBleGNsdXNpb25zVGV4dCxcclxuICAgIHNldEV4Y2x1c2lvbnNUZXh0LFxyXG4gICAgZXJyb3IsXHJcbiAgICBzZXRFcnJvcixcclxuICAgIHJlZnJlc2hTeXN0ZW0sXHJcbiAgICBjaG9vc2UsXHJcbiAgICBzdGFydCxcclxuICAgIGNhbmNlbFNjYW4sXHJcbiAgICB0b2dnbGVQYXVzZSxcclxuICAgIGxvYWREaXJlY3RvcnksXHJcbiAgICBvcGVuUHJldmlldyxcclxuICAgIHJlc3RvcmVTYXZlZFJlc3VsdCxcclxuICAgIHJlbW92ZVNhdmVkUmVzdWx0LFxyXG4gICAgcmVtb3ZlRGlyZWN0b3J5U25hcHNob3QsXHJcbiAgICBjbGVhckhpc3RvcnksXHJcbiAgICBzZXRSdW5uaW5nLFxyXG4gICAgc2V0UGF1c2VkLFxyXG4gICAgc2V0U2NhbkVycm9ycyxcclxuICAgIHNldEJyb3dzZXJMb2FkaW5nLFxyXG4gICAgc2V0RW50cmllcyxcclxuICAgIHNldER1cGxpY2F0ZXMsXHJcbiAgICBjbGVhbnVwU3RhdHVzLFxyXG4gICAgcnVuQ2xlYW51cCxcclxuICAgIGNsZWFyQ2xlYW51cFN0YXR1cyxcclxuICB9O1xyXG59XHJcbiJdLCJtYXBwaW5ncyI6IkFBYUEsU0FBUyxhQUFhLFdBQVcsUUFBUSxnQkFBdUM7QUE2RGhGLE1BQU0sb0JBQStEO0FBQUEsRUFDbkUscUJBQXFCO0FBQUEsRUFDckIsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sSUFBSTtBQUNOO0FBQ0EsTUFBTSxZQUFZO0FBQ2xCLE1BQU0sa0JBQWtCO0FBQ3hCLE1BQU0saUJBQWlCO0FBQ3ZCLE1BQU0sbUJBQW1CO0FBQ3pCLE1BQU0sb0JBQW9CO0FBQzFCLE1BQU0sZ0JBQWdCO0FBUXRCLE1BQU0sS0FBUTtBQUFBLEVBRVosWUFDbUIsVUFDQSxRQUNqQjtBQUZpQjtBQUNBO0FBQUEsRUFDaEI7QUFBQSxFQUpjLE9BQVksQ0FBQztBQUFBLEVBSzlCLElBQUksT0FBZTtBQUNqQixXQUFPLEtBQUssS0FBSztBQUFBLEVBQ25CO0FBQUEsRUFDQSxLQUFLLE1BQWU7QUFDbEIsUUFBSSxLQUFLLEtBQUssU0FBUyxLQUFLLFVBQVU7QUFDcEMsV0FBSyxLQUFLLEtBQUssSUFBSTtBQUNuQixXQUFLLFNBQVMsS0FBSyxLQUFLLFNBQVMsQ0FBQztBQUNsQztBQUFBLElBQ0Y7QUFDQSxRQUFJLEtBQUssT0FBTyxJQUFJLElBQUksS0FBSyxPQUFPLEtBQUssS0FBSyxDQUFDLENBQUUsR0FBRztBQUNsRCxXQUFLLEtBQUssQ0FBQyxJQUFJO0FBQ2YsV0FBSyxTQUFTLENBQUM7QUFB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