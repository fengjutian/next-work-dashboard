# Network Observatory V2.3 — 告警通道扩展 (Webhook / 钉钉 / Slack / Telegram)

V2.3 把告警从"弹桌面通知"扩展为多通道分发。规则表里 `notify` 字段从单一 `'desktop'` 升级为 6 种通道:`desktop` / `webhook` / `dingtalk` / `slack` / `telegram` / `silent`,每种通道的配置存在同表的 `notify_config` JSON 字段里。

## 通道一览

| 通道 | 用途 | 必需配置 | 备注 |
|---|---|---|---|
| `desktop` | Electron 桌面通知 | 无 | 默认值,未配也走这条 |
| `webhook` | 通用 HTTP POST | `url` | `bodyTemplate: json / text / none`,可加自定义 headers |
| `dingtalk` | 钉钉自定义机器人 | `url` | 可选 `secret` 启用加签,可选 `@手机号` / `@所有人` |
| `slack` | Slack Incoming Webhook | `url` | 可选 `channel` / `username` / `iconEmoji` 覆盖 |
| `telegram` | Telegram Bot | `botToken` + `chatId` | `parseMode: Markdown / HTML / MarkdownV2` |
| `silent` | 不通知,只记录 | 无 | 用于只想存事件不想打扰的场景 |

## 数据模型

`net_probe_alert_rules` 表新增两列(已通过 `CREATE TABLE IF NOT EXISTS` 兼容老库):

```sql
notify        TEXT NOT NULL DEFAULT 'desktop'  -- 'desktop' | 'webhook' | 'dingtalk' | 'slack' | 'telegram' | 'silent'
notify_config TEXT NOT NULL DEFAULT '{}'       -- JSON,与 notify 配套的字段
```

`NotifyChannelConfig` 类型(`prompt-lab/src/types/net-probe-schema.ts`):

```typescript
export interface NotifyChannelConfig {
  // Webhook 通用
  url?: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: 'json' | 'text' | 'none';
  // 钉钉
  secret?: string;
  atMobiles?: string[];
  atAll?: boolean;
  // Slack
  channel?: string;
  iconEmoji?: string;
  username?: string;
  // Telegram
  botToken?: string;
  chatId?: string;
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
  [k: string]: unknown;
}
```

## 派发器架构

新增文件:`prompt-lab/src/plugins/network-observatory/backend/net-probe-notify.ts`

- `NotifyEvent` —— 统一的载荷结构,被所有通道消费,包含规则 / 目标 / 事件 / 主机信息
- `buildNotifyEvent(type, rule, target, incident)` —— 构造载荷(从 `target.optionsJson` 解析出 port/url 等)
- `eventToText(ev)` —— 把载荷格式化成人类可读的中文文本(用于 Webhook bodyTemplate=text 的回退)
- `ChannelSender` trait + 6 个实现类(Desktop / Webhook / DingTalk / Slack / Telegram / Silent)
- `dispatchNotification(notify, notifyConfigJson, event)` —— 入口,根据 `notify` 字段选通道,捕获所有异常并返回 `ChannelSendResult { ok, channel, detail?, durationMs }`
- `testChannel(notify, notifyConfigJson)` —— 合成一个测试事件跑一次通道,UI 上"测试通道"按钮调它

`net-probe-alerts.ts` 里的 `notifyIncident` 改为:

```typescript
const result = await dispatchNotification(rule.notify, rule.notifyConfig, event);
if (!result.ok) console.warn(`[net-probe] ${result.channel} 通知失败: ${result.detail ?? '未知错误'}`);
```

## 各通道的载荷格式

### Webhook (json)
```json
{
  "type": "open",
  "rule": { "id": "...", "name": "...", "metric": "latency_p95", "op": ">", "threshold": 200, "durationSec": 60 },
  "target": { "id": "...", "target": "1.1.1.1", "probe": "icmp", "options": {} },
  "incident": { "id": "...", "startedAt": 1700000000000, "endedAt": null, "peakMetric": 250, "triggerMessage": "...", "durationSec": null },
  "timestampMs": 1700000000000,
  "host": { "hostname": "...", "platform": "Windows_NT 10.0" }
}
```

### 钉钉
```json
{
  "msgtype": "markdown",
  "markdown": {
    "title": "🚨 规则名",
    "text": "# 🚨 告警触发\n\n**ICMP** `1.1.1.1`\n\n> 触发信息\n\n- 规则: **规则名**\n- 阈值: `latency_p95 > 200`\n- 当前: `250`\n..."
  },
  "at": { "atMobiles": [...], "atUserIds": [], "isAtAll": false }
}
```

如果设了 `secret`,会在 URL 后追加 `?timestamp=...&sign=...` 加签。

### Slack
```json
{
  "text": "🚨 规则名 · 1.1.1.1 · 触发信息",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "🚨 规则名 · 告警触发" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "*ICMP* `1.1.1.1`\n触发信息" } },
    { "type": "context", "elements": [...] }
  ]
}
```

### Telegram
走 `https://api.telegram.org/bot<token>/sendMessage`,载荷:
```json
{
  "chat_id": "...",
  "text": "🚨 *规则名* (告警触发)\n\n*ICMP* `1.1.1.1`\n...\n• 事件 ID: `inc-1`",
  "parse_mode": "Markdown",
  "disable_web_page_preview": true
}
```

`MarkdownV2` 模式下会对 target/host 做特殊字符转义。

## UI

`NetworkObservatoryPanel` 的 `RulesPanel` 顶部:

- **通知通道** 下拉(6 个选项)
- 右侧 **通道配置表单**,根据所选通道动态显示对应字段
  - Webhook: URL / 方法 / 载荷格式 / 自定义 headers
  - 钉钉: URL / 加签密钥 / @手机号 / @所有人
  - Slack: URL / 频道 / 显示名 / emoji
  - Telegram: Bot Token / Chat ID / 解析模式
- **测试通道** 按钮 —— 调 `testChannel`,立即向配置好的 URL 发送一条测试事件,显示结果(✓ / ✗ 原因)
- **新增规则** 按钮 —— 提交到 storage,顺便把通道配置也写进 `notifyConfig`

## 冒烟测试

```powershell
cd prompt-lab
node resources/net-probe/smoke-test-notify.mjs
```

启动一个本地 HTTP mock,跑全部 5 种真实通道(钉钉用 signed/unsigned 两个变体) + 错误路径(无 URL / 连不上的端口 / silent / 桌面),结果写到 `samples/notify-results.json`。

最近一次跑(2026-08-10):
- webhook (json) → HTTP 200 · 36ms
- webhook (text) → HTTP 200 · 3ms
- dingtalk (unsigned) → HTTP 200 · 3ms
- dingtalk (signed) → HTTP 200 · 2ms
- slack → HTTP 200 · 1ms
- telegram → fetch failed (本地无 internet,符合预期;真实环境下会走 api.telegram.org)
- testChannel (webhook) → HTTP 200 · 4ms
- webhook (no url) → `url is required` ✓
- webhook (bad port) → `fetch failed` ✓
- silent → no-op ✓
- desktop → `electron Notification 不可用` ✓(纯 node 跑没 electron)

## 已知限制

- **Email 通道未实现**:用户需求列表里有,但 SMTP 客户端(nodemailer ~5MB)或自实现 STARTTLS+AUTH 都需要不少代码,目前 Slack/钉钉/Telegram 三家覆盖了国内 + 国外主流即时通讯场景,留待后续按需补
- **WebSocket 通道未实现**:Grafana / Prometheus AlertManager 用的远程接收协议没接,需要的话可以走 Webhook + 自定义 payload 的方式中转
- **Channel 配置没加密存储**:`botToken` / Slack URL 等以明文 JSON 存 SQLite,本地进程能读
- **失败重试**:通道发失败时只 `console.warn`,不重试也不入库(后续可以加 `net_probe_dispatch_log` 表追踪历史)
- **多通道并行**:当前规则只能选 1 个通道,不支持"同时发 Slack + 钉钉"(可以扩展 `notify` 为逗号分隔)
