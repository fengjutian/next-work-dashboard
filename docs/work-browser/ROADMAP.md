# Work Browser — 4 阶段路线图

> 完整 PRD 见 `../REQUIREMENTS.md`。本文件描述从 Phase 1（已交付）到 Phase 4 的演进路径。

## Phase 1：MVP（**已交付**）

**目标**：跑通 PRD 第 53 节定义的主链路。

- ✅ 浏览（webview）
- ✅ Tab 管理（数据模型 + UI）
- ✅ Workspace 容器（聚合 Tab/Document/Note/Task）
- ✅ 多引擎搜索（DuckDuckGo / Brave / GitHub / StackOverflow）
- ✅ 搜索结果聚合（normalize + dedupe + rank + AI 摘要）
- ✅ 网页净化（CSS + JS 注入 + 网络层拦截）
- ✅ Save as Markdown（含原始 HTML 归档 + 版本 diff）
- ✅ SQLite（workspaces / tabs / documents / document_versions / notes / annotations / tasks / ai_conversations / search_history / settings）
- ✅ Library（文档 + 搜索历史）
- ✅ 基础 AI（OpenAI-compatible 摘要）

**入口**：ActivityBar → Work Browser 图标（默认未启用，需在设置里开启）。

## Phase 1.5：体验打磨 + 净化升级（**本轮已交付**）

**目标**：把 Phase 1 跑通的能力做得更好用 + 净化效果从"样式遮盖"升级为"真正干掉"。

- ✅ **净化升级**：
  - iframe 切到 Electron `<webview>` 标签
  - 新建 `webview-cleaner-preload.ts`：从 main 拉 cleaner payload，DOM 加载时注入 CSS + JS
  - `session.fromPartition('persist:work-browser')` 专属 session + `webRequest.onBeforeRequest` 拦截 blockedDomains（不影响其他插件的 webview）
- ✅ **Task Runner UI**：
  - 新建 `TaskList.tsx` + `useTasks.ts` hook
  - 按状态分组（todo / investigating / testing / resolved / blocked）
  - Task 详情 Drawer：步骤可视化（Steps 组件）+ 状态切换 + evidence 填入
  - 模板实例化（investigation / research）+ 自定义标题
- ✅ **Annotation 数据 + 浮动菜单**：
  - `AnnotationPopover.tsx`：webview 选中文字 → 浮动菜单（高亮 / 添加笔记 / 取消）
  - IPC `work-browser:annotation:{list,create,delete}` 完整
  - webview preload 监听 selectionchange → 渲染端 → 弹菜单
- ✅ **项目遗留清理**：
  - 修 `useMarkdownDocuments.tsx:142` 重复 `case 'set-save-state'`
  - 修 `net-probe-notify.ts:34` `eslint-disable` 注释写错的规则名
  - 全项目 typecheck / lint 0 错

**入口**：ActivityBar → Work Browser → 右侧 Sider 切到 "Tasks" tab。

## Phase 2：本地知识 + RAG（**本轮已交付**）

- ✅ **本地全文搜索**：BM25（SQLite FTS5）— documents_fts + notes_fts + 触发器同步
- ✅ **多 scope 检索**：SearchBar 加 🌐网络 / 📁工作区 / 📚全库 三档
- ✅ **Embedding 集成**：Transformers.js (Xenova/all-MiniLM-L6-v2 384 维) + chunker 滑动窗口
  - `core/work-browser/embedding/chunker.ts` 段落优先切分
  - `core/work-browser/embedding/embedder.ts` mean-pooled + normalize
  - `main/work-browser/embedding.ts` 串行入 lance 索引（dim 分表）
  - `save.ts` 写完文档后 `enqueueIndexDocument` 异步触发
- ✅ **混合检索**：`core/work-browser/search/hybrid.ts`
  - BM25 (FTS5) + Vector (Lance cosine) 双路并行
  - RRF 融合：`score = Σ 1/(k + rank_i)`，k=60
  - 关联 SQLite 拿 document metadata
- ✅ **RAG 接入**：`core/work-browser/ai/rag.ts`
  - query → hybridSearch → top-k → systemPrompt（含来源列表 + 原文片段 + 引用编号）
  - 严格引用 [n] 标注（PRD 第 15 节红线）
  - main 端 IPC `work-browser:rag:query` + SearchRouter.runRag
- ✅ **Annotation 高亮回放**：
  - webview-cleaner-preload 在 `load` 事件后自动调 `work-browser:annotation:list-by-url`
  - 用 `Range.surroundContents` + `<mark>` 包裹 + 颜色映射（黄/绿/红/蓝/紫）
  - selector 失败时回退到 rangeText 文本搜索
  - 点击高亮 → sendToHost → WebContent 弹笔记侧边面板
- ⏳ **Note 富文本**：复用 markdown-editor，集成 wiki-link / 反向引用
- ⏳ **PDF / Docling 接入**：复用 document-knowledge 已有 PDF 解析
- ⏳ **AI Context 切换**：当前页 / Workspace / 全库 / 选中文档 四档
- ⏳ **Embedding 升级的 Workspace auto-group**：用余弦相似度替换 Jaccard

## Phase 3：Task + Research + 可视化（**infra 已交付**）

> infra 层（core 逻辑 + 数据模型 + IPC handler）已落地。**用户能不能用到**是 Phase 3.5 的事。

- ✅ **Task 编排 infra**：
  - `core/work-browser/task/auto-handlers.ts` — INVESTIGATION / RESEARCH 两个模板的 step-handler 链
  - `main/work-browser/ipc.ts:work-browser:task:run-auto` — 跑全链 + 实时落库
  - `useTasks.runAuto` 包装
- ✅ **Research Mode infra**：
  - `core/work-browser/research/mode.ts` — 6 阶段状态机（plan → search → extract → analyze → write → save）
  - `main/work-browser/ipc.ts:work-browser:research:run` — 一步生成结构化报告
- ✅ **Research Graph infra**：
  - `core/work-browser/graph/edges.ts` — 5 种边（cited-by / similar-to / searched-from / opened-from / saved-with）
  - SQLite v3 migration 加 `page_edges` 表
  - `main/work-browser/ipc.ts:work-browser:graph:{list-by-document,list-by-workspace,record-saved-with}`
- ✅ **AI Agent infra**：
  - `core/work-browser/agent/runner.ts` — 5 个内置 tool（search / rag / save-document / open-tab / create-annotation）+ 危险工具 confirm + rate limit
  - `main/work-browser/ipc.ts:work-browser:agent:run` — 单轮 tool-calling 循环
- ⏳ **Web Diff 增强**：diff-match-patch 字符级 + AI 解释变更
- ⏳ **Developer Mode**：Network 面板（已在 network-observatory 借鉴）+ Console + WebSocket / WebRTC trace
- ⏳ **Web Replay**：Navigation / Click / Input / Network / Console / Screenshot 录制 + 回放

## Phase 3.5：user-visible UI 补全（**本轮已交付**）

> Phase 3 跑通了数据 / IPC，但**用户从 Work Browser 面板上点不到**这些能力。Phase 3.5 把它们接到 Sider 4 个 tab。

- ✅ **A · Research Mode UI**：`SearchBar` "Research" 按钮 → `ResearchDrawer.tsx`（输入 + 6 步进度条 + 报告 + 引用链接）。完成时自动 refresh documents。
- ✅ **B · Task Runner 自动编排 UI**：`TaskList` 每张卡片 + Drawer 内加 `▶ Run Auto` 按钮（带 `Popconfirm` 提示 30s~1min）。`message.loading` 全局提示，`runAuto` 完成后整 task 替换本地 state，steps 自动按 `in-progress` / `done` 标色。
- ✅ **C · AI Agent UI 入口**：右侧 Sider 加 `🤖 Agent` tab → `AgentPanel.tsx`。Input + 发送按钮（Shift+Enter 换行），结果区展示 `answer` + 工具调用表格（危险动作红色 deny 标签）+ steps 流 + `availableTools` 标签云。`useState` 保留 10 条历史。
- ✅ **D · Research Graph 可视化**：右侧 Sider 加 `🔗 Graph` tab → `GraphView.tsx`：
  - `cytoscape` + `cytoscape-fcose` 力导向布局
  - 节点 = `Document`，5 种边按 kind 染色（蓝 / 紫 / 绿 / 橙 / 灰）
  - 边权重映射到 `width`，hover 显示 kind + weight
  - 节点点击 → 调 `onOpenDocument(url)` 在主 webview 打开
  - 上方过滤器（按 kind 过滤）+ 节点/边计数 + 重新布局 / 适应屏幕按钮
- ✅ **cyto-fcose.d.ts** 类型 shim（包没自带 types）

**入口**：ActivityBar → Work Browser → 右侧 Sider 看到 4 个 tab：`Library` / `Tasks` / `🔗 Graph` / `🤖 Agent`。

## Phase 3.5.1：细节打磨（**本轮已交付**）

> 在 Phase 3.5 跑通 4 个 tab 后，挑 user-visible 价值最高的 3 处做深。

- ✅ **A · Agent 危险动作 confirm dialog**：
  - main 端 `work-browser:agent:run` 把 `confirmDanger` 改为 `dialog.showMessageBox(getMainWindow(), { type: 'warning', buttons: ['允许', '拒绝'], defaultId: 1, cancelId: 1 })`
  - detail 显示 tool 名 + reason + 截断 600 字符的 args JSON
  - 决策记录到 `console.log` 便于 audit
  - AgentPanel 顶部提示「危险动作会弹原生 dialog 让你确认」
- ✅ **B · AI Context 切换（4 档）**：
  - main 端 agent IPC 接受 `contextSources: { workspace?, currentPage?, specificDocuments? }`
  - 自动拼成 `<work-browser-context>...</work-browser-context>` block 注入 system prompt 头部
  - AgentPanel 加 `Segmented`：`🌐无` / `📁WS` / `📄页` / `📑选`
  - 「当前页」从 `activeTab` 传 props 进 AgentPanel
  - 「指定文档」弹 Modal 多选（带搜索过滤 + 计数）
- ✅ **C · Graph tab / annotation 节点**：
  - 加新 IPC `work-browser:annotation:list-by-workspace`（JOIN 一次拿全）
  - GraphView props 加 `tabs` / `annotations`
  - 节点区分：Document（蓝色圆形）/ Tab（橙色六边形）/ Annotation（紫色菱形）
  - 节点类型过滤器（仅文档 / 仅 Tab / 仅注释 / 所有）
  - Annotation 节点点击弹 detail 框：note + rangeText 引用
  - 自引用边 / 非三类型边过滤
- ✅ **验证**：typecheck 0 错、check:ipc work-browser 域 0 错、vitest 83/83、eslint 0 errors

## Phase 4：Sync + 生态（建议 8–12 周）

- ⏳ **Sync**：
  - Phase 4.1: Syncthing（peer-to-peer）
  - Phase 4.2: WebDAV / S3 / NAS
  - Phase 4.3: 官方 Sync Service
- ⏳ **Mobile Companion**：iOS / Android 端只读 + 标注
- ⏳ **Team Workspace**：多人共享 + 权限 + 审计
- ⏳ **Marketplace**：第三方 SearchProvider / CleanerRules / TaskTemplate

## 不在路线图

- **浏览器引擎替换**（如自研）：方向偏离，不做。
- **替代 Chrome 主战场**：不与 Chrome 竞争日常浏览，只做"工作场景浏览器"。
- **大型多模态模型集成**：Phase 1 用 GPT-4o-mini 已足够；Vision / Audio 留待 Phase 4+。

## 节奏

每阶段结束都重做一次"完整交付"：
1. vitest 单测 0 fail
2. `npm run check:ipc` 通过
3. `npm run typecheck` 通过
4. `npm run lint` 0 新增 error
5. `npm start` 跑通主链路
6. README / AGENTS.md / ROADMAP.md 同步更新
