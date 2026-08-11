/**
 * ResearchDrawer — Research Mode 一站式研究 Drawer
 *
 * user-visible 完成：用户点 🔬 Research 按钮 → 弹 Drawer → 输主题 → 看实时进度 → 看报告
 */
import { Drawer, Input, Button, Space, Typography, Steps, Card, message, Tag, Spin, Select } from '../ui';
import { FlaskConical, Sparkles, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { useResearch, type ResearchProgress } from '../hooks/useResearch';
import type { Workspace } from '../../../core/work-browser/types';
import { AiSummaryCard } from './AiSummary';

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
      title={<Space><FlaskConical size={18} /> Research Mode</Space>}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small" style={{ background: '#fafbff', borderColor: '#d6e4ff' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text strong>📚 主题</Typography.Text>
            <Input
              size="large"
              placeholder="例如：ClickHouse 内存优化 / Rust 异步运行时对比 / WebGPU 落地状态"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onPressEnter={handleStart}
              disabled={loading}
            />
            <Space>
              <Typography.Text strong>📁 Workspace</Typography.Text>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                disabled={loading}
                style={{ padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 4, minWidth: 200 }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.icon || '🌊'} {w.name}</option>
                ))}
              </select>
            </Space>
            {!result && (
              <Button
                type="primary"
                size="large"
                icon={<Sparkles size={16} />}
                onClick={handleStart}
                loading={loading}
                disabled={!topic.trim() || !workspaceId}
                block
              >
                开始研究
              </Button>
            )}
          </Space>
        </Card>

        {(loading || progress) && (
          <Card size="small" title={<Space><Spin size="small" /> 研究进度</Space>}>
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
          <Card size="small" style={{ borderColor: '#ffccc7' }}>
            <Typography.Text type="danger">研究失败：{error}</Typography.Text>
          </Card>
        )}

        {result && (
          <>
            <Card
              size="small"
              title={<Space><FileText size={14} /> 报告</Space>}
              extra={
                result.reportPath && (
                  <Tag color="green" icon={<Sparkles size={12} />}>已保存到 Workspace</Tag>
                )
              }
            >
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 400,
                overflow: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                margin: 0,
                padding: 12,
                background: '#fafafa',
                borderRadius: 4,
              }}>
                {result.report}
              </pre>
            </Card>
            {result.citations.length > 0 && (
              <Card size="small" title={`📎 引用来源 (${result.citations.length})`}>
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
      </Space>
    </Drawer>
  );
}
