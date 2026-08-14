/**
 * ResearchDrawer — Research Mode 一站式研究 Drawer
 *
 * user-visible 完成：用户点 🔬 Research 按钮 → 弹 Drawer → 输主题 → 看实时进度 → 看报告
 */
import { Drawer, Input, Button, Space, Typography, Steps, Card, message, Tag, Spin, Select } from '../ui';
import { BookOpen, CheckCircle2, FileSearch, FlaskConical, FolderOpen, Globe2, Sparkles, FileText } from 'lucide-react';
import { useState } from 'react';
import { useResearch, type ResearchProgress } from '../hooks/useResearch';
import type { Workspace } from '../../../core/work-browser/types';

export interface ResearchDrawerProps {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  defaultWorkspaceId?: string;
  /** 预填主题（从 SearchBar 文本带入） */
  defaultTopic?: string;
  onCompleted?: (reportPath: string | undefined) => void;
}

const STAGE_LABELS: Record<ResearchProgress['stage'], string> = {
  'seed-query': '构造子查询',
  'multi-search': '多引擎搜索',
  'extract': '正文提取',
  'analyze': 'AI 聚合分析',
  'save': '保存报告',
  'done': '完成',
  'error': '出错',
};

const STAGE_ORDER: ResearchProgress['stage'][] = ['seed-query', 'multi-search', 'extract', 'analyze', 'save', 'done'];
const RESEARCH_FLOW = [
  { icon: FileSearch, label: '拆解问题' },
  { icon: Globe2, label: '多源搜索' },
  { icon: BookOpen, label: '阅读正文' },
  { icon: Sparkles, label: '综合分析' },
  { icon: CheckCircle2, label: '生成报告' },
];

export function ResearchDrawer({ open, onClose, workspaces, defaultWorkspaceId, defaultTopic, onCompleted }: ResearchDrawerProps) {
  const [topic, setTopic] = useState(defaultTopic || '');
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId || workspaces[0]?.id || '');
  const { loading, progress, result, error, run } = useResearch();

  const handleStart = async () => {
    if (!topic.trim()) { message.warning('请输入研究主题'); return; }
    if (!workspaceId) { message.warning('请选择 Workspace'); return; }
    const r = await run(topic.trim(), workspaceId);
    if (r) {
      message.success(`研究报告已生成（${r.took}ms）`);
      onCompleted?.(r.reportPath);
    }
  };

  const currentStep = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;

  return (
    <Drawer
      title={<Space><span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950"><FlaskConical size={16} /></span><span><span className="block text-sm">Research Mode</span><span className="block text-[10px] font-normal text-muted-foreground">多源检索 · AI 分析 · 可追溯报告</span></span></Space>}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      <div className="-m-5 min-h-full bg-gradient-to-b from-violet-50/70 via-background to-background p-5 dark:from-violet-950/20">
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card className="overflow-hidden border-violet-200/70 bg-card p-0 shadow-md dark:border-violet-900/60">
          <div className="border-b border-violet-100 bg-gradient-to-r from-violet-100/80 via-fuchsia-50 to-sky-50 px-6 py-5 dark:border-violet-900/50 dark:from-violet-950/50 dark:via-fuchsia-950/20 dark:to-sky-950/20">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-violet-700 shadow-sm dark:bg-slate-900"><Sparkles size={18}/></span><div><h2 className="text-lg font-semibold tracking-tight">今天想研究什么？</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">描述一个具体问题，系统会拆解子问题、交叉检索并生成带引用的报告。</p></div></div>
          </div>
          <Space direction="vertical" size={14} className="p-6" style={{ width: '100%' }}>
            <label className="space-y-2"><span className="text-xs font-semibold text-foreground">研究主题</span>
            <Input
              size="large"
              placeholder="例如：比较 Rust 主流异步运行时的性能、生态与适用场景"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onPressEnter={handleStart}
              disabled={loading}
              className="h-12 rounded-xl bg-background shadow-sm"
            /></label>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="space-y-2"><span className="flex items-center gap-1.5 text-xs font-semibold"><FolderOpen size={13} className="text-violet-600"/>保存到 Workspace</span><Select value={workspaceId} onChange={setWorkspaceId} options={workspaces.map(w => ({ value:w.id, label:`${w.icon || '🌊'} ${w.name}` }))} className="h-11 w-full min-w-64 rounded-xl" /></label><div className="rounded-xl bg-muted/60 px-4 py-2.5 text-[11px] leading-5 text-muted-foreground">报告与引用将自动归档<br/>方便后续继续研究</div></div>
            {!result && (
              <Button
                type="primary"
                size="large"
                icon={<Sparkles size={16} />}
                onClick={handleStart}
                loading={loading}
                disabled={!topic.trim() || !workspaceId}
                block className="h-12 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/15 hover:from-violet-500 hover:to-fuchsia-500"
              >
                开始研究
              </Button>
            )}
          </Space>
        </Card>

        {!loading && !progress && !result && !error && <section className="rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm"><div className="text-center"><div className="text-xs font-semibold uppercase tracking-[.18em] text-violet-600">从问题到结论</div><h3 className="mt-2 text-base font-semibold">一次完整的研究流程</h3></div><div className="mt-6 grid grid-cols-5 gap-2">{RESEARCH_FLOW.map(({ icon: Icon, label },index)=><div key={label} className="relative text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-violet-100 bg-violet-50 text-violet-600 dark:border-violet-900 dark:bg-violet-950"><Icon size={18}/></div><div className="mt-2 text-[11px] font-medium">{label}</div>{index<4&&<span className="absolute left-[65%] top-5 h-px w-[70%] bg-gradient-to-r from-violet-200 to-transparent dark:from-violet-800"/>}</div>)}</div><p className="mx-auto mt-6 max-w-md text-center text-xs leading-6 text-muted-foreground">建议使用清晰的问题句，并包含需要比较的对象、关注维度或时间范围。主题越具体，报告越有针对性。</p></section>}

        {(loading || progress) && (
          <Card className="rounded-2xl p-5" title={<Space><Spin size="small" /> <span>研究正在进行</span></Space>}>
            <Steps
              size="small"
              direction="vertical"
              current={currentStep < 0 ? 0 : currentStep}
              items={STAGE_ORDER.map((stage) => ({
                title: STAGE_LABELS[stage],
                description: progress?.stage === stage ? progress.message : '',
                status: progress?.stage === 'error' ? 'error' : progress?.stage === stage ? 'process' : currentStep > STAGE_ORDER.indexOf(stage) ? 'finish' : 'wait',
              }))}
            />
          </Card>
        )}

        {error && (
          <Card className="rounded-2xl border-red-200 bg-red-50/60 p-5 dark:bg-red-950/20">
            <Typography.Text type="danger">研究失败：{error}</Typography.Text>
          </Card>
        )}

        {result && (
          <>
            <Card
              className="rounded-2xl p-5"
              title={<Space><FileText size={14} /> 报告</Space>}
              extra={
                result.reportPath && (
                  <Tag color="green" icon={<Sparkles size={12} />}>已保存到 Workspace</Tag>
                )
              }
            >
              <pre className="m-0 max-h-[460px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-5 font-sans text-[13px] leading-7 text-foreground">
                {result.report}
              </pre>
            </Card>
            {result.citations.length > 0 && (
              <Card className="rounded-2xl p-5" title={`引用来源 · ${result.citations.length}`}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {result.citations.slice(0, 8).map((c, i) => (
                    <Typography.Text key={i} ellipsis style={{ width: '100%' }}>
                      <Tag>{i + 1}</Tag>
                      <Typography.Link href={c.url} target="_blank">{c.title}</Typography.Link>
                    </Typography.Text>
                  ))}
                </Space>
              </Card>
            )}
            <Space>
              <Button onClick={onClose}>关闭</Button>
            </Space>
          </>
        )}
      </Space></div>
    </Drawer>
  );
}
