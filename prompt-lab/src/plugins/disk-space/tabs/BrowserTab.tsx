import { useEffect, useMemo } from 'react';
import { Select } from 'antd';
import { ChevronDown, ExternalLink, FileText, FolderOpen, Image, Loader2, Square } from '@/components/icons';
import type { DiskDirectoryItem, DiskFilePreview } from '@/types/electron';
import { displayPath, type UseDiskScanResult } from '../hooks/useDiskScan';
import { EmptyState } from './components';
import { XMarkdown } from '@ant-design/x-markdown';
import { formatBytes } from './helpers';

/**
 * BrowserTab — 目录浏览 + 文件预览。
 *
 * 包含：
 * - 选择目录 / 排除目录输入（仅 analysis tab 隐藏）
 * - 文件浏览器（左侧）
 * - 预览面板（右侧，image / markdown / text）
 */

export interface BrowserTabProps {
  scan: UseDiskScanResult;
  preview: DiskFilePreview | null;
  setPreview: (preview: DiskFilePreview | null) => void;
  openPreview: (entry: DiskDirectoryItem) => Promise<void>;
  parentDirectory: string;
  loadDirectory: (path: string) => Promise<void>;
  showAnalysisControls: boolean; // 决定是否渲染"分析占用"按钮和排除输入
  isFocusedTab: boolean;
  start: (focusedScan: boolean) => Promise<void>;
  cancelScan: () => Promise<void>;
  choose: (drive: string) => Promise<void>;
}

export function BrowserTab(props: BrowserTabProps) {
  const { scan, preview, setPreview, openPreview, parentDirectory, loadDirectory, showAnalysisControls, isFocusedTab, start, cancelScan, choose } = props;
  const { root, currentDirectory, entries, browserLoading, scanIdRef, running, exclusionsText, setExclusionsText, system } = scan;

  // 盘符列表来自 systemInfo（disk-service 已经在 A-Z 探测了）
  const driveOptions = useMemo(
    () =>
      system.disks.map((disk) => ({
        value: disk.path,
        label: `${disk.path} · ${formatBytes(disk.free)} 可用 / ${formatBytes(disk.total)}`,
      })),
    [system.disks],
  );

  // 默认 C 盘：盘符列表加载好但 root 还没选时自动选第一个（通常是 C:）
  useEffect(() => {
    if (!root && driveOptions.length > 0) {
      const defaultDrive = driveOptions.find((option) => option.value.startsWith('C'))?.value ?? driveOptions[0].value;
      void choose(defaultDrive);
    }
    // 仅在盘符列表变化时自动选一次，避免用户主动切换后被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveOptions]);

  return (
    <>
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex gap-2">
          <Select
            className="min-w-[260px]"
            value={root || undefined}
            placeholder="选择盘符"
            options={driveOptions}
            onChange={(value) => void choose(value)}
            disabled={running}
            suffixIcon={<FolderOpen className="h-4 w-4" />}
          />
          <div className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm" title={root}>
            {root || '选择目录后可浏览与分析'}
          </div>
          {showAnalysisControls && (
            running ? (
              <button className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm" onClick={() => void cancelScan()}>
                <Square className="h-4 w-4" />停止
              </button>
            ) : (
              <button className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!root} onClick={() => void start(isFocusedTab)}>
                分析占用
              </button>
            )
          )}
        </div>
        {showAnalysisControls && (
          <label className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm">
            <span className="text-muted-foreground">排除目录</span>
            <input
              className="rounded-md border bg-background px-3 py-2"
              value={exclusionsText}
              disabled={running}
              onChange={(event) => setExclusionsText(event.target.value)}
            />
          </label>
        )}
      </section>
      {root && (
        <section className="grid min-h-[520px] overflow-hidden rounded-2xl border bg-card shadow-sm xl:grid-cols-[minmax(380px,42%)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex h-12 items-center gap-2 border-b px-3">
              <button className="rounded p-1.5 hover:bg-accent disabled:opacity-30" disabled={!parentDirectory} onClick={() => parentDirectory && void loadDirectory(parentDirectory)}>
                <ChevronDown className="h-4 w-4 rotate-90" />
              </button>
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={currentDirectory}>
                {displayPath(currentDirectory)}
              </span>
              <span className="text-xs text-muted-foreground">{entries.length} 项</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {browserLoading && !preview ? (
                <EmptyState>
                  <Loader2 className="mr-2 h-4 w-4" />加载中
                </EmptyState>
              ) : (
                entries.map((entry: DiskDirectoryItem) => (
                  <button
                    key={entry.path}
                    className={`grid w-full grid-cols-[24px_minmax(0,1fr)_90px] items-center gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted/40 ${preview?.path === entry.path ? 'bg-primary/5' : ''}`}
                    onDoubleClick={() => void openPreview(entry)}
                    onClick={() => entry.type === 'file' && void openPreview(entry)}
                  >
                    {entry.type === 'directory' ? (
                      <FolderOpen className="h-4 w-4 text-amber-500" />
                    ) : entry.extension.match(/png|jpg|jpeg|gif|webp|svg/) ? (
                      <Image className="h-4 w-4 text-sky-500" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="truncate">{entry.name}</span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {entry.type === 'directory' ? '文件夹' : formatBytes(entry.size)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col bg-muted/10">
            <div className="flex h-12 items-center justify-between border-b px-4">
              <span className="truncate text-sm font-medium">{preview?.name || '文件预览'}</span>
              {preview && (
                <button
                  className="rounded p-1.5 hover:bg-accent"
                  title="使用默认应用打开"
                  onClick={() => void window.electronAPI.diskSpace.open(scanIdRef.current, preview.path)}
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {!preview ? (
                <EmptyState>在左侧选择文件查看安全预览</EmptyState>
              ) : preview.kind === 'image' && preview.content ? (
                <div className="flex items-center justify-center">
                  <img
                    className="max-h-full max-w-full rounded-lg object-contain"
                    src={`data:${preview.mimeType};base64,${preview.content}`}
                    alt={preview.name}
                  />
                </div>
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
    </>
  );
}
