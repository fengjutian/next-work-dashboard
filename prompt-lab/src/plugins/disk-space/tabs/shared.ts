/**
 * 6 个 tab 组件的共享类型 —— 避免循环依赖。
 *
 * 拆分原则：
 * - `ScanSummary`：panel 算好的 useMemo 派生数据（directoryChanges、extensionData、
 *   historyOption 等），tab 接收即可，避免每个 tab 重复算或共享 mutable state。
 * - 各 tab 自己关心的 UI state（specialtyProbes / diagnosis / selectedDuplicates /
 *   largeFile* / probing / diagnosing）由 panel 持有并通过 props 传给 tab。
 */

import type { DiskDirectoryItem, DiskFilePreview, DiskSpecialtyProbe } from '@/types/electron';
import type { EChartsCoreOption } from 'echarts/core';
import type { UseDiskScanResult } from '../hooks/useDiskScan';

export type ActiveTab = 'overview' | 'browser' | 'analysis' | 'developer' | 'cleanup' | 'doctor';

/** panel 在顶层算好、tab 直接消费 */
export interface ScanSummary {
  extensionData: Array<[string, number]>;
  extensionOption: EChartsCoreOption;
  directoryData: ReturnType<typeof import('../DiskSpacePanel')['buildDirectoryTreeForTabs']> | unknown[];
  directoryOption: EChartsCoreOption;
  developerItems: UseDiskScanResult['directories'];
  cleanupItems: UseDiskScanResult['directories'];
  developerTotal: number;
  cleanupTotal: number;
  historyOption: EChartsCoreOption;
  visibleLargest: UseDiskScanResult['largest'];
  scannedExtensions: string[];
  selectedDuplicateBytes: number;
  cleanupAssessments: Array<{
    path: string;
    size: number;
    risk: '低风险' | '需要确认' | '仅建议检查';
    evidence: string;
  }>;
  directoryChanges: Array<{ path: string; size: number; change: number }>;
}

export type DirectoryChange = ScanSummary['directoryChanges'][number];

/** 共享 callbacks：openPreview / setPreview / setRunning 等 */
export interface ScanCallbacks {
  openPreview: (entry: DiskDirectoryItem) => Promise<void>;
  setPreview: (preview: DiskFilePreview | null) => void;
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setScanErrors: React.Dispatch<React.SetStateAction<UseDiskScanResult['scanErrors']>>;
  setDuplicates: React.Dispatch<React.SetStateAction<UseDiskScanResult['duplicates']>>;
  setEntries: (entries: DiskDirectoryItem[]) => void;
  setBrowserLoading: (loading: boolean) => void;
}
