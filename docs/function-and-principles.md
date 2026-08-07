# ⚙️ next-work-dashboard — 功能与原理

> 涵盖架构原理、核心引擎、插件系统、数据层、Agent 系统。最后更新：2026-08-04。

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

**next-work-dashboard** 是一个基于 Electron 的 AI 提示词注入桌面应用。

> **定位**：不是又一个 ChatGPT 客户端——是你所有 AI 网站的提示词遥控器。

### 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Electron 35 |
| 渲染进程 | React 18 + TypeScript 5.4 |
| UI | shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js (SQLite WASM) + Drizzle ORM |
| 图可视化 | ECharts 6 |
| 构建 | electron-forge 7 + Vite 5 |
| 终端 | xterm.js |
| 测试 | Vitest 2 + Testing Library |

---

## 2. 进程架构

```
┌─────────────────────────────────────────┐
│            主进程 (Main Process)          │
│  src/main.ts                            │
│  · 窗口管理 · 系统托盘 · 全局快捷键       │
│  · IPC 处理器 · 终端管理 · 安全存储       │
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

**原理**：React/Vue 拦截 `input.value` 赋值。通过获取原生 `HTMLTextAreaElement.prototype.value` 的 setter 直接调用，绕过框架拦截。

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

两者正交组合产生 4 种行为。

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
    ├── <webview> 元素（每标签一个）
    ├── 注入工具栏（模式/策略切换）
    └── 快捷提示词浮动面板（Ctrl+K）
```

### 4.2 为什么用 webview 而不是 iframe

> 🔗 项目记忆：[webview not iframe for external sites]

| 特性 | webview | iframe |
|---|---|---|
| 进程隔离 | ✅ 独立渲染进程 | ❌ 同进程 |
| 浏览器环境 | ✅ 完整 Chromium | ❌ 受限 |
| Session 持久化 | ✅ partition 分区 | ❌ 受同源限制 |
| 安全控制 | ✅ nodeintegration 可控 | ❌ 受同源策略 |

### 4.3 Session 分区

```
partition = `persist:site_${site.id}`
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
| `navigator.webdriver` | `false` | 隐藏自动化标志 |
| `navigator.plugins` | 非空 PluginArray | 模拟正常浏览器 |
| `navigator.languages` | `['zh-CN', 'en']` | 区域伪装 |
| `window.chrome` | `{ runtime: {} }` | 模拟 Chrome 特征 |
| `screen` 属性 | 合理值 | 规避 headless 检测 |

### 5.2 注入时机

使用 `contextIsolation: true` + `preload` 脚本，在页面 JavaScript 执行前运行，确保页面脚本读到的是伪装后的值。

---

## 6. 插件系统

详见 [插件架构文档](./plugin-architecture.md)。核心要点：

- **20 个内置插件**，`React.lazy()` 动态 import
- **Sandbox 用户插件**，`sandbox="allow-scripts"` iframe 隔离
- **PluginRegistry** 统一管理生命周期、命令、React 订阅
- Kernel 执行链已完全移除

---

## 7. 数据持久化层

> 文件：`src/db/` — sql.js + Drizzle ORM

### 7.1 技术选型

| 方案 | 决策 |
|---|---|
| sql.js (SQLite WASM) | ✅ 纯 JS，无需原生编译 |
| Drizzle ORM | ✅ 类型安全，与 TypeScript 完美集成 |
| 数据库路径 | `%APPDATA%/next-work-dashboard/data.db` |

### 7.2 核心表结构

| 表 | 用途 |
|---|---|
| `prompts` | 提示词（标题/正文/分类/标签/变量/收藏/使用次数） |
| `sites` | AI 站点配置（名称/URL/CSS 选择器/启用状态） |
| `settings` | 应用设置（键值对存储） |
| `conversations` | 对话历史元数据 |

### 7.3 数据库操作流程

```
App 启动
  → dbLoad() 从 IndexedDB 读取 SQLite 文件
  → 通过 IPC 传递给主进程
  → 主进程写入磁盘
  → drizzle-orm 连接
  ↓
运行时
  → 所有 DB 操作通过 Zustand Store 的 action
  → 同步更新内存状态 + 数据库
  ↓
保存
  → dbSave() 序列化 SQLite → 通过 IPC 写入磁盘
```

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

`useDbPersistence()` 在启动时从数据库恢复状态，并监听状态变化自动保存（debounce 500ms）。

---

## 9. ReAct Agent 系统

> 文件：`src/core/agent/` + `main/agent-task-service.ts`

### 9.1 ReAct 循环

```
Thought → Action → Observation → Thought → Action → ... → Final Answer
```

### 9.2 组件

| 组件 | 职责 |
|---|---|
| `AgentLoop` | 管理 ReAct 循环的 Thought-Action-Observation 迭代 |
| `ToolRegistry` | 注册和查找可用工具 |
| `LLMProvider` | 统一的模型调用接口（OpenAI 兼容 / DeepSeek / Ollama） |
| `agent-task-service` | 任务队列、取消/重试、执行指标 |

### 9.3 工具系统

工具通过 `PluginContributions.commands` 注册，Agent 通过 function calling 调用。支持的工具包括：

- 文件读写、搜索
- Git 操作
- 终端命令
- 知识库检索
- MCP 外部工具

---

## 10. 工作区与代码编辑器

### 10.1 工作区授权

```
用户选择文件夹 → authorizeWorkspace(root)
  → 每次文件访问验证：
    1. 路径在根内（path.resolve + 前缀检查）
    2. 真实路径授权（fs.realpathSync 防符号链接逃逸）
  → 未授权访问抛出 ACCESS_DENIED
```

### 10.2 文件编辑事务

`applyWorkspaceTextEdits(edits[])` 两阶段提交：

```
Phase 1 — 预检：读取所有文件原始内容 + mtime
Phase 2 — 写入：逐个写文件
          ↓ 任何写入失败 →
          回滚：用 Phase 1 原始内容恢复所有已修改文件
```

同时支持 `WorkspaceFileMutation`：create / delete / rename。

### 10.3 Git 集成

| 模块 | 职责 |
|---|---|
| `git-security.ts` | 脱敏凭证（token/password） |
| `git-history.ts` | `git log` 结构化解析 |
| `git-diagnostics.ts` | 错误分类（network/auth/conflict） |
| `git-overview.ts` | 分支列表解析 |
| `git-conflicts.ts` | 合并冲突检测与展示 |

**Git 操作队列**：每个工作区维护 Promise 串行队列。网络操作超时 120s，本地操作 30s。支持 `AbortController` 取消。

### 10.4 代码编辑器组件

| 组件 | 功能 |
|---|---|
| `CodeEditorPanel` | Monaco 编辑器 + 标签页管理 |
| `FileTreeRow` | 文件树渲染（展开/折叠/右键菜单） |
| `DiffView` | 差异对比视图 |
| `Search` | 工作区全局搜索 |

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
- Shell 类型根据 OS 自动选择（Windows: pwsh, macOS/Linux: bash/zsh）
- 支持自定义 shell profiles 配置

---

## 12. IPC 通信桥

### 12.1 通道分类

| 通道前缀 | 用途 |
|---|---|
| `db:*` | 数据库操作 |
| `site:*` | AI 站点管理 |
| `inject:*` | 提示词注入 |
| `shortcut:*` | 快捷键注册 |
| `token:*` | Token 安全存储 |
| `file:*` | 文件操作 |
| `workspace:*` | 工作区管理 |
| `git:*` | Git 操作 |
| `terminal:*` | 终端通信 |
| `agent:*` | Agent 任务 |

### 12.2 安全原则

- 所有 IPC 通过 `contextBridge.exposeInMainWorld` 暴露
- 不使用 `nodeIntegration: true`
- 参数校验在主进程 handler 中执行
- 敏感操作（token 读写）使用 `safeStorage` 加密

---

## 13. 快捷键与全局控制

### 13.1 快捷键一览

| 快捷键 | 功能 | 范围 |
|---|---|---|
| `Ctrl+Shift+Space` | 唤起主窗口 | 全局 |
| `Ctrl+K` | 浮动搜索面板 | 应用内 |
| `Ctrl+1` | AI 工作台 | 应用内 |
| `Ctrl+,` | 设置 | 应用内 |
| `Ctrl+O` | 打开文件 | 应用内 |

### 13.2 全局快捷键注册

```typescript
// main/shortcuts.ts
globalShortcut.register('Ctrl+Shift+Space', () => {
  const win = getMainWindow();
  win?.show();
  win?.focus();
});
```

### 13.3 系统托盘

- 关闭窗口 → 最小化到托盘（不退出）
- 托盘菜单：显示窗口 / 退出
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
