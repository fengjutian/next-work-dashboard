# Work Browser 沙箱加固全量评估

> **状态**: 评估稿
> **日期**: 2026-08-15
> **评估范围**: prompt-lab / work-browser 插件 + native/ sidecar
> **结论**: microsandbox 弃用（beta），三档加固独立推进

---

## 0. TL;DR

| 档位 | 工具 | 防什么 | 成本 | 优先级 |
|---|---|---|---|---|
| **L1** | [isolated-vm](https://github.com/laverdet/isolated-vm) | agent 跑不可信 JS | ~5 MB dep + ~200 LOC | **P0** |
| **L2** | Windows Job Objects + AppContainer | 子进程文件 / 网络 / 句柄权限 | 主进程 ~300 LOC + Rust ~100 LOC | **P1** |
| **L3** | 自建 WHP 包装 (Rust + libkrun) | microVM 级 OS 隔离 | native/ 团队 ~2 人周 | **P2** |

**集成顺序**: P0 → P1 → P2，每个都有 user-visible 节点。

**不做**:
- ❌ microsandbox（beta，README 自陈 "expect breaking changes"）
- ❌ vm2（2023 停维护，多个 escape CVE）
- ❌ Node `vm` 模块（多个 escape CVE 历史）
- ❌ L3 一步到位（成本/收益不对等）

---

## 1. 当前项目沙箱现状

| 组件 | 实际能力 | 不是 |
|---|---|---|
| Electron `sandbox: true` | 渲染进程 OS 进程隔离 | 不是 microVM |
| `cleaner-inject.ts` | 网络响应**净化**（剥 tracker/ads） | 不是代码隔离 |
| `agent/runner.ts` `confirmDanger` | UX 弹窗 | 不是安全边界 |
| `native/` Rust sidecar | 独立 OS 进程 | 不是 microVM |
| `utilityProcess` | 独立 Node 进程，IPC 受限 | 不是 microVM |

**结论: 没有任何一层是硬件级隔离。**

---

## 2. 威胁面 × 加固方案矩阵

| 威胁面 | 当前防护 | L1 | L2 | L3 |
|---|---|:---:|:---:|:---:|
| prompt injection → agent 跑任意 JS | 无 | ✅ 强 | — | — |
| agent tool 写 / 删文件 | `confirmDanger` UX | ⚠️ 部分 | ✅ 强 | ✅ 强 |
| agent tool 调任意外网 | `rateLimit` | ⚠️ 部分 | ✅ 强（AppContainer net policy） | ✅ 强（VM netns） |
| 跨 Workspace / 插件越权 | preload IPC 白名单 | ⚠️ | ✅ 强 | ✅ 强 |
| Save Page 鉴权页 | 无（main 端 fetch 无登录态） | — | — | ✅（VM 内 headless 带 cookie） |

> ✅ = 直接拦；⚠️ = 配合 allowlist 拦；— = 不适用

---

## 3. 稳定方案详评

### 3.1 L1 — isolated-vm（P0 推荐）

- **能力**: V8 isolate 跑不可信 JS；宿主全局 / Node API 默认不可见，需显式注入 host → isolate 桥
- **稳定度**: 多年无 escape CVE（不同于 vm2 / Node vm）
- **集成点**: `src/main/sandbox/l1-isolated-vm.ts` + agent runner 改造
- **改造方式**: agent tool `execute()` 前先在 isolate 里 dry-run 一次，看会发什么 IPC
- **代价**: ~5 MB dep（`node_modules`），~200 LOC
- **风险**: 低
- **若未来需要跑 Python / 用户脚本**: 切 L1 alt Wasmtime（见 3.2）

### 3.2 L1 alt — Wasmtime

- **能力**: WASM 字节码，跨语言
- **稳定度**: 字节码联盟维护
- **何时选**: agent 要跑**非 JS** 不可信代码（Python、用户脚本）→ 先编译到 WASM
- **现状**: work-browser agent tool 都是 JSON 调用，目前不需要 WASM
- **结论**: 留作"未来支持 Python tool"时再启用

### 3.3 L2 — Windows Job Objects + AppContainer（P1）

- **能力**: OS 级进程沙箱
  - **Job Object**: 限 CPU / 内存 / 句柄表 / 子进程
  - **AppContainer** (Windows 8+): lowbox 容器，文件 / 网络 / 注册表默认 deny
- **稳定度**: OS 内置 API，十余年稳定
- **集成点**: `src/main/sandbox/l2-windows.ts` 封装 `windows-rs` 调用，或拆成独立 Rust sidecar
- **适用**: agent 调 `child_process.spawn` 起的子进程（headless browser fetcher、未来 shell 工具）
- **代价**: 主进程 ~300 LOC，Rust 侧 ~100 LOC
- **风险**: 低（OS API 稳定）

### 3.4 L3 — 自建 WHP 包装（P2）

- **能力**: microVM 隔离（与 microsandbox 同档，但**自造**）
- **实现**: Rust + `windows-rs` 调 WHP API + `libkrun` boot 最小 guest
- **代价**: native/ 团队 ~2 人周；**这是 microsandbox 的自造版**
- **稳定度**: libkrun 成熟（microsandbox 也用），WHP 文档少
- **何时做**: L1+L2 不够，且 Save Page 鉴权页 / Note 跑 Python 这类 feature 真的要做
- **风险**: 中

### 3.5 L3 alt — Windows Sandbox（OS 内置）

- **能力**: OS 自带的一键隔离 VM（关闭即销毁）
- **限制**: **非编程式**（用户手动启动），不适合做 work-browser 后端
- **何时用**: QA 测试场景（跑不可信插件用 sandbox 验证）
- **结论**: 不入 work-browser 主线

---

## 4. 推荐集成顺序

### P0（先做）: L1 isolated-vm

**user-visible 节点**: agent 的 tool 执行能"先在沙箱内 dry-run，确认无害再走主进程"。

工作量:
- 加 `isolated-vm` dep
- 新建 `src/main/sandbox/l1.ts` 封装
- `agent/runner.ts` 在每个 `execute()` 前插 dry-run
- 1-2 个新 IPC channel: `workBrowser:sandbox:dryRun`
- 单测: `tests/work-browser/sandbox-l1.test.ts`
- 文档: 更新 `ARCHITECTURE.md`

### P1（后做）: L2 Windows Job Objects + AppContainer

**user-visible 节点**: agent 起的子进程（headless fetcher、未来 shell）跑在 OS 隔离环境，恶意子进程无法读 `~/.ssh` / 写 `C:\`。

工作量:
- Rust sidecar: `native/sandbox-l2/` 用 `windows-rs` 暴露 IPC
- 主进程: `src/main/sandbox/l2.ts` 调 sidecar
- `forge.config.ts` `extraResource` + `asar.unpack` 加 binary
- 1-2 个新 IPC channel
- 测试: 用 `Get-Process` 验证子进程在 Job Object 内

### P2（最后做）: L3 自建 WHP

**user-visible 节点**: "Save Page 鉴权页" + "Note 跑 Python" 这类真需要 microVM 的 feature。

工作量: 见 §3.4

---

## 5. 集成到现有架构的约束

遵循 `AGENTS.md` 关键约定:

1. **走 plugin / 独立域**: 沙箱功能不污染 work-browser 核心；可新建 `src/plugins/sandbox/`（默认 `enabled: false`）或作为 work-browser 子模块
2. **IPC 三处同步**: `src/main/sandbox/ipc.ts` + `src/preload/sandbox.ts` + `src/types/electron.d.ts`
3. **LTS extraResource**: L2/L3 涉及 native binary → `forge.config.ts` 加 `extraResource` + `asar.unpack`
4. **不能破**: `npm run check:ipc / typecheck / lint / vitest` 在 work-browser 域 0 错

---

## 6. 不做清单

| 选项 | 原因 |
|---|---|
| microsandbox | beta，README 自陈 "expect breaking changes" |
| vm2 | 2023 停维护，逃逸 CVE 已知 |
| Node `vm` 模块 | 历史上多个 escape CVE |
| WSL2 做常规副作用 | 太重（启动 ~1s） |
| L3 一步到位 | 成本/收益不对等，先 P0/P1 |

---

## 7. 待你拍板的开放项

1. **P0 isolated-vm 立刻开干，还是先看更详细的 P0 计划？**
2. **P1/P2 是做还是做但暂不暴露给用户？**（铺路模式）
3. **L1 集成位置**: 嵌进 work-browser 内部（污染核心）还是新建独立 plugin `src/plugins/sandbox/`？
4. **microsandbox 是否要持续观望**，等它 stable？
