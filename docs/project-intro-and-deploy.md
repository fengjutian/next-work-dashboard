# 🚀 next-work-dashboard — 项目介绍与部署

> 基于 Electron 的 AI 提示词注入桌面工作台 · v0.2.0

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
| 🌐 **多站点 WebView** | 多标签页同时打开多个 AI 网站，Session 持久化 |
| 📝 **提示词管理** | 完整 CRUD + 分类 / 标签 / 搜索 / 收藏 / 置顶 / 变量模板 |
| ⚡ **一键注入** | 点击提示词 → 自动填入 AI 输入框，支持填充后自动发送 |
| 💬 **对话保存** | 提取 WebView 对话历史，保存为 Markdown |
| 🕸️ **知识图谱** | G6 可视化提示词与对话之间的关联 |
| 🔌 **插件系统** | 统一 Registry：18 个内置插件 + Sandbox 用户插件 |
| ⌨️ **浮动面板** | 全局 `Ctrl+K` 唤出 Spotlight 风格搜索面板 |
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
| UI | shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js + drizzle-orm |
| 图可视化 | @antv/g6 5 |
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
│  · WebView 标签页容器                │
│  · 插件系统 (内置 + Sandbox)         │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      WebView Preload                │
│  src/webview-preload.ts             │
│  · DOM 注入引擎 (选择器定位/事件模拟)  │
└─────────────────────────────────────┘
```

### 3.3 安全模型

- WebView 中 AI 网站与主应用**完全隔离**
- `contextBridge` 暴露受控 API，不暴露 Node.js 能力
- 用户插件运行在 `sandbox="allow-scripts"` iframe + CSP `default-src 'none'`
- Token 使用 `safeStorage` + OS 原生加密
- Fuse 保护：`RunAsNode: false`、`OnlyLoadAppFromAsar: true`、asar 完整性校验

---

## 4. 项目结构

```
prompt-lab/
├── src/
│   ├── main.ts                  # 主进程入口
│   ├── preload.ts               # 渲染进程 Preload
│   ├── webview-preload.ts       # WebView DOM 注入 Preload
│   ├── renderer.tsx → App.tsx   # React 根组件
│   ├── db/                      # sql.js 数据库 + Drizzle schema
│   ├── store/                   # Zustand 全局状态
│   ├── components/              # UI 组件（ActivityBar、设置面板等）
│   ├── plugins/                 # 插件系统（18 个内置 + Sandbox）
│   ├── core/                    # 核心纯函数（注入/提取/LLM/知识库）
│   ├── hooks/                   # React Hooks
│   ├── auth/                    # Token 安全存储
│   └── lib/                     # 工具函数
├── docs/                        # 项目文档
├── tests/                       # 测试文件
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
```

---

## 6. 构建与发布

### 6.1 构建命令

```bash
# 打包安装程序
npm run make

# 仅打包（不制作安装包）
npm run package
```

### 6.2 产物矩阵

| Maker | 产物 | 平台 |
|---|---|---|
| MakerSquirrel | `.exe` 安装程序 | Windows |
| MakerZIP | `.zip` 便携版 | macOS |
| MakerDeb | `.deb` 安装包 | Debian/Ubuntu |
| MakerRpm | `.rpm` 安装包 | Fedora/RHEL |

产物输出到 `out/` 目录。

### 6.3 Fuse 安全配置

| 选项 | 值 | 说明 |
|---|---|---|
| `RunAsNode` | `false` | 禁止作为 Node.js 运行 |
| `EnableCookieEncryption` | `true` | Cookie 加密 |
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

| 数据类型 | 存储方式 | 位置 |
|---|---|---|
| 提示词 / 站点 / 设置 | sql.js (SQLite) | `%APPDATA%/next-work-dashboard/data.db` |
| 对话历史 | Markdown 文件 | `%APPDATA%/next-work-dashboard/conversations/` |
| API Token | safeStorage 加密 | OS 原生密钥链 |
| 插件私有数据 | localStorage | 渲染进程 localStorage |
| WebView Session | Electron partition | 用户数据目录 |

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
