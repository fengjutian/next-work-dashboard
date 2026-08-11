import type { DiskSpecialtyProbe } from '@/types/electron';
import { FolderOpen } from '@/components/icons';
import type { UseDiskScanResult } from '../hooks/useDiskScan';
import { displayPath } from '../hooks/useDiskScan';
import { formatBytes } from './helpers';

/**
 * DeveloperTab — 开发者空间：specialty probes + 开发环境候选项。
 *
 * 包含：
 * - 专项环境探测（Docker / WSL / Ollama / 工具链）
 * - 识别容量 + 候选目录 + 风险策略（仅只读分析）
 * - 选目录 / 重新扫描
 */

export interface DeveloperTabProps {
  scan: UseDiskScanResult;
  developerItems: UseDiskScanResult['directories'];
  developerTotal: number;
  isFocusedTab: boolean;
  specialtyProbes: DiskSpecialtyProbe[];
  probing: boolean;
  setSpecialtyProbes: (probes: DiskSpecialtyProbe[]) => void;
  setProbing: (probing: boolean) => void;
  start: (focusedScan: boolean) => Promise<void>;
  choose: () => Promise<void>;
}

export function DeveloperTab(props: DeveloperTabProps) {
  const { scan, developerItems, developerTotal, isFocusedTab, specialtyProbes, probing, setSpecialtyProbes, setProbing, start, choose } = props;
  const { root, stats, running } = scan;

  return (
    <>
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">专项环境探测</h2>
            <p className="text-xs text-muted-foreground">调用只读官方命令，不修改 Docker、WSL 或开发工具数据</p>
          </div>
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            disabled={probing}
            onClick={() => setSpecialtyProbes([])}
          >
            {probing ? '探测中…' : '重新探测'}
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {specialtyProbes.map((probe) => (
            <details key={probe.id} className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {probe.label}
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    probe.available ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {probe.available ? '已检测' : '未检测'}
                </span>
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">{probe.summary}</p>
              {probe.details.length > 0 && (
                <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs">
                  {probe.details.join('\n')}
                </pre>
              )}
            </details>
          ))}
        </div>
      </section>
      {stats.files > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">识别容量</p>
            <p className="mt-1 text-2xl font-semibold">{formatBytes(developerTotal)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">候选目录</p>
            <p className="mt-1 text-2xl font-semibold">{developerItems.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">风险策略</p>
            <p className="mt-1 text-base font-semibold">只读分析</p>
          </div>
        </section>
      )}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">开发环境占用</h2>
            <p className="mt-1 text-sm text-muted-foreground">根据 Rust 扫描结果识别常见开发工具、缓存和构建产物。</p>
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
            onClick={() => void choose()}
          >
            <FolderOpen className="h-4 w-4" />选择分析目录
          </button>
        )}
        <div className="mt-5 space-y-2">
          {developerItems.map((item) => (
            <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 rounded-lg border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{displayPath(item.path).split(/[\\/]/).filter(Boolean).at(-1)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{displayPath(item.path)}</p>
              </div>
              <span className="text-right font-medium tabular-nums">{formatBytes(item.size)}</span>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">开发资源</span>
            </div>
          ))}
          {stats.files > 0 && developerItems.length === 0 && (
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
