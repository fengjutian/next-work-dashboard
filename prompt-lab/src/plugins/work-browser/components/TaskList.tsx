/**
 * TaskList — Workspace 内 Task 列表（按状态分组）
 */
import { Card, List, Tag, Space, Typography, Empty, Button, Tooltip, Progress, Drawer, Steps, Select, Input, message, Popconfirm, Alert } from 'antd';
import { Plus, ListTodo, ChevronRight, Play, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Task, TaskStatus, TaskStep, TaskStepStatus, WorkspaceId } from '../../../core/work-browser/types';
import { useTasks } from '../hooks/useTasks';

const STATUS_ORDER: TaskStatus[] = ['todo', 'investigating', 'testing', 'resolved', 'blocked'];
const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'default', investigating: 'processing', testing: 'warning', resolved: 'success', blocked: 'error',
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办', investigating: '调查中', testing: '测试中', resolved: '已解决', blocked: '阻塞',
};
const STEP_STATUS_LABEL: Record<TaskStepStatus, string> = {
  pending: '未开始', 'in-progress': '进行中', done: '完成', failed: '失败', skipped: '跳过',
};

export interface TaskListProps {
  workspaceId: string;
}

export function TaskList({ workspaceId }: TaskListProps) {
  const { tasks, loading, refresh, setStatus, updateStep, createFromTemplate, runAuto } = useTasks(workspaceId as WorkspaceId);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [tplId, setTplId] = useState('investigation');
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: tasks.filter((t) => t.status === status),
  }));

  const handleCreate = async () => {
    if (!tplId) return;
    const t = await createFromTemplate(tplId, newTitle.trim() || undefined);
    if (t) {
      message.success('已创建任务');
      setNewTitle(''); setCreating(false);
      setActiveTask(t as Task);
    }
  };

  const handleRunAuto = async (task: Task) => {
    if (runningTaskId) return;
    setRunningTaskId(task.id);
    const hide = message.loading(`AI 编排中：${task.title}…`, 0);
    try {
      const final = await runAuto(task.id);
      hide();
      if (final) {
        const doneCount = final.steps.filter((s) => s.status === 'done').length;
        message.success(`编排完成 · ${doneCount}/${final.steps.length} 步`);
        // 如果用户正在查看该 task drawer，同步刷新
        if (activeTask?.id === final.id) setActiveTask(final);
      }
    } catch (e) {
      hide();
      message.error(`编排失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningTaskId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong><ListTodo size={12} /> Tasks ({tasks.length})</Typography.Text>
          {!creating ? (
            <Button size="small" type="primary" icon={<Plus size={12} />} onClick={() => setCreating(true)}>新建</Button>
          ) : (
            <Space size={4}>
              <Select
                size="small"
                value={tplId}
                onChange={setTplId}
                options={[
                  { label: '通用排障', value: 'investigation' },
                  { label: '主题研究', value: 'research' },
                ]}
                style={{ width: 100 }}
              />
              <Input size="small" placeholder="标题（可选）" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ width: 140 }} />
              <Button size="small" type="primary" onClick={handleCreate}>建</Button>
              <Button size="small" onClick={() => setCreating(false)}>×</Button>
            </Space>
          )}
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {tasks.length === 0 && !loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有任务" />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {grouped.map((g) => g.items.length > 0 && (
              <div key={g.status}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {STATUS_LABEL[g.status]} ({g.items.length})
                </Typography.Text>
                <List
                  size="small"
                  dataSource={g.items}
                  renderItem={(t) => (
                    <TaskCard
                      task={t}
                      running={runningTaskId === t.id}
                      onOpen={() => setActiveTask(t)}
                      onRunAuto={() => void handleRunAuto(t)}
                    />
                  )}
                />
              </div>
            ))}
          </Space>
        )}
      </div>
      <Drawer
        title={activeTask?.title || ''}
        open={!!activeTask}
        onClose={() => setActiveTask(null)}
        width={560}
        destroyOnClose
      >
        {activeTask && (
          <TaskDetail
            task={activeTask}
            running={runningTaskId === activeTask.id}
            onRunAuto={() => void handleRunAuto(activeTask)}
            onSetStatus={(s) => { void setStatus(activeTask, s); setActiveTask({ ...activeTask, status: s }); }}
            onUpdateStep={(stepId, patch) => {
              void updateStep(activeTask, stepId, patch);
              setActiveTask({
                ...activeTask,
                steps: activeTask.steps.map((s) => s.id === stepId ? { ...s, ...patch } : s),
              });
            }}
            onRefresh={() => { void refresh(); void setActiveTask(null); }}
          />
        )}
      </Drawer>
    </div>
  );
}

function TaskCard({ task, onOpen, onRunAuto, running }: {
  task: Task;
  onOpen: () => void;
  onRunAuto: () => void;
  running: boolean;
}) {
  const done = task.steps.filter((s) => s.status === 'done').length;
  const total = task.steps.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Card
      size="small"
      hoverable
      onClick={onOpen}
      style={{ marginTop: 4 }}
      bodyStyle={{ padding: 8 }}
    >
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong style={{ flex: 1, fontSize: 13 }} ellipsis>{task.title}</Typography.Text>
          <Tag color={STATUS_COLOR[task.status]} style={{ fontSize: 10, margin: 0 }}>
            {STATUS_LABEL[task.status]}
          </Tag>
        </Space>
        <Progress percent={percent} size="small" showInfo={false} status={running ? 'active' : 'normal'} />
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary" style={{ fontSize: 10 }}>
            {done}/{total} 步 · {task.aiGenerated ? 'AI 生成' : '手动'}
          </Typography.Text>
          <Popconfirm
            title="AI 自动编排此任务？"
            description="会用 LLM 总结 + 搜索引擎 + RAG 跑完所有 step（可能 30s~1min）"
            onConfirm={(e) => { e?.stopPropagation(); onRunAuto(); }}
            onCancel={(e) => e?.stopPropagation()}
            okText="开始"
            cancelText="取消"
            disabled={running || task.status === 'resolved'}
          >
            <Button
              size="small"
              type="primary"
              icon={running ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
              disabled={running || task.status === 'resolved'}
              onClick={(e) => e.stopPropagation()}
            >
              {running ? '跑中' : 'Run Auto'}
            </Button>
          </Popconfirm>
        </Space>
      </Space>
    </Card>
  );
}

function TaskDetail({ task, onSetStatus, onUpdateStep, onRefresh, onRunAuto, running }: {
  task: Task;
  onSetStatus: (s: TaskStatus) => void;
  onUpdateStep: (stepId: string, patch: { status?: TaskStepStatus; result?: string; evidence?: string }) => void;
  onRefresh: () => void;
  onRunAuto: () => void;
  running: boolean;
}) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" style={{ background: '#fafafa' }}>
        <Typography.Paragraph style={{ marginBottom: 8 }}>{task.description}</Typography.Paragraph>
        <Space wrap>
          {STATUS_ORDER.map((s) => (
            <Tag.CheckableTag
              key={s}
              checked={task.status === s}
              onChange={() => onSetStatus(s)}
            >
              {STATUS_LABEL[s]}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>
      <Popconfirm
        title="AI 自动编排此任务？"
        description="会用 LLM 总结 + 搜索引擎 + RAG 跑完所有 step"
        onConfirm={onRunAuto}
        okText="开始"
        cancelText="取消"
        disabled={running || task.status === 'resolved'}
      >
        <Button block type="primary" icon={running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} disabled={running || task.status === 'resolved'}>
          {running ? 'AI 编排中…' : '▶ Run Auto · AI 编排所有 step'}
        </Button>
      </Popconfirm>
      {running && (
        <Alert type="info" showIcon message="AI 正在调用搜索 / RAG 填入每个 step，可在卡片步骤里查看实时进度（每次 step 完成后会自动落库）" />
      )}
      <div>
        <Typography.Text strong>步骤</Typography.Text>
        <Steps
          size="small"
          direction="vertical"
          current={task.steps.findIndex((s) => s.status !== 'done' && s.status !== 'skipped')}
          style={{ marginTop: 8 }}
          items={task.steps.map((step) => ({
            title: (
              <Space>
                <span>{step.title}</span>
                <Tag style={{ fontSize: 10 }}>{STEP_STATUS_LABEL[step.status]}</Tag>
              </Space>
            ),
            description: <StepEditor step={step} onChange={(patch) => onUpdateStep(step.id, patch)} />,
            status: step.status === 'done' ? 'finish' : step.status === 'failed' ? 'error' : step.status === 'in-progress' ? 'process' : 'wait',
          }))}
        />
      </div>
      <Button block onClick={onRefresh}>刷新</Button>
    </Space>
  );
}

function StepEditor({ step, onChange }: { step: TaskStep; onChange: (patch: { status?: TaskStepStatus; result?: string; evidence?: string }) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>{step.description}</Typography.Paragraph>
      <Space wrap size={4} style={{ marginBottom: 4 }}>
        {(['pending', 'in-progress', 'done', 'failed', 'skipped'] as TaskStepStatus[]).map((s) => (
          <Tag.CheckableTag
            key={s}
            checked={step.status === s}
            onChange={() => onChange({ status: s })}
            style={{ fontSize: 10 }}
          >
            {STEP_STATUS_LABEL[s]}
          </Tag.CheckableTag>
        ))}
        <Tooltip title="展开填入证据 / 结果">
          <Button size="small" type="text" icon={<ChevronRight size={12} />} onClick={() => setExpanded((e) => !e)} />
        </Tooltip>
      </Space>
      {expanded && (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Input.TextArea
            placeholder="证据（文档/笔记/命令输出…）"
            value={step.evidence}
            onChange={(e) => onChange({ evidence: e.target.value })}
            rows={2}
          />
          <Input.TextArea
            placeholder="结果 / 备注"
            value={step.result || ''}
            onChange={(e) => onChange({ result: e.target.value })}
            rows={2}
          />
        </Space>
      )}
    </div>
  );
}
