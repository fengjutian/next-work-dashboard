# next-work-dashboard — 功能与原理完整文档

> 涵盖架构原理、核心引擎、插件系统、数据层、Agent 系统。

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
9. [ReAct Agent 系统](#9-react-agent-系统)
10. [工作区与代码编辑器](#10-工作区与代码编辑器)
11. [终端系统](#11-终端系统)
12. [IPC 通信桥](#12-ipc-通信桥)
13. [快捷键与全局控制](#13-快捷键与全局控制)

---

## 1. 项目概述

**next-work-dashboard** 是一个基于 Electron 的 AI 提示词注入桌面应用。内置 WebView 浏览器打开 DeepSeek、ChatGPT、Kimi 等 AI 对话网站，支持将预设提示词一键注入到网页输入框中，提升 AI 交互效率。

> 定位：不是又一个 ChatGPT 客户端——是你所有 AI 网站的提示词遥控器。

### 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Electron 35 |
| 渲染进程 | React 18 + TypeScript 5.4 |
| UI | shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js (SQLite WASM) + Drizzle ORM |
| 图可视化 | @antv/g6 5 |
| 构建 | electron-forge 7 + Vite 5 |
| 终端 | xterm.js |
| 测试 | Vitest 2 + Testing Library |

### 核心能力

| 能力 | 说明 |
|------|------|
| 多站点 WebView | 多标签页同时打开多个 AI 网站，Session 持久化 |
| 提示词管理 | 完整的 CRUD + 分类/标签/搜索/收藏/置顶/变量模板 |
| 一键注入 | 点击提示词 → 自动填入 AI 输入框，支持填充后自动发送 |
| 对话保存 | 提取 WebView 中的对话历史，保存为 Markdown |
| 知识图谱 | G6 可视化提示词与对话之间的关联 |
| 插件系统 | 统一 Registry：18 个内置插件 + Sandbox / Kernel 用户插件 |
| 浮动面板 | 全局 Ctrl+K 唤出 Spotlight 风格搜索面板 |
| 主题切换 | 亮色 / 暗色 / 跟随系统 |
| 代码编辑器 | 工作区文件树 + Monaco 编辑器 + Git 集成 |
| SSH 终端 | 基于 xterm.js + SSH2 的远程终端 |
| ReAct Agent | 支持 function calling 的 AI Agent 循环 |

---

## 2. 进程架构

```
┌─────────────────────────────────────────┐
│            主进程 (Main Process)          │
│  src/main.ts                            │
│  · 窗口管理 (BrowserWindow)              │
│  · 系统托盘 (Tray)                       │
│  · 全局快捷键 (globalShortcut)           │
│  · IPC 处理器 (ipcMain.handle)           │
│  · 终端管理 (node-pty)                   │
│  · 安全存储 (safeStorage)                │
└──────────────┬──────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼──────────────────────────┐
│           Preload 脚本                    │
│  src/preload.ts                         │
│  · contextBridge.exposeInMainWorld      │
│  · 暴露 window.electronAPI              │
│  · 所有操作序列化为 IPC 调用              │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          渲染进程 (Renderer)               │
│  src/renderer.tsx → App.tsx             │
│  · React UI (ActivityBar + 面板)         │
│  · WebView 标签页容器                     │
│  · 插件系统 (内置 + Sandbox + Kernel)     │
│  · Zustand 状态管理                      │
│  · SQL.js 数据库                         │
└──────────────┬──────────────────────────┘
               │ webview preload
┌──────────────▼──────────────────────────┐
│        WebView Preload                   │
│  src/webview-preload.ts                 │
│  · 浏览器指纹伪装                        │
│  · 在页面脚本执行前注入                   │
└─────────────────────────────────────────┘
```

### 关键原则

1. **渲染进程零 Node.js 权限**：渲染进程通过 `contextBridge` 暴露的 `window.electronAPI` 调用主进程能力，永远不直接 `require('electron')`。这是 Electron 安全最佳实践。

2. **单例窗口模式**（`main/globals.ts`）：主进程维护模块级 `let mainWindow`，通过 `getMainWindow()` / `setMainWindow()` 访问。避免循环导入，确保所有 IPC handler 共享同一窗口引用。

3. **启动顺序**（`main.ts`）：
   ```
   app.whenReady() → createWindow → createTray → setupIPC → registerShortcuts
   ```

---

## 3. 提示词注入引擎

> 文件：`src/core/injector.ts` — 纯函数，零运行时依赖

注入引擎是项目的核心差异化功能：将用户预设的提示词自动填入任意 AI 网站的输入框。

### 3.1 变量系统

提示词支持 `{{变量名}}` 模板语法：

```
请帮我审查以下 {{语言}} 代码，重点关注 {{关注点}}：
```

**提取变量**（`extractVariables`）：

```
正则：/\{\{(\w+)\}\}/g
原理：遍历所有匹配，用 Set 去重，返回变量名数组
```

**填充变量**（`fillVariables`）：

```
正则：/\{\{(\w+)\}\}/g
原理：用 values 映射替换，未提供的变量保持原样 {{name}}
```

### 3.2 注入脚本生成（`buildInjectionScript`）

注入分三步，每一步都有明确的设计理由：

#### 第一步：Native Setter 写入

```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
)?.set;

if (nativeSetter) {
  nativeSetter.call(input, text);
} else {
  input.value = text;
}
```

**原理**：现代前端框架（React/Vue）会拦截 `input.value` 的赋值，直接 `input.value = text` 不会触发框架的响应式更新。通过获取原生 `HTMLTextAreaElement.prototype.value` 的 setter 并直接调用，绕过框架拦截，确保值真正写入底层 DOM。

#### 第二步：事件模拟

```javascript
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

**原理**：即使通过 native setter 写入了值，框架（尤其是 React）仍然依赖事件来同步内部状态。手动触发 `input` 和 `change` 事件（冒泡）通知框架"值已改变"。

#### 第三步：自动提交（可选）

```javascript
// 仅当 mode === 'fill-and-submit' 且配置了 submitSelector
setTimeout(() => {
  const btn = document.querySelector(submitSelector);
  if (btn) btn.click();
}, 200);
```

**原理**：200ms 延迟确保输入框的状态已完全同步后再点击发送按钮。

### 3.3 注入策略

通过 Zustand store 维护两种策略维度：

| 策略 | 选项 | 含义 |
|------|------|------|
| 注入模式 `injectMode` | `fill-only` | 仅填充输入框，不发送 |
| | `fill-and-submit` | 填充后自动点击发送 |
| 填充策略 `injectStrategy` | `replace` | 替换输入框全部现有内容 |
| | `append` | 追加到输入框现有内容末尾 |

两者正交组合，产生 4 种注入行为：纯填充替换、纯填充追加、自动发送替换、自动发送追加。

---

## 4. WebView 多标签浏览器

> 核心组件：`WebViewContainer.tsx`

### 4.1 架构

```
WebViewContainer
├── TabBar（标签栏）
│   ├── 站点标签（可拖拽排序）
│   ├── 新建标签按钮
│   └── 右键菜单（关闭/刷新/复制URL）
└── WebView 面板
    ├── <webview> 元素（每个标签一个）
    ├── 注入工具栏（模式/策略切换）
    └── 快捷提示词浮动面板（Ctrl+K）
```

### 4.2 为什么是 webview 而不是 iframe

根据项目记忆 [webview not iframe for external sites]：

> 嵌入外部网站的插件必须使用 Electron webview 标签而非 iframe。

原因：
1. **独立进程**：每个 `<webview>` 运行在独立的渲染进程中，崩溃不影响主应用
2. **完整浏览器环境**：webview 拥有完整的 Chromium 环境，包括 Cookie、localStorage、Service Worker
3. **Session 持久化**：webview 的 session 可以分区（partition），实现登录态持久化
4. **安全性**：webview 通过 `preload` 注入脚本，而 iframe 受同源策略限制
5. **节点能力控制**：webview 的 `nodeintegration` 可精确控制

### 4.3 Session 分区

每个站点标签使用独立的 `partition`：

```
partition = `persist:site_${site.id}`
```

这确保了：
- 不同 AI 站点的登录态互不干扰
- 同一站点的多个标签共享 Session
- 应用重启后登录态保持

### 4.4 页面加载管理

| 事件 | 处理 |
|------|------|
| `did-start-loading` | 显示 loading spinner |
| `did-stop-loading` | 隐藏 loading，提取对话 |
| `did-fail-load` | 显示错误页面，支持重试 |
| `page-title-updated` | 更新标签页标题 |
| `did-navigate` | 更新地址栏，记录导航历史 |

---

## 5. 反机器人指纹伪装

> 文件：`src/webview-preload.ts`

### 5.1 问题

AI 网站在 Electron webview 中会检测到异常浏览器指纹（如 `navigator.webdriver === true`），触发"使用环境异常"警告（典型：DeepSeek）。

### 5.2 原理

`webview-preload.ts` 在页面任何脚本执行**之前**运行，通过 `Object.defineProperty` 覆盖以下 `navigator` 属性：

| 属性 | 伪造值 | 理由 |
|------|--------|------|
| `userAgent` | Chrome 134 on Windows | Electron 的默认 UA 暴露了 Electron 标识 |
| `userAgentData` | 完整 Chrome brands | 高熵 UA 指纹，DeepSeek 等会检测 |
| `webdriver` | `false` | 自动化标志，必须设为 false |
| `plugins` | 3 个假插件 | Electron 的 `navigator.plugins` 为空，非常可疑 |
| `languages` | `['zh-CN','zh','en-US','en']` | 正常中文用户配置 |
| `platform` | `'Win32'` | 覆盖可能的异常值 |
| `hardwareConcurrency` | `8` | 隐藏真实 CPU 核心数 |
| `deviceMemory` | `8` | 隐藏真实内存大小 |
| `screen.colorDepth` | `24` | 覆盖可能的异常值 |
| `screen.pixelDepth` | `24` | 覆盖可能的异常值 |

同时还确保 `window.chrome` 对象存在（Electron 中通常缺失），以通过 `typeof window.chrome === 'object'` 检测。

### 5.3 关键注意

- 所有覆盖使用 `configurable: true`，允许 AI 网站的脚本后续修改
- 每个 `defineProperty` 包裹在 `try/catch` 中，单个失败不影响其他
- **不覆盖 `navigator.mimeTypes`**，因为该属性在某些 Chromium 版本中不可配置

---

## 6. 插件系统

> 详细架构见 [plugin-architecture.md](./plugin-architecture.md)。此处仅提炼核心原理。

### 6.1 统一注册、三种运行模式

```
┌─────────────────────────────────────┐
│         ActivityBar (图标按钮)        │
│   用户点击 → 切换 activeActivity      │
└──────────────┬──────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 内置插件   Sandbox    Kernel
(React FC)  (iframe)  (React bundle)
```

| 层级 | 说明 | 安全隔离 |
|------|------|----------|
| **内置层** | 18 个随应用编译的 React 插件 | 完全信任，直接访问 React 上下文 |
| **Sandbox 层** | 用户编写或导入的 JS 脚本 | iframe + CSP + postMessage，不直接暴露 Node.js |
| **Kernel 层** | 用户导入的 React bundle | Renderer 宿主上下文，无可靠安全隔离，仅可信来源 |

### 6.2 PluginRegistry — 发布-订阅单例

```typescript
class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private listeners = new Set<() => void>();
  private version = 0;

  register(plugin: Plugin): void        // 注册，id 重复则停用并覆盖
  getEnabled(): Plugin[]                // 按 order 排序返回已启用
  setEnabled(id: string, enabled: boolean): void  // 不可变更新并触发生命周期
  getLifecycleState(id: string): PluginLifecycleState
  subscribe(fn: () => void): () => void
  getVersion(): number                  // useSyncExternalStore 快照
}
```

**原理**：Registry 是独立单例，React 侧通过 `usePluginRegistryVersion()` 和 `useSyncExternalStore` 订阅稳定版本快照。插件支持异步 `activate/deactivate`，禁用、覆盖和卸载时会自动清理命令与订阅资源，并通过生命周期 token 防止延迟激活产生泄漏。

### 6.3 沙箱插件 SDK

用户插件运行在 `<iframe>` 中，通过 `postMessage` 通信：

```
用户插件 (iframe)                    Host (React)
     │                                  │
     │ postMessage({ type, requestId }) │
     │ ──────────────────────────────> │
     │                                  │ 处理请求
     │ postMessage({ requestId, result })│
     │ <────────────────────────────── │
```

**核心安全约束**：
- 每个请求带 `requestId` 用于 Promise 解析
- Host 校验消息来源、结构、参数数量和 256 KB 大小上限
- SDK 请求具有 30 秒超时
- 插件私有存储按 ID 隔离，单插件上限 512 KB
- 外链仅允许 `https:`、`http:`、`mailto:`，且禁止内嵌凭据
- SDK 暴露 7 个 channel：`store`、`ui`、`actions`、`data`、`preview`、`file`、`config`

---

## 7. 数据持久化层

> 文件：`src/db/index.ts` + `src/db/schema.ts`

### 7.1 技术选型：为什么是 sql.js

| 选项 | 优点 | 缺点 | 本项目结论 |
|------|------|------|-----------|
| better-sqlite3 | 原生性能 | 需要 native addon，Electron 打包复杂 | ❌ |
| sql.js (SQLite WASM) | 纯 WASM，零依赖 | 全内存，需手动刷盘 | ✅ |
| IndexedDB | 浏览器原生 | 非 SQL，查询能力弱 | ❌ |
| JSON 文件 | 最简单 | 无查询，大文件慢 | ❌ |

### 7.2 架构

```
渲染进程
├── Drizzle ORM (类型安全的查询构建)
│   └── schema.ts (表定义)
├── sql.js (SQLite 编译为 WASM)
│   └── 内存中的 SQLite 实例
└── flushDbToDisk()
    └── IPC → 主进程 → userData/next-work-dashboard.db
```

### 7.3 表结构

| 表 | 用途 | 关键字段 |
|----|------|----------|
| `prompts` | 提示词 | id, title, content, category, tags(JSON), variables(JSON), pinned, favorite, usageCount |
| `sites` | AI 站点配置 | id, name, url, inputSelector, submitSelector, enabled, useProxy |
| `conversations` | 对话历史 | id, siteId, promptId, title, messages(JSON), createdAt |
| `settings` | 键值设置 | key, value (theme, injectMode, aiApiConfig, roles, userCategories) |

### 7.4 写入策略：Write-Through Cache

每个 Zustand 状态变更都会**同步**写入数据库：

```typescript
// store/store.ts 模式
updatePrompt: (id, patch) => {
  if (isDbReady()) dbUpdatePrompt(id, patch);  // 写 SQLite
  set((s) => ({                                  // 更新内存状态
    prompts: s.prompts.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
    ),
  }));
},
```

**原理**：数据库和内存状态始终同步。即使应用崩溃，最近的写入已通过 `flushDbToDisk()` 持久化到磁盘（关键写操作后立即调用）。

### 7.5 磁盘刷写（Flush）

```
flushDbToDisk()
  → sql.js 导出内存数据库为 Uint8Array
  → IPC: 'db:save' → 主进程
  → fs.writeFile(userData/next-work-dashboard.db)
```

触发时机：`addPrompt`、`updatePrompt`、`deletePrompt`、`addSite`、`updateSite` 等关键操作后。

### 7.6 类型转换

SQLite 不支持 boolean 和 JSON 类型，需要手动转换：

| JS 类型 | SQLite 存储 | 读取还原 |
|---------|------------|----------|
| `boolean` | `INTEGER (0/1)` | `val === 1` |
| `string[]` (tags, variables) | `TEXT (JSON)` | `JSON.parse` with safe fallback |
| `Message[]` (conversations) | `TEXT (JSON)` | `JSON.parse` with safe fallback |

---

## 8. 状态管理

> 文件：`src/store/store.ts`（Zustand 单 Store）

### 8.1 单一 Store 设计

所有状态在一个 Zustand store 中：

```typescript
interface AppState {
  // 数据层
  prompts: Prompt[];
  sites: SiteConfig[];
  conversations: ConversationRecord[];
  // UI 层
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  activeActivity: string | null;
  // 注入控制
  injectMode: InjectMode;
  injectStrategy: InjectStrategy;
  pendingInjection: { text: string; siteId: string } | null;
  // AI API
  aiApi: { provider, apiKey, model } | null;
  roles: Role[];
  // ... 100+ mutator functions
}
```

### 8.2 跨组件通信：信号模式

不使用事件总线，通过 store 中的"信号字段"实现：

```
组件 A: set({ promptDrawerOpen: true })
组件 B: useEffect 监听 promptDrawerOpen → 打开抽屉
组件 C: set({ pendingInjection: { text, siteId } })
WebViewContainer: useEffect 监听 pendingInjection → 执行注入
```

### 8.3 选择器优化

```typescript
// selectors.ts
export function useFilteredPrompts() {
  return useStore(useShallow((s) => {
    // 组合 filter：search + category + tags + sort
    return s.prompts
      .filter(/* search */)
      .filter(/* category */)
      .filter(/* tags */)
      .sort(/* pinned > favorite > usageCount */);
  }));
}
```

**原理**：`useShallow` 做浅比较，避免每次渲染都返回新数组引用，减少子组件不必要的重渲染。

---

## 9. ReAct Agent 系统

> 文件：`src/core/agent.ts` + `src/core/llm.ts` + `src/core/tools/`

### 9.1 架构概览

```
用户输入
   │
   ▼
runAgent(provider, userMessage, history, model)
   │  AsyncGenerator<AgentStep>
   ▼
┌─────────────────────────────────┐
│        ReAct Loop                │
│                                  │
│  Think → 流式 LLM 调用           │
│    │                             │
│    ├── 有 tool_calls?            │
│    │   ├── Act: 并行执行工具     │
│    │   ├── Observe: 返回结果     │
│    │   └── 追加到消息历史, 循环   │
│    │                             │
│    └── 无 tool_calls?            │
│        └── Answer: 返回最终答案   │
└─────────────────────────────────┘
```

### 9.2 LLM Provider 接口

```typescript
interface LLMProvider {
  readonly id: string;
  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
  validate(): Promise<boolean>;
}
```

支持 OpenAI 兼容 API。流式响应通过 `AsyncIterable<ChatChunk>` 逐 token 产出。

### 9.3 Tool Calling 流程

1. **Schema 收集**：`getEnabledToolSchemas()` 获取所有已启用工具的 OpenAI function schema
2. **流式调用**：LLM 流式返回，同时收集 `tool_call` delta（index → id/name/arguments 的增量拼接）
3. **执行**：`finishReason === 'tool_calls'` 时，解析完整的 tool call 列表，逐个执行
4. **追加历史**：按 OpenAI 格式将 assistant 消息（含 tool_calls）+ tool 结果消息追加到消息数组
5. **循环**：继续下一轮 LLM 调用，最多 `maxSteps`（默认 5）步

### 9.4 AgentStep 类型

```typescript
type AgentStep =
  | { type: 'think'; content: string }     // 正在思考
  | { type: 'act'; toolCalls: ToolCall[] } // 准备执行工具
  | { type: 'observe'; toolResults: ToolResult[] } // 工具执行结果
  | { type: 'answer'; content: string }    // 最终回答
```

UI 层根据 `type` 渲染不同的视觉反馈：`think` 显示思考动画，`act` 显示工具调用卡片，`observe` 显示结果，`answer` 渲染最终 Markdown。

### 9.5 工具注册

```typescript
// core/tools/types.ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

内置工具集（`core/tools/builtin.ts`）：
- 文件读写（基于工作区授权）
- Web Fetch（HTTP 请求）
- Shell 命令执行（通过终端通道）
- 知识库搜索

---

## 10. 工作区与代码编辑器

> 核心插件：`plugins/code-editor/`（145K+ 代码量）

### 10.1 路径安全沙箱

> 文件：`main/workspace-path.ts`

```typescript
function resolveWorkspacePath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  // 1. 防止路径遍历：target 必须在 root 内
  assertInsideWorkspace(root, target);
  // 2. 符号链接解析 + 授权检查
  const realRoot = fs.realpathSync(root);
  if (!authorizedRoots.has(realRoot)) throw new Error('ACCESS_DENIED');
  const realTarget = fs.realpathSync(target);
  assertInsideWorkspace(realRoot, realTarget);
  return realTarget;
}
```

**原理**：
- 工作区必须先通过用户手动选择文件夹来 `authorizeWorkspace(root)`
- 每次文件访问都验证：路径在根内（`path.resolve` + 前缀检查）+ 真实路径授权（`fs.realpathSync` 防符号链接逃逸）
- 抛出 `ACCESS_DENIED` 阻止未授权访问

### 10.2 文件编辑事务

> 文件：`main/workspace-transaction.ts`

`applyWorkspaceTextEdits(edits[])` 实现两阶段提交：

```
Phase 1 — 预检：读取所有文件的原始内容 + mtime
Phase 2 — 写入：逐个写文件
          ↓ 任何写入失败 →
          回滚：用 Phase 1 的原始内容恢复所有已修改文件
```

同时支持 `WorkspaceFileMutation` 联合类型：create / delete / rename 操作。

### 10.3 Git 集成

> 文件：`main/git-*.ts` 系列

| 模块 | 职责 |
|------|------|
| `git-security.ts` | 从 git 输出中脱敏凭证（token/password） |
| `git-history.ts` | `git log` 解析为结构化历史 |
| `git-diagnostics.ts` | git 错误分类（network/auth/conflict） |
| `git-overview.ts` | 分支列表解析 |
| `git-conflicts.ts` | 合并冲突检测与展示 |

**Git 操作队列**：每个工作区维护一个 `Promise` 链（串行队列），避免并发 git 操作导致的 `.git` 锁竞争。网络操作超时 120s，本地操作 30s。支持 `AbortController` 取消。

### 10.4 代码编辑器组件

| 组件 | 功能 |
|------|------|
| `CodeEditorPanel` | Monaco 编辑器 + 标签页管理 |
| `FileTreeRow` | 文件树渲染（展开/折叠/右键菜单） |
| `DiffView` | 差异对比视图 |
| `Search` | 工作区全局搜索 |

---

## 11. 终端系统

> 文件：`src/plugins/terminal/`（Renderer UI 与 `backend/` 主进程实现）

### 11.1 双模式终端

| 模式 | 后端 | 使用场景 |
|------|------|----------|
| 本地终端 | `node-pty` (主进程) | 本地 shell 操作 |
| SSH 远程终端 | `ssh2` (主进程) | 远程服务器连接 |

### 11.2 架构

```
渲染进程 (xterm.js)
    │ 用户输入
    ▼
IPC: 'terminal:write'
    │
    ▼
主进程 (terminal-manager.ts)
    ├── node-pty (本地 PTY)
    └── ssh2 Client (远程 SSH)
    │
    ▼ 输出
IPC: 'terminal:data'
    │
    ▼
渲染进程 (xterm.js write)
```

### 11.3 生命周期

```typescript
// 应用退出时清理
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyAll();  // 销毁所有 PTY/SSH 连接
});
```

---

## 12. IPC 通信桥

> 文件：`src/preload.ts` + `src/main/ipc-handlers.ts`

### 12.1 模式

```
渲染进程调用                     主进程处理
─────────────                   ────────────
window.electronAPI               ipcMain.handle
  .injectPrompt({...})      →    'inject:prompt'
  .db.save({...})           →    'db:save'
  .workspace.readFile(p)    →    'workspace:readFile'
  .terminal.write(data)     →    'terminal:write'
```

### 12.2 事件订阅模式

```typescript
// preload.ts
onFileChanged: (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on('workspace:fileChanged', handler);
  return () => ipcRenderer.removeListener('workspace:fileChanged', handler);
}
```

**原理**：返回取消订阅函数，React 组件可在 `useEffect` 的 cleanup 中调用。

### 12.3 主要 API 分类

| 命名空间 | 功能 |
|----------|------|
| `window.*` | 窗口控制（最小化/最大化/关闭） |
| `db.*` | 数据库读写 |
| `workspace.*` | 工作区文件/Git 操作（20+ 方法） |
| `terminal.*` | 终端输入/输出/SSH 连接 |
| `auth.*` | OAuth 流程 |
| `shell.*` | 打开外部链接/文件 |
| `injectPrompt` | 向 WebView 注入提示词 |
| `saveConversation` | 保存对话历史 |
| `copyText` | 剪贴板写入 |
| `fetchFavicon` | 获取站点图标 |

---

## 13. 快捷键与全局控制

> 文件：`src/main/shortcuts.ts`

### 13.1 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` / `Cmd+K` | 唤起浮动提示词搜索面板（Spotlight 风格） |
| `Ctrl+Shift+L` | 显示/隐藏主窗口 |

### 13.2 原理

`globalShortcut.register(key, callback)` 注册系统级快捷键。即使应用在后台也能响应。

```typescript
registerShortcuts() {
  globalShortcut.register('CommandOrControl+K', () => {
    const win = getMainWindow();
    win?.webContents.send('shortcut:spotlight');
  });
}
```

主进程捕获快捷键 → 通过 `webContents.send` 通知渲染进程 → 渲染进程展示 Spotlight 面板。

---

## 附录 A：目录结构

```
prompt-lab/
├── src/
│   ├── main.ts                    # Electron 主进程入口
│   ├── main/                      # 主进程模块
│   │   ├── window.ts              # BrowserWindow 创建
│   │   ├── tray.ts                # 系统托盘
│   │   ├── ipc-handlers.ts        # 所有 IPC 处理器 (55K)
│   │   ├── shortcuts.ts           # 全局快捷键
│   │   ├── workspace-path.ts      # 路径安全沙箱
│   │   ├── workspace-text.ts      # 文本编码检测
│   │   ├── workspace-transaction.ts # 文件编辑事务+回滚
│   │   ├── git-security.ts        # Git 凭证脱敏
│   │   ├── git-history.ts         # Git 日志解析
│   │   ├── git-diagnostics.ts     # Git 错误分类
│   │   ├── git-overview.ts        # Git 分支解析
│   │   └── git-conflicts.ts       # 合并冲突检测
│   ├── preload.ts                 # contextBridge API 暴露
│   ├── webview-preload.ts         # WebView 反指纹注入
│   ├── renderer.tsx               # React 渲染入口
│   ├── App.tsx                    # 根布局 + 插件路由
│   ├── core/                      # UI 无关纯逻辑层
│   │   ├── injector.ts            # 注入引擎
│   │   ├── llm.ts                 # LLM Provider 接口
│   │   ├── agent.ts               # ReAct Agent 循环
│   │   ├── conversation-extractor.ts # 对话提取
│   │   ├── graph-extractor.ts     # 知识图谱提取
│   │   └── tools/                 # 工具系统
│   ├── store/                     # Zustand 状态管理
│   │   ├── store.ts               # 单一 Store
│   │   ├── types.ts               # 类型定义
│   │   ├── selectors.ts           # 记忆化选择器
│   │   └── defaultPrompts/        # 内置提示词模板
│   ├── db/                        # 数据库层
│   │   ├── index.ts               # sql.js 初始化和 CRUD
│   │   └── schema.ts              # Drizzle ORM schema
│   ├── plugins/                   # 插件系统
│   │   ├── types.ts               # Plugin 接口
│   │   ├── registry.ts            # 发布-订阅注册中心
│   │   ├── built-in/index.ts      # 18 个内置插件注册
│   │   ├── code-editor/           # 代码编辑器 (145K+)
│   │   ├── terminal/              # 终端面板
│   │   ├── excel-preview/         # Excel 预览
│   │   ├── pdf-preview/           # PDF 预览
│   │   ├── ppt-preview/           # PPT 预览
│   │   ├── word-preview/          # Word 预览
│   │   ├── excalidraw/            # 白板
│   │   ├── notes/                 # 便签
│   │   ├── translation/           # 翻译
│   │   ├── weread/                # 微信读书
│   │   ├── windy/                 # 天气
│   │   ├── plugin-manager/        # 插件管理
│   │   ├── dynamic/               # 动态加载
│   │   └── sandbox/               # iframe 沙箱 SDK
│   ├── terminal/                  # 终端管理
│   │   └── terminal-manager.ts
│   ├── components/                # 通用 UI 组件
│   ├── hooks/                     # 通用 Hooks
│   ├── lib/                       # 工具函数
│   ├── types/                     # 全局类型
│   └── auth/                      # OAuth 认证
├── tests/                         # 测试
├── docs/                          # 文档
└── design/                        # 设计规范
```

---

## 附录 B：设计模式索引

| 模式 | 位置 | 说明 |
|------|------|------|
| **IPC Bridge** | `preload.ts` → `ipc-handlers.ts` | `contextBridge` 暴露类型安全 API |
| **Write-Through Cache** | `store.ts` → `db/index.ts` | 状态变更同步写 SQLite |
| **Pub/Sub Registry** | `plugins/registry.ts` | 插件注册/订阅/通知 |
| **Async Generator Agent** | `core/agent.ts` | `async function*` 流式 ReAct 循环 |
| **Provider Interface** | `core/llm.ts` | `LLMProvider` 接口支持多种后端 |
| **Strategy Pattern** | `store.ts` (injectMode/Strategy) | 注入模式和策略的正交组合 |
| **Singleton Window** | `main/globals.ts` | 模块级变量管理单例窗口 |
| **Two-Phase Commit** | `workspace-transaction.ts` | 文件编辑预检+回滚 |
| **Sandbox via postMessage** | `plugins/sandbox/` | iframe 隔离 + requestId Promise |
| **Path Sandbox** | `workspace-path.ts` | realpath 解析 + 授权白名单 |
