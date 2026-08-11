# Work Browser 插件

PRD：57 章完整产品需求 → 本插件为 **Phase 1 MVP**（PRD 第 53 节）。

## 本轮交付范围

| PRD 章节 | 内容 | 状态 |
|---|---|---|
| 7. Workspace 资源 | Workspace/Tab/Document/Note/Task/AI 模型 | ✅ |
| 8. Task | Task 数据模型 + 模板（investigation/research）+ Runner | ✅ |
| 10–15. 多引擎搜索 | 4 个 provider（DuckDuckGo/Brave/GitHub/StackOverflow）+ 聚合 + 去重 + 排序 + AI 摘要 | ✅ |
| 17. 网页净化 | network 层域名黑名单 + DOM 层 CSS 注入 | ✅ Phase 1（CSS 注入）；Phase 2 升级 webview JS |
| 20. 网页保存 | Save as Markdown + 原始 HTML 归档 + 版本检测 | ✅ |
| 27. 本地搜索 | SQLite + 跨 Workspace 搜索历史 | ✅ Phase 1（SQLite）；Phase 2 接 LanceDB |
| 32. AI Provider | OpenAI-compatible 协议（覆盖 OpenAI/DeepSeek/Qwen/Ollama） | ✅ Phase 1 |
| 47. 右键菜单 | Phase 2 | ⏳ |
| 48. 快捷键 | Phase 2 | ⏳ |
| 49. Command Palette | Phase 2 | ⏳ |
| 53. Phase 1 MVP | 浏览/Tab/Workspace/多引擎/聚合/净化/Save Markdown/SQLite/Library/基础 AI | ✅ |

## 架构

```
┌─────────────────────────────────────────────┐
│  src/plugins/work-browser/                   │  ← 渲染端
│  ├── WorkBrowserPanel.tsx                    │
│  ├── components/                             │
│  └── hooks/                                  │
├─────────────────────────────────────────────┤
│  src/main/work-browser/                      │  ← 主进程
│  ├── database.ts (SQLite 单例)               │
│  ├── workspace-store.ts / document-store.ts  │
│  ├── search-router.ts (聚合)                 │
│  ├── save.ts (Save as Markdown)              │
│  ├── cleaner.ts (净化 pipeline)              │
│  └── ipc.ts (work-browser:* handlers)        │
├─────────────────────────────────────────────┤
│  src/core/work-browser/                      │  ← 纯函数 + 类型
│  ├── types.ts                                │
│  ├── parser/ (html-cleaner / readability / markdown)
│  ├── search/ (provider / aggregator / dedup / rank)
│  ├── ai/ (summarizer / context)
│  ├── task/ (template / runner)
│  ├── document/ (version / diff)
│  ├── workspace/ (auto-group)
│  └── storage/ (schema / migrations)         │
├─────────────────────────────────────────────┤
│  src/preload/work-browser.ts                 │  ← IPC 桥
└─────────────────────────────────────────────┘
```

## 跑通

```bash
cd prompt-lab
npm run check:ipc   # 校验 IPC 契约
npm run typecheck   # 编译检查
npm test -- work-browser  # 单元测试
npm start
```

## 已知 Phase 1 限制

- **WebContent** 用 `<iframe sandbox>`，未接 Electron `<webview>` 注入净化 JS。
- **Save Page** 由 main 端 fetch（不依赖渲染端 webview 取 HTML）。
- **AI 摘要** 需在设置中配置 baseUrl/apiKey，未配置时不阻塞搜索。
- **本地知识库全文搜索** 暂未接 LanceDB（Phase 2）。
- **Annotation 高亮渲染** 暂未实现（数据模型就位）。
- **Task Runner** 模板就位，UI 编排器待补。
- **Web Replay / Network 可视化 / Sync** 在路线图 Phase 3-4。
