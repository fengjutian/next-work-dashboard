# next-work-dashboard — 项目介绍与部署文档

## 1. 项目简介

**next-work-dashboard** 是一个基于 Electron 的 AI 提示词注入桌面应用。内置 WebView 浏览器打开 DeepSeek、ChatGPT、Kimi 等 AI 对话网站，支持将预设提示词一键注入到网页输入框中，提升 AI 交互效率。

> 定位：不是又一个 ChatGPT 客户端——是你所有 AI 网站的提示词遥控器。

### 1.1 核心能力

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

### 1.2 差异化优势

| 维度 | next-work-dashboard | ChatBox | AIPRM (浏览器扩展) |
|------|---------------------|---------|---------------------|
| 需要 API Key | ❌ 不需要 | ✅ 必须 | ❌ 不需要 |
| 保留官网体验 | ✅ 完整 | ❌ 无 | ✅ |
| 多 AI 站点 | ✅ 任意可配 | 多模型 API | ❌ 仅 ChatGPT |
| 提示词管理 | ✅ 本地 SQLite | ❌ | ✅ |
| 变量模板 | ✅ | ❌ | ✅ |
| 数据隐私 | ✅ 纯本地 | ⚠️ API 传输 | ✅ |

---

## 2. 技术架构

### 2.1 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Electron 35 |
| 渲染进程 | React 18 + TypeScript 5.4 |
| UI | shadcn/ui + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 持久化 | sql.js + drizzle-orm |
| 图可视化 | @antv/g6 5 |
| 构建 | electron-forge 7 + Vite 5 |
| 测试 | Vitest 2 + Testing Library |
| 包管理 | npm |

### 2.2 进程架构

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
│  · 插件系统 (内置 + Sandbox + Kernel) │
└─────────────────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      WebView Preload                │
│  src/webview-preload.ts             │
│  · DOM 注入引擎 (选择器定位/事件模拟)  │
└─────────────────────────────────────┘
```

### 2.3 安全模型

- WebView 中运行的 AI 网站与主应用完全隔离
- 通过 `contextBridge` 暴露受控 API，不暴露 Node.js 能力
- 用户插件运行在 `sandbox="allow-scripts"` iframe + CSP `default-src 'none'`
- Token 存储使用 `safeStorage` + OS 原生加密
- 打包时启用 Fuse 保护：`RunAsNode: false`、`OnlyLoadAppFromAsar: true`

### 2.4 插件系统（内置插件与用户 Sandbox）

详见 `docs/plugin-architecture.md`。

```
┌──────────────────────────────────────────┐
│  内置插件层 (Plugin 接口)                  │
│  18 个 React 组件 → PluginRegistry        │
├──────────────────────────────────────────┤
│  用户 Sandbox 层 (UserPluginDef)          │
│  iframe 隔离 → postMessage → usePluginBridge │
│  7 通道 / 8 权限 / private localStorage   │
├──────────────────────────────────────────┤
└──────────────────────────────────────────┘
```

`PluginRegistry` 同时负责启用状态、命令贡献、生命周期和资源回收。React 组件通过基于 `useSyncExternalStore` 的 `usePluginRegistryVersion()` 订阅变化。用户插件只能运行在 iframe Sandbox 中，并通过 CSP、权限和消息校验访问宿主能力；用户 Kernel 执行链已经移除。

---

## 3. 项目结构

```
prompt-lab/
├── index.html                          # 渲染进程入口 HTML
├── package.json                        # 依赖与脚本
├── forge.config.ts                     # Electron Forge 构建配置
├── vite.main.config.ts                 # 主进程 Vite 配置
├── vite.preload.config.ts              # Preload Vite 配置
├── vite.renderer.config.ts             # 渲染进程 Vite 配置
├── vitest.config.ts                    # 测试配置
├── drizzle.config.ts                   # Drizzle ORM 配置
├── tailwind.config.js                  # Tailwind CSS 配置
├── postcss.config.js                   # PostCSS 配置
├── tsconfig.json                       # TypeScript 配置
├── docs/
│   └── plugin-architecture.md          # 插件架构文档
├── tests/                              # 测试文件
├── src/
│   ├── main.ts                         # Electron 主进程入口
│   ├── preload.ts                      # Preload 脚本
│   ├── webview-preload.ts              # WebView Preload (DOM 注入)
│   ├── renderer.tsx                    # React 渲染入口
│   ├── App.tsx                         # 应用根组件
│   ├── index.css                       # 全局样式
│   ├── db/
│   │   ├── index.ts                    # 数据库连接
│   │   └── schema.ts                   # Drizzle 表结构
│   ├── store/
│   │   ├── index.ts                    # Zustand Store
│   │   ├── types.ts                    # Store 类型
│   │   └── defaultPrompts.ts           # 默认提示词数据
│   ├── components/
│   │   ├── ActivityBar.tsx             # VSCode 风格侧边活动栏
│   │   ├── CommandPalette.tsx          # Spotlight 浮动搜索面板
│   │   ├── VariableFillDialog.tsx      # 变量填充对话框
│   │   ├── ImportExport.tsx            # 导入导出
│   │   ├── SettingsSidebar.tsx         # 设置侧边栏
│   │   ├── SiteRow.tsx                 # 站点配置行
│   │   ├── Toast.tsx                   # 通知组件
│   │   ├── icons.tsx                   # 图标组件
│   │   ├── settings/                   # 设置子面板
│   │   │   ├── SettingsAISites.tsx
│   │   │   ├── SettingsAbout.tsx
│   │   │   ├── SettingsAiApi.tsx
│   │   │   ├── SettingsAppearance.tsx
│   │   │   ├── SettingsDataManagement.tsx
│   │   │   └── SettingsShortcuts.tsx
│   │   └── ui/                         # shadcn/ui 基础组件
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       ├── scroll-area.tsx
│   │       └── separator.tsx
│   ├── plugins/                        # 插件系统
│   │   ├── types.ts                    # Plugin / 生命周期接口
│   │   ├── registry.ts                 # 注册、命令、生命周期
│   │   ├── usePluginRegistry.ts        # React 外部 Store 适配
│   │   ├── built-in/index.ts           # 18 个内置插件
│   │   ├── ai/                         # AI 导航、WebView、会话保存
│   │   ├── chat/                       # AI 对话及专属子组件
│   │   ├── prompts/                    # 提示词侧栏与抽屉
│   │   ├── history/                    # 会话历史
│   │   ├── knowledge-graph/            # 知识图谱及画布组件
│   │   ├── database/                   # 数据库浏览器
│   │   ├── dynamic/DynamicPlugin.tsx   # 用户插件运行模式分发
│   │   ├── plugin-manager/             # 创建、导入、导出、管理
│   │   ├── code-editor/                # 代码编辑器插件
│   │   ├── terminal/                   # 终端 UI 与主进程 backend
│   │   ├── excel-preview/              # Excel 插件
│   │   └── sandbox/                    # iframe 沙箱运行时
│   │       ├── types.ts                # 协议/权限类型
│   │       ├── PluginSandbox.tsx        # iframe 容器
│   │       ├── plugin-sdk.ts           # SDK 类型与唯一运行时
│   │       └── usePluginBridge.ts      # Host 桥接与安全校验
│   ├── hooks/
│   │   └── usePersistence.ts           # 持久化 Hook
│   ├── auth/
│   │   └── token-store.ts              # Token 安全存储
│   ├── lib/
│   │   └── utils.ts
│   └── types/
│       └── electron.d.ts               # Electron API 类型声明
└── dist/                               # 构建产物
```

---

## 4. 开发环境搭建

### 4.1 前置要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- Windows / macOS / Linux

### 4.2 安装与启动

```bash
# 克隆项目
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

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint
```

---

## 5. 构建与部署

### 5.1 构建命令

```bash
# 打包为可分发的安装包
npm run make

# 仅打包（不制作安装包）
npm run package
```

### 5.2 构建产物

`forge.config.ts` 配置了 4 种 Maker：

| Maker | 产物 | 平台 |
|-------|------|------|
| `MakerSquirrel` | `.exe` Windows 安装程序 | Windows |
| `MakerZIP` | `.zip` 便携版 | macOS |
| `MakerDeb` | `.deb` 安装包 | Debian/Ubuntu |
| `MakerRpm` | `.rpm` 安装包 | Fedora/RHEL |

构建产物输出到 `out/` 目录。

### 5.3 构建配置要点

- **asar 打包**：`packagerConfig.asar: true`，应用代码打包为单个 asar 归档
- **Fuse 安全**：
  - `RunAsNode: false` — 禁止作为 Node.js 运行
  - `EnableCookieEncryption: true` — Cookie 加密
  - `OnlyLoadAppFromAsar: true` — 仅从 asar 加载
  - `EnableEmbeddedAsarIntegrityValidation: true` — asar 完整性校验
- **Vite 三入口**：`main.ts`（主进程）、`preload.ts`（Preload）、`webview-preload.ts`（WebView Preload）

### 5.4 发布流程

```bash
# 1. 确保测试通过
npm test

# 2. 更新版本号（package.json version）

# 3. 构建
npm run make

# 4. 产物在 out/make/ 目录下
```

### 5.5 免安装便携版

直接分发 `npm run package` 产出的 `out/` 目录即可运行（需保留 `node_modules` 中的原生模块）。

---

## 6. 数据存储

| 数据类型 | 存储方式 | 位置 |
|----------|----------|------|
| 提示词/站点/设置 | sql.js (SQLite) | `%APPDATA%/next-work-dashboard/data.db` |
| 对话历史 | Markdown 文件 | `%APPDATA%/next-work-dashboard/conversations/` |
| API Token | safeStorage 加密 | OS 原生密钥链 |
| 插件私有数据 | localStorage | 渲染进程 localStorage |
| WebView Session | Electron partition | 用户数据目录 |

---

## 7. 功能完成度

| 模块 | 完成率 |
|------|:--:|
| 浏览器 / 注入 | **100%** |
| 提示词管理 | **88%** |
| 设置 | **40%** |
| 总体 | **75%** (33/44) |

详见 `FEATURE_CHECKLIST.md`。

---

## 8. 相关文档

| 文档 | 路径 |
|------|------|
| 需求文档 | `REQUIREMENTS.md` |
| 功能对照表 | `FEATURE_CHECKLIST.md` |
| 文档中心 | `docs/README.md` |
| 用户手册 | `docs/user-guide.md` |
| 插件架构 | `docs/plugin-architecture.md` |
| 故障排查 | `docs/troubleshooting.md` |
| 贡献指南 | `docs/contributing.md` |
| 安全模型 | `docs/security.md` |
