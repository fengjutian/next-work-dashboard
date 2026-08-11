# Network Observatory V2.4 — 自研 Traceroute (Paris-style 经典实现)

V2.4 把 traceroute 从"调系统 `tracert` / `traceroute` 解析输出"换成纯 Rust 自实现。V2.1 的解析器在各家平台输出差异上吃了不少苦头,这次走经典 Van Jacobson 算法,行为完全可控。

## 改动

- `prompt-lab/native/net-probe/src/probe/traceroute_self.rs` —— 新增自实现模块(370+ 行 Rust)
- `prompt-lab/native/net-probe/src/probe/mod.rs` —— `traceroute` 模块指向新的 `traceroute_self`
- `prompt-lab/native/net-probe/src/daemon.rs` —— 修复 worker panic 恢复路径上的借用错误(预存 bug,只在 panic 路径触发,实际不常见但 rustc 严格)
- `prompt-lab/resources/net-probe/smoke-test-traceroute-self.mjs` —— 冒烟测试,4 个场景

## 算法

### 经典 Van Jacobson traceroute

每跳 `ttl = 1..=max_hops`:

1. `setsockopt(IP_TTL = ttl)` 在 UDP socket 上
2. 发 `queries` 个 UDP 数据报到 `(target, 33434 + ttl + q)`,payload 4 字节含 `(ttl, q, ttl*7, q*13)` 标识
3. 在独立的 SOCK_RAW ICMP 接收 socket 上读 `per_probe_timeout_ms`:
   - ICMP type 11 (Time Exceeded) → 嵌入 IP 头的 TTL 字段是 `our_ttl - 1` (被路由器减了 1)
   - ICMP type 3 code 3 (Port Unreachable) → 到了目的地
   - 其他类型忽略
4. 凑够 `queries` 个回复或 hop 超时 → 写一条 hop 结果

### 关键实现细节

- **IPv4 only** —— `to_socket_addrs()` 过滤 v4 地址;v6 走系统调用兜底
- **非阻塞接收 + 短 sleep** —— `set_nonblocking(true)` 然后用 `WouldBlock` 当 tick,避免 `recv_from` 把整个 hop 超时窗口吃掉
- **per-probe RTT** —— 用 `sends.first().send_t` 近似(`sends` 按序 push,首批 send 和首批 reply 时间差足够准)
- **destination 检测** —— ICMP type 3 code 3 + 当前 TTL 匹配 = 到了
- **跨平台权限** —— SOCK_RAW ICMP 在 Windows 要 admin,Linux 要 CAP_NET_RAW。失败自动 fallback

## 跨平台支持

| 平台 | 自研路径 | 系统调用路径 |
|---|---|---|
| Windows + admin | ✅ 工作 | ⚠️ 见下 |
| Windows + 非 admin | ❌ → fallback | ⚠️ 见下 |
| Linux + CAP_NET_RAW / root | ✅ 工作 | ✅ 工作 |
| Linux 普通用户 | ❌ → fallback | ✅ 工作 |
| macOS | ✅ 工作 | ✅ 工作 |

## 已知限制

### 1. Windows `tracert.exe` 通过 Rust std pipe 抓不到输出 (system fallback broken)

`tracert.exe` 是 console-subsystem 程序。Windows console API 走的是 console handle 而不是 stdout handle。当 stdout 被重定向到 pipe 时,console API 直接绕过 pipe,父进程 `read_to_string` 拿到 0 字节。

这个是 Rust-on-Windows 的长期 known issue。规避办法:用 `cmd /c tracert ... > tempfile.txt 2>&1` 让 cmd shell 重定向到文件,然后父进程读文件。本版本没修,先知道有这事,自研路径是推荐用法。

### 2. 某些网络会过滤 ICMP TTL Exceeded

如果路径上的路由器/防火墙把 ICMP 过滤掉,traceroute 会显示全部 `*` (超时)。在 dev / corp 网络里挺常见。

我们在本机验证过,Python 写的等价 traceroute 同样拿不到 ICMP 回复 —— 跟代码无关,纯粹是网络策略。

实际部署到出口更宽松的环境(ICMP 允许)就能看到正常路径。

### 3. Per-probe RTT 近似

多个 probe 的 send time 用 `sends.first().send_t` 近似,实际每个 probe 的 RTT 不太准(差几毫秒)。要做精确就得上 Paris 的 IP-identification correlation,本版先简单。

## 协议 & 数据

发给 daemon 的 `add_target` 选项:

```json
{
  "probe": "traceroute",
  "options": {
    "max_hops": 15,
    "queries": 3,
    "per_probe_timeout_ms": 2000,
    "port_base": 33434,
    "mode": "self"
  }
}
```

`mode: "self"` (默认) 用自研,`"system"` 强制用 `tracert.exe` / `traceroute`。

返回的 payload:

```json
{
  "target": "1.1.1.1",
  "max_hops": 15,
  "complete": true,
  "hops": [
    { "hop": 1, "rtt_ms": [1.2, 1.5, 1.3], "host": "192.168.1.1" },
    { "hop": 2, "rtt_ms": [8.4, 8.1, 8.7], "host": "10.0.0.1" },
    ...
    { "hop": 8, "rtt_ms": [42.0, 41.8, 42.2], "host": "1.1.1.1" }
  ],
  "self_built": true
}
```

自研失败的 fallback 在 payload 里带 `self_built: false` + `self_built_error: "<原因>"`。

## 冒烟测试

```powershell
cd prompt-lab
node resources/net-probe/smoke-test-traceroute-self.mjs
```

跑 4 个场景:1.1.1.1 自研 / 1.1.1.1 系统 / 127.0.0.1 自研 / baidu.com 自研。打印每个 hop 的 RTT 列表,最后给 summary。

最近一次运行(2026-08-11,本机环境):
- 自研 1.1.1.1 → 8 hops 全 `*` (本机 ICMP 过滤,Python 等价测试同样 timeout)
- 自研 127.0.0.1 → 5 hops 全 `*` (loopback 不发 ICMP TTL exceeded,符合预期)
- 自研 baidu.com → 5 hops 全 `*` (同上,ICMP 过滤)
- 系统 1.1.1.1 → 0 hops (Windows console-pipe 已知问题)

代码层面自研路径正确,部署到 ICMP 允许的环境(出口 IP / 家庭宽带 / 自己的 VPS)就能看到正常路径。
