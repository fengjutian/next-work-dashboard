# 🚀 next-work-dashboard — 项目介绍与部署

> 基于 Electron 的 AI 下一代工作平台 · v0.1.0

---

## 1. 这是什么？

**next-work-dashboard** 是一个桌面应用，内置 WebView 浏览器，可同时打开 DeepSeek、ChatGPT、Kimi、通义千问、豆包、Gemini 等 AI 对话网站，并支持将预设提示词**一键注入**到网页输入框中。

> **定位**：不是又一个 ChatGPT 客户端 —— 是你所有 AI 网站的提示词遥控器。

### 为什么不用 API Key？

- ✅ **零成本**：不需要 API Key，直接使用官网免费服务
- ✅ **完整体验**：保留官网全部功能（联网搜索、文件上传、插件等）
- ✅ **隐私优先**：所有数据纯本地存储，不上传任何服务器

---

## 2. 核心能力一览

| 能力 | 说明 |
|---|---|
| 🌐 **多站点 WebView** | 多标签页同时打开多个 AI 网站，Session 持久化（每站点独立 partition） |
| 📝 **提示词管理** | 完整 CRUD + 分类 / 标签 / 搜索 / 收藏 / 置顶 / 变量模板 |
| ⚡ **一键注入** | 点击提示词 → 自动填入 AI 输入框，支持填充后自动发送 |
| 💬 **AI 对话** | 内置对话面板，支持多模型、工具调用（文件/Git/终端/知识库/MCP/Office）、技能与记忆 |
| 📚 **知识库** | 会话历史、知识工作区、文档知识库（本地语义索引） |
| 🕸️ **知识图谱** | 代码 / 知识图谱可视化（ECharts + 多视图） |
| 💻 **代码编辑器** | 工作区文件树、Git 集成、差异视图、终端、AI 辅助编辑、Agent 隔离工作区 |
| 🗂️ **Office Studio** | OfficeCLI 内置集成，Word / Excel / PPT 编辑 |
| 🔌 **插件系统** | 统一 Registry：23 个内置插件 + Sandbox 用户插件 |
| ⌨️ **浮动面板** | 全局 `Ctrl/Cmd+Shift+Space` 唤起 Spotlight 风格搜索面板（快捷键可自定义） |
| 🎨 **主题切换** | 亮色 / 暗色 / 跟随系统 |

### 竞品对比

| 维度 | next-work-dashboard | ChatBox | AIPRM（扩展） |
|---|---|---|---|
| 需要 API Key | ❌ 不需要 | ✅ 必须 | ❌ 不需要 |
| 保留官网体验 | ✅ 完整 | ❌ 无 | ✅ |
| 多 AI 站点 | ✅ 任意可配 | 多模型 API | ❌ 仅 ChatGPT |
| 提示词管理 | ✅ 本地 SQLite | ❌ | ✅ |
| 变量模板 | ✅ | ❌ | ✅ |
| 数据隐私 | ✅ 纯本地 | ⚠️ API 传输 | ✅ |

---

## 3. 技术架构

### 3.1 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Electron 35 |
| 渲染进程 | React 18 + TypeScript 5.4 |
| UI | Ant Design 6 + @ant-design/x + shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js (SQLite WASM) + drizzle-orm（渲染进程内存库 + 主进程落盘） |
| 代码编辑 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| 图可视化 | echarts 6 + mermaid + cytoscape |
| 知识库/向量 | @lancedb/lancedb + @huggingface/transformers（本地 Embedding） |
| MCP | @modelcontextprotocol/sdk |
| 构建 | electron-forge 7 + Vite 5 |
| 测试 | Vitest 2 + Testing Library |

### 3.2 进程架构

```
┌─────────────────────────────────────┐
│            主进程 (Main)              │
│  src/main.ts                        │
│  · 窗口管理   · 全局快捷键             │
│  · 数据持久化 · IPC 通信              │
│  · 菜单/托盘  · 安全存储              │
│  · 终端/Agent 工作区/Git/MCP/Office  │
└──────────┬──────────────────────────┘
           │ IPC
┌──────────▼──────────────────────────┐
│         Preload 脚本                 │
│  src/preload.ts                     │
│  · contextBridge 暴露安全 API        │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│          渲染进程 (Renderer)          │
│  src/renderer.tsx → App.tsx         │
│  · React UI (ActivityBar + 面板)     │
│  · sql.js 内存数据库 + 定时落盘        │
│  · 插件系统 (23 内置 + Sandbox)       │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      WebView Preload                │
│  src/webview-preload.ts             │
│  · DOM 注入引擎 (选择器定位/事件模拟)  │
│  · 反机器人指纹伪装                  │
└─────────────────────────────────────┘
```

### 3.3 安全模型

- WebView 中 AI 网站与主应用**完全隔离**
- `contextBridge` 暴露受控 API，不暴露 Node.js 能力
- 用户插件运行在 `sandbox="allow-scripts"` iframe + CSP `default-src 'none'`
- Token 使用 `safeStorage` + OS 原生加密
- Fuse 保护：`RunAsNode: false`、`OnlyLoadAppFromAsar: true`、asar 完整性校验

详见 [安全模型](./security.md)。

---

## 4. 项目结构

```
prompt-lab/
├── src/
│   ├── main.ts                  # 主进程入口（窗口/托盘/快捷键/IPC/工作区）
│   ├── preload.ts               # 渲染进程 Preload（window.electronAPI）
│   ├── webview-preload.ts       # WebView DOM 注入 + 反指纹 Preload
│   ├── renderer.tsx → App.tsx   # React 根组件
│   ├── main/                    # 主进程逻辑：IPC、Agent、Git、工作区、MCP、托盘、终端
│   ├── db/                      # sql.js 数据库 + Drizzle schema
│   ├── store/                   # Zustand 全局状态
│   ├── components/              # UI 组件（TitleBar、ActivityBar、设置 8 Tab 等）
│   ├── features/                # 功能模块（如 prompts 提示词域）
│   ├── plugins/                 # 插件系统（23 个内置 + Sandbox）
│   ├── core/                    # 核心纯函数（注入/提取/LLM/Agent/工具/知识库）
│   ├── services/                # 渲染进程服务（知识工作区、MCP/Office 审批等）
│   ├── hooks/                   # React Hooks
│   ├── auth/                    # Token 安全存储
│   ├── types/                   # 全局类型声明
│   ├── workers/                 # Web Worker（PDF 等）
│   └── lib/                     # 工具函数
├── docs/                        # 项目文档
├── tests/                       # 测试文件
├── scripts/                     # 构建/检查脚本（prepare:native、check:docs 等）
├── forge.config.ts              # Electron Forge 构建配置
├── vite.main.config.ts          # 主进程 Vite 配置
├── vite.preload.config.ts       # Preload Vite 配置
└── vite.renderer.config.ts      # 渲染进程 Vite 配置
```

---

## 5. 开发环境

### 5.1 前置要求

| 工具 | 版本 |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| OS | Windows / macOS / Linux |

> 原生依赖（node-pty、lancedb）首次安装时通过 `prepare:native` 自动重建。

### 5.2 安装与启动

```bash
git clone <repo-url>
cd next-work-dashboard/prompt-lab

# 安装依赖
npm install

# 启动开发模式（热重载）
npm start

# 运行测试
npm test

# 测试 UI 模式
npm run test:ui

# 代码检查
npm run lint

# 类型检查
npm run typecheck
```

### 5.3 质量检查命令

| 命令 | 说明 |
|---|---|
| `npm run check` | 一键全量检查（typecheck + lint + test + IPC 契约 + 文档链接 + 编码） |
| `npm run check:ipc` | IPC 通道契约校验（`scripts/check-ipc-contract.mjs`） |
| `npm run check:docs` | Markdown 链接校验（`scripts/check-markdown-links.mjs`） |
| `npm run check:encoding` | UTF-8 编码校验 |

---

## 6. 构建与发布

### 6.1 构建命令

```bash
# 打包安装程序（自动重建原生依赖）
npm run make

# 仅打包（不制作安装包）
npm run package

# 发布
npm run publish
```

### 6.2 产物矩阵

| Maker | 产物 | 平台 |
|---|---|---|
| MakerSquirrel | `.exe` 安装程序 | Windows |
| MakerZIP | `.zip` 便携版 | macOS |
| MakerDeb | `.deb` 安装包 | Debian/Ubuntu |
| MakerRpm | `.rpm` 安装包 | Fedora/RHEL |

产物输出到 `out/` 目录。

### 6.3 Fuse 安全配置（forge.config.ts）

| 选项 | 值 | 说明 |
|---|---|---|
| `RunAsNode` | `false` | 禁止作为 Node.js 运行 |
| `EnableCookieEncryption` | `true` | Cookie 加密 |
| `EnableNodeOptionsEnvironmentVariable` | `false` | 禁止 NODE_OPTIONS 注入 |
| `EnableNodeCliInspectArguments` | `false` | 禁止 CLI inspect 参数 |
| `OnlyLoadAppFromAsar` | `true` | 仅从 asar 加载 |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | asar 完整性校验 |

### 6.4 发布流程

```bash
npm test                    # 1. 确保测试通过
# 更新 package.json version  # 2. 更新版本号
npm run make                # 3. 构建
# 产物在 out/make/           # 4. 分发
```

---

## 7. 数据存储路径

> 实际路径以 `app.getPath('userData')`（Windows 下为 `%APPDATA%\next-work-dashboard`）为准。

| 数据类型 | 存储方式 | 位置 |
|---|---|---|
| 提示词 / 站点 / 设置 / 会话 / Agent / 技能 / 缓存 | sql.js (SQLite) | `<userData>/next-work-dashboard.db` |
| 对话历史导出 / 记忆 | Markdown 文件 | `<documents>/next-work-dashboard/conversations/`、`.../memories/` |
| API Token | safeStorage 加密 | `<userData>/.auth-tokens.enc` |
| 插件私有数据 | localStorage | 渲染进程 localStorage（`plugin-platform-state-v1`） |
| 文档缓存（PDF 等） | 文件缓存 | `<userData>/document-cache/` |
| Agent 工作区 | Git Worktree | `<userData>/agent-worktrees/` |
| 向量记忆 | LanceDB | `<userData>/memory.lancedb/` |
| MCP 配置 / 审计 | JSON / JSONL | `<userData>/mcp-servers.json`、`mcp-audit.jsonl` |
| WebView Session | Electron partition | `<userData>/chromium-session-v1/`（sessionData） |

---

## 8. 功能完成度

| 模块 | 完成率 |
|---|---|
| 浏览器 / 注入 | **100%** |
| 提示词管理 | **94%** |
| 设置 | **80%** |
| Word 预览 | **45%** |
| Excel 编辑 | **100%** |
| **总体** | **79%** (71/90) |

详见 [功能检查表](../FEATURE_CHECKLIST.md)。

---

## 9. 相关文档

| 文档 | 路径 |
|---|---|
| 需求文档 | [REQUIREMENTS.md](../REQUIREMENTS.md) |
| 功能对照表 | [FEATURE_CHECKLIST.md](../FEATURE_CHECKLIST.md) |
| 用户手册 | [user-guide.md](./user-guide.md) |
| 插件架构 | [plugin-architecture.md](./plugin-architecture.md) |
| 架构路线图 | [architecture-roadmap.md](./architecture-roadmap.md) |
| 功能与原理 | [function-and-principles.md](./function-and-principles.md) |
| 故障排查 | [troubleshooting.md](./troubleshooting.md) |
| 贡献指南 | [contributing.md](./contributing.md) |
| 安全模型 | [security.md](./security.md) |
