# Work Browser — Phase 1 交付说明

> 配套架构：[`ARCHITECTURE.md`](./ARCHITECTURE.md) / 路线：[`ROADMAP.md`](./ROADMAP.md) / PRD：父目录 `REQUIREMENTS.md`

## 交付清单

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

- `src/preload.ts`：import + 合并 workBrowserBridge 到 electronAPI
- `src/main.ts`：import + 调用 setupWorkBrowserIPC()
- `src/plugins/built-in/index.ts`：注册 work-browser 插件（order=9, enabled=false, keepAlive=true）
- `src/types/electron.d.ts`：加 workBrowserBridge 接口

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
