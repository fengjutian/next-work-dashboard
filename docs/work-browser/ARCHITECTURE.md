# Work Browser — 架构

> 详细 PRD 见同目录 `../REQUIREMENTS.md`（用户原文 57 章） / Phase 1 范围见 [`PHASE1.md`](./PHASE1.md) / 阶段路线见 [`ROADMAP.md`](./ROADMAP.md)

## 核心设计原则

1. **Workspace 才是产品，Browser 只是壳**（PRD 第 56 节）
2. **AI 是整层智能，不是 Chat 面板**（PRD 第 56 节）
3. **本地文档 = Knowledge，不是 Download**（PRD 第 56 节）

## 分层

```
┌─────────────────────────────────────────────────────────────────┐
│  Render (Electron Renderer Process)                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  src/plugins/work-browser/                                  │ │
│  │  ├── WorkBrowserPanel.tsx                                   │ │
│  │  ├── components/{SearchBar, WorkspaceList, TabBar, …}       │ │
│  │  └── hooks/{useWorkspace, useSearch}                        │ │
│  └─────────────────────┬───────────────────────────────────────┘ │
│                        │ window.electronAPI.workBrowser.*        │
│  ┌─────────────────────▼───────────────────────────────────────┐ │
│  │  src/preload/work-browser.ts (contextBridge)                 │ │
│  └─────────────────────┬───────────────────────────────────────┘ │
├────────────────────────┼────────────────────────────────────────┤
│  Main (Electron Main Process)                                   │
│  ┌─────────────────────▼───────────────────────────────────────┐ │
│  │  src/main/work-browser/ipc.ts (work-browser:* channels)     │ │
│  │  ├── database.ts       (SQLite 单例)                        │ │
│  │  ├── workspace-store.ts / document-store.ts                 │ │
│  │  ├── search-router.ts  (聚合 + AI 摘要)                     │ │
│  │  ├── save.ts           (Save as Markdown)                   │ │
│  │  └── cleaner.ts        (净化 pipeline)                      │ │
│  └─────────────────────┬───────────────────────────────────────┘ │
├────────────────────────┼────────────────────────────────────────┤
│  Core (Pure functions + Types)                                  │
│  ┌─────────────────────▼───────────────────────────────────────┐ │
│  │  src/core/work-browser/                                      │ │
│  │  ├── types.ts                                                │ │
│  │  ├── parser/    (html-cleaner / readability / markdown)     │ │
│  │  ├── search/    (provider / aggregator / dedup / rank)     │ │
│  │  ├── ai/        (summarizer / context)                      │ │
│  │  ├── task/      (template / runner)                         │ │
│  │  ├── document/  (version / diff)                            │ │
│  │  ├── workspace/ (auto-group)                                │ │
│  │  ├── annotation/(model)                                      │ │
│  │  └── storage/   (schema / migrations)                       │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. core / main / render 三层严格分离

- **core**：纯函数 + 类型，不 import Electron / DOM。vitest 直接跑。
- **main**：唯一可以 import Electron 的层；SQLite + IPC handler。
- **render**：React 组件 + hooks；只能通过 `window.electronAPI.workBrowser` 通信。
- **webview-cleaner-preload**：Electron `<webview>` 内部跑的脚本，DOM 注入净化 + annotation 高亮。

好处：core 可独立单测、可在 Node 脚本里复用、未来可换 main 框架（不一定非 Electron）。

### 2. IPC 命名约定

`work-browser:<domain>:<action>`，例 `work-browser:search:run`、`work-browser:document:save`。

`scripts/check-ipc-contract.mjs` 会扫所有 `ipcMain.handle` ↔ `ipcRenderer.invoke` 的 channel 名一一对应。新加 channel 必须同时改：
- `src/main/work-browser/ipc.ts`（handler）
- `src/preload/work-browser.ts`（bridge）
- `src/types/electron.d.ts`（类型）

### 3. 资源 ID 用 branded string

```ts
type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
```

防止把 DocumentId 误传给需要 WorkspaceId 的函数。`newId<T>()` 工厂方法生成。

### 4. SQLite 单库 + 表

数据库文件：`<userData>/work-browser/work-browser.db`，WAL 模式。所有资源（workspaces / tabs / documents / document_versions / notes / annotations / tasks / ai_conversations / search_history）一张库，通过外键关联。`schema_migrations` 表记录迁移版本。

### 5. SearchProvider 协议

```ts
interface SearchProvider {
  id: string;
  name: string;
  capabilities: { web, images, news, code, suggestions };
  search(query, signal): Promise<SearchResult[]>;
  getSuggestions?(query, signal): Promise<string[]>;
}
```

aggregator 并行调用 4 个 provider → normalize → dedupe → rank → 返回。AI 摘要作为可选项注入到 onSummarize 回调里。

### 6. Save as Markdown 流程

```
User → 点击"保存" → 渲染端调 document.save({ url, workspaceId })
  ↓
Main 端 fetchHtml(url) → extractReadability(html) → contentMd
  ↓
SQLite 查重（按 url + workspaceId）
  ↓
写两份文件：<storagePath>/documents/<id>.md + <storagePath>/raw/<id>-<ts>.html
  ↓
检测 hash 变化 → 追加 document_versions（带 diffSummary）
  ↓
返回 { documentId, isNewVersion, diffSummary }
```

### 7. AI 摘要：OpenAI-compatible 协议

`POST <baseUrl>/chat/completions`，body 走标准 OpenAI 格式。覆盖：
- OpenAI
- DeepSeek
- Qwen（DashScope OpenAI 兼容模式）
- Ollama / vLLM / LocalAI（设置 `baseUrl=http://localhost:11434/v1`）

不依赖 prompt-lab 现有 ai 模块的内部协议（避免耦合）。

### 8. 净化（Phase 1 简版）

- **网络层**：内置 + 用户自定义域名黑名单（`session.webRequest.onBeforeRequest` 在 Phase 1.5 接入）
- **DOM 层**：CSS `display:none` 注入 + JS 兜底移除（适配常见 cookie banner / 弹窗 / 广告）
- Phase 1 渲染端用 `<iframe sandbox>`，等 Phase 1.5 切到 Electron `<webview>` + 完整净化脚本

### 9. Workspace 自动归组（启发式 Phase 1 + Phase 2 Embedding 升级路径）

四维加权：
- 域名集中度（60%+ 同域 → 强信号）
- 标题关键词重叠（Jaccard ≥ 0.3）
- 路径前缀相似
- 时间窗口（30 分钟内活跃）

Phase 2 已交付 Embedding 集成：Save Document 时异步入 lance 索引；hybridSearch 用 BM25 + Vector 双路召回，RRF 融合。

### 10. RAG 检索（Phase 2 已交付）

`core/work-browser/ai/rag.ts` 提供 `buildRagContext`：
1. query 走 `hybridSearch`（FTS5 + Lance cosine）
2. top-k chunks 按 fusedScore 排序
3. 拼成 systemPrompt：来源列表 + 原文片段（每段标注 [n]）
4. 返回 citations + chunks + AIContext

调用方拿到 bundle 后自己拼 messages 调 LLM，确保引用清晰可追溯。

## 已知限制

| 项 | 限制 | 解决 |
|---|---|---|
| Save Page 取 HTML | 必须 main 端可 fetch | 不支持鉴权页 / 反爬页面 |
| 净化效果 | Phase 1 弱 | Phase 1.5 切 webview + 完整 JS 注入 |
| 本地全文搜索 | 仅 SQLite 标题/URL LIKE | Phase 2 接 LanceDB |
| RAG | 未实现 | Phase 2 |
| 多用户 / Sync | 未实现 | Phase 4 |
| AI 摘要引用 | 仅 chat 文本 | Phase 2 增加原文片段高亮 |
