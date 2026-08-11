# next-work-dashboard — Agent Guide

> This file is consumed by OpenCode / Codex / Cursor / Aider / Devin / Gemini CLI / etc. as a project-memory bootstrap.
> 适用对象：在 `next-work-dashboard` 仓库内工作的 AI agent。

## 项目身份

- **productName**: `next-work-dashboard`
- **本仓库结构**：
  - `prompt-lab/` — 主 Electron 桌面 App（**本指南主要适用区**）
  - `nwd-admin/` — 独立前端工作台
  - `mycast-share/` — Rust + Tauri 媒体分享 app
  - `native/` — Rust sidecar 资源（rag-worker / disk-scanner / net-probe / video-player / mycast / voice-engine）
  - `design/` — 设计稿
  - `docs/` — 项目文档

## prompt-lab 技术栈

- Electron 35 + Vite + React 18 + TypeScript 5.4
- Drizzle ORM + better-sqlite3 + LanceDB（向量）
- TipTap / Monaco / Antd 6 / Tailwind 3 / Zustand
- Transformers.js（本地 Embedding）+ MCP SDK
- 端到端测试：Vitest + jsdom

## 关键约定

1. **插件系统**：所有新功能优先走插件 ——
   - 接口契约见 `src/plugins/types.ts`（`Plugin` interface）
   - 内置插件注册在 `src/plugins/built-in/index.ts`
   - 用户插件由 `src/plugins/plugin-manager/` 加载
2. **IPC 契约**：`scripts/check-ipc-contract.mjs` 扫 `ipcMain.handle` ↔ `ipcRenderer.invoke`，**漏一个会 fail**。
   新加 channel 必须同时改：
   - `src/main/<feature>/ipc.ts`（handler）
   - `src/preload/<feature>.ts`（bridge）
   - `src/types/electron.d.ts`（类型）
3. **LTS 安全开关**：`extraResource` / `asar.unpack` 集中在 `forge.config.ts`，新增 native sidecar 必更新。
4. **网络层净化**：见 [Work Browser Cleaner 注入点](#work-browser--work-browser-插件)。

## <a id="work-browser"></a>Work Browser 插件（新增）

> **位置**：`prompt-lab/src/plugins/work-browser/` + `src/main/work-browser/` + `src/core/work-browser/`
> **入口**：`src/plugins/built-in/index.ts` 里 id=`work-browser`，默认 `enabled: false`，用户需在设置里启用。
> **详细文档**：[`docs/work-browser/ARCHITECTURE.md`](./docs/work-browser/ARCHITECTURE.md) / [`PHASE1.md`](./docs/work-browser/PHASE1.md) / [`ROADMAP.md`](./docs/work-browser/ROADMAP.md)

### 范围与边界

- 本插件是 **AI 工作浏览器**（PRD 57 章）Phase 1 MVP 实现。**不**做完整浏览器引擎。
- 独立 core（`src/core/work-browser/`），不复用 prompt-lab 现有 ai 模块的内部协议。
- 复用：`ai/`、`memory/`、`lancedb-memory.ts`、`semantic-search.ts`、`document-knowledge`（存储与基础能力）。
- 不复用：现有 `main/workspace/tasks.ts`（是 shell task runner，不是 PRD 里的"排障任务"）。

### 必读文件

| 文件 | 用途 |
|---|---|
| `src/core/work-browser/types.ts` | 全部数据模型（Workspace / Tab / Document / Note / Task / AIConversation / SearchProvider / SearchResult） |
| `src/core/work-browser/search/aggregator.ts` | 多引擎并行 + 去重 + 排序 |
| `src/main/work-browser/ipc.ts` | 主进程 IPC handlers（work-browser:* 命名空间） |
| `src/preload/work-browser.ts` | 渲染端桥（→ window.electronAPI.workBrowser） |
| `src/plugins/work-browser/WorkBrowserPanel.tsx` | ActivityBar 主面板 |

### 修改 Work Browser 的"必跑"验证

```bash
cd prompt-lab
npm run check:ipc   # 必须通过
npm run typecheck   # work-browser 域 0 error
npm run lint        # work-browser 域 0 error
npx vitest run tests/work-browser/  # 32 / 32 必须全过
```

### 添加新能力时

1. **新数据模型** → 加到 `src/core/work-browser/types.ts` + `src/core/work-browser/storage/schema.ts`（在 `SCHEMA_V1` 里 CREATE 新表）
2. **新搜索引擎** → 实现 `SearchProvider` 接口，在 `src/core/work-browser/search/providers/` 加文件，`providers/index.ts` 注册
3. **新 IPC channel** → main `ipc.ts` + preload `work-browser.ts` + `types/electron.d.ts` 三处同步
4. **新 UI** → 组件放 `src/plugins/work-browser/components/`，主面板 `WorkBrowserPanel.tsx` 引入
5. **新领域逻辑** → core 层加纯函数 + 单测（`tests/work-browser/`）

### 已知限制（Phase 1 + 1.5 + 2 已交付；Phase 3-4 在路线图）

| 限制 | 原因 | 何时解决 |
|---|---|---|
| Save Page 不能保存鉴权页 | main 端 fetch 无登录态 | 未知（看用户） |
| AI 摘要需手动配 baseUrl/apiKey | 独立 core，未集成 ai 模块 | Phase 3 |
| Note 富文本 / Wiki-link | 未接入 markdown-editor | Phase 3 |
| PDF / Docling 解析 | 未集成 document-knowledge | Phase 3 |
| AI Context 切换 | 仅 workspace/library，缺 current-page / specific-documents | Phase 3 |
| Embedding 升级的 Workspace auto-group | 当前还是 Jaccard | Phase 3 |
| Task Runner 编排器 | UI 已可改状态，但缺多步自动串联 + AI 自动填证据 | Phase 3 |
| Web Diff 增强 / Web Replay | 在路线图 | Phase 3 |
| Sync / NAS / WebDAV / S3 | 在路线图 | Phase 4 |

## 已知全局遗留（不是 bug，按项目节奏处理）

- `src/components/icons.tsx` 引用了 lucide-react 1.25 没有的 icon（Mic / AudioLines / AudioWaveform / CircleStop）—— typecheck 报 4 个错
- `src/plugins/network-observatory/backend/net-probe-notify.ts` 用 `require()` 触发 `no-var-requires` —— lint 报 1 个错
- `src/components/CommandPalette.tsx:142` 有 duplicate case label —— lint 报 1 个错

不影响 Phase 1 work-browser 上线。
