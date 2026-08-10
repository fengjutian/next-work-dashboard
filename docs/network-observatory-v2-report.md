# Network Observatory V2.2 — 报告导出

V2.2 在 V2 (Heatmap) 之上新增"报告导出"功能。点击 Network Observatory 工具栏右上角的 **导出报告** 按钮即可生成可分享的 Markdown / HTML 报告。

## 输出格式

### Markdown

适合粘贴到 Slack / Notion / Jira / GitHub PR 等支持 Markdown 渲染的环境。

包含：
- 标题 / 时间窗口 / 主机信息
- 概览表（目标数、采样数、失联率、告警事件）
- 目标总览表（每目标一行：类型、间隔、状态、采样、失败率、p50/p95/p99）
- 每个目标的章节：
  - 基础元信息（ID、间隔、超时、选项、数据范围、最近错误）
  - 统计表（min/max/avg/p50/p90/p95/p99/jitter）
  - **7×24 热图**（Unicode 块字符 + 数值，`▁▂▃▄▅▆▇█` 八档色阶）
  - **24h 延迟分布**（按小时聚合，avg / p95 / 采样 / 失联率）
- 告警事件表（开始 / 持续 / 目标 / 规则 / 触发信息 / 峰值）

### HTML

适合在浏览器中查看或"打印为 PDF"。自包含（无外部 CSS/JS / CDN 依赖），可离线分发。

- 同等数据 + 自带 CSS 样式 + 内联热图（每个单元格根据延迟上色，hover 显示 tooltip）
- `@media print` 媒体查询已配置：打印时自动收紧边距、隐藏打印提示、避免在目标章节中间分页
- 顶部黄色提示条提醒用户："点击浏览器菜单 打印 (Ctrl/⌘+P)，目标选择 另存为 PDF"

## 触发流程

1. 点击工具栏 **导出报告** 按钮
2. 在弹窗中设置：
   - 报告标题
   - 时间范围（最近 1h / 6h / 24h / 7d）
   - 输出格式（HTML / Markdown）
   - 目标范围（全部 / 仅启用 / 当前选中目标）
3. 点击 **预览数据** → 显示目标数 / 样本数 / 失联率 / 进行中告警的概览（可选）
4. 点击 **导出 HTML/MD** → 触发 Electron `dialog:saveFile` 选择保存路径，写入文件

## 架构

新增文件：
- `prompt-lab/src/plugins/network-observatory/backend/net-probe-report.ts` — 纯函数模块，无 IPC 依赖
  - `buildReportData(input)` — 聚合数据
  - `buildMarkdownReport(data)` → 字符串
  - `buildHtmlReport(data)` → 字符串（含 `<style>` 块、`@media print`）
  - `suggestReportFilename(title, format)` → `net-obs_<title>_<timestamp>.<ext>`

修改文件：
- `prompt-lab/src/plugins/network-observatory/NetworkObservatoryPanel.tsx`
  - 新增 `ExportReportModal` 子组件
  - 工具栏新增 **导出报告** 按钮
  - 新增 `FileText` / `Download` 图标 import
  - 局部 `NetProbeAPI` 接口补齐 `listResults` 的 `untilMs` / `listIncidents` 的 `limit` 字段

未改动 IPC：因为只需要读 `listResults` / `heatmap` / `listAlertRules` / `listIncidents` / `listTargets` + 写 `saveFile`，全部走现有 channel。

## 关键设计决策

- **小时聚合放在报表侧而非数据库侧**：每次报告生成时重算 24 小时聚合，资源消耗极低（< 1ms / 目标），换来报告格式灵活性（未来可以加日聚合、对比窗口等）
- **HTML 自包含**：所有 CSS 内联在 `<style>` 中，热图用 `<td style="background:...">` 而非 SVG，离线打开无样式丢失
- **`@media print` 内嵌**：分页规则直接写在 HTML 头部，无需用户配置
- **热图共享同一套 `HEAT_BANDS_MS` 阈值**：MD 用 Unicode 块字符 (`▁▂▃▄▅▆▇█`)，HTML 用同色系 hex (`#10b981` → `#b91c1c`)，保证视觉一致
- **traceroute 目标的热图跳过**：traceroute 间隔长（默认 60s+），24h 内只有少量样本，168 个格子基本是空的。`buildReportData` 在生成热图前直接跳过 `probe === 'traceroute'` 的目标

## 已知限制

- **报告不含原始采样数据**：仅包含聚合统计 + 小时分布。如果用户需要原始 CSV，请用数据库直接导出（V2.3 计划）
- **告警事件只显示单条规则名**：未在事件表中保存规则快照，若规则被删除，报告显示 "(deleted rule)"
- **小时分布按本地时区**：`computeHourlyRollup` 用 `new Date().getHours()`，跨时区分享报告时小时标签会有歧义
- **V1.1 traceroute 目标在热图里始终为空**：因为我们跳过了它们；这跟 V2 的设计一致

## 冒烟测试

```powershell
cd prompt-lab
node resources/net-probe/smoke-test-report.mjs
```

合成 3 个目标 + 24h 数据 + 2 个事件（1 关闭 + 1 开放），分别生成 `samples/sample-report.md` 和 `samples/sample-report.html`，可在浏览器中直接打开 HTML 验证样式。

最近一次运行的输出（2026-08-10）：
- 4 目标（3 启用，1 暂停）· 43,200 样本 · 2.19% 失联率 · 2 告警（1 仍在进行）
- MD  10,093 字节
- HTML 69,646 字节
