# @next-work-dashboard/weread

可复用的微信读书集成包，提供数据同步、笔记搜索、阅读统计、Markdown 导出、AI 摘要/推荐，以及 Electron 主进程 IPC 服务。

本包采用宿主适配器设计，不绑定具体数据库或状态管理方案。宿主负责持久化和渲染进程 API，组件负责交互与展示。

## 功能

- 同步微信读书书籍、划线和书评
- 本地缓存、笔记搜索与同步历史
- 阅读器、阅读进度和阅读时长记录
- 阅读统计、兴趣画像和知识网络
- Markdown 全量/增量导出与内容指纹
- AI 书籍摘要与个性化推荐
- Electron 主进程 IPC handlers
- 不依赖 React 的分析、索引和导出纯函数

## 安装

```bash
npm install @next-work-dashboard/weread react react-dom
```

本包只发布 ESM。React 和 React DOM 是 peer dependencies，支持 React 18.3 和 React 19。

## 导出入口

| 入口 | 用途 |
| --- | --- |
| `@next-work-dashboard/weread` | 汇总导出 core、React 和主进程 API |
| `@next-work-dashboard/weread/core` | 类型、分析、索引、阅读记录和 Markdown 导出 |
| `@next-work-dashboard/weread/react` | 面板、Provider、适配器和 UI 组件 |
| `@next-work-dashboard/weread/main` | Electron IPC channel 与注册函数 |
| `@next-work-dashboard/weread/styles.css` | 面板基础样式 |

## React 快速接入

`WereadPanel` 不接收 `adapter` 属性，必须放在 `WereadProvider` 内。

```tsx
import {
  WereadPanel,
  WereadProvider,
  type WereadAdapter,
} from '@next-work-dashboard/weread/react';
import '@next-work-dashboard/weread/styles.css';

const adapter: WereadAdapter = {
  api: {
    wereadRequest: (apiKey, payload) =>
      window.electronAPI.wereadRequest(apiKey, payload),
    wereadAiSummary: (payload) =>
      window.electronAPI.wereadAiSummary(payload),
    wereadAiRecommend: (payload) =>
      window.electronAPI.wereadAiRecommend(payload),
  },
  ai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'your-ai-api-key',
    model: 'your-model',
  },
  tasks: taskRepository,
};

export function ReadingWorkspace() {
  return (
    <WereadProvider adapter={adapter}>
      <WereadPanel />
    </WereadProvider>
  );
}
```

Provider 内的自定义组件可以调用 `useWereadAdapter()` 访问同一适配器。

## 持久化适配器

宿主必须实现 `WereadTaskRepository`。底层可以使用 SQLite、IndexedDB、远程数据库或内存存储。

```ts
import type {
  WereadAction,
  WereadCachedBook,
  WereadExportState,
  WereadNoteSearchMatch,
  WereadReviewState,
  WereadSyncSummary,
} from '@next-work-dashboard/weread/core';
import type { WereadTaskRepository } from '@next-work-dashboard/weread/react';

export const taskRepository: WereadTaskRepository = {
  loadCache(query = ''): WereadCachedBook[] {
    return database.loadBooks(query);
  },
  replaceCache(books): WereadSyncSummary {
    return database.replaceBooks(books);
  },
  loadExportStates(): WereadExportState[] {
    return database.loadExportStates();
  },
  markExported(states): void {
    database.markExported(states);
  },
  searchNotes(query, limit = 100): WereadNoteSearchMatch[] {
    return database.searchNotes(query, limit);
  },
  loadReviewStates(): WereadReviewState[] {
    return database.loadReviewStates();
  },
  markReviewed(bookId, intervalDays): WereadReviewState {
    return database.markReviewed(bookId, intervalDays);
  },
  loadActions(): WereadAction[] {
    return database.loadActions();
  },
  saveAction(action): void {
    database.saveAction(action);
  },
  loadSyncHistory(): WereadSyncSummary[] {
    return database.loadSyncHistory();
  },
  async flush(): Promise<void> {
    await database.flush();
  },
  isReady(): boolean {
    return database.isReady();
  },
};
```

| 方法 | 作用 |
| --- | --- |
| `loadCache` | 加载本地书籍缓存，可按关键词过滤 |
| `replaceCache` | 替换缓存并返回新增、更新和删除统计 |
| `searchNotes` | 搜索本地划线与书评 |
| `markExported` | 保存已导出内容的指纹 |
| `markReviewed` | 更新间隔复习状态 |
| `saveAction` | 保存由笔记生成的行动项 |
| `loadSyncHistory` | 读取同步历史 |
| `flush` | 将内存状态持久化到磁盘 |
| `isReady` | 判断数据库是否可用 |

## Electron 主进程

应用启动时注册 handlers：

```ts
import { ipcMain } from 'electron';
import { registerWereadIpc } from '@next-work-dashboard/weread/main';

registerWereadIpc({ ipcMain });
```

注册的 channel 为：

- `weread:request`
- `weread:ai-summary`
- `weread:ai-recommend`

preload bridge 示例：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { WEREAD_IPC } from '@next-work-dashboard/weread/main';

contextBridge.exposeInMainWorld('electronAPI', {
  wereadRequest: (apiKey: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke(WEREAD_IPC.REQUEST, apiKey, payload),
  wereadAiSummary: (payload: unknown) =>
    ipcRenderer.invoke(WEREAD_IPC.AI_SUMMARY, payload),
  wereadAiRecommend: (payload: unknown) =>
    ipcRenderer.invoke(WEREAD_IPC.AI_RECOMMEND, payload),
});
```

主进程会请求微信读书 Agent Gateway，并对可重试错误最多尝试三次。微信读书 API Key 必须以 `wrk-` 开头。

## AI 配置

摘要和推荐功能调用 OpenAI-compatible Chat Completions 接口：

```text
POST {baseUrl}/chat/completions
```

```ts
const ai = {
  baseUrl: 'https://your-provider.example/v1',
  apiKey: process.env.AI_API_KEY ?? '',
  model: 'your-chat-model',
};
```

真实密钥应由宿主安全配置层管理，不要写入源代码或提交到仓库。渲染进程应通过受控 preload bridge 发起请求。

## Electron WebView

面板的阅读器标签使用 Electron `<webview>`，需要宿主窗口允许 webview。非 Electron 宿主仍可复用笔记、搜索、统计、导出和 AI 功能，但应隐藏或替换阅读器入口。

以下状态默认保存在 `localStorage`：

- 字体、排版预设和主题
- 每本书的阅读位置
- 最近阅读、阅读时长和每日时长

## Core API

Core API 不依赖 React 或 Electron。

### TF-IDF 关键词分析

```ts
import {
  clearWereadAnalysisCache,
  extractWereadWords,
  tfIdfWereadTerms,
} from '@next-work-dashboard/weread/core';

const words = extractWereadWords('这里是一段阅读笔记');
const scores = tfIdfWereadTerms([
  { id: 'book-1', text: '第一本书的划线与想法' },
  { id: 'book-2', text: '第二本书的划线与想法' },
]);
const topTerms = [...scores.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

clearWereadAnalysisCache();
```

### 笔记索引

```ts
import {
  indexedWereadNotes,
  wereadSearchText,
} from '@next-work-dashboard/weread/core';

const notes = indexedWereadNotes(book);
const searchableText = wereadSearchText(book);
```

`indexedWereadNotes` 会把划线和书评转换为统一的 `WereadIndexedNote`。

### Markdown 导出

```ts
import {
  makeWereadMarkdown,
  safeWereadFilename,
  wereadBookFingerprint,
} from '@next-work-dashboard/weread/core';

const markdown = makeWereadMarkdown(books);
const incrementalMarkdown = makeWereadMarkdown(changedBooks, true);
const filename = `${safeWereadFilename(books[0].title)}.md`;
const fingerprint = wereadBookFingerprint(books[0]);
```

内容指纹可用于判断划线或书评是否改变，从而实现增量导出。

### 阅读活动

```ts
import {
  dateKey,
  formatReadingDuration,
  loadReadingActivities,
  saveReadingActivity,
} from '@next-work-dashboard/weread/core';

const activities = loadReadingActivities();
console.log(dateKey(), formatReadingDuration(activities[0]?.totalSeconds ?? 0));
```

阅读活动写入浏览器 `localStorage`，最多保留最近 30 本书。

## 主要数据类型

| 类型 | 含义 |
| --- | --- |
| `WereadCachedBook` | 本地缓存的书籍、划线和书评 |
| `WereadIndexedNote` | 标准化后的划线或书评 |
| `WereadNoteSearchMatch` | 带摘要的笔记搜索结果 |
| `WereadSyncSummary` | 单次同步的变化统计 |
| `WereadExportState` | 已导出内容的指纹和时间 |
| `WereadReviewState` | 间隔复习状态 |
| `WereadAction` | 从笔记生成的行动项 |
| `WereadReadingActivity` | 阅读位置、进度和时长统计 |

## 样式

必须引入基础样式：

```ts
import '@next-work-dashboard/weread/styles.css';
```

组件使用 CSS variables 和语义化颜色类。宿主可以在根节点覆盖变量以适配浅色或深色主题。使用 Tailwind CSS 时，应确保发布包中的组件类名包含在生产构建的内容扫描范围内。

## 验证与发布

仓库根目录验证全部包：

```bash
npm run verify:packages
```

只验证本包：

```bash
npm run typecheck --workspace @next-work-dashboard/weread
npm test --workspace @next-work-dashboard/weread
npm run build --workspace @next-work-dashboard/weread
```

检查发布内容：

```bash
npm publish --workspace @next-work-dashboard/weread --access public --dry-run
```

## 限制

- 阅读器需要 Electron `<webview>`
- AI provider 必须兼容 Chat Completions API
- 微信读书接口依赖外部 Agent Gateway
- 数据持久化、文件写入、密钥保存和 preload 安全策略由宿主负责

## License

MIT
