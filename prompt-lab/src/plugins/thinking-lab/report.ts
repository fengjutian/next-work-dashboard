import { FRAMEWORK_BY_ID } from './framework-registry';
import type { ThinkingRun } from './thinking-types';

export function buildThinkingReport(run: ThinkingRun): string {
  const frameworks = run.results.map((result) => {
    const name = FRAMEWORK_BY_ID.get(result.frameworkId)?.name ?? result.frameworkId;
    return `## ${name}\n\n${result.content || result.error || '无结果'}`;
  }).join('\n\n---\n\n');
  return `# 战略分析报告\n\n- 生成时间：${new Date(run.createdAt).toLocaleString('zh-CN')}\n- 模型：${run.model}\n- 模式：${run.mode}\n- 框架：${run.frameworkIds.map((id) => FRAMEWORK_BY_ID.get(id)?.name ?? id).join('、')}\n\n## 问题\n\n${run.question}\n\n## 背景与约束\n\n${run.context || '无'}\n\n${frameworks}\n\n# 交叉质询\n\n${run.critique || '当前模式未执行交叉质询'}\n\n# 委员会综合结论\n\n${run.synthesis || '无'}\n`;
}

export function downloadMarkdown(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
