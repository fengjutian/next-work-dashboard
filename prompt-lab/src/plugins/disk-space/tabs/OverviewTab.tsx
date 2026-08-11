import type { EChartsCoreOption } from 'echarts/core';
import type { UseDiskScanResult } from '../hooks/useDiskScan';
import { Chart, EmptyState, UsageCard } from './components';

/**
 * OverviewTab — 系统资源概览：磁盘 / 内存使用卡 + 历史趋势 + 历史数据管理。
 *
 * 只渲染 activeTab === 'overview' 时显示的块；其他内容（modal、bottom summary、
 * 共享 header / nav）由 DiskSpacePanel 顶层渲染。
 */

export interface OverviewTabProps {
  scan: UseDiskScanResult;
  historyOption: EChartsCoreOption;
  onOpenSnapshots: () => void;
  onOpenResults: () => void;
}

export function OverviewTab({ scan, historyOption, onOpenSnapshots, onOpenResults }: OverviewTabProps) {
  const { system, diskHistory, directorySnapshots, clearHistory } = scan;
  return (
    <>
      {directorySnapshots.length > 0 && (
        <div className="flex justify-end">
          <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={onOpenSnapshots}>
            管理扫描快照
          </button>
        </div>
      )}
      {scan.savedResults.length > 0 && (
        <div className="flex justify-end">
          <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={onOpenResults}>
            查看扫描存档（{scan.savedResults.length}）
          </button>
        </div>
      )}
      {(diskHistory.length > 0 || directorySnapshots.length > 0) && (
        <section className="flex items-center justify-between rounded-xl border bg-card px-5 py-3 shadow-sm">
          <div className="text-sm">
            <span className="font-medium">本地历史数据</span>
            <span className="ml-3 text-xs text-muted-foreground">磁盘快照 {diskHistory.length} · 目录快照 {directorySnapshots.length}</span>
          </div>
          <button className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={() => void clearHistory()}>
            清空历史
          </button>
        </section>
      )}
      <section className="h-[300px] overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="font-medium">磁盘使用趋势</h2>
            <p className="text-xs text-muted-foreground">每小时记录一次，最多保留最近 7 天</p>
          </div>
          <span className="text-xs text-muted-foreground">{diskHistory.length} 个快照</span>
        </div>
        <div className="h-[245px]">
          {diskHistory.length ? <Chart option={historyOption} className="h-full w-full" /> : <EmptyState>首次记录后将在这里显示磁盘变化</EmptyState>}
        </div>
      </section>
      {system && (
        <section className="grid gap-4 xl:grid-cols-2">
          {system.disks.map((disk, index) => (
            <UsageCard
              key={disk.path}
              title={`${disk.path} ${index === 0 ? '系统磁盘' : '本地磁盘'}`}
              subtitle={`${system.hostname} · ${system.platform}`}
              used={disk.used}
              total={disk.total}
              color={index === 0 ? '#7c3aed' : '#2563eb'}
            />
          ))}
          <UsageCard title="物理内存" subtitle="实时内存占用" used={system.memory.used} total={system.memory.total} color="#0891b2" />
        </section>
      )}
    </>
  );
}
