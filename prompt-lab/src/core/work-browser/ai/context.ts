/**
 * AI Context — 上下文构建与切换
 *
 * 模式（PRD 第 28 节）：
 *  - current-page: 单页面（最简）
 *  - current-workspace: 当前 Workspace 内全部 Document/Note（默认）
 *  - all-library: 跨 Workspace 全库
 *  - specific-documents: 用户选中的若干 Document
 *
 * Phase 1 实现：把上下文打包为 messages 数组，附带引用标注。
 * RAG 集成留到 Phase 2（lancedb-memory + RAG-worker）。
 */
import type { AIContext, Document, Note, Task, Citation } from '../types';

export interface ContextBundle {
  systemPrompt: string;
  contextText: string;
  citations: Citation[];
}

const SYSTEM_HEADER = `你是 Work Browser 的 AI 助手，基于用户工作区内容回答。
规则：
- 引用事实时标注 [doc:n] 或 [note:n] 编号。
- 不要编造未在上下文中出现的事实。
- 简洁回答，给出可执行的下一步。`;

export function buildContextBundle(args: {
  context: AIContext;
  documents: Document[];
  notes: Note[];
  task: Task | null;
}): ContextBundle {
  const { context, documents, notes, task } = args;
  const citations: Citation[] = [];
  const docLines: string[] = [];
  const noteLines: string[] = [];

  documents.forEach((d, i) => {
    docLines.push(`[doc:${i + 1}] ${d.title}\nURL: ${d.url}\n${d.summary || ''}`);
    citations.push({ documentId: d.id, url: d.url, title: d.title, excerpt: (d.summary || '').slice(0, 200) });
  });
  notes.forEach((n, i) => {
    noteLines.push(`[note:${i + 1}] ${n.title}\n${(n.content || '').slice(0, 600)}`);
  });

  const parts: string[] = [];
  parts.push(SYSTEM_HEADER);
  parts.push(`\n## 上下文范围: ${context.scope}`);
  if (task) {
    parts.push(`\n## 当前任务\n- 标题: ${task.title}\n- 状态: ${task.status}\n- 描述: ${task.description}`);
  }
  if (docLines.length) parts.push(`\n## 文档\n${docLines.join('\n\n')}`);
  if (noteLines.length) parts.push(`\n## 笔记\n${noteLines.join('\n\n')}`);
  if (!docLines.length && !noteLines.length && !task) {
    parts.push('\n（当前上下文中没有内容，请用户提供更多信息。）');
  }

  return { systemPrompt: parts.join('\n'), contextText: parts.join('\n'), citations };
}
