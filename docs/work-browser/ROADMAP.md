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

## Phase 2：本地知识 + RAG（**已部分交付**：FTS5 完成；Embedding/RAG 待）

- ✅ **本地全文搜索**：BM25（SQLite FTS5）— documents_fts + notes_fts + 触发器同步
- ✅ **多 scope 检索**：SearchBar 加 🌐网络 / 📁工作区 / 📚全库 三档
- ✅ **save 时写 plain_text**：FTS5 索引内容来源
- ⏳ **Embedding**：复用 `lancedb-memory`（已有）做 Document / Note / Annotation 向量化
- ⏳ **RAG**：AI 回答时检索 top-k + 原文片段引用 + 高亮
- ⏳ **Note 富文本**：复用 markdown-editor，集成 wiki-link / 反向引用
- ⏳ **PDF / Docling 接入**：复用 document-knowledge 已有 PDF 解析
- ⏳ **AI Context 切换**：当前页 / Workspace / 全库 / 选中文档 四档
- ⏳ **Embedding 升级的 Workspace auto-group**：用余弦相似度替换 Jaccard
- ⏳ **Annotation 高亮回放**：webview 加载 document 时按 selector 重新渲染高亮

## Phase 3：Task + Research + 可视化（建议 6–8 周）

- ⏳ **Task 编排 UI**：可视化 step 进度、AI 自动填证据
- ⏳ **Research Mode**：多步研究流程（搜索 → 净化 → 摘要 → 报告）一站式
- ⏳ **Web Diff 增强**：diff-match-patch 字符级 + AI 解释变更
- ⏳ **Research Graph**：Knowledge Graph 加 page-level 边（cited-by / similar-to / searched-from / opened-from / saved-with）
- ⏳ **AI Agent**：MCP 工具接入，可执行"打开/点击/搜索/提取/保存"工作流
- ⏳ **Developer Mode**：Network 面板（已在 network-observatory 借鉴）+ Console + WebSocket / WebRTC trace
- ⏳ **Web Replay**：Navigation / Click / Input / Network / Console / Screenshot 录制 + 回放

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
