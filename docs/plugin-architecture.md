# next-work-dashboard 插件架构设计文档

## 1. 概述

插件系统采用**双层架构**：内核 React 插件 + 用户沙箱插件，统一通过 `PluginRegistry`（全局单例）管理生命周期。ActivityBar 渲染所有已启用插件的图标按钮，点击后主内容区渲染对应面板。

```
用户操作 → ActivityBar → PluginRegistry.getEnabled()
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
       内置 Plugin      用户 Plugin     用户 Plugin
       (React 组件)     (旧版 Markdown)  (新版 iframe)
                            │               │
                            └───────┬───────┘
                                    ▼
                            DynamicPlugin
                                    │
                            PluginSandbox (iframe)
                                    │
                            postMessage ◄──► usePluginBridge
```

---

## 2. 内核插件层（Plugin 接口）

### 2.1 接口定义

```typescript
// src/plugins/types.ts
interface Plugin {
  id: string;                                    // 唯一标识
  name: string;                                  // ActivityBar 悬停提示 & 设置页显示名
  icon: ComponentType<{ className?: string }>;   // 图标组件
  component: FC;                                 // 主面板 React 组件
  enabled: boolean;                              // 启用/禁用
  order: number;                                 // 排序权重，越小越靠前
}
```

### 2.2 PluginRegistry（全局注册中心）

`src/plugins/registry.ts` — 发布-订阅模式的单例：

| 方法 | 说明 |
|------|------|
| `register(plugin)` | 注册插件，id 重复则覆盖 |
| `registerAll(plugins)` | 批量注册 |
| `unregister(id)` | 卸载插件 |
| `get(id)` | 获取单个插件 |
| `getAll()` | 按 order 排序返回全部 |
| `getEnabled()` | 返回已启用的插件 |
| `setEnabled(id, enabled)` | 切换启用状态 |
| `getEnabledSnapshot()` | 持久化用快照 |
| `subscribe(fn)` | 订阅变更，返回取消函数 |

### 2.3 内置插件列表

启动时 `registerBuiltInPlugins()` 注册 7 个内置插件：

| id | 名称 | 组件 | order |
|----|------|------|-------|
| `ai` | AI | `AIPanel` — WebView 多标签浏览器 | 0 |
| `prompts` | 提示词 | `PromptSidebar` — 提示词 CRUD | 1 |
| `history` | 历史 | `ConversationHistory` — 对话记录 | 2 |
| `graph` | 知识图谱 | `KnowledgeGraph` — G6 图谱可视化 | 3 |
| `notes` | 便签 | `NotesPanel` — 便签面板 | 4 |
| `weread` | 微信读书 | `WereadPanel` — 微信读书嵌入 | 5 |
| `plugin-manager` | 插件管理 | `PluginManagerPanel` — 用户插件管理 | 6 |

---

## 3. 用户沙箱插件层

用户编写的 JavaScript 脚本运行在**隔离 iframe** 中，通过 `postMessage` 与 Host 通信。核心安全原则：不暴露 Node.js / Electron 能力给用户脚本，所有操作序列化为消息。

### 3.1 架构图

```
┌──────────────────────────────────────────┐
│  Host (React Renderer)                   │
│                                          │
│  usePluginBridge                         │
│  ├─ store    → 读取 Zustand 状态快照      │
│  ├─ actions  → 剪贴板 / 注入 / 打开URL    │
│  ├─ data     → localStorage 私有存储      │
│  ├─ ui       → Toast / 主题令牌 / 容器    │
│  ├─ preview  → Markdown / 图片 / PDF      │
│  └─ file     → Electron 文件对话框        │
│         ▲                                │
│         │ postMessage                    │
│         ▼                                │
│  ┌──────────────────────────────────┐    │
│  │ iframe (sandbox="allow-scripts") │    │
│  │                                  │    │
│  │ CSP: default-src 'none'          │    │
│  │                                  │    │
│  │ <script> SDK 运行时 </script>     │    │
│  │ <script> 用户脚本   </script>     │    │
│  │ <style>  自定义 CSS  </style>     │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### 3.2 postMessage 协议

```typescript
// src/plugins/sandbox/types.ts
interface SandboxMessage {
  requestId: string;   // UUID，响应时原样返回
  channel: Channel;    // 'store' | 'ui' | 'actions' | 'data' | 'preview' | 'file'
  method: string;      // 方法名
  args?: unknown[];    // 参数数组
  ok?: boolean;        // 响应：是否成功
  result?: unknown;    // 响应：返回值
  error?: string;      // 响应：错误信息
  event?: string;      // 事件推送：事件名
  payload?: unknown;   // 事件推送：数据
}
```

### 3.3 权限模型

用户插件在创建时声明所需权限，Host 侧在每个 API 调用前校验：

| 权限 | 对应能力 |
|------|----------|
| `store.read` | 读取提示词、站点、标签页、对话历史、主题 |
| `clipboard` | 读写系统剪贴板 |
| `inject` | 向 AI 站点 webview 注入提示词 |
| `external.open` | 在外部浏览器打开 URL |
| `data` | 插件私有键值存储（localStorage 隔离） |
| `preview` | 渲染 Markdown / 图片 / PDF / 代码 |
| `file.read` | Electron 文件打开对话框 |
| `file.write` | Electron 文件保存对话框 |

### 3.4 SDK API 参考

用户脚本通过全局 `window.PluginSDK` 调用：

```javascript
// ── store ──
await PluginSDK.store.getPrompts()        // → PromptSnapshot[]
await PluginSDK.store.getSites()          // → SiteSnapshot[]
await PluginSDK.store.getTabs()           // → TabSnapshot[]
await PluginSDK.store.getActiveTab()      // → TabSnapshot | null
await PluginSDK.store.getTheme()          // → 'light' | 'dark' | 'system'
await PluginSDK.store.getConversations()  // → ConvMetaSnapshot[]

// 订阅状态变更
const unsub = PluginSDK.store.subscribe('prompts-changed', (data) => { ... })

// ── ui ──
await PluginSDK.ui.setContent('<h1>Hello</h1>')   // 设置 iframe 内 HTML
await PluginSDK.ui.getThemeTokens()                // → CSS 变量集合
await PluginSDK.ui.showToast('操作成功', 'success')
await PluginSDK.ui.getContainerSize()              // → { w: number, h: number }

// ── actions ──
await PluginSDK.actions.copyToClipboard('text')
await PluginSDK.actions.injectPrompt('deepseek', '你好', true)  // siteId, text, autoSubmit
await PluginSDK.actions.openUrl('https://example.com')

// ── data (私有存储) ──
await PluginSDK.data.set('key', { foo: 'bar' })
await PluginSDK.data.get('key')
await PluginSDK.data.list()
await PluginSDK.data.delete('key')

// ── preview ──
await PluginSDK.preview.markdown('# 标题\n**加粗**')
await PluginSDK.preview.image('data:image/png;base64,...', '截图')
await PluginSDK.preview.pdf('data:application/pdf;base64,...')
await PluginSDK.preview.code('const x = 1;', 'javascript')

// ── file ──
await PluginSDK.file.pickOpen({ accept: '.json' })
await PluginSDK.file.pickSave(JSON.stringify(data), 'export.json')
```

### 3.5 用户插件定义

```typescript
interface UserPluginDef {
  id: string;
  name: string;
  script: string;           // JS 源码
  style?: string;           // 自定义 CSS
  permissions: PluginPermission[];
  iconEmoji?: string;       // 如 '📊' '⚡'
}
```

---

## 4. 关键文件索引

| 文件 | 职责 |
|------|------|
| `src/plugins/types.ts` | Plugin 接口定义 |
| `src/plugins/registry.ts` | PluginRegistry 单例（注册/订阅/启用） |
| `src/plugins/index.ts` | 统一导出 |
| `src/plugins/built-in/index.ts` | 7 个内置插件注册 |
| `src/plugins/built-in/dynamic.plugin.tsx` | 用户插件通用渲染组件（兼容新旧模式） |
| `src/plugins/built-in/plugin-manager.plugin.tsx` | 插件管理面板 UI |
| `src/plugins/built-in/notes.plugin.tsx` | 便签插件 |
| `src/plugins/built-in/weread.plugin.tsx` | 微信读书插件 |
| `src/plugins/sandbox/types.ts` | 沙箱协议类型（消息/权限/快照） |
| `src/plugins/sandbox/PluginSandbox.tsx` | iframe 容器（srcdoc 注入） |
| `src/plugins/sandbox/plugin-sdk.ts` | SDK 运行时类型定义 |
| `src/plugins/sandbox/usePluginBridge.ts` | Host 侧 postMessage 桥接器 |
| `src/plugins/sandbox/plugin-frame.html` | iframe 静态模板 |

---

## 5. 设计要点

1. **安全隔离** — iframe `sandbox="allow-scripts"` + CSP `default-src 'none'`，用户脚本无法访问 Node.js / Electron API
2. **权限最小化** — 每个 API 调用前校验 `permissions` 数组，拒绝未授权操作
3. **私有存储隔离** — `localStorage` key 前缀 `pksdk:data:<pluginId>` 确保插件间数据互不干扰
4. **向后兼容** — `DynamicPlugin` 同时支持旧版 Markdown `content` 和新版 `script` 沙箱两种模式
5. **响应式注册** — `PluginRegistry.subscribe()` 支持 React 组件通过 Zustand 触发重渲染
6. **事件推送** — Host 可主动推送 `prompts-changed` / `sites-changed` 等事件到 iframe
