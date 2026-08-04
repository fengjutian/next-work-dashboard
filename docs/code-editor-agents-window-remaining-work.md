# Code Editor Agents Window：未开发功能交接单

- 更新日期：2026-08-04
- 目标读者：接手开发的 DeepSeek / 其他代码 Agent
- 项目目录：`prompt-lab`
- 关联设计：`docs/code-editor-agents-window.md`

## 1. 开发前须知

以下能力已经实现，不要重复开发：Agents 三栏视图、会话新建/搜索/置顶/分叉/重命名/归档/恢复/删除、按会话保存对话/日志/候选、请求取消和重新运行、单文件及多文件 Diff 审阅、原子接受多文件、验证流水线、worktree 创建/查询/放弃、AI 在 worktree 中读取和写入、worktree 内验证、合并预检、squash 合并及成功后清理。

当前重要文件：

- `prompt-lab/src/plugins/code-editor/agents/AgentsWindow.tsx`：Agents UI。
- `prompt-lab/src/plugins/code-editor/CodeEditorWorkspaceController.tsx`：当前总编排层。
- `prompt-lab/src/plugins/code-editor/agents/useAgentSessions.ts`：会话持久化与操作。
- `prompt-lab/src/plugins/code-editor/agents/useAiSessionState.ts`：按会话保存 AI 状态和候选。
- `prompt-lab/src/plugins/code-editor/agents/useAiEditGeneration.ts`：模型请求与结果解析。
- `prompt-lab/src/main/agent-worktree.ts`：worktree 生命周期与安全合并。
- `prompt-lab/src/main/task-runner.ts`、`workspace-tasks.ts`：已有终端任务基础设施。
- `prompt-lab/src/main/ipc-handlers.ts`、`src/preload.ts`、`src/types/electron.d.ts`：IPC 契约。

不得削弱现有路径校验、工作区授权、原子事务、候选过期检查、主工作区干净检查和合并冲突保护。

## 2. P0：独立 Agent 任务执行器

### 目标

把 Agent 的长时间模型调用从 React 渲染进程迁移到主进程任务服务，为后台运行、队列、并发和重启恢复建立统一基础。

### 功能要求

1. 新建主进程 `AgentTaskService`，维护任务状态：`queued`、`running`、`cancelling`、`interrupted`、`failed`、`review`、`completed`。
2. 每个任务至少保存 `taskId`、`sessionId`、工作区、执行根目录、指令、模型配置快照、创建/开始/结束时间、进度、错误和恢复信息。
3. 提供创建、查询、列表、取消、重试和订阅进度的 IPC。
4. 主进程执行网络请求、上下文读取和结果流接收；渲染进程只提交任务及展示事件。
5. 任务结果必须写回正确会话，切换会话不能导致串写。
6. 关闭 Agents 页面后任务继续运行；关闭应用时将运行中任务持久化为可恢复状态。
7. 继续兼容现有单文件和多文件候选格式。

### 验收标准

- 切换页面或会话不终止任务，也不会串写结果。
- 取消在合理时间内生效，并产生最终状态事件。
- 同一任务的进度事件有严格递增序号，重复事件不会重复落库。
- 主进程异常或应用退出后，不把任务错误标成 completed。
- 为任务状态机、取消、重试、事件顺序和错误路径增加单元测试。

## 3. P0：任务队列与真正并行执行

### 功能要求

1. 支持配置全局并发上限，默认建议为 2。
2. 同一 worktree 同时只允许一个写任务；不同会话的独立 worktree 可以并行。
3. UI 展示排队序号、运行数量和取消排队任务入口。
4. 支持公平调度，避免某个工作区长期占满队列。
5. 验证任务与模型任务需明确资源关系；同一会话写入候选时不得同时合并或放弃 worktree。
6. 合并、放弃、归档和永久删除前检查关联任务状态。

### 验收标准

- 两个不同 worktree 会话可以同时运行并分别接收日志和候选。
- 超出并发上限的任务保持 queued，前序任务结束后自动启动。
- 同一会话不会发生并发写入和合并竞态。

## 4. P0：SQLite 持久化与重启恢复

### 功能要求

1. 将 Agent 会话、消息、日志、候选、任务和验证运行记录从 `localStorage` 迁移到 SQLite。
2. 大文本和候选内容避免全部加载到内存；支持分页读取消息和日志。
3. 提供一次性迁移：读取旧版本本地数据，成功写库后记录迁移版本；迁移失败保留旧数据。
4. 应用重启后恢复 queued 任务；原 running 任务转为 interrupted，并允许用户重试。
5. 恢复待审候选、验证配置、worktree 引用和最近执行指标。
6. 永久删除会话时清理关联数据；若存在 worktree，要求先确认清理策略。

### 验收标准

- 重启后会话、消息、日志、候选及 worktree 状态一致。
- 旧用户数据只迁移一次且无丢失。
- 大型会话不会触发 `localStorage` 容量错误。
- 数据库 schema 有版本号和升级测试。

## 5. P1：Token 预算与长会话管理

### 功能要求

1. 展示上下文估算 Token、输出 Token、预算上限和截断原因。
2. 支持按会话设置预算，并在发起请求前给出超限提示。
3. 对长会话生成结构化摘要，同时保留最近消息和关键文件引用。
4. 摘要需要可追踪来源，不能静默丢弃尚未完成的用户约束。
5. interrupted 任务可从保存的指令、上下文清单和阶段重新运行；不要求恢复网络流的字节级断点。

### 验收标准

- 达到预算时行为可预测：压缩、要求确认或阻止，不出现无提示截断。
- 压缩前后的关键约束有测试覆盖。

## 6. P1：可视化合并冲突解决

当前 Agent 合并在检测到重叠路径时直接阻止，尚未提供会话内冲突编辑。

### 功能要求

1. 预检展示基线、主分支版本、Agent 版本及冲突文件列表。
2. 复用现有 Merge Editor，支持 Current、Incoming、Both 和手工编辑 Result。
3. 支持 content、add/add、delete/modify、modify/delete 和 rename/rename。
4. 只有全部冲突解决且无冲突标记时才允许提交。
5. 用户取消时主工作区、索引和 worktree 必须保持可恢复状态。
6. 成功后仍执行 squash 提交和 worktree 清理；失败不得留下半合并状态。

### 验收标准

- 每类冲突有测试仓库用例。
- 合并取消、应用崩溃和提交失败都有恢复路径。
- 不允许使用会丢弃用户原有修改的强制 reset。

## 7. P1：远程交付与 Pull Request

### 功能要求

1. 合并到主工作区之外，增加“推送 Agent 分支”和“创建 Pull Request”交付方式。
2. 展示远程、目标分支、提交列表、变更摘要和验证结果。
3. 凭据必须复用安全凭据机制，禁止写入日志或数据库明文。
4. 推送前检查远程分支重名、非快进、无 upstream 和权限错误。
5. PR Provider 设计为适配器；首个实现可选 GitHub，但核心层不能硬编码单一平台。
6. 创建成功后保存 PR URL，并支持在系统浏览器打开。

### 验收标准

- 用户取消确认时不产生远程变更。
- 网络、权限和分支冲突错误有明确提示并可重试。

## 8. P2：容器、远程沙箱与外部 Agent Provider

### 功能要求

1. 定义执行环境接口：本地 worktree、容器、SSH/远程沙箱。
2. 接口覆盖文件读取、事务写入、命令运行、取消、日志流和清理。
3. 显示环境准备、运行、失联、清理失败等状态。
4. 定义外部 Agent Provider 接口，统一能力声明、模型选择、流式事件、取消和错误映射。
5. Provider 不得直接绕过候选审阅、路径授权和 worktree 合并流程。
6. 远程资源必须有超时和孤儿资源清理机制。

## 9. P1：集成测试与故障注入

至少补充以下 Electron 集成测试：

1. 创建会话 → 创建 worktree → 生成候选 → 原子接受 → 验证 → 合并。
2. 两个会话并行运行且结果不串写。
3. 运行中重启应用并恢复为 interrupted/queued。
4. 主工作区脏状态阻止合并。
5. 重叠路径阻止合并；可视化冲突功能完成后覆盖解决流程。
6. 合并提交失败后主工作区不处于半合并状态。
7. 删除、归档、放弃 worktree 与运行任务之间的竞态。
8. SQLite 旧数据迁移、schema 升级和大候选分页读取。

## 10. 推荐实施顺序

1. AgentTaskService 状态机和 IPC。
2. 将现有模型调用迁移到主进程。
3. SQLite schema、repository 和旧数据迁移。
4. 队列、并发限制及 UI。
5. 重启恢复和断点重试。
6. Token 预算与长会话压缩。
7. 可视化冲突解决。
8. 远程分支和 Pull Request。
9. 容器、远程沙箱和外部 Provider。
10. 补齐端到端故障注入测试。

每个批次都必须运行：

```powershell
npm run typecheck
npm run lint
npm run test
npm run check:ipc
npm run check:docs
npm run check:encoding
```

不要一次重写 `CodeEditorWorkspaceController.tsx`。优先把新能力做成独立 service、hook 和 repository，再逐步替换现有调用链，以降低回归风险。
