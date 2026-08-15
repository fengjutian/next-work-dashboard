# P1 计划: L2 Windows Job Objects + AppContainer

> **父评估**: [`docs/work-browser/SANDBOX-EVAL.md`](../SANDBOX-EVAL.md) §3.3
> **集成位置**: Rust sidecar `native/sandbox-l2/` + 主进程封装 `src/main/sandbox-l2/`
> **工作量**: 1-2 天（含 Rust 编译 + forge.config.ts 调整 + 测试）
> **风险**: 低（OS 内置 API）

---

## 0. User-Visible Milestone（验收门）

**AI 助手起的子进程（headless fetcher、未来 shell 工具）跑在 OS 隔离环境：不能读 `~/.ssh`、不能写 `C:\Windows`、不能调任意外网（除非 allowlist）。**

具体场景：work-browser agent 调 `child_process.spawn('curl', ['https://attacker.com'])` → 子进程被沙箱化 → 访问 `~/.ssh/id_rsa` 报 ACCESS DENIED → 访问 `C:\Windows\System32` 报 ACCESS DENIED → 默认网络 deny。

> **不是**"sidecar 编出来了"或"IPC 接通了"。

---

## 1. Scope

- 新建 Rust crate `native/sandbox-l2/`
- 用 `windows-rs` 封装 Job Object + AppContainer API
- 通过 JSON-RPC over stdio 与主进程通信（参考你 memory 里"Electron + 长期 sidecar 进程的端口隔离"经验）
- 主进程加 spawn helper：起子进程时自动套上沙箱
- 测试 + 文档 + forge.config.ts 更新

## 2. Out of Scope

- ❌ 不动 L1（独立轨道）
- ❌ 不动 L3
- ❌ 不实现 generic `runas` 替代品（不是这层的目的）
- ❌ 不动 work-browser 核心 agent（只暴露 spawn helper 给 agent 用）

---

## 3. Files

### 3.1 新建

```
native/
└── sandbox-l2/
    ├── Cargo.toml
    ├── src/
    │   ├── main.rs                       # JSON-RPC server
    │   ├── job_object.rs                 # Job Object 封装
    │   ├── app_container.rs              # AppContainer 封装
    │   ├── process.rs                    # spawn + attach
    │   ├── policy.rs                     # 资源限制 (CPU/内存/网络)
    │   └── ipc.rs                        # JSON-RPC schema
    └── tests/
        └── integration_test.rs

prompt-lab/
├── src/main/sandbox-l2/
│   ├── ipc.ts                            # 主进程 IPC handlers
│   ├── sidecar.ts                        # sidecar 进程管理
│   ├── spawn-helper.ts                   # spawn 包装 (agent 调这个)
│   └── policy-defaults.ts                # 默认策略
├── src/preload/sandbox-l2.ts             # renderer bridge
└── tests/work-browser/sandbox-l2/
    ├── sidecar.test.ts
    ├── spawn-helper.test.ts
    ├── job-object.test.ts                # E2E: spawn + verify
    └── app-container.test.ts             # E2E: 访问限制验证
```

### 3.2 修改

- `prompt-lab/package.json` — 加 `@charlesfeng/sandbox-l2-bindings` 之类（如直接 spawn 二进制则不加）
- `prompt-lab/forge.config.ts` — `extraResource` 加 `sandbox-l2.exe`，`asar.unpack` 路径
- `prompt-lab/src/types/electron.d.ts` — 加 `sandboxL2` 类型
- `prompt-lab/src/plugins/built-in/index.ts` — 注册（独立 plugin 或塞 P0 sandbox plugin 内）
- `prompt-lab/forge.config.cjs` 或类似 — `npm run postinstall` 触发 cargo build

---

## 4. IPC 契约

### 4.1 主进程 → Rust sidecar（JSON-RPC over stdio）

```json
// request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "spawn",
  "params": {
    "command": "curl",
    "args": ["https://api.openai.com/v1/models"],
    "policy": {
      "cpu_limit_pct": 50,
      "memory_limit_mb": 512,
      "job_kill_on_job_close": true,
      "app_container": {
        "name": "wb-headless-fetcher",
        "capabilities": ["INTERNET"],
        "allowed_paths_read": ["C:\\Users\\<user>\\.work-browser\\cache"],
        "allowed_paths_write": ["C:\\Users\\<user>\\.work-browser\\cache"],
        "network": "allowlist",
        "network_allowlist": ["api.openai.com", "*.github.com"]
      }
    }
  }
}

// response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "pid": 12345,
    "handle": "uuid-v4"
  }
}
```

Methods:
- `spawn` — 起受限子进程
- `kill` — 杀进程
- `status` — 子进程状态
- `metrics` — CPU/内存/net 实时
- `list` — 当前所有受限进程

### 4.2 renderer → main（Electron IPC）

```ts
'sandbox:spawnIsolated'(cmd: string, args: string[], opts: SandboxOpts): Promise<{ handle: string; pid: number }>
'sandbox:killIsolated'(handle: string): Promise<void>
'sandbox:listIsolated'(): Promise<Array<{ handle: string; pid: number; cmd: string; startedAt: number }>>
```

---

## 5. 关键设计

### 5.1 Rust crate 选型

- `windows = "0.58"` — 官方 Windows API binding
- `serde` + `serde_json` — JSON-RPC 序列化
- `tokio` — async runtime（与 `native/voice-engine` 等保持一致）
- 编译目标：`x86_64-pc-windows-msvc`（与项目 native/ 其它 crate 一致）

### 5.2 Job Object 配置

- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — 父进程退出时连带杀子进程
- `JOB_OBJECT_LIMIT_PROCESS_MEMORY` — 内存硬限
- `JOB_OBJECT_LIMIT_CPU` — CPU 时间百分比限制
- `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` — 最多 N 个子进程
- **不**用 `JOB_OBJECT_LIMIT_BREAKAWAY_OK`（防逃逸）

### 5.3 AppContainer 配置

- 通过 `CreateAppContainerProfile` + `GetAppContainerFolderPath` 拿到 SID
- spawn 时 `STARTUPINFO` 带 `AppContainerSid`
- capability 集合默认 `["INTERNET"]`（最小权限）
- 文件 ACL 通过 SetSecurityInfo 限定 allowed_paths
- 网络：默认 deny，配合 Windows Filtering Platform (WFP) 加 allowlist

### 5.4 sidecar 进程模型

- 启动：`spawn(native/sandbox-l2.exe, { stdio: ['pipe', 'pipe', 'pipe'] })`
- 通信：JSON-RPC over stdio
- 错误处理：sidecar 崩了 → 主进程自动重启 → 重建子进程列表
- 端口隔离：你 memory 里有先例，用 `--http-port=0` 或纯 stdio 通信避坑

### 5.5 默认策略（policy-defaults.ts）

```ts
export const DEFAULT_POLICY = {
  cpu_limit_pct: 50,
  memory_limit_mb: 512,
  job_kill_on_job_close: true,
  app_container: {
    capabilities: ['INTERNET'],
    allowed_paths_read: [],   // 默认全 deny
    allowed_paths_write: [],
    network: 'deny',         // 默认 deny
  },
};
```

agent 调 spawn helper 必须显式声明网络/文件需求。

---

## 6. 测试

### 6.1 Rust 单元测试（`native/sandbox-l2/tests/`）

| # | 用例 |
|---|---|
| 1 | Job Object 创建 + 进程 attach |
| 2 | 内存超限 → 进程被杀 |
| 3 | AppContainer SID 创建 |
| 4 | 路径 ACL 设置成功 |

### 6.2 E2E 测试（`tests/work-browser/sandbox-l2/`）

| # | 用例 |
|---|---|
| 1 | spawn `whoami` → 跑通，stdout 正确 |
| 2 | spawn `cmd /c type C:\Users\<user>\.ssh\id_rsa` → ACCESS DENIED |
| 3 | spawn `cmd /c dir C:\Windows\System32` → ACCESS DENIED |
| 4 | spawn `curl https://evil.com`（无 allowlist）→ 网络拒绝 |
| 5 | spawn `curl https://api.openai.com`（有 allowlist）→ 成功 |
| 6 | `Get-Process` 显示子进程 Job Object ID 不为 0 |
| 7 | 父进程退出 → 所有子进程连带 kill |

### 6.3 集成测试

- 主进程 IPC handler 单元测试
- sidecar 重启场景
- 与 P0 共存（P0 的 dry-run 不需要 L2 配合）

---

## 7. 验收

- ✅ `cargo build --release` 在 `native/sandbox-l2/` 成功
- ✅ `cargo test` 全过
- ✅ `npm run check:ipc` 0 错
- ✅ `npm run typecheck` 0 错
- ✅ `npm run lint` 0 错
- ✅ `npx vitest run tests/work-browser/sandbox-l2/` 100% 通过
- ✅ `npx vitest run tests/work-browser/` 32/32 全过
- ✅ `npm run package` 打出安装包，sidecar .exe 在 `extraResource` 路径
- ✅ 手测：agent 调 spawn helper 起 `curl`，实际验证网络被 deny

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| `windows-rs` API 跨 Windows 版本差异 | 限定 Windows 10 1809+（AppContainer 完整）|
| Job Object 杀进程时延 | 接受默认行为（os 自行调度）|
| forge.config.ts 集成 | 参考 `native/voice-engine` 已有模式 |
| AppContainer 首次创建 profile 失败 | 重试 + 错误日志 |
| 跨用户（SYSTEM 账户）跑不起 AppContainer | 主进程做检测，失败回退到 Job Object only |
