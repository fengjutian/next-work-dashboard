---
layout: default
title: "Network Observatory V1.1.1"
---

# Network Observatory V1.1.1

V1.1.1 落地了 HTTPS 与 IPv6 基础,补全 V1.1 留下的协议缺口。

## 本次新增

### HTTPS(rustls)

- `Cargo.toml` 加 `rustls = 0.23`(feature: `ring`)+ `webpki-roots 0.26`
- `main.rs` 在启动时 `rustls::crypto::ring::default_provider().install_default()`
- `probe/http.rs` 重写为同时支持 `http://` 和 `https://`,用 `rustls::Stream::new` 包 TCP 流
- TLS 握手时间单独测量(`tls_ms`)
- 真实端到端验证:
  - `https://example.com`:`tls_ms ≈ 200ms` / `ttfb_ms ≈ 700ms`
  - `https://github.com`:`tls_ms ≈ 400ms` / `ttfb_ms ≈ 1.7s`(大页面下载)

### IPv6

- `probe/icmp.rs` 加 `ip_version` 选项(`auto` / `v4` / `v6`),按地址族分发
- `probe/tcp.rs` 加 `ip_version` 选项,过滤 v4 / v6 候选地址
- `probe/dns.rs` 已支持 AAAA 记录(V1.1),V1.1.1 验证多 resolver 仍工作
- `platform/windows.rs` 与 `platform/unix.rs` 都加 `icmp6_echo` 函数
- `probe/mod.rs` 修 `resolve()` 处理 IPv6 字面量(`[2001::1]:0` 包裹)+ 错误处理(直接调 `to_socket_addrs` first,失败 fallback 加端口)

**Windows 上的 ICMPv6 限制**:`windows` crate 0.58 暴露的 `Icmp6SendEcho2` 在当前构建上返回 `ERROR_INVALID_PARAMETER(87)`,我未能定位到正确的 generic 参数(P0/P1 Param impl)。V1.1.1 临时返回 `Err("icmpv6 on windows: not yet supported in v1.1.1")`,Unix 路径完整。V1.2 将切换到 `Icmp6ParseReplies` + 自建 raw ICMPv6 socket,或在升级 `windows` crate 后重试。

### UI

- **IP version 下拉**:ICMP / TCP 添加目标时显示 `自动 / IPv4 only / IPv6 only`
- **Waterfall 详情条形图**:HTTP 目标选中后,Stats 下方新增一条 24px 高的水平堆叠条形图,显示最近一次成功 probe 的 `DNS / TCP / TLS / TTFB / Download` 累积延迟(不同颜色)

### 协议层

- `resolve()` 重写:现在能正确处理
  - 裸 hostname(`example.com` → 加 `:0`)
  - 裸 IPv4(`1.1.1.1` → 加 `:0`)
  - 裸 IPv6(`2001::1` → `[2001::1]:0`)
  - 已带端口(`1.1.1.1:443` → 直接 `to_socket_addrs`)
  - 已带 IPv6 端口(`[2001::1]:443` → 直接)

之前 `resolve("1.1.1.1:0")` 会被 `parse::<IpAddr>()` 判 false,fallback `format!("{target}:0")` 错误产生 `"1.1.1.1:0:0"`,触发 `WSANO_DATA`。V1.1.1 修复后,先尝试 target 原样 `to_socket_addrs`,空就 fallback。

## 端到端验证(V1.1.1 实际跑出)

| Probe                | 目标                          | 结果                                  |
| -------------------- | ----------------------------- | ------------------------------------- |
| ICMP v4              | 1.1.1.1                       | ✅ 95-244ms                            |
| ICMP v6              | 2001:4860:4860::8888          | ❌ `not yet supported on windows`     |
| TCP v4               | github.com                    | ✅ 180-200ms,remote=20.205.243.166:443 |
| TCP v6               | github.com                    | ⚠️ no v6 address(DNS AAAA 未返回)    |
| DNS A                | github.com                    | ✅ 130ms                               |
| DNS AAAA             | github.com                    | ✅ 130ms                               |
| HTTP (plain)         | http://example.com            | ✅ 200ms,status=200,571 bytes        |
| HTTPS (real cert)    | https://example.com           | ✅ TLS 200ms,TTFB 700ms               |
| HTTPS (large)        | https://github.com            | ✅ TLS 400ms,TTFB 1.7s                |

Windows 上 `1.1.1.1:443` TCP connect 被本地防火墙/网络拦截(`connect timed out`),非代码问题。Linux / macOS 上行为会不同。

## 当前限制

- ICMPv6 在 Windows:暂未实现(已详细说明,V1.2 修)
- TCP v6:依赖目标域名有 AAAA 记录
- HTTPS:仅 TLS 1.2(故意禁用 1.3 + 1.0,留 V1.2 加 1.3)
- Windows ICMP handle leak 风险:`IcmpCreateFile` 每次调用都新建 handle 然后关闭,V1.2 改为一次性 cache

## 路线(V1.2 / V2 / V3)

- **V1.2**(1 周内)
  - 修 ICMPv6(Windows raw socket 替代 `Icmp6SendEcho2`)
  - TLS 1.3 支持
  - Waterfall 详情扩展:每个组件可点击展开历史
  - PDF / Markdown 报告导出(对接 PRD §二十)
  - 告警滑动时间窗口(替代当前"连续命中")
- **V2**(2-4 周)
  - Traceroute(V2.1 调系统 `tracert` / V2.2 自研 Paris)
  - LAN 扫描(ARP / mDNS)+ 拓扑
  - Heatmap
  - 告警通道:Email / Webhook / 钉钉 / Slack
- **V3**(产品化)
  - Cloud Agent / 多节点
  - AI RCA
  - 商业化分档
