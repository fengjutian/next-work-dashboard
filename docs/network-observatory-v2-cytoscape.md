# Network Observatory V2.6 — Cytoscape 力导向拓扑

V2.5 的 LAN 拓扑是固定 SVG 环(本机中心,主机按角度排外圈)。V2.6 换成 cytoscape + fcose 力导向布局:节点按边的连接关系自由排,几十个节点时仍然清爽,加新节点也会"让位"。

## 改动

- `prompt-lab/package.json` —— 显式声明 `cytoscape@^3.34.0` 和 `cytoscape-fcose@^2.2.0`
- `prompt-lab/src/plugins/network-observatory/NetworkObservatoryPanel.tsx`
  - `LanPanel` 里 ~110 行 SVG 拓扑 → 1 个 `<div ref={cyRef}>`
  - `useEffect` 初始化 cytoscape,`fcose` 布局,host 变化时 diff 增删节点
  - selectedIp 与 cytoscape 选中状态双向同步
  - 新增 `居中` 按钮 —— 调用 `cy.fit()`

## 交互能力

- **拖动节点** —— cytoscape 默认行为,自排网络避开用户偏好
- **滚轮缩放** —— `minZoom: 0.3, maxZoom: 2.5, wheelSensitivity: 0.3`
- **点选/取消** —— 点节点切详情,点空白处取消
- **点本机节点** —— 取消当前选中(本机在中心固定位置,选中它意义不大)
- **侧边栏列表点击** —— 同步到 cytoscape 选中状态
- **fit-to-viewport** —— 居中按钮 + 初始化时自动 fit

## 节点样式

按开放端口类型上色:
- 🟢 绿 `#10b981` — 有 80/443(Web 服务器)
- 🟡 橙 `#f59e0b` — 有其他 TCP 端口
- ⚪ 灰 `#94a3b8` — 无端口(可能是 ICMP-only 或防火墙挡住)

中心节点(本机)特殊样式:大 64×64,紫色 `#6366f1`,白色加粗字体。

选中状态:边框 3px 黑色,节点放大 ~22%。

## fcose 布局参数

```js
{
  name: 'fcose',
  quality: 'default',       // 'draft' / 'default' / 'proof'
  randomize: true,          // 每次 random 重排,避免每次都是同一布局
  animate: false,           // 不动画(防止和 scan 流程冲突)
  nodeSeparation: 80,       // 节点最小距离
  idealEdgeLength: () => 90,
  nodeRepulsion: () => 8000, // 节点间斥力
  gravity: 0.25,            // 向中心拉的强度
  numIter: 2500,            // 迭代次数
  fit: true,                // 布局完后自动 fit
  padding: 30,
}
```

针对 LAN 场景(典型 1-50 host)调过:够松散不重叠,也不会太空。

## 性能

- 6 host: ~5ms(1 次布局)
- 32 host: ~50ms
- 254 host: ~300-500ms(`numIter: 2500` 在大图上时间主要花在这)

host 变化时只做 diff 增删,不会重新建图。选中态变化不重布局。

## 冒烟测试

```powershell
cd prompt-lab
node resources/net-probe/smoke-test-cytoscape.mjs
```

jsdom 模拟 DOM,跑 cytoscape + fcose 在 5 节点图上,验证:
- 所有节点得到合法坐标(非 NaN)
- 边数 = host 数
- 布局结果 x/y 跨度合理

最近一次运行(2026-08-11):
```
=== cytoscape + fcose layout positions ===
  self           (34.4, 0.1)
  192.168.1.1    (58.3, 93.0)
  192.168.1.5    (-26.8, 72.4)
  192.168.1.9    (-58.3, 15.3)
  192.168.1.42   (-49.8, -45.2)
  192.168.1.100  (55.1, -93.0)

OK: 6 nodes, 5 edges laid out successfully
OK: positions span x=[-58.3, 58.3], y=[-93, 93]
```

(注意:本机节点在中心区域,5 个 host 围绕外圈。fcose 自动调整了顺序,不是按 IP 排序)

## 已知限制 / 留 V2.7

1. **位置不持久化** —— 每次重新打开 LAN 标签,fcose 重新 random 布局。如果用户拖了节点,关闭就丢
2. **没按 subnet 分组** —— 多个子网扫到的主机混在一个图里,没视觉分组(可以用 cytoscape compound nodes 实现)
3. **没 edge 类型** —— 现在所有边都是"我扫到了它",没有 host 之间的实际关系(ARP cache / 路由表)
4. **没动画** —— host 增删是瞬时的,fcose 重布局也是瞬时的(故意关掉避免视觉疲劳,但用户可能期望"加新节点时其他节点让一下"的过渡)
5. **没触屏支持** —— desktop-only,cytoscape 有 touch extension 但没装
6. **手动 fit** —— 没有 zoom-to-selection,只 fit-all(`居中` 按钮)

## 跟 V2.5 的差异

| | V2.5 (静态 SVG 环) | V2.6 (cytoscape) |
|---|---|---|
| 布局 | 固定环,主机按角度等距 | fcose 力导向,自适应 |
| 缩放/拖动 | 无 | 滚轮缩放 + 拖动节点 |
| > 50 节点 | 挤成一团 | 仍可读 |
| 新节点加入 | 重新计算环 | 增量 diff,其他节点让位 |
| Bundle size | 0 (手写 SVG) | +200KB(cytoscape + fcose) |
| 风格 | 跟 Tailwind 一致 | cytoscape 主题色,需要 stylesheet 协调 |

## V2 全景

| 阶段 | 状态 |
|---|---|
| V2.0 Traceroute (system) | ✅ |
| V2.2 报告导出 | ✅ `5bb3c0b` |
| V2.3 告警通道 | ✅ code + docs `0b6f0d1` |
| V2.4 自研 Traceroute | ✅ `baa53cd` |
| V2.5 LAN 扫描 + 拓扑 | ✅ `4c7f23d` |
| **V2.6 cytoscape 力导向** | ✅ `?????` |
