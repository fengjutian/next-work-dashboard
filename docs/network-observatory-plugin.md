---
layout: default
title: "Network Observatory 插件"
---

# Network Observatory 插件

Network Observatory 是 nwd 的内置网络可观测性插件。它把"我能 ping 通吗"升级成"我的网络在持续做什么、什么时候开始变差、问题在哪一跳"。

它**不是** ping 工具,而是一个面向开发者、运维、个人 IT 的桌面网络诊断与监控入口。

## 产品定位(高层)

| 维度 | 传统 Ping 工具 | Network Observatory |
| --- | --- | --- |
| 输出 | 平均延迟 | min/avg/p50/p90/p95/p99/jitter/loss |
| 协议 | ICMP | ICMP / TCP / DNS / HTTP / Traceroute(规划) |
| 时间 | 实时 | 实时 + 历史 + 趋势 |
| 告警 | 无 | 阈值 + 通知(规划) |
| 根因 | 手动 | AI 辅助(规划) |
| 形态 | 工具 | 持续观测 |

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  Network Observatory (nwd 插件)                          │
├──────────────────────────────────────────────────────────┤
│  React UI (shadcn + Tailwind)                            │
│   ├── Dashboard (V1.1)   ├── Targets (V1.1)              │
│   ├── Diagnostics (V2)   ├── Traceroute (V2)             │
│   ├── History (V1.1)     ├── Alerts (V1.1)               │
│   └── AI Diagnosis (V3)                                   │
├──────────────────────────────────────────────────────────┤
│  TypeScript Layer (nwd 插件 backend)                     │
│   ├── NetProbeService (daemon 管理)                       │
│   ├── ProbeManager (调度)            [V1.1]               │
│   ├── Storage (drizzle/sql.js)        [V1.1]               │
│   └── AlertEngine                     [V1.1]               │
├──────────────────────────────────────────────────────────┤
│  Rust Engine (CLI sidecar, daemon 模式)                  │
│   ├── nwd-net-probe.exe                                  │
│   ├── protocol.rs (JSONL over stdio)                     │
│   ├── daemon.rs (事件循环 + 目标调度)                      │
│   ├── probe/icmp.rs (跨平台 ICMP)                        │
│   └── platform/{windows,unix}.rs                         │
└──────────────────────────────────────────────────────────┘
```

### 集成模式:Rust CLI sidecar(不用 napi-rs)

为什么不用 napi-rs(本项目现有 native 集成是 `disk-scanner` 的 sidecar 模式):

- **进程隔离**:网络探测遇到异常 target 时崩溃,不应拖垮 Electron。
- **跨平台分发简单**:一个 `.exe` 搞定,不用为每个 Node ABI 维护 prebuild。
- **可独立测试**:Rust 侧 `cargo test`,Node 侧 mock stdout。
- **可独立升级**:改 Rust 不需要重打 Node addon。
- **性能瓶颈在网络 RTT,不在 IPC**:每 5s 一次 ping,JSON 序列化占比 < 0.1%。

## JSONL 协议

启动:`nwd-net-probe.exe daemon` 持续运行,通过 stdin/stdout 与 Node 通信。

**Node → Rust (stdin)**:

```jsonl
{"type":"add_target","id":"t1","target":"8.8.8.8","probe":"icmp","interval_ms":5000}
{"type":"remove_target","id":"t1"}
{"type":"shutdown"}
```

**Rust → Node (stdout)**:

```jsonl
{"type":"ready","version":"0.1.0","pid":1234}
{"type":"probe_result","id":"t1","probe":"icmp","timestamp_ms":1700000000000,"success":true,"latency_ms":23.5}
{"type":"probe_result","id":"t1","probe":"icmp","timestamp_ms":1700000005000,"success":false,"error":"timeout"}
{"type":"error","message":"unknown probe type: ws"}
```

## 跨平台 ICMP

| 平台 | 实现 | 权限 |
| --- | --- | --- |
| Windows | `IcmpSendEcho` / `Icmp6SendEcho`(Icmp.dll) | 用户态,无需管理员 |
| Linux | raw socket via `socket2` | 需要 `CAP_NET_RAW` 或 setuid |
| macOS | raw socket via `socket2` | 需要 `CAP_NET_RAW` 或 setuid |

V1:仅 IPv4。IPv6 留 V1.1。

## V1 范围(本次已交付)

- 1 个 probe:**ICMP**
- 持续 daemon 模式(进程常驻,stdin/stdout JSONL)
- React 面板:添加目标、查看实时结果、移除目标
- 进程崩溃自动重连(指数退避,最多 30s)
- 5xx 条最近结果内存缓存(无持久化)
- 主进程退出前优雅 shutdown daemon

## 后续路线

### V1.1(1-2 周)

- TCP Connect probe(端口探活)
- DNS probe(A / AAAA / CNAME / 多 resolver 对比)
- HTTP probe(DNS + TCP + TLS + TTFB + Download waterfall)
- 7 天历史(SQLite via drizzle)
- 阈值告警 + 桌面通知
- IPv6 支持
- 实时折线图(echarts)

### V2(2-4 周)

- Traceroute(V2.1:调系统命令;V2.2:自研)
- LAN 扫描(ARP / mDNS)
- 网络拓扑可视化
- Heatmap(按小时/星期聚合)
- 告警通道(Email / Webhook / 钉钉 / Slack)

### V3(产品化)

- AI Root Cause Analysis(LLM 调用历史数据)
- Cloud Agent / 多节点
- 网络地图(地理节点)
- Team / API / SaaS
- 商业化分档:Free / Pro / Team / Enterprise

## 开发与打包

```bash
cd prompt-lab
npm run build:net-probe      # 单独构建 Rust daemon
npm start                     # 启动 nwd(自动构建 net-probe + disk-scanner)
```

构建脚本将 release 二进制复制到 `resources/net-probe/`;Electron Forge 把它作为 `extraResource` 打包。开发模式从 `native/net-probe/target/release/` 直接加载。

## 当前限制(V1)

- 仅 IPv4,仅 ICMP。
- 历史仅保留在内存(最近 500 条),重启即丢。
- 无图表、无告警、无 AI。
- Unix 平台需要 `CAP_NET_RAW`(或自行 setuid)才能发 raw socket ICMP;若不可用,V1.1 会回退到解析 `ping` 命令输出。
- 进程崩溃后到 `ready` 之间有最多 10s 不可用窗口(指数退避)。

## 路线取舍说明

- **不实现"统一 ProbeResult 数据结构"**:Ping / Traceroute / HTTP 的结果语义差异太大,强塞一个结构会让类型变 `any`。改为"统一 Probe 接口 + 各自结果结构",TS 端用 discriminated union 表达。
- **Traceroute V1 不自研**:Paris traceroute 是个研究级问题,V1 调系统 `tracert` / `traceroute`;V2 再考虑自研。
- **AI RCA 留 V3**:依赖 V1-V2 的真实数据,没有历史就没法 RCA。
- **商业化留 V3**:产品价值验证前不抽象"Team / API" 等企业功能。
