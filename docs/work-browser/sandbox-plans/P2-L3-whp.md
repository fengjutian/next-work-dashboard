# P2 计划: L3 自建 WHP 包装 (Rust + libkrun)

> **父评估**: [`docs/work-browser/SANDBOX-EVAL.md`](../SANDBOX-EVAL.md) §3.4
> **集成位置**: Rust sidecar `native/sandbox-l3/` + 主进程封装 `src/main/sandbox-l3/`
> **工作量**: 2 人周（含 libkrun build、WHP API 集成、镜像缓存、端到端测试）
> **风险**: 中（WHP 文档少、libkrun 需自己 build）

---

## 0. User-Visible Milestone（验收门）

**解锁两个 user-visible feature**:

1. **Save Page 支持鉴权页**: work-browser agent 保存需要登录的页面时，在 microVM 内启动 headless browser 带 cookie 上下文，host 进程只看 IPC 流
2. **Note 里能跑 Python**: 用户在 note 写 Python → 在 microVM 内执行 → 结果回写 note

> **不是**"microVM 起来了"或"sidecar 编译过了"。
> **前置**: 必须 L1 + L2 都已上线并稳定（避免叠加风险）。

---

## 1. Scope

- 新建 Rust crate `native/sandbox-l3/`
- 用 `windows-rs` 调 WHP API + `libkrun` boot 最小 Linux guest
- 镜像管理：OCI 拉取 + 本地缓存
- 网络：TAP 设备 + 主机侧代理实现 allowlist
- Secrets：API key 不进 VM（注入到 network proxy 层）
- 主进程 IPC + forge 集成 + 端到端测试

## 2. Out of Scope

- ❌ 不动 L1 / L2
- ❌ 不实现完整容器编排（k8s 那一套）
- ❌ 不做 GPU 直通
- ❌ 不做共享文件系统（每次启动全新）
- ❌ 不支持 macOS / Linux（只 Windows，参考本机 platform=win32）

## 3. Files

### 3.1 新建

```
native/
└── sandbox-l3/
    ├── Cargo.toml                          # libkrun + windows-rs
    ├── build.rs                            # 链接 libkrun 动态库
    ├── libkrun/                            # submodule 或 vendor
    │   └── ... (libkrun 源码)
    ├── src/
    │   ├── main.rs                         # JSON-RPC server
    │   ├── vm.rs                           # VM 生命周期
    │   ├── whp.rs                          # WHP API 封装
    │   ├── exec.rs                         # VM 内 exec
    │   ├── network.rs                      # TAP + 主机代理
    │   ├── secrets.rs                      # 秘密注入
    │   ├── image.rs                        # OCI pull + 缓存
    │   └── ipc.rs                          # JSON-RPC schema
    └── tests/
        ├── boot_test.rs
        ├── exec_test.rs
        └── network_test.rs

prompt-lab/
├── src/main/sandbox-l3/
│   ├── ipc.ts                              # IPC handlers
│   ├── sidecar.ts                          # sidecar 管理
│   ├── vm-manager.ts                       # VM 池
│   ├── secret-store.ts                     # 秘密管理（不进 VM）
│   └── image-cache.ts                      # 镜像缓存
├── src/preload/sandbox-l3.ts
└── tests/work-browser/sandbox-l3/
    ├── boot.test.ts
    ├── exec.test.ts
    ├── network-allowlist.test.ts
    └── secret-isolation.test.ts
```

### 3.2 修改

- `prompt-lab/forge.config.ts` — `extraResource` 加 `sandbox-l3.exe` + `libkrun.dll`
- `prompt-lab/src/types/electron.d.ts` — 加 `sandboxL3` 类型
- `prompt-lab/src/plugins/work-browser/WorkBrowserPanel.tsx` — Save Page 走 sandbox-l3 路径
- `prompt-lab/src/plugins/built-in/index.ts` — 注册
- （如果 P2 第二阶段做 Note 跑 Python）`src/core/work-browser/note/` — 加 `exec` 工具

---

## 4. IPC 契约

### 4.1 主进程 → Rust sidecar

```json
// vm.create
{
  "method": "vm.create",
  "params": {
    "name": "wb-save-12345",
    "image": "python:3.12",        // OCI 镜像
    "cpus": 1,
    "memory_mb": 512,
    "network": {
      "mode": "allowlist",
      "allow": ["api.openai.com", "github.com", "*.anthropic.com"]
    },
    "secrets": [
      { "key_ref": "openai_api_key", "allowed_hosts": ["api.openai.com"] }
    ]
  }
}

// vm.exec
{
  "method": "vm.exec",
  "params": {
    "vm_id": "uuid",
    "command": "python",
    "args": ["-c", "print('hi')"],
    "timeout_ms": 30000
  }
}

// vm.stop / vm.destroy
```

### 4.2 renderer → main

```ts
'sandbox:vmCreate'(opts: { image: string; cpus?: number; memoryMb?: number; network?: NetPolicy; secrets?: SecretRef[] }): Promise<{ vmId: string }>
'sandbox:vmExec'(vmId: string, cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number; tookMs: number }>
'sandbox:vmStop'(vmId: string): Promise<void>
'sandbox:vmList'(): Promise<Array<{ vmId: string; image: string; startedAt: number; status: 'running' | 'stopped' }>>
'sandbox:imagePull'(image: string): Promise<{ size: number; cached: boolean }>
'sandbox:imageList'(): Promise<Array<{ image: string; size: number; pulledAt: number }>>
'sandbox:secretsRegister'(key: string, allowedHosts: string[]): Promise<{ keyRef: string }>
```

---

## 5. 关键设计

### 5.1 microVM 选型

**libkrun**（与 microsandbox 同款）:
- 优点：成熟，OCI 兼容，跨平台
- 缺点：需 C 编译，Windows 上需要 WHP 适配（libkrun 0.x 已支持）
- 启动：<500ms（M1 实测 <100ms，Windows WHP 估 ~300-500ms）

guest 镜像:
- 默认用 `python:3.12-slim`（小，~150MB）
- 拉取一次缓存到 `~/.work-browser/microsandbox-images/`

### 5.2 网络隔离（TAP + 主机代理）

```
[VM 内进程] → TAP 设备 → [主机 sidecar 代理] → {check allowlist} → 真实网络
                                       ↓
                            拦截的 HTTP header:
                            Authorization: Bearer <key_ref>
                            ↓
                            sidecar 用真 key 替换
```

**关键**: secrets 只在主机侧替换，**VM 内进程看不到真 key**，只看到 `key_ref`。

### 5.3 WHP 集成要点

- `WHvCreatePartition` → `WHvSetupPartition` → `WHvCreateVirtualProcessor`
- guest 加载: libkrun 提供 elf/PE 加载器
- 退出: libkrun 处理 ACPI shutdown

### 5.4 资源管理

- VM 池：默认 2 个 VM warm pool
- idle 30s 销毁
- 内存上限：每 VM 512MB（Save Page 用）/ 1GB（Python 跑用）

### 5.5 不做的优化（避免 scope drift）

- ❌ 不做 VM 快照
- ❌ 不做 checkpoint/restore
- ❌ 不做 GPU 直通
- ❌ 不做跨 VM 文件共享

---

## 6. 测试

### 6.1 Rust 单元测试

| # | 用例 |
|---|---|
| 1 | WHP partition 创建/销毁 |
| 2 | libkrun VM boot 成功 |
| 3 | exec "echo hello" → stdout 正确 |
| 4 | exec timeout → 强制 kill |
| 5 | network 拦截 + allowlist 命中 |
| 6 | network 拦截 + 拒绝非 allowlist |
| 7 | OCI image pull + 缓存命中 |

### 6.2 E2E（`tests/work-browser/sandbox-l3/`）

| # | 用例 |
|---|---|
| 1 | `vm.exec("echo", ["hi"])` → 100ms 内返回 |
| 2 | 镜像二次拉取走缓存（<100ms）|
| 3 | 网络 allowlist 命中（curl api.openai.com）|
| 4 | 网络非 allowlist 拒绝（curl evil.com）|
| 5 | **secret 隔离**: VM 内 `env \| grep OPENAI` → 看不到真 key，只能看到 `key_ref` |
| 6 | VM 内存超限 → host 强杀 |
| 7 | 主进程退出 → VM 全部清理 |
| 8 | Save Page 走 sandbox-l3：mock 一个需要 cookie 的 URL，验证能拿到内容 |

### 6.3 集成测试

- work-browser 现有 32/32 测试不破
- 与 P0（isolated-vm dry-run）共存不冲突
- 与 P1（Job Object 子进程）共存不冲突

---

## 7. 验收

- ✅ `cargo build --release` 在 `native/sandbox-l3/` 成功（含 libkrun 链接）
- ✅ `cargo test` 全过
- ✅ `npm run check:ipc` 0 错
- ✅ `npm run typecheck` 0 错
- ✅ `npm run lint` 0 错
- ✅ `npx vitest run tests/work-browser/sandbox-l3/` 100% 通过
- ✅ `npx vitest run tests/work-browser/` 32/32 全过（不破）
- ✅ `npx vitest run tests/work-browser/` 加上 P0 + P1 测试不破
- ✅ `npm run package` 打出安装包，libkrun.dll 在 `extraResource`
- ✅ 手测：Save Page 走 sandbox-l3 拿鉴权页内容
- ✅ 手测：Note 写 `print(1+1)` → 跑出 2

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| libkrun 编译失败（Windows toolchain）| 第一天专门做 POC：能编出来 `libkrun.dll` |
| WHP API 文档稀缺 | 抄 microsandbox 开源实现的对应部分（microsandbox 是参考实现） |
| guest 镜像体积大 | 第一个镜像用 `python:3.12-slim`；用户可自定义 |
| WHP 与其他 hypervisor 冲突 | P0 阶段已经验证用户 Hyper-V 可用，假定沿用 |
| Windows 版本要求 | 最低 Windows 10 1809（WHP 完整支持）|
| 与 L1/L2 资源竞争 | sidecar 独立进程 + 独立端口池（参考 memory 里的 sidecar 隔离经验）|

---

## 9. 不做（强制约束）

- ❌ 不引入 microsandbox（beta，决策已定）
- ❌ 不做 macOS / Linux 适配（仅 Windows）
- ❌ 不做 GPU / 图形直通
- ❌ 不做 VM 持久化（每次启动全新）
