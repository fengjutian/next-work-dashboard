# ⚙️ next-work-dashboard — 功能与原理

> 涵盖架构原理、核心引擎、插件系统、数据层、Agent 系统。最后更新：2026-08-08。

---

## 目录

1. [项目概述](#1-项目概述)
2. [进程架构](#2-进程架构)
3. [提示词注入引擎](#3-提示词注入引擎)
4. [WebView 多标签浏览器](#4-webview-多标签浏览器)
5. [反机器人指纹伪装](#5-反机器人指纹伪装)
6. [插件系统](#6-插件系统)
7. [数据持久化层](#7-数据持久化层)
8. [状态管理](#8-状态管理)
9. [AI Agent 系统](#9-ai-agent-系统)
10. [工作区与代码编辑器](#10-工作区与代码编辑器)
11. [终端系统](#11-终端系统)
12. [IPC 通信桥](#12-ipc-通信桥)
13. [快捷键与全局控制](#13-快捷键与全局控制)

---

## 1. 项目概述

**next-work-dashboard** 是一个基于 Electron 的 AI 下一代工作平台。

> **定位**：不是又一个 ChatGPT 客户端——是你所有 AI 网站的提示词遥控器。

### 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Electron 35 |
| 渲染进程 | React 18 + TypeScript 5.4 |
| UI | Ant Design 6 + @ant-design/x + shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js (SQLite WASM) + Drizzle ORM |
| 图可视化 | ECharts 6 / mermaid / cytoscape |
| 代码编辑 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| 向量/Embedding | LanceDB + Transformers.js（本地） |
| MCP | @modelcontextprotocol/sdk |
| 构建 | electron-forge 7 + Vite 5 |
| 测试 | Vitest 2 + Testing Library |

---

## 2. 进程架构

```
┌─────────────────────────────────────────┐
│            主进程 (Main Process)          │
│  src/main.ts + src/main/                │
│  · 窗口管理 · 系统托盘 · 全局快捷键       │
│  · IPC 处理器 · 终端管理 · 安全存储       │
│  · Agent 任务 · Git 工作区 · MCP · Office │
└──────────────┬──────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼──────────────────────────┐
│           Preload 脚本                    │
│  src/preload.ts                         │
│  · contextBridge.exposeInMainWorld      │
│  · 暴露 window.electronAPI              │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          渲染进程 (Renderer)               │
│  src/renderer.tsx → App.tsx             │
│  · React UI · WebView 标签页 · 插件系统   │
│  · Zustand 状态管理 · SQL.js 数据库       │
└──────────────┬──────────────────────────┘
               │ webview preload
┌──────────────▼──────────────────────────┐
│        WebView Preload                   │
│  src/webview-preload.ts                 │
│  · 浏览器指纹伪装 · 页面脚本执行前注入     │
└─────────────────────────────────────────┘
```

### 关键原则

1. **渲染进程零 Node.js 权限**：通过 `contextBridge` 暴露 `window.electronAPI`，永不直接 `require('electron')`
2. **单例窗口模式**（`main/globals.ts`）：模块级 `let mainWindow`，`getMainWindow()` / `setMainWindow()` 访问
3. **启动顺序**：`app.whenReady() → createWindow → createTray → setupIPC → registerShortcuts`
4. **数据本地化**：sql.js 内存数据库在渲染进程运行，通过 IPC `db:save` 定时（30s / beforeunload / 退出前）落盘

---

## 3. 提示词注入引擎

> 核心文件：`src/core/injector.ts` — 纯函数，零运行时依赖

### 3.1 变量系统

提示词支持 `{{变量名}}` 模板语法：

```
请帮我审查以下 {{语言}} 代码，重点关注 {{关注点}}：
```

| 函数 | 实现 | 说明 |
|---|---|---|
| `extractVariables` | 正则 `/\{\{(\w+)\}\}/g` + Set 去重 | 提取变量名数组 |
| `fillVariables` | 正则替换 + values 映射 | 未提供的变量保持原样 `{{name}}` |

### 3.2 注入三步流程（`buildInjectionScript`）

#### 第一步：Native Setter 写入

```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
)?.set;
if (nativeSetter) { nativeSetter.call(input, text); }
else { input.value = text; }
```

**原理**：React/Vue 拦截 `input.value` 赋值。通过获取原生 `HTMLTextAreaElement.prototype.value`（fallback 到 `HTMLInputElement.prototype.value`）的 setter 直接调用，绕过框架拦截。

#### 第二步：事件模拟

```javascript
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

**原理**：框架依赖事件同步内部状态。手动触发 `input` / `change` 冒泡事件通知框架。

#### 第三步：自动提交（可选）

```javascript
setTimeout(() => {
  const btn = document.querySelector(submitSelector);
  if (btn) btn.click();
}, 200);
```

**原理**：200ms 延迟确保输入框状态完全同步后再点击发送。

### 3.3 注入策略

| 策略 | 选项 | 含义 |
|---|---|---|
| `injectMode` | `fill-only` | 仅填充，不发送 |
| | `fill-and-submit` | 填充后自动发送 |
| `injectStrategy` | `replace` | 替换全部内容 |
| | `append` | 追加到末尾 |

两者正交组合产生 4 种行为。`buildInjectionScript` 找不到输入框选择器时返回 `{ success: false, error: 'INPUT_NOT_FOUND' }`，由 `parseInjectResult` 解析。

---

## 4. WebView 多标签浏览器

> 核心组件：`src/plugins/ai/WebViewContainer.tsx`

### 4.1 架构

```
WebViewContainer
├── TabBar（标签栏）
│   ├── 站点标签（可拖拽排序）
│   ├── 新建标签按钮
│   └── 右键菜单（关闭/刷新/复制URL）
└── WebView 面板
    ├── <webview> 元素（每标签一个）
    ├── 注入工具栏（模式/策略切换）
    └── 快捷提示词浮动面板（Ctrl+K）
```

### 4.2 为什么用 webview 而不是 iframe

| 特性 | webview | iframe |
|---|---|---|
| 进程隔离 | ✅ 独立渲染进程 | ❌ 同进程 |
| 浏览器环境 | ✅ 完整 Chromium | ❌ 受限 |
| Session 持久化 | ✅ partition 分区 | ❌ 受同源限制 |
| 安全控制 | ✅ nodeintegration 可控 | ❌ 受同源策略 |

### 4.3 Session 分区

```tsx
<webview partition={`persist:site-${tab.siteId}`} />
```

- 不同 AI 站点登录态互不干扰
- 关闭标签后 Session 保留
- 每个 partition 独立 Cookie / localStorage / Service Worker

---

## 5. 反机器人指纹伪装

> 文件：`src/webview-preload.ts` — 在页面脚本执行前注入

### 5.1 伪装项

| 属性 | 伪装值 | 目的 |
|---|---|---|
| `navigator.userAgent` | 伪造 Chrome 134 UA | 隐藏 Electron UA |
| `navigator.userAgentData` | 伪造 brands / platform，`getHighEntropyValues()` 返回高熵假值（platformVersion / architecture / uaFullVersion） | 规避新版浏览器指纹 API |
| `navigator.webdriver` | `false` | 隐藏自动化标志 |
| `navigator.plugins` | 非空 PluginArray（PDF Plugin 等） | 模拟正常浏览器（Electron 默认 plugins 为空） |
| `navigator.languages` | `['zh-CN', 'zh', 'en-US', 'en']` | 区域伪装 |
| `navigator.platform` | `'Win32'` | 平台伪装 |
| `navigator.hardwareConcurrency` | `8` | CPU 核数伪装 |
| `navigator.deviceMemory` | `8` | 内存伪装 |
| `window.chrome` | `{ runtime: {}, loadTimes, csi, app }` | 模拟 Chrome 特征 |
| `screen.colorDepth` / `pixelDepth` | `24` | 规避 headless 检测 |

### 5.2 注入时机

使用 `contextIsolation: true` + 独立 `webview-preload` 脚本，在页面 JavaScript 执行前运行，确保页面脚本读到的是伪装后的值。所有伪装项用 `Object.defineProperty` + `try/catch` 包裹，失败静默忽略。

---

## 6. 插件系统

详见 [插件架构文档](./plugin-architecture.md)。核心要点：

- **23 个内置插件**，`React.lazy()` 动态 import
- **Sandbox 用户插件**，`sandbox="allow-scripts"` iframe 隔离
- **PluginRegistry** 统一管理生命周期、命令、文件编辑器、React 订阅
- Kernel 执行链已完全移除
- `plugin:file-open` 文件打开协议已实现（Office Studio 已接入，其余编辑器待办）

---

## 7. 数据持久化层

> 文件：`src/db/` — sql.js + Drizzle ORM

### 7.1 技术选型

| 方案 | 决策 |
|---|---|
| sql.js (SQLite WASM) | ✅ 纯 JS，无需原生编译；运行在渲染进程内存中 |
| Drizzle ORM | ✅ 类型安全，与 TypeScript 完美集成 |
| 数据库路径 | `<userData>/next-work-dashboard.db` |

### 7.2 核心表结构（Drizzle schema + ensureSchema）

Drizzle schema（`src/db/schema.ts`）20 张表，运行时 `ensureSchema()` 补充 `chat_sessions` / `chat_messages` / `weread_notes` / `weread_export_state` 等。主要分组：

| 分组 | 表 |
|---|---|
| 提示词 | `prompts`（标题/正文/分类/标签/变量/收藏/置顶/使用次数） |
| 站点 | `sites`（名称/URL/CSS 选择器/启用/代理/排序） |
| 注入 | `inject_history` |
| 设置 | `settings`（键值对）、`schema_version` |
| LLM 缓存 | `llm_response_cache`、`embedding_cache`、`semantic_shadow_cache`、`llm_cache_events` |
| 会话/记忆 | `chat_sessions`、`chat_messages`、`conversations` |
| 微信读书 | `weread_books`、`weread_review_state`、`weread_actions`、`weread_sync_history`、`weread_notes`、`weread_export_state` |
| 汉语新解 | `hanyu_jinjie_executions` |
| 文档知识库 | `document_knowledge_records` |
| Agent | `agent_sessions`、`agent_messages`、`agent_logs`、`agent_proposals`、`agent_tasks` |
| 技能 | `skills`、`skill_files` |

### 7.3 数据库操作流程

```
App 启动
  → useDbPersistence() 通过 IPC db:load 读取磁盘 SQLite 字节
  → initDb() 在渲染进程用 sql.js 加载 + ensureSchema()
  → 所有 DB 操作通过 Zustand Store 的 action
  → 同步更新内存状态 + 数据库
  ↓
保存
  → flushDbToDisk(): sql.js export() → IPC db:save → 主进程 fs.writeFileSync
  → 触发：每 30s 定时 / beforeunload / 托盘退出 save-before-quit / 变更后主动 flush
```

> IndexedDB 仅用于会话历史的语义检索索引（`conversation-memory.ts`，store `next-work-dashboard-memory`），不属于主数据路径。

---

## 8. 状态管理

> 文件：`src/store/` — Zustand 5

### 8.1 Store 架构

```typescript
interface AppStore {
  // 提示词
  prompts: Prompt[];
  addPrompt: (p) => void;
  updatePrompt: (id, patch) => void;
  deletePrompt: (id) => void;

  // 站点
  sites: SiteConfig[];
  addSite: (s) => void;

  // 标签页
  tabs: Tab[];
  activeTabId: string | null;

  // 设置
  settings: AppSettings;
  setSetting: (key, value) => void;

  // 注入策略
  injectMode: 'fill-only' | 'fill-and-submit';
  injectStrategy: 'replace' | 'append';
}
```

### 8.2 持久化 Hook

`useDbPersistence()` 在启动时从数据库恢复状态，并监听状态变化自动保存（定时 30s flush + 变更主动落盘）。

---

## 9. AI Agent 系统

> 聊天侧 ReAct 循环：`src/core/agent.ts` + `src/core/tools/`
> 文件编辑任务：`src/main/agent/`（task-service / worktree / script-runner / execution-env）

### 9.1 ReAct 循环（聊天）

```
Thought → Action → Observation → Thought → Action → ... → Final Answer
```

`src/core/agent.ts` 导出 `runAgent()`（异步生成器）：支持 OpenAI 流式 `tool_call` 增量解析与 DeepSeek 风格 DSML 工具调用标签；默认最多 5 步；支持工具 allowlist（`allowedToolNames`）。由 `src/plugins/chat/useChatSession.ts` 与 `ChatPanel.tsx` 消费。

### 9.2 工具系统（已实现）

`src/core/tools/` 是独立的工具注册与执行系统：

| 文件 | 职责 |
|---|---|
| `registry.ts` | `registerTool` / `getTool` / `listTools` / `executeToolCall` / `getEnabledToolSchemas` |
| `types.ts` | `ToolDefinition` / `ToolCall` / `ToolResult` 类型 |
| `builtin.ts` | 内置通用工具 |
| `code-workspace-tools.ts` | 工作区文件、Git、`workspace_run_script`（脚本在隔离 Worktree 内运行） |
| `knowledge-tools.ts` | 知识库检索 |
| `conversation-memory-tools.ts` | 会话记忆读写 |
| `mcp-tools.ts` | MCP 外部工具 |
| `office-tools.ts` | Office 文档工具 |
| `plugin-tools.ts` | 插件相关工具 |

### 9.3 LLM Provider

`src/core/llm.ts`：

| 组件 | 职责 |
|---|---|
| `LLMProvider` 接口 | `chat` / `listModels` / `validate` |
| `createOpenAIProvider()` | OpenAI 兼容（流式 SSE 解析） |
| Provider Registry | `registerProvider` / `getProvider` / `listProviders` |

### 9.4 文件编辑任务（主进程）

`src/main/agent/task-service.ts` 的 `AgentTaskService`：任务队列、取消/重试、执行指标（`agent-task:create/get/list/cancel/retry` + `agent-task:event` 订阅）。

`src/main/agent/execution-env.ts`：`ExecutionEnv` 抽象（`AgentProvider` / `createLocalWorktreeEnv`），`readFile`/`writeFiles`/`runCommand` 全部经过 `resolveWorkspacePath` 边界校验。

---

## 10. 工作区与代码编辑器

### 10.1 工作区授权

```
用户选择文件夹 → authorizeWorkspace(root)   # src/main/workspace/path.ts
  → 每次文件访问验证：
    1. 路径在根内（path.resolve + 前缀检查）
    2. 真实路径授权（fs.realpathSync 防符号链接逃逸）
  → 未授权访问抛出 ACCESS_DENIED
```

### 10.2 文件编辑事务

`applyWorkspaceTextEdits(root, edits)`（`src/main/workspace/transaction.ts`）两阶段提交：

```
Phase 1 — 预检：读取所有文件原始内容 + mtime（fileWasModified 冲突检测）
Phase 2 — 写入：逐个写文件
          ↓ 任何写入失败 →
          回滚：用 Phase 1 原始内容恢复所有已修改文件
```

同时支持 `WorkspaceFileMutation`：create / delete / rename（`applyWorkspaceFileMutations`）。文本编解码（UTF-8/GBK 检测）见 `workspace/text.ts`。

### 10.3 Git 集成

| 模块 | 职责 |
|---|---|
| `git/security.ts` | 脱敏凭证（token/password） |
| `git/history.ts` | `git log` 结构化解析 |
| `git/diagnostics.ts` | 错误分类（network/auth/conflict） |
| `git/overview.ts` | 分支列表解析 |
| `git/conflicts.ts` | 合并冲突检测与展示 |
| `git/rename-conflict.ts` | 重命名冲突处理 |

**Git 操作队列**：每个工作区维护 Promise 串行队列。网络操作超时 120s，本地操作 30s。支持 `AbortController` 取消。

### 10.4 代码编辑器组件

| 组件 | 功能 |
|---|---|
| `CodeEditorWorkspaceController` | Monaco 编辑器 + 标签页管理 + 工作区控制 |
| `WorkspaceExplorer` / `FileTreeRow` | 文件树渲染（展开/折叠/右键菜单） |
| `DiffViewPanel` / `GitHistoryGraph` | 差异对比与提交历史 |
| `SearchPanel` / `QuickOpenPanel` | 工作区全局搜索与快速打开 |
| `agents/AgentsWindow` | Agent 会话视图（基于 `agent-sessions` / `agent-edit-scope` / `ai-token-budget`） |
| `useAiEditGeneration` / `useAiProposalReview` | AI 编辑生成与提案审查 |

### 10.5 Agent 隔离工作区（Git Worktree）

- 代码对话第一次写文件、局部编辑或运行项目脚本时，通过 `workspace:createAgentWorktree` 创建以会话 ID 命名的独立 Git Worktree（分支 `agent/<sessionId>`），存储在 `<userData>/agent-worktrees/`
- 首次创建要求主工作区干净（`assertCleanAgentWorktreeBase`）；存在未提交修改时停止 AI 写入，要求先提交或 Stash
- 后续工具操作在隔离分支上进行；`mergeAgentWorktree` 以 squash-merge 方式合并回主工作区（仅用户手动触发，AI 工具没有合并权限）
- 冲突处理：`getAgentWorktreeConflictVersions` + `previewAgentWorktreeMerge`

---

## 11. 终端系统

> 文件：`src/plugins/terminal/`

### 11.1 终端架构

| 模式 | 后端 | 状态 |
|---|---|---|
| 本地终端 | `node-pty`（主进程） | ✅ 已实现 |
| 远程 SSH | `ssh2` | ❌ 未引入 |

### 11.2 架构

```
Renderer (xterm.js)
  → IPC → Main Process (node-pty)
           → OS Shell (bash/pwsh/zsh)
```

### 11.3 多标签终端

- 终端插件支持多标签，每个标签一个 pty 会话
- `discoverShellProfiles()` 自动发现 shell（Windows: PowerShell/pwsh/cmd/Git Bash/WSL；POSIX: `$SHELL` + zsh/bash/fish/sh）
- 支持自定义 shell profiles 与环境变量层（`mergeEnvironmentLayers` + `resolveSecretReferences`，`${secret:name}` 引用安全 token）

---

## 12. IPC 通信桥

### 12.1 通道分类

| 通道 | 用途 |
|---|---|
| `db:load` / `db:save` | SQLite 数据库读写 |
| `store-load` / `store-save` | 旧版 JSON 存储（迁移用） |
| `inject-prompt` | 提示词注入 |
| `terminal:profiles/create/write/resize/destroy` + `terminal:data:<id>` / `terminal:exit:<id>` | 终端通信 |
| `workspace:*` | 工作区授权、文件编辑、Git、Agent Worktree、脚本执行 |
| `git:*` | Git 操作 |
| `agent-task:*` | Agent 任务队列 |
| `document-cache:save/load/delete` | 文档缓存 |
| `office:*` | Office 文档操作 |
| `window-*` / `auto-launch-*` | 窗口与开机自启 |
| `toggle-search-panel` / `inject-from-context-menu` / `save-before-quit` | 事件推送（Main→Renderer） |
| `token:*` / `auth` | Token 安全存储（safeStorage） |

### 12.2 安全原则

- 所有 IPC 通过 `contextBridge.exposeInMainWorld` 暴露
- 不使用 `nodeIntegration: true`
- 参数校验在主进程 handler 中执行
- 敏感操作（token 读写）使用 `safeStorage` 加密
- `scripts/check-ipc-contract.mjs` 校验通道契约一致性

---

## 13. 快捷键与全局控制

### 13.1 快捷键一览

| 快捷键 | 功能 | 范围 |
|---|---|---|
| `Ctrl/Cmd+Shift+Space` | 唤起主窗口 + 切换搜索面板 | **全局**（可自定义） |
| `Ctrl/Cmd+K` | 浮动搜索面板（CommandPalette） | 应用内 |
| `Ctrl/Cmd+1` | AI 工作台 | 应用内 |
| `Ctrl/Cmd+,` | 设置 | 应用内 |
| `Ctrl/Cmd+O` | 打开文件（经 resolveFileEditor） | 应用内 |
| `Ctrl+R` | 重新加载界面 | 应用内 |
| `Escape` | 关闭弹层 / 菜单 | 应用内 |
| `Alt+F4` | 关闭窗口 | 应用内 |

### 13.2 全局快捷键注册

```typescript
// main/shortcuts.ts
globalShortcut.register('CommandOrControl+Shift+Space', () => {
  const win = getMainWindow();
  win?.show();
  win?.focus();
  win?.webContents.send('toggle-search-panel');
});
```

- 默认 `Ctrl/Cmd+Shift+Space`；若 `userData/next-work-dashboard-data.json` 中存在 `shortcuts['toggle-search']`，则注销默认并注册自定义快捷键
- 注册失败静默回退默认
- `will-quit` 时 `globalShortcut.unregisterAll()`

### 13.3 系统托盘

- 关闭窗口 → 最小化到托盘（不退出）
- 托盘菜单：显示窗口 / 退出（退出时发送 `save-before-quit` 触发数据库落盘）
- 托盘图标：应用状态指示

---

## 相关文档

| 文档 | 路径 |
|---|---|
| 插件架构 | [plugin-architecture.md](./plugin-architecture.md) |
| 架构路线图 | [architecture-roadmap.md](./architecture-roadmap.md) |
| 安全模型 | [security.md](./security.md) |
| 代码编辑器需求 | [code-editor-requirements.md](./code-editor-requirements.md) |
| 终端功能 | [terminal-features.md](./terminal-features.md) |
