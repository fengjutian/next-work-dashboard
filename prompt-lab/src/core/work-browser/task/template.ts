/**
 * Task 模板（PRD 第 8 / 9 节：排障任务）
 *
 * 每个模板定义一组 steps，AI Runner 按顺序/并行执行。
 * Phase 1 提供"通用排障"模板作为示例；用户可扩展。
 */
import { newId, now, type TaskStep, type TaskStepId, type Task, type WorkspaceId, type TaskId } from '../types';

export interface TaskStepTemplate {
  id: string; // 模板内唯一
  title: string;
  description: string;
  /** 'sequential' 表示等上一步 done；'parallel' 与同组并行。 */
  parallel?: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  steps: TaskStepTemplate[];
}

export const INVESTIGATION_TEMPLATE: TaskTemplate = {
  id: 'investigation',
  name: '通用排障',
  description: '收集症状 → 检索相似案例 → 列出假设 → 收集证据 → 给出方案',
  steps: [
    { id: 'collect-symptoms', title: '收集症状', description: '记录错误码、日志、复现条件' },
    { id: 'search-cases', title: '检索相似案例', description: '多引擎搜索错误码 / 关键词', parallel: true },
    { id: 'list-hypotheses', title: '列出假设', description: '按可能性从高到低排列根因' },
    { id: 'collect-evidence', title: '收集证据', description: '从 Workspace 文档、笔记、命令输出取证' },
    { id: 'propose-fix', title: '给出方案', description: '最小变更验证步骤 + 回滚预案' },
  ],
};

export const RESEARCH_TEMPLATE: TaskTemplate = {
  id: 'research',
  name: '主题研究',
  description: '搜索 → 净化 → 摘要 → 聚合 → 报告',
  steps: [
    { id: 'seed-query', title: '构造查询', description: '基于主题拆出 3–5 个角度的子查询' },
    { id: 'multi-search', title: '多引擎搜索', description: '并行跑 4 个 provider', parallel: true },
    { id: 'extract', title: '正文提取', description: '对 top 结果做 Readability 净化' },
    { id: 'analyze', title: 'AI 聚合分析', description: '生成核心结论 / 争议 / 推荐阅读' },
    { id: 'report', title: '输出报告', description: '写入 Research Report 文档' },
  ],
};

export const ALL_TEMPLATES: TaskTemplate[] = [INVESTIGATION_TEMPLATE, RESEARCH_TEMPLATE];

export function instantiateTask(workspaceId: WorkspaceId, template: TaskTemplate, title?: string): Task {
  const taskId = newId<TaskId>();
  const t = now();
  return {
    id: taskId,
    workspaceId,
    title: title || `${template.name} · ${new Date().toLocaleString('zh-CN')}`,
    description: template.description,
    status: 'todo',
    relatedDocumentIds: [],
    relatedTabIds: [],
    relatedNoteIds: [],
    steps: template.steps.map<TaskStep>((s) => ({
      id: newId<TaskStepId>(),
      title: s.title,
      description: s.description,
      status: 'pending',
      evidence: '',
      result: null,
    })),
    aiGenerated: true,
    createdAt: t,
    updatedAt: t,
    resolvedAt: null,
  };
}

export function nextStepIndex(task: Task): number {
  return task.steps.findIndex((s) => s.status === 'pending' || s.status === 'in-progress');
}
