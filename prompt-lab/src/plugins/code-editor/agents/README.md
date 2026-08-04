# Code Editor Agents

该目录封装代码编辑器的 Agents 功能。目录外模块应优先从 `index.ts` 引用公开 API。

- `AgentsWindow.tsx`：Agents 三栏界面。
- `agent-sessions.ts`、`useAgentSessions.ts`：会话模型与持久化。
- `agent-edit-scope.ts`：工作区、目录和文件作用范围。
- `ai-context.ts`、`ai-token-budget.ts`：上下文与 Token 预算。
- `ai-conversation.ts`、`useAiSessionState.ts`：对话、候选和请求状态。
- `useAiEditGeneration.ts`：Agent 任务生成与主进程任务调用。
- `useAiProposalReview.ts`、`ai-proposal-summary.ts`：候选审阅和变更摘要。

通用编辑器类型、Diff、Explorer 和 Git 能力仍位于父目录，避免 Agents 模块反向承载编辑器基础设施。
