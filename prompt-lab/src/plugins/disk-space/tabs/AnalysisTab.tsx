import type { EChartsCoreOption } from 'echarts/core';
import type { UseDiskScanResult } from '../hooks/useDiskScan';
import { displayPath } from '../hooks/useDiskScan';
import { Chart, EmptyState } from './components';
import { formatBytes } from './helpers';
import type { DirectoryChange } from './shared';
import type { TreemapNode } from './helpers';

/**
 * AnalysisTab — 空间分析：largest 筛选、重复文件工作台、目录变化、treemap。
 *
 * 共享的"扫描统计 + treemap + 全局 largest 列表"在 panel 顶层渲染，这里只管
 * activeTab === 'analysis' 时独有的块。
 */

export interface AnalysisTabProps {
  scan: UseDiskScanResult;
  // UI state 由 panel 持有
  selectedDuplicates: string[];
  setSelectedDuplicates: React.Dispatch<React.SetStateAction<string[]>>;
  largeFileThreshold: number;
  setLargeFileThreshold: (value: number) => void;
  customThresholdGb: string;
  setCustomThresholdGb: (value: string) => void;
  largeFileExtension: string;
  setLargeFileExtension: (value: string) => void;
  largeFileSort: 'size' | 'modified' | 'extension';
  setLargeFileSort: (value: 'size' | 'modified' | 'extension') => void;
  // shared 派生
  visibleLargest: UseDiskScanResult['largest'];
  scannedExtensions: string[];
  directoryChanges: DirectoryChange[];
  selectedDuplicateBytes: number;
  // callbacks
  openPreview: (entry: { name: string; path: string; type: 'file'; size: number; modifiedAt: number; extension: string }) => Promise<void>;
}

export function AnalysisTab(props: AnalysisTabProps) {
  const {
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
    visibleLargest,
    scannedExtensions,
    directoryChanges,
    selectedDuplicateBytes,
    openPreview,
  } = props;
  const { stats, duplicates, scanIdRef, running, setDuplicates } = scan;

  return (
    <>
      {stats.files > 0 && (
        <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <label className="grid gap-1 text-xs text-muted-foreground">
            自定义最小容量（GB）
            <input
              className="w-40 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              type="number"
              min="0"
              step="0.1"
              value={customThresholdGb}
              placeholder="例如 2.5"
              onChange={(event) => setCustomThresholdGb(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            文件类型
            <select
              className="w-40 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              value={largeFileExtension}
              onChange={(event) => setLargeFileExtension(event.target.value)}
            >
              <option value="">全部类型</option>
              {scannedExtensions.map((extension) => (
                <option key={extension} value={extension}>.{extension}</option>
              ))}
            </select>
          </label>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => {
              setCustomThresholdGb('');
              setLargeFileExtension('');
              setLargeFileThreshold(0);
            }}
          >
            重置筛选
          </button>
        </section>
      )}
      {stats.files > 0 && (
        <div className="flex justify-end gap-1">
          {([['size', '按大小'], ['modified', '按修改时间'], ['extension', '按扩展名']] as const).map(([value, label]) => (
            <button
              key={value}
              className={`rounded-md border px-3 py-1.5 text-xs ${largeFileSort === value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              onClick={() => setLargeFileSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {duplicates.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
            <div>
              <h2 className="font-medium">重复文件工作台</h2>
              <p className="text-xs text-muted-foreground">完整哈希并逐字节复核；每组第一项建议保留</p>
            </div>
            <button
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-40"
              disabled={!scanIdRef.current || selectedDuplicates.length === 0 || running}
              onClick={async () => {
                const result = await window.electronAPI.diskSpace.trash(scanIdRef.current, selectedDuplicates);
                if (!result.success) return;
                const removed = new Set(result.trashed);
                setDuplicates((current) =>
                  current
                    .map((group) => ({ ...group, files: group.files.filter((file) => !removed.has(file.path)) }))
                    .filter((group) => group.files.length > 1),
                );
                setSelectedDuplicates([]);
              }}
            >
              移入回收站（{selectedDuplicates.length} · {formatBytes(selectedDuplicateBytes)}）
            </button>
          </div>
          <div className="max-h-[520px] overflow-auto p-4">
            {duplicates.map((group) => (
              <div key={group.groupId} className="mb-3 overflow-hidden rounded-lg border">
                <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {group.files.length} 个相同文件 · 单个 {formatBytes(group.size)} · 最多释放 {formatBytes(group.size * (group.files.length - 1))}
                </div>
                {group.files.map((file, index) => (
                  <label key={file.path} className="grid grid-cols-[24px_minmax(0,1fr)_110px] items-center gap-2 border-t px-3 py-2 text-sm hover:bg-muted/30">
                    <input
                      type="checkbox"
                      disabled={index === 0}
                      checked={selectedDuplicates.includes(file.path)}
                      onChange={() =>
                        setSelectedDuplicates((current) =>
                          current.includes(file.path) ? current.filter((path) => path !== file.path) : [...current, file.path],
                        )
                      }
                    />
                    <span className="truncate font-mono text-xs" title={displayPath(file.path)}>
                      {displayPath(file.path)}
                      {index === 0 && <span className="ml-2 font-sans text-primary">建议保留</span>}
                    </span>
                    <span className="text-right text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      {stats.files > 0 && (
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
                  <span className="truncate font-mono text-xs" title={displayPath(item.path)}>
                    {displayPath(item.path)}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">当前 {formatBytes(item.size)}</span>
                  <span className={`text-right font-medium tabular-nums ${item.change > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {item.change > 0 ? '+' : '−'}
                    {formatBytes(Math.abs(item.change))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">完成同一目录的第二次扫描后，将显示具体增长来源</div>
          )}
        </section>
      )}
      {stats.files > 0 && (
        <section className="max-h-[430px] overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
            <div>
              <h2 className="font-medium">大文件分析</h2>
              <p className="text-xs text-muted-foreground">共显示 {visibleLargest.length} 个文件</p>
            </div>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {([[0, '全部'], [1024 ** 3, '> 1 GB'], [5 * 1024 ** 3, '> 5 GB'], [10 * 1024 ** 3, '> 10 GB']] as const).map(([value, label]) => (
                <button
                  key={label}
                  className={`rounded-md px-3 py-1.5 text-xs ${largeFileThreshold === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setLargeFileThreshold(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {visibleLargest.length ? (
              visibleLargest.map((file) => (
                <button
                  key={file.path}
                  className="grid w-full grid-cols-[minmax(0,1fr)_110px_150px] items-center gap-3 border-b px-5 py-2.5 text-left text-sm hover:bg-muted/40"
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
                  <span className="truncate font-mono text-xs" title={displayPath(file.path)}>
                    {displayPath(file.path)}
                  </span>
                  <span className="text-right font-medium tabular-nums">{formatBytes(file.size)}</span>
                  <span className="text-right text-xs text-muted-foreground">{new Date(file.modifiedAt).toLocaleDateString()}</span>
                </button>
              ))
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">没有符合当前大小条件的文件</div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
