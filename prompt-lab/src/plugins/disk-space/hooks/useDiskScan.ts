/**
 * useDiskScan —— 磁盘空间插件的核心扫描 hook。
 *
 * 集中所有非 UI 逻辑：IPC 事件监听、扫描生命周期、TopN 维护、localStorage
 * 持久化（history / snapshots / results / exclusions / usn-cursors）、USN 游标。
 * UI 状态（activeTab / selectedDuplicates / modal open 状态 / largeFile 筛选
 * / specialtyProbes / 诊断）仍由 panel 或 tab 组件自己维护。
 *
 * 设计原则：
 * - 不依赖 store 或 AI（这些由 tab 组件按需注入）。
 * - 暴露 ref + state + actions；ref 给同步副作用用，state 给渲染用。
 * - choose() / start() / cancelScan() / togglePause() 等动作幂等且自包含。
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  DiskArchiveEntry,
  DiskDirectoryItem,
  DiskDirectorySnapshotData,
  DiskFilePreview,
  DiskPersistedResult,
  DiskScanEvent,
  DiskSnapshotEntry,
  DiskSystemInfo,
  DiskUsnInfo,
} from '@/types/electron';

// ---------------- 类型别名 ----------------

export type FileEntry = Extract<DiskScanEvent, { type: 'files' }>['items'][number];
export type DirectoryEntry = Extract<DiskScanEvent, { type: 'directories' }>['items'][number];
export type DuplicateGroup = Extract<DiskScanEvent, { type: 'duplicate' }>;

export type DiskHistoryPoint = {
  timestamp: number;
  disks: Array<{ path: string; used: number }>;
};
export type DirectorySnapshot = {
  timestamp: number;
  root: string;
  directories: Array<{ path: string; size: number }>;
};
export type PersistedScanResult = {
  id: string;
  root: string;
  savedAt: number;
  stats: { files: number; bytes: number; errors: number };
  directories: DirectoryEntry[];
  largest: FileEntry[];
  extensions: Record<string, number>;
  duplicates: DuplicateGroup[];
};
export type ScanErrorItem = {
  path: string;
  category: 'permission-denied' | 'not-found' | 'busy' | 'io';
  message: string;
};
export type ScanTelemetry = {
  currentPath: string;
  directories: number;
  files: number;
  bytes: number;
  elapsedMs: number;
};
export type ScanPhase = 'scanning' | 'hashing';

// 清理动作状态机：替换原 error 字符串匹配（"清理完成$"）的反模式。
// 任何时刻只能处于以下状态之一；切换状态时驱动副作用（自动重扫、Toast）。
export type CleanupStatus =
  | { kind: 'idle' }
  | { kind: 'running'; action: CleanupActionId }
  | { kind: 'success'; action: CleanupActionId; message: string }
  | { kind: 'error'; action: CleanupActionId; message: string };
export type CleanupActionId = 'docker-build-cache' | 'npm-cache' | 'pnpm-store';

const SCAN_ERROR_LABELS: Record<ScanErrorItem['category'], string> = {
  'permission-denied': '拒绝访问',
  'not-found': '路径失效',
  busy: '文件占用',
  io: 'I/O 错误',
};
const TOP_FILES = 50;
const TOP_DIRECTORIES = 500;
const SCAN_ERROR_CAP = 100;
const DISK_HISTORY_CAP = 168; // 7 天 × 24 小时
const SAVED_RESULTS_CAP = 5;
const SNAPSHOTS_CAP = 20;

// ---------------- TopN 容器 ----------------

/**
 * 维护 capacity 个最大元素的小顶堆。容量未满 O(log n) push；满后 O(1) 拒绝
 * 或 O(log n) 替换堆顶。百万级事件下避免每条都 [...arr].sort().slice(0, N)。
 */
class TopN<T> {
  private readonly data: T[] = [];
  constructor(
    private readonly capacity: number,
    private readonly sizeOf: (item: T) => number,
  ) {}
  get size(): number {
    return this.data.length;
  }
  push(item: T): void {
    if (this.data.length < this.capacity) {
      this.data.push(item);
      this.bubbleUp(this.data.length - 1);
      return;
    }
    if (this.sizeOf(item) > this.sizeOf(this.data[0]!)) {
      this.data[0] = item;
      this.sinkDown(0);
    }
  }
  toSortedDesc(): T[] {
    return [...this.data].sort((a, b) => this.sizeOf(b) - this.sizeOf(a));
  }
  reset(): void {
    this.data.length = 0;
  }
  load(items: T[]): void {
    this.data.length = 0;
    for (const item of items) this.push(item);
  }
  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const cur = this.sizeOf(this.data[i]!);
      const par = this.sizeOf(this.data[parent]!);
      if (cur < par) {
        const tmp = this.data[i]!;
        this.data[i] = this.data[parent]!;
        this.data[parent] = tmp;
        i = parent;
      } else break;
    }
  }
  private sinkDown(i: number): void {
    const n = this.data.length;
    // 标准小顶堆下滤：循环到堆序稳定为止。
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.sizeOf(this.data[l]!) < this.sizeOf(this.data[smallest]!)) smallest = l;
      if (r < n && this.sizeOf(this.data[r]!) < this.sizeOf(this.data[smallest]!)) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[i]!;
      this.data[i] = this.data[smallest]!;
      this.data[smallest] = tmp;
      i = smallest;
    }
  }
}

// ---------------- localStorage 工具 ----------------

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------------- displayPath 工具 ----------------

/** Windows 长路径前缀 \\?\ 或 \\?\UNC\ 还原成可见形式。 */
export function displayPath(value: string): string {
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

// ---------------- Hook 接口 ----------------

export interface UseDiskScanResult {
  // system / history
  system: DiskSystemInfo | null;
  diskHistory: DiskHistoryPoint[];

  // root + directory
  root: string;
  currentDirectory: string;
  entries: DiskDirectoryItem[];
  preview: DiskFilePreview | null;
  browserLoading: boolean;
  setPreview: (preview: DiskFilePreview | null) => void;
  setCurrentDirectory: (path: string) => void;

  // scan lifecycle
  scanIdRef: MutableRefObject<string>;
  rootRef: MutableRefObject<string>;
  running: boolean;
  paused: boolean;
  phase: ScanPhase;
  scanTelemetry: ScanTelemetry;
  scanErrors: ScanErrorItem[];
  stats: { files: number; bytes: number; errors: number };

  // results
  largest: FileEntry[];
  duplicates: DuplicateGroup[];
  extensions: Record<string, number>;
  directories: DirectoryEntry[];

  // history / archive
  directorySnapshots: DiskSnapshotEntry[];
  // snapshot 完整数据：与 directorySnapshots 一一对应；directoryChanges 派生用。
  // 启动时异步从 userData 加载，done 时直接 push 新数据。
  directorySnapshotData: DirectorySnapshot[];
  savedResults: DiskArchiveEntry[];

  // USN
  usnInfo: DiskUsnInfo | null;
  usnDelta: number | null;

  // config
  exclusionsText: string;
  setExclusionsText: (value: string) => void;

  // error — 由 hook 内部维护（catch 分支统一写入）
  error: string;
  setError: (message: string) => void;

  // actions
  refreshSystem: () => Promise<void>;
  choose: () => Promise<void>;
  start: (focusedScan: boolean) => Promise<void>;
  cancelScan: () => Promise<void>;
  togglePause: () => Promise<void>;
  loadDirectory: (path: string) => Promise<void>;
  openPreview: (entry: DiskDirectoryItem) => Promise<void>;
  // archive 操作改成 async：内部从 userData 文件加载完整数据
  restoreSavedResult: (id: string) => Promise<void>;
  removeSavedResult: (id: string) => Promise<void>;
  removeDirectorySnapshot: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setScanErrors: React.Dispatch<React.SetStateAction<ScanErrorItem[]>>;
  setBrowserLoading: (loading: boolean) => void;
  setEntries: (entries: DiskDirectoryItem[]) => void;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateGroup[]>>;

  // cleanup 状态机
  cleanupStatus: CleanupStatus;
  runCleanup: (action: CleanupActionId) => Promise<void>;
  clearCleanupStatus: () => void;
}

// ---------------- Hook 实现 ----------------

export function useDiskScan(): UseDiskScanResult {
  // system / history
  const [system, setSystem] = useState<DiskSystemInfo | null>(null);
  const [diskHistory, setDiskHistory] = useState<DiskHistoryPoint[]>(() =>
    readJson<DiskHistoryPoint[]>('disk-space.history', []),
  );

  // root + directory
  const [root, setRoot] = useState('');
  const rootRef = useRef('');
  const [currentDirectory, setCurrentDirectory] = useState('');
  const [entries, setEntries] = useState<DiskDirectoryItem[]>([]);
  const [preview, setPreview] = useState<DiskFilePreview | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);

  // scan lifecycle
  const scanIdRef = useRef('');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>('scanning');
  const [scanTelemetry, setScanTelemetry] = useState<ScanTelemetry>({
    currentPath: '',
    directories: 0,
    files: 0,
    bytes: 0,
    elapsedMs: 0,
  });
  const [scanErrors, setScanErrors] = useState<ScanErrorItem[]>([]);
  const [stats, setStats] = useState({ files: 0, bytes: 0, errors: 0 });

  // results
  const [largest, setLargest] = useState<FileEntry[]>([]);
  const largestRef = useRef<FileEntry[]>([]);
  const largestTopRef = useRef(new TopN<FileEntry>(TOP_FILES, (item) => item.size));
  const largestDirtyRef = useRef(false);
  const scannedDirectoriesRef = useRef<DirectoryEntry[]>([]);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const duplicatesRef = useRef<DuplicateGroup[]>([]);
  const [extensions, setExtensions] = useState<Record<string, number>>({});
  const extensionsRef = useRef<Record<string, number>>({});

  // archive：元数据存 userData/scan-archive/，完整数据按 id 懒加载。
  // 这里只持元数据列表；调用方在需要完整数据时通过 loadArchive / loadSnapshot 拉取。
  const [directorySnapshots, setDirectorySnapshots] = useState<DiskSnapshotEntry[]>([]);
  const [directorySnapshotData, setDirectorySnapshotData] = useState<DirectorySnapshot[]>([]);
  const [savedResults, setSavedResults] = useState<DiskArchiveEntry[]>([]);

  // USN
  const [usnInfo, setUsnInfo] = useState<DiskUsnInfo | null>(null);
  const [usnDelta, setUsnDelta] = useState<number | null>(null);

  // config
  const [exclusionsText, setExclusionsTextState] = useState(
    () => localStorage.getItem('disk-space.exclusions') ?? '.git,node_modules,target',
  );
  const setExclusionsText = useCallback((value: string) => {
    setExclusionsTextState(value);
    localStorage.setItem('disk-space.exclusions', value);
  }, []);

  // error
  const [error, setError] = useState('');

  // cleanup 状态机
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus>({ kind: 'idle' });

  // 一次性副作用：挂载时从 userData 拉取 archive / snapshot 元数据，
  // 并把老版本 localStorage 数据迁移到 userData 后清空。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) 老数据迁移
      const legacyResults = readJson<PersistedScanResult[] | null>('disk-space.results', null);
      const legacySnapshots = readJson<DirectorySnapshot[] | null>('disk-space.directory-snapshots', null);
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
                duplicates: saved.duplicates,
              },
            });
          } catch { /* 迁移失败忽略，不阻塞新流程 */ }
        }
        localStorage.removeItem('disk-space.results');
      }
      if (legacySnapshots && legacySnapshots.length > 0) {
        for (const snapshot of legacySnapshots) {
          const id = `${snapshot.root.replace(/[\\/:*?"<>|]/g, '_')}__${snapshot.timestamp}`;
          try {
            await window.electronAPI.diskSpace.saveSnapshot({
              id,
              root: snapshot.root,
              timestamp: snapshot.timestamp,
              directoryCount: snapshot.directories.length,
              data: snapshot,
            });
          } catch { /* ignore */ }
        }
        localStorage.removeItem('disk-space.directory-snapshots');
      }

      // 2) 加载 userData 元数据
      try {
        const [archive, snapshots] = await Promise.all([
          window.electronAPI.diskSpace.listArchive(),
          window.electronAPI.diskSpace.listSnapshots(),
        ]);
        if (cancelled) return;
        setSavedResults(archive);
        setDirectorySnapshots(snapshots);
        // 并行拉每个 snapshot 的完整数据，directoryChanges 派生需要
        const fullData = await Promise.all(
          snapshots.map((meta) => window.electronAPI.diskSpace.loadSnapshot(meta.id)),
        );
        if (cancelled) return;
        setDirectorySnapshotData(
          fullData.filter((value): value is DiskDirectorySnapshotData => value !== null),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [setError]);

  // TopN flush —— 把堆里的 top 50 同步到 state/largestRef
  const flushLargest = useCallback(() => {
    largestDirtyRef.current = false;
    const sorted = largestTopRef.current.toSortedDesc();
    largestRef.current = sorted;
    setLargest(sorted);
  }, []);

  // 一次性副作用：自动轮询 refreshSystem（每 30s）
  const refreshSystemImpl = useCallback(async (): Promise<void> => {
    try {
      const next = await window.electronAPI.diskSpace.systemInfo();
      setSystem(next);
      setDiskHistory((current) => {
        const now = Date.now();
        const latest = current.at(-1);
        if (latest && now - latest.timestamp < 60 * 60 * 1000) return current;
        const history = [
          ...current,
          {
            timestamp: now,
            disks: next.disks.map((disk) => ({ path: disk.path, used: disk.used })),
          },
        ].slice(-DISK_HISTORY_CAP);
        writeJson('disk-space.history', history);
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
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshSystemImpl]);

  // IPC 事件监听：onEvent
  useEffect(() => {
    const unsubscribe = window.electronAPI.diskSpace.onEvent((id, event) => {
      if (id !== scanIdRef.current) return;
      if (event.type === 'files') {
        for (const item of event.items) largestTopRef.current.push(item);
        if (!largestDirtyRef.current) {
          largestDirtyRef.current = true;
          requestAnimationFrame(flushLargest);
        }
      } else if (event.type === 'directories') {
        const next = event.items.slice(0, TOP_DIRECTORIES);
        scannedDirectoriesRef.current = next;
        setDirectories(next);
      } else if (event.type === 'duplicate-progress') {
        setPhase('hashing');
      } else if (event.type === 'scan-status') {
        setScanTelemetry(event);
      } else if (event.type === 'scan-error') {
        setScanErrors((value) =>
          [
            ...value,
            {
              path: event.path,
              category: event.category,
              message: `【${SCAN_ERROR_LABELS[event.category]}】${event.message}`,
            },
          ].slice(-SCAN_ERROR_CAP),
        );
      } else if (event.type === 'duplicate') {
        const next = [...duplicatesRef.current, event];
        duplicatesRef.current = next;
        setDuplicates(next);
      } else if (event.type === 'extension') {
        const next = { ...extensionsRef.current, [event.extension || '(无扩展名)']: event.size };
        extensionsRef.current = next;
        setExtensions(next);
      } else if (event.type === 'progress' || event.type === 'done') {
        setStats({ files: event.files, bytes: event.bytes, errors: event.errors });
        if (event.type === 'done' && rootRef.current) {
          flushLargest();
          const id = crypto.randomUUID();
          const fullData: DiskPersistedResult = {
            id,
            root: rootRef.current,
            savedAt: Date.now(),
            stats: { files: event.files, bytes: event.bytes, errors: event.errors },
            directories: scannedDirectoriesRef.current.slice(0, TOP_DIRECTORIES),
            largest: largestRef.current.slice(0, TOP_FILES),
            extensions: { ...extensionsRef.current },
            duplicates: duplicatesRef.current.slice(0, 100),
          };
          const meta: DiskArchiveEntry = {
            id,
            root: fullData.root,
            savedAt: fullData.savedAt,
            stats: fullData.stats,
            duplicates: fullData.duplicates.length,
          };
          // 异步写 userData 文件；不阻塞渲染。
          void window.electronAPI.diskSpace
            .saveArchive({ ...meta, data: fullData })
            .then((next) => setSavedResults(next))
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));

          // last-result 缓存：只存 id + root，恢复时按 id 加载。
          writeJson('disk-space.last-result', { id, root: fullData.root });

          const snapshotData: DiskDirectorySnapshotData = {
            timestamp: fullData.savedAt,
            root: fullData.root,
            directories: scannedDirectoriesRef.current.map((item) => ({
              path: item.path,
              size: item.size,
            })),
          };
          const snapshotId = `${fullData.root.replace(/[\\/:*?"<>|]/g, '_')}__${fullData.savedAt}`;
          const snapshotMeta: DiskSnapshotEntry = {
            id: snapshotId,
            root: fullData.root,
            timestamp: fullData.savedAt,
            directoryCount: snapshotData.directories.length,
          };
          void window.electronAPI.diskSpace
            .saveSnapshot({ ...snapshotMeta, data: snapshotData })
            .then((next) => {
              setDirectorySnapshots(next);
              // 同步把完整数据 push 到内存 state，directoryChanges 派生可直接用
              setDirectorySnapshotData((current) => [...current, snapshotData].slice(-SNAPSHOTS_CAP));
            })
            .catch(() => { /* 快照失败不致命 */ });
        }
      }
    });
    return unsubscribe;
  }, [flushLargest]);

  // IPC 事件监听：onExit
  useEffect(() => {
    const unsubscribe = window.electronAPI.diskSpace.onExit((id, result) => {
      if (id !== scanIdRef.current) return;
      setRunning(false);
      setPaused(false);
      if (result.error) setError(result.error);
    });
    return unsubscribe;
  }, []);

  // USN info
  useEffect(() => {
    if (!root) {
      setUsnInfo(null);
      setUsnDelta(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.diskSpace
      .usnInfo(root)
      .then((info) => {
        if (cancelled) return;
        setUsnInfo(info);
        if (info.supported && info.volume && info.nextUsn !== undefined) {
          const cursors = readJson<
            Record<string, { journalId?: number; nextUsn: number; recordedAt: number }>
          >('disk-space.usn-cursors', {});
          const previous = cursors[info.volume];
          setUsnDelta(
            previous && previous.journalId === info.journalId
              ? Math.max(0, info.nextUsn - previous.nextUsn)
              : null,
          );
          cursors[info.volume] = {
            journalId: info.journalId,
            nextUsn: info.nextUsn,
            recordedAt: Date.now(),
          };
          writeJson('disk-space.usn-cursors', cursors);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setUsnInfo({ supported: false, error: String(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // actions
  const refreshSystem = refreshSystemImpl;
  const choose = useCallback(async () => {
    const previousScanId = scanIdRef.current;
    if (previousScanId && running) {
      void window.electronAPI.diskSpace.cancel(previousScanId);
      scanIdRef.current = '';
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
      const saved = readJson<null | {
        root: string;
        stats: { files: number; bytes: number; errors: number };
        directories: DirectoryEntry[];
        largest: FileEntry[];
        extensions: Record<string, number>;
        duplicates?: DuplicateGroup[];
      }>('disk-space.last-result', null);
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
    async (focusedScan: boolean) => {
      if (!root || running) return;
      const exclusions = focusedScan
        ? ['.git']
        : exclusionsText
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
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
      setPhase('scanning');
      setError('');
      setPaused(false);
      setRunning(true);
      try {
        await window.electronAPI.diskSpace.start(scanIdRef.current, root, {
          exclusions,
          skipDuplicates: focusedScan,
        });
      } catch (cause) {
        setRunning(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [root, running, exclusionsText],
  );

  const cancelScan = useCallback(async () => {
    if (!scanIdRef.current) return;
    await window.electronAPI.diskSpace.cancel(scanIdRef.current);
    scanIdRef.current = '';
    setRunning(false);
    setPaused(false);
  }, []);

  const togglePause = useCallback(async () => {
    if (!scanIdRef.current) return;
    const success = paused
      ? await window.electronAPI.diskSpace.resume(scanIdRef.current)
      : await window.electronAPI.diskSpace.pause(scanIdRef.current);
    if (success) setPaused(!paused);
  }, [paused]);

  const loadDirectory = useCallback(
    async (directory: string) => {
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
    [root],
  );

  const openPreview = useCallback(
    async (entry: DiskDirectoryItem) => {
      if (entry.type === 'directory') {
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
    [root, loadDirectory],
  );

  // 恢复存档：先按 id 异步加载完整数据，再写入 ref + state。
  const restoreSavedResult = useCallback(async (id: string) => {
    try {
      const data = await window.electronAPI.diskSpace.loadArchive(id);
      if (!data) throw new Error('存档不存在或已损坏');
      // 主进程序列化去掉了 'type' 字段；恢复时补回以满足 DuplicateGroup 类型。
      const duplicates: DuplicateGroup[] = (data.duplicates ?? []).map((group) => ({
        type: 'duplicate' as const,
        groupId: group.groupId,
        size: group.size,
        files: group.files,
      }));
      rootRef.current = data.root;
      scannedDirectoriesRef.current = data.directories as DirectoryEntry[];
      largestRef.current = data.largest as FileEntry[];
      largestTopRef.current.load(data.largest as FileEntry[]);
      largestDirtyRef.current = false;
      extensionsRef.current = data.extensions;
      duplicatesRef.current = duplicates;
      setRoot(data.root);
      setCurrentDirectory(data.root);
      setStats(data.stats);
      setDirectories(data.directories as DirectoryEntry[]);
      setLargest(data.largest as FileEntry[]);
      setExtensions(data.extensions);
      setDuplicates(duplicates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);

  const removeSavedResult = useCallback(async (id: string) => {
    try {
      const next = await window.electronAPI.diskSpace.deleteArchive(id);
      setSavedResults(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);

  const removeDirectorySnapshot = useCallback(
    async (id: string) => {
      try {
        const next = await window.electronAPI.diskSpace.deleteSnapshot(id);
        setDirectorySnapshots(next);
        setDirectorySnapshotData((current) => {
          // 通过元数据定位：找 timestamp 匹配的 snapshot
          const meta = next.find((entry) => entry.id === id);
          if (!meta) return current;
          return current.filter(
            (snapshot) => !(snapshot.timestamp === meta.timestamp && snapshot.root === meta.root),
          );
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [setError],
  );

  const clearHistory = useCallback(async () => {
    localStorage.removeItem('disk-space.history');
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

  const runCleanup = useCallback(async (action: CleanupActionId) => {
    if (cleanupStatus.kind === 'running') return;
    setCleanupStatus({ kind: 'running', action });
    try {
      const result = await window.electronAPI.diskSpace.runCleanup(action, root);
      if (result.success) {
        setCleanupStatus({ kind: 'success', action, message: result.output ?? '清理完成' });
      } else if (result.canceled) {
        setCleanupStatus({ kind: 'idle' });
      } else {
        setCleanupStatus({ kind: 'error', action, message: result.output ?? '清理失败' });
      }
    } catch (cause) {
      setCleanupStatus({
        kind: 'error',
        action,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [cleanupStatus.kind, root]);

  const clearCleanupStatus = useCallback(() => {
    setCleanupStatus({ kind: 'idle' });
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
    clearCleanupStatus,
  };
}
