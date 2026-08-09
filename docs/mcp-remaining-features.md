---
layout: default
title: "MCP 未完成功能与后续开发计划"
---

# MCP 未完成功能与后续开发计划

## 1. 文档目的

本文记录 AI 对话模块 MCP 集成的当前边界、尚未实现的能力、建议优先级和验收标准，供后续开发、评审和版本规划使用。

## 2. 当前已经完成

当前实现已经覆盖 MCP 工具调用的基础闭环：

- 支持本地 stdio MCP Server。
- 支持远程 Streamable HTTP MCP Server。
- 支持 Server 配置持久化、连接、断开、删除和自动连接。
- 支持发现 MCP tools，并转换为现有 Agent `ToolDefinition`。
- MCP 工具可参与 AI 对话的 function-calling 循环。
- 工具使用 `mcp__server__tool` 命名空间，避免重名。
- 支持嵌套 JSON Schema 参数。
- 支持工具级启用和禁用。
- 支持 MCP annotations 风险提示。
- 支持应用内调用审批，包括仅本次、本会话和永久授权。
- 破坏性工具每次都必须审批。
- 支持成功、失败和拒绝状态的 JSONL 审计。
- Bearer Token 使用 Electron `safeStorage` 加密保存。
- HTTP Header 和 stdio 环境变量支持 `${secret:name}` 引用。
- 远程地址默认强制 HTTPS，仅回环地址允许 HTTP。
- 支持连接超时、调用超时和应用退出时关闭连接。
- 已纳入 typecheck、lint、test、IPC、Markdown 和 UTF-8 质量门禁。

相关实现位于：

- `prompt-lab/src/main/mcp/mcp-manager.ts`
- `prompt-lab/src/main/mcp/mcp-config.ts`
- `prompt-lab/src/core/tools/mcp-tools.ts`
- `prompt-lab/src/services/mcp-approval.ts`
- `prompt-lab/src/plugins/chat/McpApprovalDialog.tsx`
- `prompt-lab/src/plugins/chat/ToolManagerDialog.tsx`
- `prompt-lab/src/types/mcp.ts`

## 3. P0：建议优先完成

### 3.1 MCP Resources

当前只消费 tools，尚未接入 resources。

需要实现：

- 调用 `resources/list` 并处理分页。
- 调用 `resources/read`。
- 支持 resource templates 和参数填写。
- 展示 URI、名称、MIME 类型、Server 来源和描述。
- 文本资源可插入当前对话上下文。
- 图片及二进制资源可转换为对话附件。
- Markdown 资源可导入知识工作区。
- 导入知识工作区时保留 MCP URI、Server 和读取时间等来源信息。
- 对资源内容应用大小限制和不可信内容标记。

验收标准：

- 用户能在 AI 对话中浏览已连接 Server 的资源。
- 用户能把文本资源添加到当前消息。
- 用户能把 Markdown 资源作为可审查变更导入知识工作区。
- 超大资源不会直接进入模型上下文。
- 资源读取错误可见且不会中断整个对话。

### 3.2 多模态工具结果

当前 MCP 工具结果主要被序列化为文本，尚未完整利用 MCP content 类型。

需要实现：

- 原生解析 `text`、`image`、`audio`、`resource` 和 `resource_link`。
- 保留并展示 `structuredContent`。
- 图片显示缩略图并支持查看原图。
- 音频提供受控播放入口。
- resource link 支持查看详情和按需读取。
- ToolCallCard 展示结果类型、大小、来源和错误。
- 对未知 content 类型安全降级为 JSON 摘要。
- 对单次结果和单个内容块设置大小上限。

验收标准：

- 图片结果不再显示成 JSON 字符串。
- structured content 可以折叠查看。
- 大型结果不会造成界面卡顿或上下文爆炸。
- 所有结果保留 Server、工具和调用审计关联。

### 3.3 会话级 MCP 选择

当前已连接的 MCP 工具会进入全局工具注册表，缺少对话隔离。

需要实现：

- 每个会话保存启用的 MCP Server 和工具集合。
- 新建会话可继承默认策略，但之后独立修改。
- Agent 只向模型发送当前会话启用的工具 Schema。
- 会话切换时立即刷新可用工具。
- 对不存在或已经断开的工具显示降级状态。
- 导出会话时记录 MCP 能力快照，但不得包含密钥。

验收标准：

- 不同对话可以启用不同 MCP Server。
- 未选择的工具不会发送给模型，也不能被执行。
- 断开 Server 不会破坏历史消息显示。
- 会话恢复后可以还原工具选择。

## 4. P1：重要增强

### 4.1 MCP Prompts

需要实现：

- 调用 `prompts/list` 和 `prompts/get`。
- 在现有提示词管理器中按 MCP Server 分组。
- 根据参数定义生成填写表单。
- 支持插入输入框、直接发送或绑定到会话。
- 标注远程来源，避免与本地提示词混淆。
- Server 断开后保留名称但禁止执行。

验收标准：

- 用户可以发现、填写并运行 MCP Prompt。
- 参数校验错误在发送前显示。
- MCP Prompt 不会被误保存成本地原创内容。

### 4.2 动态能力刷新

需要监听：

- `notifications/tools/list_changed`
- `notifications/resources/list_changed`
- `notifications/prompts/list_changed`

需要实现：

- 收到通知后防抖刷新对应列表。
- 新增工具自动进入管理器但遵循默认禁用或审批策略。
- 移除工具后从 Agent Schema 中删除。
- 刷新失败时保留最后一次有效快照。
- UI 显示最近同步时间和同步错误。

验收标准：

- Server 修改工具列表后无需重新连接。
- 正在执行的调用不受列表刷新影响。
- 列表变化不会重置用户的工具启用状态。

### 4.3 HTTP 认证增强

当前支持加密保存的 Bearer Token，但尚未完成完整 OAuth。

需要实现：

- OAuth 2.1 Authorization Code + PKCE。
- 浏览器授权回调和状态校验。
- Token 刷新、过期检测和 401 后重新授权。
- OAuth Client Metadata 管理。
- 自定义 Header 编辑器，值可引用安全凭据。
- 企业代理和自定义 CA 的受控配置。
- 登录、登出和撤销凭据。

验收标准：

- OAuth Token 不进入普通配置、日志或 renderer 持久化状态。
- Token 到期后可以安全刷新。
- state、redirect URI 和 PKCE 校验完整。
- 授权失败不会无限重试。

### 4.4 真实 MCP 集成测试

当前主要是适配器和配置单元测试，缺少真实协议往返测试。

需要增加本地 fixture Server，覆盖：

- stdio 启动、握手、工具发现、调用和退出。
- Streamable HTTP 初始化和 Session。
- Bearer Header 注入。
- 分页工具列表。
- 工具调用超时和取消。
- Server 异常退出与状态更新。
- list_changed 通知。
- resource、prompt、图片和 structured content 返回。
- 应用退出后的进程清理。

验收标准：

- CI 中不依赖公网即可完成 MCP 集成测试。
- fixture 能模拟错误、超时、分页和断线。
- 测试结束后无残留子进程或监听端口。

## 5. P2：安全、治理与运维

### 5.1 审计增强

需要实现：

- 按 Server、工具、时间、状态筛选。
- 查看完整参数、结果和审批决定。
- JSONL 导出。
- 日志自动轮转和容量上限。
- Token、密码、Cookie、Authorization 等字段自动脱敏。
- 审计记录关联会话 ID、消息 ID 和 tool call ID。
- 对日志损坏进行逐行容错和修复提示。

### 5.2 stdio 安全隔离

需要实现：

- 命令允许列表或首次启动审批。
- cwd 限制在用户授权目录内。
- 环境变量允许列表。
- 禁止 shell 拼接，继续使用 command + args。
- 子进程并发、内存和运行时间限制。
- Server stderr 大小限制和脱敏。
- 异常退出频率限制，避免重启风暴。

### 5.3 HTTP 网络安全

需要实现：

- Server 域名允许列表。
- DNS 重绑定和回环地址变化防护。
- 重定向策略限制。
- TLS 证书错误默认拒绝。
- 请求 Header 允许列表。
- 上传内容大小和响应大小限制。
- 明确区分受信任内网与开放互联网 Server。

### 5.4 Prompt Injection 防护

需要实现：

- 将 MCP 外部资源和 open-world 输出标记为不可信。
- 在 Agent system prompt 中声明外部内容不能覆盖系统和用户授权。
- 当会话同时具备私有数据读取与外部写入能力时提高审批等级。
- 高风险链路禁止使用永久授权。
- 审批界面显示数据来源和潜在外发目标。

## 6. 非目标与暂缓事项

以下内容不建议在基础能力稳定前优先开发：

- MCP SDK v2 迁移。当前官方仍建议生产使用 v1.x，待 v2 稳定后再评估。
- 自动信任所有 readOnly annotations。annotations 只是提示，不是安全契约。
- 无审批的全局 MCP 自动执行。
- 将密钥直接写入 MCP 配置或导出文件。
- 在 renderer 直接创建 stdio 子进程或持有远程 Token。

## 7. 建议实施顺序

1. MCP Resources 基础读取和文本上下文注入。
2. 多模态 Tool/Resource 结果模型与 UI。
3. 会话级 Server 和工具选择。
4. 动态 tools/resources/prompts 刷新。
5. MCP Prompts 与现有提示词管理器集成。
6. 本地 stdio 和 HTTP fixture 集成测试。
7. OAuth、Token 刷新和自定义 Header 管理。
8. 审计脱敏、轮转、导出和筛选。
9. stdio/HTTP 隔离与 prompt injection 联动策略。

## 8. 完成定义

每项 MCP 功能合并前应满足：

- 主进程、preload 和 renderer 类型保持一致。
- IPC 漂移检查通过。
- 新增能力具有单元测试；协议能力具有 fixture 集成测试。
- `npm run check` 全部通过。
- Electron 生产打包通过。
- 密钥不出现在普通配置、日志、错误信息和测试快照中。
- 写入、外发和破坏性操作具有明确审批路径。
- 文档同步更新当前状态和剩余工作。
