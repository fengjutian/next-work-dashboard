# P0 计划: L1 isolated-vm（Work Browser Agent Dry-Run）

> **父评估**: [`docs/work-browser/SANDBOX-EVAL.md`](../SANDBOX-EVAL.md) §3.1
> **集成位置**: 独立 plugin `src/plugins/sandbox/`
> **工作量**: 3-4 小时（含测试）
> **风险**: 低

---

## 0. User-Visible Milestone（验收门）

**AI 助手在调用任何 work-browser tool 之前，会先在 V8 isolate 内 dry-run，把"打算做什么"展示给用户，等用户确认后再真做。**

具体场景：用户让 agent "保存 GitHub Trending 页面"，agent 准备调 `savePage({ url, html })` → UI 弹窗显示"AI 打算写 1 个文件到 `/workspace/research/github-trending.md`，确认？" → 用户点确认 → 真做。

> **不是**"isolated-vm 装上了"或"sandbox 框架写好了"。

---

## 1. Scope

- 加 `isolated-vm` 依赖
- 新建独立 plugin `src/plugins/sandbox/`
- 新建主进程封装 `src/main/sandbox/`
- agent runner 改造：`execute()` 前自动 dry-run
- 测试 + 文档

## 2. Out of Scope

- ❌ 不改 agent 现有 UI 流程（只新增 dry-run 拦截层）
- ❌ 不动 L2 / L3
- ❌ 不动 work-browser 核心架构
- ❌ 不实现"AI 自动生成 JS 在 isolate 跑"（那是 L1 alt Wasmtime 的事）

---

## 3. Files

### 3.1 新建

```
prompt-lab/
├── src/
│   ├── plugins/sandbox/
│   │   ├── index.ts                         # plugin manifest
│   │   ├── ui.tsx                           # settings panel (toggle)
│   │   ├── WorkBrowserSandboxPanel.tsx      # main UI panel
│   │   ├── components/
│   │   │   ├── DryRunPreview.tsx            # dry-run 结果展示
│   │   │   └── IsolateStatusBadge.tsx       # 状态指示
│   │   └── README.md
│   ├── main/sandbox/
│   │   ├── ipc.ts                           # IPC handlers
│   │   ├── isolated-vm.ts                   # V8 isolate 封装
│   │   ├── isolate-pool.ts                  # isolate 复用
│   │   ├── dry-run.ts                       # dry-run 逻辑
│   │   └── lifecycle.ts                     # 启停
│   └── preload/sandbox.ts                   # renderer bridge
├── tests/work-browser/sandbox/
│   ├── isolated-vm.test.ts
│   ├── isolate-pool.test.ts
│   ├── dry-run.test.ts
│   └── ipc.test.ts
└── docs/work-browser/sandbox-plans/
    └── P0-L1-isolated-vm.md                 # 本文件
```

### 3.2 修改

- `prompt-lab/package.json` — 加 `isolated-vm` 依赖
- `prompt-lab/src/types/electron.d.ts` — 加 `sandbox` 类型
- `prompt-lab/src/plugins/built-in/index.ts` — 注册新 plugin
- `prompt-lab/src/core/work-browser/agent/runner.ts` — `execute()` 前插 `dryRun` 调用
- `prompt-lab/src/core/work-browser/agent/runner.ts` 的 `ToolContext` 加 `dryRun` 字段

---

## 4. IPC 契约

```ts
// renderer → main (src/main/sandbox/ipc.ts)
'sandbox:dryRun'(toolCall: {
  name: string;          // tool name (e.g. "savePage")
  args: any;             // tool args
  workspaceId: string | null;
}): Promise<{
  ok: true;
  effects: Array<{
    kind: 'ipc' | 'file' | 'log';
    target: string;      // IPC channel 或 文件路径
    preview: string;     // 截断后的内容预览
  }>;
  warnings: string[];    // 检测到的可疑模式
} | {
  ok: false;
  reason: string;        // 拒绝原因（host bridge 调用了不允许的 API 等）
}>

'sandbox:enable'(enabled: boolean): Promise<{ enabled: boolean }>
'sandbox:status'(): Promise<{ enabled: boolean; poolSize: number; poolIdle: number }>
'sandbox:configure'(opts: { maxPoolSize?: number; autoDryRun?: boolean }): Promise<void>
```

`src/preload/sandbox.ts` 暴露 `window.electronAPI.sandbox`。

`src/types/electron.d.ts` 扩展：
```ts
declare global {
  interface ElectronAPI {
    sandbox: {
      dryRun: (toolCall: ...) => Promise<...>;
      enable: (enabled: boolean) => Promise<...>;
      status: () => Promise<...>;
      configure: (opts: ...) => Promise<void>;
    };
  }
}
```

---

## 5. 关键设计

### 5.1 Isolate pool

- 单 isolate V8 启动 ~50ms，每个 tool 都启不可接受
- pool size=2，任务队列，idle 30s 回收
- 每次 dry-run = 从 pool 借 isolate，注入 host bridge 引用，跑完归还

### 5.2 Host bridge（注入到 isolate 的 API）

**允许**:
- `host.preview(text: string)` → 返回截断后的字符串（宿主用来做 UI 展示）
- `host.log(message: string, level: 'info' | 'warn' | 'error')` → 宿主写日志
- `host.effect(kind, target, preview)` → 累积 effect 列表

**禁止**（默认不存在）:
- `require` / `import` / `process` / `global` / `fetch` / `XMLHttpRequest`
- `Buffer` / `fs` / `path`
- 任何 Node.js / Electron API

dry-run 代码做静态检查：检测到上述关键字直接拒绝（`{ ok: false, reason: 'forbidden_api' }`）。

### 5.3 Dry-run 执行流程

```
agent.execute(toolName, args)
  ↓
1. 调 sandbox:dryRun({ name: toolName, args, workspaceId })
  ↓
2. main 进程：pool 借 isolate → 注入 host bridge → 跑 dry-run 脚本
  ↓
3. dry-run 脚本：根据 toolName 选模板（如 savePage → 模拟生成 effect）
  ↓
4. isolate 归还，effects 返回 renderer
  ↓
5. UI 弹 DryRunPreview，显示 effects，等用户确认
  ↓
6. 确认 → agent 走原路径 execute（真做）
   取消 → throw 'user_cancelled'
```

### 5.4 Dry-run 模板（每个 tool 一份）

定义在 `src/main/sandbox/dry-run-templates.ts`：
```ts
{
  savePage: (args) => ({
    effects: [{ kind: 'file', target: `workspace/${args.workspaceId}/${slugify(args.title || args.url)}.md`, preview: args.html?.slice(0, 200) }],
    warnings: [],
  }),
  searchWeb: (args) => ({
    effects: [{ kind: 'ipc', target: 'workBrowser:search:run', preview: JSON.stringify(args) }],
    warnings: args.query.includes(';rm ') ? ['suspicious_chars_in_query'] : [],
  }),
  // ... 每个 tool 一份
}
```

---

## 6. 测试

### 6.1 `tests/work-browser/sandbox/isolated-vm.test.ts`

| # | 用例 |
|---|---|
| 1 | isolate 内能跑 host 注入的 pure function |
| 2 | isolate 内不能 `require('fs')`（返回拒绝结果）|
| 3 | isolate 内调不存在的 host API 抛 ReferenceError |
| 4 | isolate 内能累积 effects（多次调 host.effect）|
| 5 | isolate 跑超时（5s）被强制终止 |
| 6 | 两个 isolate 并行跑互相隔离（global 不共享）|

### 6.2 `tests/work-browser/sandbox/isolate-pool.test.ts`

| # | 用例 |
|---|---|
| 1 | 借 → 用 → 归还，size 不增长 |
| 2 | pool 满时新请求排队 |
| 3 | idle 30s 后 isolate 数量下降 |
| 4 | 关闭 app 时 pool 清理 |

### 6.3 `tests/work-browser/sandbox/dry-run.test.ts`

| # | 用例 |
|---|---|
| 1 | `savePage` dry-run 返回正确的 file effect |
| 2 | `searchWeb` dry-run 检出 `;rm -rf` 警告 |
| 3 | 不存在的 tool 返回 `{ ok: false, reason: 'unknown_tool' }` |
| 4 | `autoDryRun: false` 时跳过 dry-run 直接放行 |

### 6.4 `tests/work-browser/sandbox/ipc.test.ts`

- `check:ipc` 同步通过
- preload typecheck 通过
- 4 个 channel 都有 handler

### 6.5 现有测试不能破

- `npx vitest run tests/work-browser/` → 32/32 必须全过
- 现有 IPC 调用方（`agent/runner.ts`）改动需要向后兼容

---

## 7. 验收

- ✅ `npm run check:ipc` 0 错
- ✅ `npm run typecheck` 0 错（work-browser 域）
- ✅ `npm run lint` 0 错
- ✅ `npx vitest run tests/work-browser/sandbox/` 100% 通过
- ✅ `npx vitest run tests/work-browser/` 32/32 全过（不破）
- ✅ 手测：agent 调 savePage 时 UI 弹 dry-run 预览，用户点确认后真做

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| isolated-vm 在 Electron 35 native binary 兼容 | 装包后跑 typecheck + vitest 验 |
| V8 isolate 内存占用（每个 ~10MB）| pool size=2，限额可控 |
| agent 改 execute 路径影响其他 caller | 默认 `autoDryRun: false`，feature flag 控 |
| dry-run 模板漏写（新 tool 上线没模板）| lint 规则：每个 tool 必填 dry-run 模板 |
