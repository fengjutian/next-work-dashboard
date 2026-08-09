---
layout: default
title: "🗺️ 架构演进路线图"
---

# 🗺️ 架构演进路线图

> 源于 Continue.dev 架构分析，结合当前代码现状的改造优先级。最后更新：2026-08-08。

---

## 优先级总览

| 优先级 | 方向 | 改动规模 | 用户感知 | 状态 |
|---|---|---|---|---|
| ⭐⭐⭐ | **1. Core/UI 分离** | 小 | 架构收益 | ✅ 已完成 |
| ⭐⭐⭐ | **5. 工具系统** | 小 | 中 | ✅ 已实现 |
| ⭐⭐⭐ | **4. Context Provider** | 中 | 🔥 高 | 📋 待实现 |
| ⭐⭐ | **2. Protocol 驱动** | 大 | 类型安全 | 🚧 部分（契约检查） |
| ⭐⭐ | **3. LLM 抽象层** | 中 | 中 | ✅ 骨架已建，接入待完成 |

---

## 1. Core/UI 分离 ✅

### 目标

将注入逻辑和对话提取逻辑从 React 组件中抽离为纯函数，放到 `src/core/`。

### 已完成

```
src/core/
├── injector.ts                  # buildInjectionScript / extractVariables / fillVariables / parseInjectResult
├── conversation-extractor.ts    # buildConversationExtractScript
├── llm.ts                       # LLMProvider 接口 + createOpenAIProvider + Provider Registry
├── agent.ts                     # runAgent() ReAct 循环
├── tools/                       # ToolRegistry + 内置/工作区/知识库/MCP/Office 工具
├── conversation-memory.ts       # 会话记忆检索索引
├── knowledge/                   # 知识库索引/检索/提案/健康
└── index.ts                     # barrel export
```

### 效果

- `WebViewContainer.tsx` 减少大量内联脚本
- 注入逻辑可独立单测
- 为 LLM API 直连模式铺路

---

## 4. Context Provider（模板变量自动填充）

### 目标

提示词中的 `{{变量}}` 不再只能手动输入，支持自动上下文填充。

### 方案

```
src/core/context-providers/
├── types.ts           # ContextProvider 接口
└── builtin.ts         # 内置 provider：{{date}} {{time}} {{clipboard}} {{selection}} {{activeTabUrl}}
```

```typescript
interface ContextProvider {
  name: string;
  description: string;
  resolve(): string | Promise<string>;
}
```

### 渲染层改动

1. `PromptVariable` 增加 `provider?: string` 字段
2. `injector.ts` 的 `buildInjectionScript()` 调用前先 `resolveVariables()` — 优先走 provider，fallback 手动输入
3. `VariableFillDialog` 识别有 provider 的变量，自动填充并标记为只读

### 收益

- 用户写 `今天是 {{date}}，帮我 {{clipboard}}` 自动获取日期和剪贴板
- 模板变量从"占位符"升级为"动态上下文"

> **状态**：目前 `src/core/context-providers/` 尚不存在，仍为规划项。`{{变量}}` 目前通过手动 `VariableFillDialog` 填充。

---

## 2. Protocol 驱动（IPC 类型化）🚧 部分

### 目标

将散落的 `ipcMain.handle` / `ipcRenderer.invoke` 集中为类型安全的协议层。

### 已完成

- `scripts/check-ipc-contract.mjs`：运行时校验 preload 暴露的通道与主进程 handler 一致
- Preload 暴露的类型化 `window.electronAPI`（`src/preload.ts`）

### 方案（规划）

```
src/protocol/
├── channels.ts    # IPC_CHANNELS 枚举 + 每个 channel 的 Request/Response 类型
└── index.ts       # 类型化的 invoke<T>(channel, args)
```

```typescript
const IPC = {
  'db:load':       { req: void,                    res: ArrayBuffer | null },
  'db:save':       { req: { data: ArrayBuffer },   res: { success: boolean } },
  'inject-prompt': { req: { siteId, promptId },    res: { success: boolean; error?: string } },
} as const;
```

### 收益

- 编译期检查 channel 是否存在
- 参数和返回值有完整类型提示
- 新增 IPC 不会拼错 channel 名称

---

## 3. LLM 抽象层 ✅（骨架）

### 目标

统一模型调用接口，支持 OpenAI 兼容 API、DeepSeek、本地 Ollama。

### 已完成

```
src/core/llm.ts
├── LLMProvider 接口         # chat / listModels / validate
├── createOpenAIProvider()   # OpenAI 兼容（流式 SSE 解析）
└── Provider Registry        # registerProvider / getProvider / listProviders
```

接入现状（`src/plugins/chat/useChatSession.ts` 等）：
- AI 对话面板已通过 LLMProvider 直连（OpenAI 兼容，支持 DeepSeek 风格 DSML 工具调用）
- LLM 响应缓存 `llm-cache.ts` 已接入 SQLite

### 待完成

- [ ] DeepSeek 专用 Provider 特化参数（FIM 补全等）
- [ ] Ollama Provider（本地模型）
- [ ] Anthropic Provider（Claude Messages API）
- [ ] 更多业务场景全面切换到 `LLMProvider`

---

## 5. 工具系统 ✅（已实现）

### 目标

让 AI Agent 具备可扩展、可授权的工具调用能力。

### 已完成

```
src/core/tools/
├── registry.ts          # registerTool / getTool / listTools / executeToolCall
├── types.ts             # ToolDefinition / ToolCall / ToolResult
├── builtin.ts           # 内置通用工具
├── code-workspace-tools.ts  # 工作区文件、Git、workspace_run_script（隔离 Worktree）
├── knowledge-tools.ts   # 知识库检索
├── conversation-memory-tools.ts # 会话记忆
├── mcp-tools.ts         # MCP 外部工具
├── office-tools.ts      # Office 文档工具
└── plugin-tools.ts      # 插件相关工具
```

工具由 `runAgent()`（`src/core/agent.ts`）通过 function calling / DSML 标签调用，支持 `allowedToolNames` 白名单控制。

### 待办

- 注入逻辑插件化（`PluginContributions.injectors?: Record<string, Injector>`）：让 Gemini 的 `contenteditable`、微信/钉钉等非标准输入框可注入自定义注入器
- 特殊站点交互（预先点击、滚动等）的工具化

---

## 实施建议

| 时序 | 方向 | 理由 |
|---|---|---|
| **立即** | Context Provider | 用户体验质变，改动可控 |
| **短期** | LLM Provider 全场景接入 | 利用已建骨架，接入更多 Provider |
| **中期** | Protocol 驱动 | 重构性质，配合新功能逐步迁移（已有关键检查脚本） |
| **观望** | 注入器插件化 | 等特殊站点需求驱动 |
