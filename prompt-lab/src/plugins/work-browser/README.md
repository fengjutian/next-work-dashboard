# Work Browser 插件

PRD：57 章完整产品需求。插件已从 Phase 1 MVP 演进到本地知识、Research、Agent 与本地优先同步阶段。

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
| 流式搜索 | Provider 独立超时、取消、单源重试、连续失败熔断 | ✅ |
| PDF / Office | PDF、DOCX、XLS/XLSX、PPTX；Docling OCR；结构化表格/公式/批注/演讲者备注 | ✅ |
| Research 证据闭环 | 持久化证据状态、人工核验、claim ↔ evidence 映射、引用回跳 | ✅ |
| Workspace Sync | 增量基线、删除传播、冲突裁决、回滚、WebDAV/S3/Syncthing、凭据加密 | ✅ |
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

## 当前边界

- AI 摘要 / Agent 需配置 OpenAI-compatible baseUrl、apiKey 与 model；未配置不阻塞普通搜索。
- 扫描 PDF 的 OCR 需在 Library 中配置可访问的 Docling 服务地址。
- WebDAV / S3 的真实端到端验证需要用户提供目标服务和凭据；内置逻辑与模拟协议测试已覆盖。
- 官方托管 Sync Service、Mobile Companion、Team Workspace 与 Marketplace 仍属于后续生态范围。
