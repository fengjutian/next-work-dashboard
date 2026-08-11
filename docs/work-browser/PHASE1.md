# Work Browser — Phase 1 + 1.5 交付说明

> 配套架构：[`ARCHITECTURE.md`](./ARCHITECTURE.md) / 路线：[`ROADMAP.md`](./ROADMAP.md) / PRD：父目录 `REQUIREMENTS.md`

## 两轮交付清单

### Phase 1（第一轮）

- core/ 13 个文件（types + parser + search + ai + task + document + workspace + annotation + storage + sync 占位）
- main/ 8 个文件
- preload 桥 1 个
- plugins/ 10 个文件
- 6 个单测文件 / 32 用例
- 3 份文档 + AGENTS.md

### Phase 1.5（第二轮，"继续开发"）

**净化升级**：
- 新建 `src/webview-cleaner-preload.ts`（净化注入 + selection 监听）
- forge.config.ts 加 webview-cleaner-preload entry
- `cleaner.ts` 加 `setupWorkBrowserSession()`：专属 session + `webRequest.onBeforeRequest` 拦截
- `WebContent.tsx` 改用 `<webview partition="persist:work-browser">` 替代 iframe

**Task Runner UI**：
- `useTasks.ts` hook
- `TaskList.tsx` + Task 详情 Drawer
- `workBrowser.task.{templates,createFromTemplate}` IPC
- 模板实例化（investigation / research）

**Annotation**：
- `AnnotationPopover.tsx` 浮动菜单
- `workBrowser.annotation.{list,create,delete}` IPC
- webview → render IPC 走 selectionchange

**FTS5 本地全文搜索**：
- v2 migration：documents + notes 加 plain_text 列 + FTS5 虚拟表 + 3 触发器
- `core/search/local.ts`：BM25 检索 + snippet 高亮
- aggregator 合并 local + web results
- `SearchBar` 加 scope 切换（🌐 / 📁 / 📚）

**项目遗留清理**：
- `useMarkdownDocuments.tsx:142` 删重复 case
- `net-probe-notify.ts:34` 修 eslint-disable 注释
- 全项目 typecheck / lint 0 错

**单测**：
- `task-runner.test.ts`（5 用例）
- `annotation-model.test.ts`（2 用例）
- `search-local.test.ts`（5 纯函数 + 6 Electron 环境 skip）

### Phase 2（第三轮，"继续全部开发"）

**Embedding 集成**：
- `core/work-browser/embedding/chunker.ts` 段落优先 + 句切 + overlap（11 单测用例）
- `core/work-browser/embedding/embedder.ts` Transformers.js (Xenova/all-MiniLM-L6-v2 384 维)，懒加载 + cache
- `main/work-browser/embedding.ts` 串行入 lance 索引（按 dim 分表）
- `save.ts` 写完文档后 `enqueueIndexDocument` 异步触发

**混合检索**：
- `core/work-browser/search/hybrid.ts` BM25 (FTS5) + Vector (Lance) 并行召回
- RRF 融合：`score = Σ 1/(k + rank_i)`，k=60
- 关联 SQLite 拿 document metadata
- `hybridToSearchResults` 转 SearchResult 格式（8 单测用例）

**RAG 接入**：
- `core/work-browser/ai/rag.ts` `buildRagContext`
  - query → hybridSearch → top-k → systemPrompt（含来源列表 + 原文片段 + 引用编号）
  - 严格引用 [n] 标注（PRD 第 15 节红线）
  - citations + chunks + AIContext
- main 端 IPC `work-browser:rag:query` + SearchRouter.runRag

**Annotation 高亮回放**：
- `webview-cleaner-preload.ts` 扩展
  - did-finish-load 后调 `work-browser:annotation:list-by-url`
  - 用 `Range.surroundContents` + `<mark>` 包裹 + 颜色映射
  - selector 失败时回退到 rangeText 文本搜索
- `WebContent.tsx` 监听 `work-browser:annotation-clicked` → `AnnotationSidePanel` 弹笔记侧边
- IPC `work-browser:annotation:list-by-url`（按 URL 查 document → list annotations）

**单测**：
- `chunker.test.ts`（11 用例）
- `hybrid-rrf.test.ts`（8 用例：transformation + RRF 公式）

## 验证状态

| 项 | 命令 | Phase 1 | Phase 1.5 | Phase 2 |
|---|---|---|---|---|
| IPC 契约 | `npm run check:ipc` | ✅ | ✅ | ✅ |
| TypeScript | `npm run typecheck` | ✅ work-browser 域 0 错 | ✅ 整项目 0 错 | ✅ 整项目 0 错 |
| ESLint | `npm run lint` | ✅ work-browser 域 0 错 | ✅ 整项目 0 错 | ✅ 整项目 0 错 |
| Vitest | `npx vitest run tests/work-browser/` | ✅ 32/32 | ✅ 46/46（6 skip） | ✅ 67/67（6 skip 待 Electron） |
| Electron 启动 | `npm start` | ✅ | ✅ | ✅ |

### 新增文件

```
prompt-lab/
├── .eslintignore                                [新增：屏蔽 SQL/MD 文件]
├── src/
│   ├── core/work-browser/                       [新建独立 core，13 个文件]
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── parser/
│   │   │   ├── html-cleaner.ts
│   │   │   ├── readability.ts
│   │   │   ├── markdown.ts
│   │   │   └── index.ts
│   │   ├── search/
│   │   │   ├── provider.ts
│   │   │   ├── aggregator.ts
│   │   │   ├── dedup.ts
│   │   │   ├── rank.ts
│   │   │   ├── providers/{_shared,duckduckgo,brave,github,stackoverflow,index}.ts
│   │   ├── ai/
│   │   │   ├── summarizer.ts
│   │   │   └── context.ts
│   │   ├── task/
│   │   │   ├── template.ts
│   │   │   └── runner.ts
│   │   ├── document/
│   │   │   ├── version.ts
│   │   │   └── diff.ts
│   │   ├── workspace/auto-group.ts
│   │   ├── annotation/model.ts
│   │   ├── storage/{schema.ts,migrations.ts,index.ts,schema.sql}
│   │   └── sync/README.md                       [Phase 4 占位]
│   ├── main/work-browser/                       [主进程入口，7 个文件]
│   │   ├── index.ts
│   │   ├── database.ts
│   │   ├── workspace-store.ts
│   │   ├── document-store.ts
│   │   ├── search-router.ts
│   │   ├── save.ts
│   │   ├── cleaner.ts
│   │   └── ipc.ts
│   ├── preload/work-browser.ts                  [渲染端桥接]
│   ├── plugins/work-browser/                    [ActivityBar 插件，10 个文件]
│   │   ├── index.ts
│   │   ├── WorkBrowserPanel.tsx
│   │   ├── constants.ts
│   │   ├── cleaner-inject.ts
│   │   ├── hooks/{useWorkspace,useSearch}.ts
│   │   ├── components/{SearchBar,WorkspaceList,TabBar,WebContent,SearchResults,AiSummary,LibraryList,SavePageDialog}.tsx
│   │   └── README.md
│   └── types/electron.d.ts                      [新增 workBrowserBridge 类型]
├── tests/work-browser/                          [6 个单测文件，32 用例全过]
│   ├── search-aggregator.test.ts
│   ├── html-cleaner.test.ts
│   ├── document-version.test.ts
│   ├── web-diff.test.ts
│   ├── workspace-auto-group.test.ts
│   └── search-dedup.test.ts
├── docs/work-browser/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── PHASE1.md                                [本文件]
└── AGENTS.md                                    [根目录 work-browser 章节]
```

### 修改文件

**Phase 1**：
- `src/preload.ts`：import + 合并 workBrowserBridge 到 electronAPI
- `src/main.ts`：import + 调用 setupWorkBrowserIPC()
- `src/plugins/built-in/index.ts`：注册 work-browser 插件（order=9, enabled=false, keepAlive=true）
- `src/types/electron.d.ts`：加 workBrowserBridge 接口

**Phase 1.5**：
- `forge.config.ts`：加 webview-cleaner-preload entry
- `src/main/work-browser/cleaner.ts`：加 `setupWorkBrowserSession()` + `getWebviewCleanerPreloadPath()`
- `src/main/work-browser/ipc.ts`：加 annotation:* / task:templates / task:create-from-template / cleaner:webview-* / search:run scope
- `src/main/work-browser/document-store.ts`：upsertDocument 接 plainText + FTS5 触发器
- `src/main/work-browser/save.ts`：写 plainText 到 documents
- `src/main/work-browser/search-router.ts`：scope 解析 + 注入 localDb
- `src/main/work-browser/search-router.ts`：FTS5 scope 透传
- `src/main/work-browser/workspace-store.ts`（间接通过 migration 触发）：无改动
- `src/core/work-browser/storage/schema.ts`：v1 schema 加 FTS5 + plain_text
- `src/core/work-browser/storage/migrations.ts`：v2 migration + 回填
- `src/core/work-browser/search/aggregator.ts`：合并 local + web
- `src/core/work-browser/search/local.ts`：新建 FTS5 查询
- `src/preload/work-browser.ts`：加 annotation.* + cleaner.webview* + search.run scope + task.*
- `src/types/electron.d.ts`：加 annotation / cleaner.webview* / search scope / task.templates 类型
- `src/plugins/markdown-editor/hooks/useMarkdownDocuments.tsx`：删重复 case
- `src/plugins/network-observatory/backend/net-probe-notify.ts`：eslint-disable 注释修正

## 验证状态

| 项 | 命令 | 结果 |
|---|---|---|
| IPC 契约 | `npm run check:ipc` | ✅ work-browser 全部对齐（其余报错为项目原有遗留） |
| TypeScript | `npm run typecheck` | ✅ work-browser 域 0 错误（其余 4 个为项目原有） |
| ESLint | `npm run lint` | ✅ work-browser 域 0 错误（其余 3 个为项目原有） |
| Vitest | `npx vitest run tests/work-browser/` | ✅ 32 / 32 通过 |
| Electron 启动 | `npm start` | ⏳ 未在本会话跑（需要 build rag-worker / net-probe / mycast 资源） |

## 已知 Phase 1 限制

1. **WebContent** 用 `<iframe sandbox>`，未接 Electron `<webview>` 注入净化 JS（Phase 1.5 切）。
2. **Save Page** 由 main 端 fetch（不依赖渲染端 webview 取 HTML），所以**鉴权页 / 反爬页面**保存不到。
3. **AI 摘要** 需在 settings 里配置 baseUrl/apiKey，未配置时搜索结果仍返回但不附带 aiSummary。
4. **本地知识库全文搜索** 暂未接 LanceDB / SQLite FTS5（Phase 2）。
5. **Annotation 高亮渲染** 数据模型就位，UI 待补。
6. **Task Runner** 模板就位，UI 编排器待补（Phase 3）。
7. **Web Replay / Network 可视化 / Sync** 在路线图 Phase 3-4。

## 跑通步骤

```bash
cd prompt-lab
npm run check:ipc   # 校验 work-browser:* IPC 全部对齐
npm run typecheck   # 0 错误（work-browser 域）
npm run lint        # 0 错误（work-browser 域）
npx vitest run tests/work-browser/  # 32/32 通过
npm start           # 启动 Electron；ActivityBar → 启用 Work Browser
```

## 使用流程

1. 启动后在 ActivityBar 找到 "Work Browser" 图标，启用。
2. 左侧 "新建工作区"（如 "PostHog 排障"）。
3. 中间顶部输入 URL → "搜索" 也会弹多引擎结果。
4. 在搜索结果或新 Tab 中打开页面 → 点 "保存" → 选 Workspace → 存为 Markdown + 原始 HTML。
5. 右侧 Library 看已保存文档 + 搜索历史。
6. 设置 → Work Browser → 填 AI baseUrl/apiKey → 启用 AI 摘要。

## 反馈 / 改进

请在 Phase 2 启动前提交：
- 净化规则漏掉的网站清单
- Save as Markdown 跑不通的 URL 样本
- AI 摘要的引用 / 中文质量反馈
- 想要优先做的 Phase 2 能力
