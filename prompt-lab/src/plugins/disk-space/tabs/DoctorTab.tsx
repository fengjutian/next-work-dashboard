import { XMarkdown } from '@ant-design/x-markdown';
import type { UseDiskScanResult } from '../hooks/useDiskScan';
import { displayPath } from '../hooks/useDiskScan';
import { EmptyState } from './components';
import { formatBytes } from './helpers';
import type { DirectoryChange } from './shared';

/**
 * DoctorTab — AI 磁盘医生：基于扫描证据生成诊断 + 报告导出。
 *
 * diagnosis 文本由 panel 持有（跨 tab 切换仍保留）；generateDiagnosis 由 panel
 * 提供，因为要串起 stats / largest / directoryChanges / cleanupItems 多个数据源。
 */

export interface DoctorTabProps {
  scan: UseDiskScanResult;
  diagnosis: string;
  setDiagnosis: (text: string) => void;
  diagnosing: boolean;
  setDiagnosing: (value: boolean) => void;
  generateDiagnosis: () => Promise<void>;
  exportScanReport: () => Promise<void>;
  directoryChanges: DirectoryChange[];
  cleanupTotal: number;
}

export function DoctorTab(props: DoctorTabProps) {
  const { scan, diagnosis, setDiagnosis, diagnosing, setDiagnosing, generateDiagnosis, exportScanReport, directoryChanges, cleanupTotal } = props;
  const { stats, duplicates } = scan;
  const duplicateReclaimable = duplicates.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0);
  void setDiagnosis; void setDiagnosing; // 留作扩展（手动中止诊断等）
  void directoryChanges; void displayPath; // 当前未在 JSX 直接用

  return (
    <>
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">AI 磁盘医生</h2>
            <p className="mt-1 text-sm text-muted-foreground">只发送容量、路径和变化摘要，不读取或上传文件内容</p>
          </div>
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={diagnosing || stats.files === 0}
            onClick={() => void generateDiagnosis()}
          >
            {diagnosing ? '正在诊断…' : '生成诊断报告'}
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">扫描容量</p>
            <p className="mt-1 font-semibold">{formatBytes(stats.bytes)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">增长来源</p>
            <p className="mt-1 font-semibold">{directoryChanges.filter((item) => item.change > 0).length}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">清理候选</p>
            <p className="mt-1 font-semibold">{formatBytes(cleanupTotal)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">重复可释放</p>
            <p className="mt-1 font-semibold">{formatBytes(duplicateReclaimable)}</p>
          </div>
        </div>
        <div className="mt-5 min-h-[300px] rounded-lg border bg-background p-5">
          {diagnosis ? (
            <XMarkdown content={diagnosis} className="chat-markdown prose prose-sm max-w-none dark:prose-invert" />
          ) : (
            <EmptyState>
              {stats.files ? '点击"生成诊断报告"，分析结果将引用真实扫描证据' : '请先在空间分析中完成一次扫描'}
            </EmptyState>
          )}
        </div>
      </section>
      {stats.files > 0 && (
        <div className="flex justify-end gap-2">
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => void exportScanReport()}>
            导出扫描报告
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            disabled={!diagnosis}
            onClick={() => void window.electronAPI.saveFile(diagnosis, `磁盘医生-${new Date().toISOString().slice(0, 10)}.md`)}
          >
            导出诊断 Markdown
          </button>
        </div>
      )}
    </>
  );
}
