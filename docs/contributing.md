---
layout: default
title: "🤝 贡献指南"
---

# 🤝 贡献指南

> 参与 next-work-dashboard 开发前请先阅读本文。

---

## 1. 环境准备

```bash
git clone <repo-url>
cd next-work-dashboard/prompt-lab
npm install
npm start        # 启动开发模式
npm test         # 运行测试
npm run lint     # 代码检查
```

| 工具 | 版本要求 |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |

> 原生依赖（node-pty、lancedb）首次安装时通过 `npm run prepare:native` 自动重建。

---

## 2. 分支策略

| 分支 | 用途 |
|---|---|
| `main` | 稳定版本，随时可发布 |
| `feature/*` | 新功能开发 |
| `fix/*` | Bug 修复 |
| `docs/*` | 文档更新 |

### PR 流程

1. 从 `main` 创建功能分支
2. 开发 + 测试 + lint + typecheck
3. 创建 PR，描述变更内容
4. 代码审查
5. 合并到 `main`

---

## 3. 代码规范

### 3.1 TypeScript

- 严格模式：`strict: true`
- 禁止 `any`（特殊情况需注释说明）
- 导出函数和接口必须有 JSDoc 注释
- 提交前运行 `npm run typecheck`

### 3.2 React

- 使用函数组件 + Hooks
- Props 使用 `interface` 定义
- 组件文件命名：PascalCase（如 `WebViewContainer.tsx`）
- 避免超过 200 行的单文件组件

### 3.3 命名约定

| 类型 | 约定 | 示例 |
|---|---|---|
| 文件 | kebab-case 或 PascalCase | `injector.ts` / `WebViewContainer.tsx` |
| 函数 | camelCase | `buildInjectionScript()` |
| 接口 | PascalCase | `Plugin` / `SiteConfig` |
| 常量 | UPPER_SNAKE | `DEFAULT_SITES` |
| IPC Channel | `domain:action` | `db:load` / `inject-prompt` |

### 3.4 文件组织

```
src/
├── main.ts              # 主进程入口（窗口/托盘/快捷键/IPC/工作区）
├── preload.ts           # contextBridge API 暴露（window.electronAPI）
├── webview-preload.ts   # WebView 注入 + 反指纹
├── renderer.tsx         # React 入口
├── main/                # 主进程逻辑：IPC、Agent、Git、工作区、MCP、托盘、终端
├── core/                # 纯函数，零运行时依赖，可独立测试（注入/LLM/Agent/工具/知识库）
├── components/          # 通用 UI 组件
├── features/            # 功能域（如 prompts）
├── plugins/             # 插件系统（每个插件一个目录）
├── store/               # Zustand Store
├── services/            # 渲染进程服务
├── db/                  # SQLite + Drizzle
├── hooks/               # 自定义 Hooks
├── auth/                # Token 安全存储
└── types/               # 全局类型
```

---

## 4. 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]
```

| Type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `refactor` | 重构（无功能变化） |
| `test` | 测试 |
| `chore` | 构建/工具链 |

示例：
```
feat(injector): 支持追加模式注入
fix(webview): 修复标签页关闭后 Session 未释放
docs(plugin): 更新 Sandbox SDK 文档
```

---

## 5. 测试

### 5.1 测试框架

| 工具 | 用途 |
|---|---|
| Vitest 2 | 测试运行器 |
| Testing Library | React 组件测试 |

### 5.2 测试要求

- 核心逻辑（`src/core/`、`src/main/workspace/`、`src/main/git/`）必须覆盖
- 新增功能同时提交测试
- 运行 `npm test` 全部通过后再提交

```bash
npm test               # 运行全部测试
npm run test:ui        # UI 模式
npm run test:coverage  # 覆盖率报告
```

### 5.3 一键全量检查

```bash
npm run check
# = typecheck + lint + test + check:ipc + check:docs + check:encoding
```

---

## 6. 文档更新

代码行为变化时，**同一变更中**更新对应文档：

| 变更类型 | 更新文档 |
|---|---|
| 新增/修改插件 API | `docs/plugin-architecture.md` |
| 新增/修改功能 | `docs/function-and-principles.md` + `FEATURE_CHECKLIST.md` |
| 修改设置项 | `docs/user-guide.md` + `REQUIREMENTS.md` |
| 修改构建流程 | `docs/project-intro-and-deploy.md` |
| 修改安全模型 | `docs/security.md` |

文档链接校验：`npm run check:docs`（确保相对链接不失效）。

---

## 7. 架构原则

1. **Core/UI 分离**：核心逻辑放在 `src/core/`，纯函数、零运行时依赖
2. **类型安全**：IPC 通信、数据库 Schema、插件接口全部类型化
3. **安全优先**：渲染进程零 Node.js 权限、插件沙箱隔离、Token 加密存储、Agent 隔离 Worktree
4. **渐进增强**：预览先行再编辑、内置优先再用户插件
