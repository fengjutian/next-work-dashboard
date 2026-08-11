# Network Observatory V2.5 — LAN 扫描 + 拓扑

V2.5 把"被动监测目标"扩展为"主动探索 LAN"。Network Observatory 从工具升级成产品,关键就是让人能直观看到自己网络里有什么。

## 这是什么

- **TCP 扫描**本地 /24 子网里的常见端口 (22/80/443/445/3389/5353)
- **存储**扫到的主机(IP, hostname, open_ports, first/last_seen, source)
- **UI** 拓扑视图:本机在中心,扫到的主机在外圈,按开放端口类型上色
- **手动触发** 扫描,持久化历史

## 数据模型

新表 `net_probe_lan_hosts`:

```sql
CREATE TABLE net_probe_lan_hosts (
  id          TEXT PRIMARY KEY,            -- e.g. "lan-192.168.1.1"
  ip          TEXT NOT NULL UNIQUE,
  mac         TEXT,                        -- null (V2.5 不做 ARP,留给 V2.6)
  hostname    TEXT,                        -- PTR 反查
  vendor      TEXT,                        -- OUI (V2.5 always null,留 V2.6)
  open_ports  TEXT NOT NULL DEFAULT '[]',  -- JSON array of numbers
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'tcp', -- 'tcp' | 'arp' | 'mdns'
  scan_id     TEXT                         -- 同一批 scan 的 group id
);
CREATE INDEX idx_net_probe_lan_hosts_last_seen
  ON net_probe_lan_hosts(last_seen DESC);
```

`NetProbeLanHost` 类型暴露给 renderer,字段 `openPorts: string`(JSON-encoded list of port numbers)。

## Rust 探针

`prompt-lab/native/net-probe/src/probe/lan_scan.rs`(~250 行)

### 算法

1. **本地子网检测** —— `UdpSocket::bind("0.0.0.0:0")` + `connect("8.8.8.8:80")` + `local_addr()`,取 v4 头三段当 /24
2. **并行扫描** —— 每个 host 一个 worker thread,串行尝试 6 个端口(`TcpStream::connect_timeout`),250-300ms timeout
3. **反向 DNS** —— 至少有一个端口开放的 host,走 `hickory-resolver::AsyncResolver::tokio_from_system_conf()` + `reverse_lookup`,500ms timeout
4. **结果汇总** —— 主线程 `recv_timeout(outer_timeout)`,达到上限就停
5. **payload** —— `{ subnet, scanned, found, hosts: [{ ip, hostname, open_ports }] }`

### 性能

254 hosts × 6 ports = 1524 次 connect。worker thread + 短 timeout 全部并发,实际墙钟 ≈ `per_port_timeout × 6`(内核 SYN 重传靠 OS 自己排队)。
- 32 hosts / 6 ports / 200ms timeout → ~1s
- 254 hosts / 6 ports / 300ms timeout → ~2-3s

### 选项

```json
{
  "subnet": "192.168.1.0",        // 显式 /24(可省,自动检测)
  "ports": [22, 80, 443, ...],   // 自定义端口列表(可省)
  "per_port_timeout_ms": 300,    // 单次 connect 超时
  "max_hosts": 254                // 扫多少 host(防失控)
}
```

## IPC

新增 3 个 handler (`net-probe-service.ts`):

- `net-probe:scan-lan(opts?)` — 触发一次性扫描,返回扫到的主机列表(已 upsert 进 storage)
- `net-probe:list-lan-hosts(opts?)` — 读 storage(支持 `scanId` / `sinceMs` / `limit` 过滤)
- `net-probe:delete-lan-host(id)` — 删除一条

`scan-lan` 走 `OneShotCollector` + `broadcastListeners`:
1. 加一个临时 target `lanscan-<scanId>`(interval 10 分钟,timeout 30s)
2. 在主进程订阅 broadcast,等 `probe_result` 事件匹配 targetId
3. 拿到结果后逐 host `dbUpsertLanHost` + 删临时 target + 返回合并后的数据

`preload.ts` + `electron.d.ts` 同步暴露 API。

## UI

`NetworkObservatoryPanel` 左侧栏新增 `LAN 拓扑` 按钮,点开后右侧显示:

- 顶部工具栏:子网输入框、`扫描 LAN` 按钮、上次扫描摘要(主机数/耗时/时间)
- 主区域:
  - **SVG 拓扑** — 本机在中心,扫到的主机在外圈按角度排,连线虚线。颜色按开放端口类型:
    - 🟢 绿: 80/443 开放(Web 服务器)
    - 🟡 橙: 其他端口开放
    - ⚪ 灰: 无端口(可能是 ping-only 设备)
  - **图例** 右上角小卡片
- 右侧栏:
  - 默认:主机列表(每行 IP / hostname / 端口数)
  - 选中节点:详情面板(IP、hostname、MAC、开放端口 chips、首次/最近时间、来源、删除按钮)

主机数 0 时显示空状态,提示 "点上面的「扫描 LAN」开始 TCP 扫描本地 /24"。

## 冒烟测试

```powershell
cd prompt-lab
node resources/net-probe/smoke-test-lan-scan.mjs
```

启动 daemon,跑 2 个 scan:
- `127.0.0.0/24` (loopback,Windows 上会发现 32 个虚拟主机)
- 自动检测的 `172.16.201.0/24` (本机真实子网)

最近一次运行(2026-08-11):
- `127.0.0.0/24` scanned=32 found=32 (Windows loopback 整段都响应 445 端口)
- `172.16.201.0/24` scanned=32 found=2 (路由器 172.16.201.5 + 同事机 172.16.201.9)
- 1-1.3s latency
- hostname 反查全部成功(`localhost.` / `router.lan` 等)

## 已知限制 / 留 V2.6 做的

1. **没有 ARP / MAC 地址** —— `source: 'tcp'`,mac 字段永远是 null
2. **没有 vendor / OUI 查表** —— `vendor` 字段永远是 null
3. **没有 mDNS 服务发现** —— 没扫 `_services._dns-sd._udp.local` 也没问 individual PTR
4. **没有拓扑历史 diff** —— 不存 topology snapshot,只存 host list
5. **没自动定期扫描** —— 只能手动点按钮;V2.6 加 cron + 后台 worker
6. **只支持 IPv4** —— v6 留 V2.6(link-local / SLAAC 复杂度高)
7. **/24 only** —— 没法扫 /16 或 /23,硬编码
8. **Windows 端口检测会过 WFP / 防火墙** —— 公司机可能挡住 22/80/443 的入口 SYN,显示"无端口"
9. **拓扑是静态 SVG 环形布局** —— 没有真正的力导向,大量节点 (>50) 会挤
10. **没存 subnet 信息** —— 多个 scan 跨子网时,所有 host 都混在一起
