# Work Browser 沙箱加固 — 实施计划索引

> **父评估**: [`docs/work-browser/SANDBOX-EVAL.md`](../SANDBOX-EVAL.md)
> **状态**: 三档独立计划草案（2026-08-15），待评审后选推进顺序

## 三档计划

| 档 | 标题 | 集成位置 | 工作量 | 用户可见节点 |
|---|---|---|---|---|
| **P0** | [L1 isolated-vm](./P0-L1-isolated-vm.md) | 新独立 plugin `src/plugins/sandbox/` | ~3-4h | AI 助手 tool 执行前先 dry-run 让用户看 |
| **P1** | [L2 Windows Job Objects + AppContainer](./P1-L2-windows-job.md) | Rust sidecar `native/sandbox-l2/` | ~1-2d | AI 起的子进程不能读 `~/.ssh` / 写 `C:\` |
| **P2** | [L3 自建 WHP 包装](./P2-L3-whp.md) | Rust sidecar `native/sandbox-l3/` | ~2 人周 | Save Page 鉴权页 / Note 跑 Python |

## 关键约束（所有档位适用）

来自 `AGENTS.md` 关键约定:

1. **plugin-first**: P0 走 `src/plugins/sandbox/`，独立 plugin，默认 `enabled: false`
2. **IPC 三处同步**: `src/main/<feature>/ipc.ts` + `src/preload/<feature>.ts` + `src/types/electron.d.ts`
3. **LTS extraResource** (P1/P2): `forge.config.ts` 加 native binary + `asar.unpack`
4. **不能破**: `npm run check:ipc / typecheck / lint / vitest` 在 work-browser 域 0 错

## 验收门统一口径

每个 P_k 完成 = **user-visible 节点** 可见 + 自动化测试全过，而不是"库装上了"或"代码写了"。

## 实施顺序建议

P0 → P1 → P2 顺序推进，每档完成 → 上线观察 → 再决定下一档。
可以并行: P0 完成后 P1 / P2 同时启动（人手够）。
不建议: 跳过 P0/P1 直接 P2（cost/收益不对等）。

## 变更记录

| 日期 | 变更 | 状态 |
|---|---|---|
| 2026-08-15 | 初稿（P0/P1/P2 三档计划 + 索引） | 草案 |
