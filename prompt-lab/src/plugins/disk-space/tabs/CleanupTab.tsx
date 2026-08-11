import type { CleanupStatus } from '../hooks/useDiskScan';
import { FolderOpen, Loader2 } from '@/components/icons';
import type { UseDiskScanResult } from '../hooks/useDiskScan';
import { displayPath } from '../hooks/useDiskScan';
import { formatBytes } from './helpers';

/**
 * CleanupTab — 清理建议：官方清理动作（白名单）+ 候选风险评估。
 *
 * 状态机基于 CleanupStatus 状态机（替代原 /清理完成$/ error 字符串匹配）。
 */

export interface CleanupTabProps {
  scan: UseDiskScanResult;
  cleanupItems: UseDiskScanResult['directories'];
  cleanupTotal: number;
  cleanupAssessments: Array<{ path: string; size: number; risk: '低风险' | '需要确认' | '仅建议检查'; evidence: string }>;
  isFocusedTab: boolean;
  cleanupStatus: CleanupStatus;
  runCleanup: (action: 'docker-build-cache' | 'npm-cache' | 'pnpm-store') => Promise<void>;
  clearCleanupStatus: () => void;
  start: (focusedScan: boolean) => Promise<void>;
  pickRoot: () => Promise<void>;
}

export function CleanupTab(props: CleanupTabProps) {
  const { scan, cleanupItems, cleanupTotal, cleanupAssessments, isFocusedTab, cleanupStatus, runCleanup, clearCleanupStatus, start, pickRoot } = props;
  const { root, stats, running } = scan;

  return (
    <>
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="font-medium">官方清理动作</h2>
        <p className="mt-1 text-xs text-muted-foreground">每次执行都会显示系统确认框、实际命令和影响说明</p>
        {cleanupStatus.kind === 'running' && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4" />清理中…
          </div>
        )}
        {cleanupStatus.kind === 'success' && (
          <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            清理完成：{cleanupStatus.message}
          </div>
        )}
        {cleanupStatus.kind === 'error' && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            清理失败：{cleanupStatus.message}
            <button className="ml-2 underline" onClick={clearCleanupStatus}>关闭</button>
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {([['docker-build-cache', 'Docker Build Cache', '需要确认'], ['npm-cache', 'npm 缓存', '低风险'], ['pnpm-store', 'pnpm Store', '低风险']] as const).map(([action, label, risk]) => (
            <div key={action} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{risk}</span>
              </div>
              <button
                className="mt-4 w-full rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                disabled={cleanupStatus.kind === 'running'}
                onClick={() => void runCleanup(action)}
              >
                {cleanupStatus.kind === 'running' && cleanupStatus.action === action ? '执行中…' : '查看影响并执行'}
              </button>
            </div>
          ))}
        </div>
      </section>
      {cleanupAssessments.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-3">
            <h2 className="font-medium">候选风险与识别依据</h2>
            <p className="text-xs text-muted-foreground">路径扫描仅用于建议；文件夹不会在此处直接删除</p>
          </div>
          {cleanupAssessments.map((item) => (
            <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-3 border-b px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs" title={displayPath(item.path)}>
                  {displayPath(item.path)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{item.evidence}</p>
              </div>
              <span className="text-right text-sm font-medium">{formatBytes(item.size)}</span>
              <span className={`text-right text-xs font-medium ${
                item.risk === '低风险' ? 'text-emerald-700' : item.risk === '需要确认' ? 'text-amber-700' : 'text-red-700'
              }`}>
                {item.risk}
              </span>
            </div>
          ))}
        </section>
      )}
      {stats.files > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">识别容量</p>
            <p className="mt-1 text-2xl font-semibold">{formatBytes(cleanupTotal)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">候选目录</p>
            <p className="mt-1 text-2xl font-semibold">{cleanupItems.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">风险策略</p>
            <p className="mt-1 text-base font-semibold">全部需要人工确认</p>
          </div>
        </section>
      )}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">可清理候选项</h2>
            <p className="mt-1 text-sm text-muted-foreground">仅提供检查建议，不会自动删除任何文件。</p>
          </div>
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!root || running}
            onClick={() => void start(isFocusedTab)}
          >
            {stats.files ? '重新扫描' : '开始扫描'}
          </button>
        </div>
        {!root && (
          <button
            className="mt-5 flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => void pickRoot()}
          >
            <FolderOpen className="h-4 w-4" />选择分析目录
          </button>
        )}
        <div className="mt-5 space-y-2">
          {cleanupItems.map((item) => (
            <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 rounded-lg border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{displayPath(item.path)}</p>
              </div>
              <span className="text-right font-medium tabular-nums">{formatBytes(item.size)}</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700">需要确认</span>
            </div>
          ))}
          {stats.files > 0 && cleanupItems.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">当前扫描范围内未发现匹配项</div>
          )}
          {stats.files === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">选择目录并扫描后生成分析结果</div>
          )}
        </div>
      </section>
    </>
  );
}
