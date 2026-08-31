# @next-work-dashboard/rss-reader

可复用的 RSS/Atom 阅读器包，提供订阅源解析、React 阅读器界面，以及 Web、Tauri、Electron/Node 三种宿主接入方式。

## 功能概览

- 解析 RSS 2.0 与 Atom 订阅源
- 从普通网页自动发现 RSS/Atom 地址
- 管理订阅、分类、已读状态与收藏状态
- 批量刷新、全文搜索和文章保留策略
- 导入和导出 OPML
- 提取并缓存文章正文
- 关键词规则：通知、自动收藏、自动标记已读
- 推荐订阅源目录

## 导出入口

| 导入路径 | 用途 | 环境 |
| --- | --- | --- |
| `@next-work-dashboard/rss-reader` | 汇总导出 `core` 和 `react` | 通用 |
| `@next-work-dashboard/rss-reader/core` | 数据类型、解析器、推荐源 | Web、WebView、Node |
| `@next-work-dashboard/rss-reader/react` | 面板、Provider、宿主接口 | React 18/19 |
| `@next-work-dashboard/rss-reader/web` | 浏览器默认 adapter | Web |
| `@next-work-dashboard/rss-reader/tauri` | Tauri `invoke` adapter | Tauri |
| `@next-work-dashboard/rss-reader/main` | IPC、SQLite、后台刷新 | Electron/Node 主进程 |
| `@next-work-dashboard/rss-reader/styles.css` | 阅读器样式 | UI 宿主 |

## 安装

在本 monorepo 根目录执行：

```bash
npm install
```

外部项目可以安装发布后的包：

```bash
npm install @next-work-dashboard/rss-reader react react-dom
```

在应用入口引入样式：

```ts
import '@next-work-dashboard/rss-reader/styles.css';
```

## React 界面

`RssReaderPanel` 不直接依赖 Electron 或 Tauri。网络、存储、文件和系统能力都通过 `RssReaderAdapter` 注入。

```tsx
import { RssReaderPanel } from '@next-work-dashboard/rss-reader/react';

export function RssPage() {
  return <RssReaderPanel adapter={adapter} />;
}
```

也可以通过 Provider 提供 adapter：

```tsx
import {
  RssReaderPanel,
  RssReaderProvider,
} from '@next-work-dashboard/rss-reader/react';

export function RssPage() {
  return (
    <RssReaderProvider adapter={adapter}>
      <RssReaderPanel />
    </RssReaderProvider>
  );
}
```

面板容器应具有明确宽高，例如：

```tsx
<div style={{ width: '100%', height: '100vh' }}>
  <RssReaderPanel adapter={adapter} />
</div>
```

## Web 接入

### 最小示例

```tsx
import { useMemo } from 'react';
import { RssReaderPanel } from '@next-work-dashboard/rss-reader/react';
import { createWebRssReaderAdapter } from '@next-work-dashboard/rss-reader/web';

export function WebRssPage() {
  const adapter = useMemo(() => createWebRssReaderAdapter(), []);
  return <RssReaderPanel adapter={adapter} />;
}
```

默认 Web adapter 使用：

- `fetch` 请求订阅源和正文
- `localStorage` 保存订阅、文章、规则、设置和正文缓存
- Clipboard API 复制文本
- 浏览器文件选择器导入 OPML
- Blob 下载导出 OPML
- `window.open` 打开外部文章
- Notification API 请求通知权限

### 处理 CORS

很多第三方 RSS 服务没有开放浏览器跨域访问，因此生产环境通常需要同源代理。使用 `resolveFetchUrl` 转换请求地址：

```tsx
const adapter = createWebRssReaderAdapter({
  resolveFetchUrl: (url, kind) => {
    const query = new URLSearchParams({ url, kind });
    return `/api/rss-proxy?${query.toString()}`;
  },
});
```

`kind` 为 `feed`（订阅源）或 `article`（文章正文）。代理端应：

- 只允许 HTTP/HTTPS
- 禁止 localhost、内网 IP、云元数据地址和特殊用途 IP
- 每次重定向后重新校验目标，防止 SSRF
- 限制响应大小、重定向次数和超时
- 不转发客户端提供的敏感认证头

### 完整配置

```ts
const adapter = createWebRssReaderAdapter({
  // 可以替换为 sessionStorage 或实现 Storage 接口的对象。
  storage: window.localStorage,

  // 多实例或多账号可使用不同 key。
  storageKey: 'my-app:rss:v1',

  resolveFetchUrl: (url, kind) =>
    `/api/rss-proxy?kind=${kind}&url=${encodeURIComponent(url)}`,

  // 可注入包含鉴权、监控或重试逻辑的 fetch。
  fetch: window.fetch.bind(window),

  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
});
```

### Web 存储与正文提取限制

默认实现把数据写入一条 localStorage 记录，适合轻量使用。浏览器通常只提供数 MB 容量；大量订阅或正文缓存建议使用 IndexedDB/服务端数据库实现自定义 adapter。

Web 正文提取是轻量 DOM 文本提取，不等同于完整 Readability。需要高质量 Markdown、图片和排版时，建议在服务端代理中完成正文解析。

## Tauri 接入

Tauri adapter 将界面操作映射为 Rust command。包本身不依赖 `@tauri-apps/api`，因此不会锁定 Tauri 主版本。

### 前端示例

Tauri 2：

```tsx
import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RssReaderPanel } from '@next-work-dashboard/rss-reader/react';
import { createTauriRssReaderAdapter } from '@next-work-dashboard/rss-reader/tauri';

export function TauriRssPage() {
  const adapter = useMemo(
    () => createTauriRssReaderAdapter({ invoke }),
    [],
  );
  return <RssReaderPanel adapter={adapter} />;
}
```

Tauri 1 可从 `@tauri-apps/api/tauri` 导入 `invoke`，其余用法相同。

### 默认 Rust command 契约

| 操作 | 默认 command | 参数 |
| --- | --- | --- |
| 获取订阅源 | `rss_fetch` | `{ rawUrl }` |
| 加载状态 | `rss_load_state` | 无 |
| 保存状态 | `rss_save_state` | `{ state }` |
| 刷新全部 | `rss_refresh_all` | 无 |
| 设置刷新周期 | `rss_set_refresh_minutes` | `{ minutes }` |
| 设置保留天数 | `rss_set_retention_days` | `{ days }` |
| 设置通知 | `rss_set_notifications_enabled` | `{ enabled }` |
| 提取正文 | `rss_extract_article` | `{ feedId, articleId, rawUrl }` |
| 搜索 | `rss_search` | `{ query }` |
| 查询规则 | `rss_list_rules` | 无 |
| 保存规则 | `rss_save_rule` | `{ rule }` |
| 删除规则 | `rss_delete_rule` | `{ id }` |
| 选择文件 | `rss_pick_file` | `{ options }` |
| 保存文件 | `rss_save_file` | `{ options }` |

外部链接默认调用 Tauri Shell 插件的 `plugin:shell|open`，参数为 `{ path: url }`。

Rust command 的返回值需能序列化成 core 导出的 `RssFeed`、`RssState`、`RssKeywordRule[]` 等对应类型。正文提取返回：

```ts
interface RssExtractedContent {
  text: string;
  markdown: string;
  wordCount: number;
}
```

### 自定义 command 名称

```ts
const adapter = createTauriRssReaderAdapter({
  invoke,
  commands: {
    fetch: 'reader_fetch_feed',
    loadState: 'reader_load_state',
    saveState: 'reader_save_state',
    openExternal: 'open_external_url',
  },
});
```

### 剪贴板

默认使用 WebView 的 `navigator.clipboard`。如果 CSP 或权限不允许，可以注入 Tauri Clipboard 插件：

```ts
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

const adapter = createTauriRssReaderAdapter({
  invoke,
  copyText: writeText,
});
```

### Tauri 安全建议

- 网络和 SQLite 持久化放在 Rust 端，以避开 WebView CORS
- 对 URL 执行协议、DNS、私网地址和重定向校验
- capabilities 只开放阅读器实际需要的 command
- Shell 只允许 HTTP/HTTPS，不接受任意协议
- 限制 OPML、文章响应和数据库字段大小

## Electron/Node 接入

`main` 入口提供 `better-sqlite3` 持久化、RSS 请求、正文缓存、全文搜索、规则和后台刷新。

```ts
import path from 'node:path';
import Database from 'better-sqlite3';
import { app, ipcMain, Notification } from 'electron';
import { registerRssIpc } from '@next-work-dashboard/rss-reader/main';

let rssDatabase: Database.Database | null = null;

registerRssIpc(
  { ipcMain },
  {
    openDatabase: () => {
      rssDatabase ??= new Database(
        path.join(app.getPath('userData'), 'rss-reader.db'),
      );
      return rssDatabase;
    },
    extractReadability: async (html) => ({
      contentText: extractText(html),
      contentMarkdown: extractMarkdown(html),
      wordCount: countWords(html),
    }),
    notify: (title, body) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    },
  },
);
```

还要在 preload 中把 `RSS_IPC` 映射为满足 `RssHostApi` 的固定方法，再作为 adapter 传给面板。本仓库 `prompt-lab` 已有完整范例。不要开启 `nodeIntegration`，也不要向渲染进程暴露通用的 `ipcRenderer.invoke`。

## 自定义 Adapter

默认实现不满足需求时，实现统一宿主接口：

```ts
import type {
  RssHostApi,
  RssReaderAdapter,
} from '@next-work-dashboard/rss-reader/react';

const api: RssHostApi = {
  rss: {
    fetch: (rawUrl) => repository.fetch(rawUrl),
    loadState: () => repository.loadState(),
    saveState: (state) => repository.saveState(state),
    refreshAll: () => repository.refreshAll(),
    setRefreshMinutes: (minutes) => repository.setRefreshMinutes(minutes),
    setRetentionDays: (days) => repository.setRetentionDays(days),
    setNotificationsEnabled: (enabled) => repository.setNotifications(enabled),
    extractArticle: (feedId, articleId, rawUrl) =>
      repository.extractArticle(feedId, articleId, rawUrl),
    search: (query) => repository.search(query),
    listRules: () => repository.listRules(),
    saveRule: (rule) => repository.saveRule(rule),
    deleteRule: (id) => repository.deleteRule(id),
  },
  shell: { openExternal: (url) => openExternal(url) },
  copyText: (text) => copyText(text),
  pickFile: (options) => pickFile(options),
  saveFile: (options) => saveFile(options),
};

const adapter: RssReaderAdapter = { api };
```

## 单独使用解析器

```ts
import { parseRssFeed } from '@next-work-dashboard/rss-reader/core';

const xml = await response.text();
const feed = parseRssFeed(xml, 'https://example.com/feed.xml');

console.log(feed.title);
console.log(feed.items);
```

解析器同步、跨平台且不依赖 Node `crypto`。文章 ID 根据 guid、链接或标题稳定生成。

## 数据模型

```text
RssState
├── subscriptions: RssSubscription[]
└── articles: RssArticle[]
      ├── feedId    -> RssSubscription.id
      ├── read      已读状态
      └── starred   收藏状态
```

关键词规则动作：

- `notify`：发送通知
- `star`：自动收藏
- `mark-read`：自动标记已读

详细字段以 `@next-work-dashboard/rss-reader/core` 导出的 TypeScript 类型为准。

## 开发与验证

验证所有 packages：

```bash
npm run verify:packages
```

仅验证本包：

```bash
cd packages/rss-reader
npm run typecheck
npm test
npm run build
```

构建输出位于 `dist/`，包含 JavaScript、TypeScript 声明和 `styles.css`。

## 常见问题

### Web 添加订阅出现 `Failed to fetch`

通常是目标网站未开放 CORS。配置 `resolveFetchUrl` 使用可信服务端代理，不要关闭浏览器安全策略。

### Web 使用一段时间后无法保存

可能超过 localStorage 配额。减少正文缓存，或使用 IndexedDB/服务端数据库实现自定义 adapter。

### Tauri 提示 command not found

确认 command 已加入 `tauri::generate_handler![]`，名称与上表一致；名称不同时通过 `commands` 覆盖。

### Tauri 无法打开外部链接

确认已经注册 Shell 插件并在 capabilities 中授权，或覆盖 `commands.openExternal`。

### 提示 `RssReaderProvider is missing`

未传 `adapter` 属性时必须用 `RssReaderProvider` 包裹面板。最简单的方式是直接使用 `<RssReaderPanel adapter={adapter} />`。

### Electron IPC 契约检查失败

修改 RSS channel 时，需要同步主进程 handler、preload bridge 和 `electron.d.ts`。本仓库还需运行 `prompt-lab` 的 `npm run check:ipc`。
