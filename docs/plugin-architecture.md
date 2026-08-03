# next-work-dashboard 插件系统

> 本文描述 `prompt-lab/src/plugins/` 当前实现。最后更新：2026-08-03。

## 1. 总览

插件系统采用统一注册、三种运行模式的设计：

```text
内置 React 插件 ───────────────────┐
用户 Kernel 插件 ── DynamicPlugin ─┼─> PluginRegistry
用户 Sandbox 插件 ─ iframe/Bridge ─┘        │
                                             ├─ ActivityBar / TitleBar
                                             ├─ App 主面板
                                             ├─ CommandPalette
                                             └─ PluginStatusBar
```

三种模式的定位不同：

| 模式 | 代码来源 | 运行位置 | 信任级别 | 典型用途 |
|---|---|---|---|---|
| 内置插件 | 随应用编译 | 宿主 React 树 | 完全信任 | 核心工作台功能 |
| Sandbox | 用户脚本或 `.nwd` | `sandbox="allow-scripts"` iframe | 低信任 | 数据面板、轻量工具 |
| Kernel | 用户 bundle 或 `.nwd` | Renderer 宿主上下文 | 高风险、仅可信来源 | 需要 React 与宿主能力的扩展 |

旧版纯文本 `content` 插件仍可由 `DynamicPlugin` 渲染，以保证向后兼容。

## 2. 启动与渲染流程

应用模块加载时按以下顺序初始化：

```text
registerBuiltInPlugins()
  → rehydrateUserPlugins()
  → React 渲染 App
  → useDbPersistence() 恢复启用状态差量
```

用户插件因此无需先打开插件管理器即可出现在导航和主面板中。

`App`、`ActivityBar`、`TitleBar`、`CommandPalette`、`PluginStatusBar` 和插件管理器通过 `usePluginRegistryVersion()` 订阅 Registry。该 Hook 基于 React `useSyncExternalStore`，不再使用计数器强制刷新。

当前 App 会挂载全部已启用插件的面板，并通过 `display` 切换可见性。这样可以保留组件状态，但大型插件仍会占用后台资源；按需加载和 `keepAlive` 策略尚未实现。

## 3. Plugin 接口

核心接口位于 `prompt-lab/src/plugins/types.ts`：

```ts
interface Plugin {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  component: FC;
  enabled: boolean;
  order: number;
  contributions?: PluginContributions;
  activate?: (
    context: PluginContext,
  ) => void | PluginDisposable | Promise<void | PluginDisposable>;
  deactivate?: () => void | Promise<void>;
}
```

### 3.1 Contributions

```ts
interface PluginContributions {
  commands?: PluginCommand[];
  statusBarItems?: StatusBarItemDef[];
  views?: Record<string, FC>;
}
```

- `commands` 已接入命令面板。
- `statusBarItems` 已接入底部状态栏。
- `views` 是预留扩展点，尚未形成完整的视图区域注册机制。

### 3.2 生命周期

Registry 支持以下状态：

```text
inactive → activating → active
    ↑                       │
    └──── deactivating ─────┘

激活异常 → error
```

启用插件时调用 `activate(context)`；禁用、卸载或覆盖插件时先回收资源，再调用 `deactivate()`。

```ts
const plugin: Plugin = {
  // 基础字段省略
  activate(context) {
    const stopWatching = startWatchingFiles();
    context.subscriptions.add(stopWatching);

    context.commands.register('example.refresh', async () => {
      await refreshData();
    });

    return () => releaseOtherResources();
  },
  async deactivate() {
    await flushPendingWrites();
  },
};
```

`PluginContext` 提供：

| API | 作用 |
|---|---|
| `subscriptions.add(disposable)` | 注册禁用时自动执行的清理函数 |
| `commands.register(id, handler)` | 注册命令处理器并自动纳入资源回收 |

生命周期使用递增 token 防止异步竞态。例如插件在 `activate()` 完成前被禁用，迟到的清理函数仍会立即执行，不会残留资源。

## 4. PluginRegistry

`prompt-lab/src/plugins/registry.ts` 导出 `PluginRegistry` 类和全局单例 `pluginRegistry`。

### 4.1 注册与状态 API

| 方法 | 说明 |
|---|---|
| `register(plugin)` | 注册插件；重复 ID 会停用并覆盖旧实例 |
| `registerAll(plugins)` | 批量注册 |
| `unregister(id)` | 停用并卸载插件，同时清理命令 |
| `get(id)` | 获取插件 |
| `getAll()` | 按 `order` 返回全部插件 |
| `getEnabled()` | 按 `order` 返回启用插件 |
| `setEnabled(id, enabled)` | 不可变地更新启用状态并触发生命周期 |
| `setEnabledMap(map)` | 批量更新，只通知真正发生的变化 |
| `getEnabledSnapshot()` | 生成持久化用启用状态快照 |
| `getLifecycleState(id)` | 查询生命周期状态 |

### 4.2 React 订阅

Registry 内部维护稳定的版本号。每次有效变化增加版本，并通知订阅者：

```ts
function MyComponent() {
  usePluginRegistryVersion();
  const plugins = pluginRegistry.getEnabled();
  // ...
}
```

### 4.3 命令 API

| 方法 | 说明 |
|---|---|
| `registerCommandHandler(id, handler)` | 注册处理器，返回撤销函数 |
| `executeCommand(id, ...args)` | 执行命令 |
| `getCommands()` | 获取全部命令声明 |
| `getPluginCommands(pluginId)` | 获取指定插件的命令 |

命令声明和命令处理器是分开的。推荐在 `activate()` 中通过 `context.commands.register()` 注册处理器，以确保禁用时自动清理。

当前未注册 handler 的命令仍保留旧版 fallback 行为；该行为只通知 Registry，并不能可靠完成面板导航，后续应由明确的导航服务替代。

## 5. 内置插件

`registerBuiltInPlugins()` 当前注册 18 个内置插件：

| ID | 面板 | 默认启用 | order |
|---|---|---:|---:|
| `ai` | AI 工作台 | 是 | 0 |
| `chat` | AI 对话 | 是 | 1 |
| `prompts` | 提示词管理 | 是 | 2 |
| `history` | 知识库/会话历史 | 是 | 3 |
| `graph` | 知识图谱 | 是 | 4 |
| `notes` | 便签 | 否 | 5 |
| `weread` | 微信读书 | 否 | 6 |
| `windy` | Windy | 否 | 7 |
| `plugin-manager` | 插件管理 | 是 | 8 |
| `terminal` | 终端 | 否 | 9 |
| `database` | 数据库浏览器 | 是 | 10 |
| `translator` | 百度翻译 | 否 | 11 |
| `word-preview` | Word 预览 | 否 | 12 |
| `excel-preview` | Excel 编辑 | 否 | 13 |
| `ppt-preview` | PPT 演示 | 否 | 14 |
| `excalidraw` | Excalidraw 白板 | 是 | 15 |
| `pdf-preview` | PDF 预览 | 是 | 16 |
| `code-editor` | 代码编辑器 | 是 | 17 |

默认状态以 `built-in/index.ts` 和 `plugins/defaults.ts` 为准。数据库中的用户启用状态差量可以覆盖默认值。

## 6. Sandbox 插件

### 6.1 隔离边界

Sandbox 插件由 `PluginSandbox` 生成 `srcdoc` iframe：

```html
<iframe sandbox="allow-scripts" />
```

CSP 核心规则：

```text
default-src 'none'
script-src 'unsafe-inline'
style-src 'unsafe-inline'
img-src data: https:
font-src data:
```

未设置 `allow-same-origin`，插件脚本不能直接读取宿主 DOM、Cookie 或宿主 localStorage。需要宿主能力时只能通过 `PluginSDK → postMessage → usePluginBridge`。

### 6.2 消息协议

请求结构：

```ts
interface SandboxMessage {
  requestId: string;
  channel: 'store' | 'ui' | 'actions' | 'data' | 'preview' | 'file' | 'config';
  method: string;
  args?: unknown[];
}
```

Host 会检查：

- 消息必须来自当前插件 iframe 的 `contentWindow`。
- `requestId`、`channel`、`method` 和 `args` 结构合法。
- 参数最多 8 个。
- 单条消息序列化后不超过 256 KB。
- 每个具体能力的参数类型和长度。

SDK 请求默认 30 秒超时。iframe 卸载或 Host 无响应时，调用方会收到 rejected Promise。

### 6.3 权限

| 权限 | 能力 |
|---|---|
| `store.read` | 读取提示词、站点、标签页、主题和会话元数据 |
| `clipboard` | 写入系统剪贴板 |
| `inject` | 向 AI 站点注入提示词 |
| `external.open` | 打开外部链接 |
| `data` | 使用插件私有键值存储 |
| `preview` | Markdown、图片、PDF、代码预览 |
| `file.read` | 通过选择器读取文件 |
| `file.write` | 通过保存对话框写入文件 |

外链只允许 `https:`、`http:` 和 `mailto:`，并拒绝 URL 中携带用户名或密码。

插件私有存储使用 `pksdk:data:<pluginId>` 命名空间，单插件上限为 512 KB，并拒绝 `__proto__`、`constructor`、`prototype` 等危险键。

### 6.4 SDK API

```js
// Store，需要 store.read
await PluginSDK.store.getPrompts();
await PluginSDK.store.getSites();
await PluginSDK.store.getTabs();
await PluginSDK.store.getActiveTab();
await PluginSDK.store.getTheme();
await PluginSDK.store.getConversations();

// UI，无需额外权限
await PluginSDK.ui.setContent('<h1>Hello</h1>');
await PluginSDK.ui.getThemeTokens();
await PluginSDK.ui.showToast('完成', 'success');
await PluginSDK.ui.getContainerSize();

// Actions
await PluginSDK.actions.copyToClipboard('text');
await PluginSDK.actions.injectPrompt('deepseek', '你好', false);
await PluginSDK.actions.openUrl('https://example.com');

// 私有数据，需要 data
await PluginSDK.data.set('key', { value: 1 });
await PluginSDK.data.get('key');
await PluginSDK.data.list();
await PluginSDK.data.delete('key');

// 预览，需要 preview
await PluginSDK.preview.markdown('# 标题');
await PluginSDK.preview.image('data:image/png;base64,...', '图片');
await PluginSDK.preview.pdf('data:application/pdf;base64,...');
await PluginSDK.preview.code('const value = 1;', 'javascript');

// 文件
await PluginSDK.file.pickOpen({ accept: '.json' });
await PluginSDK.file.pickSave('{}', 'export.json');

// 配置
await PluginSDK.config.get('pageSize');
await PluginSDK.config.getAll();
await PluginSDK.config.set('pageSize', 20);
await PluginSDK.config.getDefaults();
```

SDK 类型和实际注入 iframe 的运行时代码都来自 `sandbox/plugin-sdk.ts`，避免维护两份协议实现。

## 7. Kernel 插件

Kernel 插件由 `DynamicPlugin` 中的 `KernelPluginLoader` 加载：

1. 检测 JSX 并尝试使用 Babel 转换。
2. 通过 `new Function()` 执行 CommonJS/IIFE bundle。
3. 注入 React、XLSX、Zustand store、有限 Electron API 和 `injectToAI`。
4. 从 `module.exports.default`、`module.exports` 或约定全局变量取得 React 组件。
5. 使用 Error Boundary 隔离渲染异常。

提供给正常插件代码的 Electron API 白名单为：

- `pickFile`
- `saveFile`
- `copyText`

导入或本地创建 Kernel 插件时必须经过高风险确认。

> 安全警告：Kernel 插件仍在 Renderer 全局上下文执行。白名单减少了正常开发时的能力暴露，但不能阻止恶意代码通过全局对象寻找宿主能力。它不是真正的安全沙箱，只能安装完全可信的代码。可靠隔离需要 Electron Utility Process；在完成隔离前，也可以考虑关闭用户 Kernel 插件入口。

## 8. `.nwd` 插件包

当前格式为 JSON 文本 `nwd-v1`。

### 8.1 Sandbox 示例

```json
{
  "format": "nwd-v1",
  "manifest": {
    "id": "example.dashboard",
    "name": "Example Dashboard",
    "version": "1.0.0",
    "apiVersion": "1",
    "runtime": "sandbox",
    "permissions": ["store.read", "data"]
  },
  "script": "PluginSDK.ui.setContent('<h1>Hello</h1>')",
  "style": "h1 { color: #2563eb; }"
}
```

Kernel 包使用 `kernelBundle` 代替 `script`。

### 8.2 导入校验

导入时检查：

- 文件不超过 2 MB。
- `format` 必须为 `nwd-v1`。
- `name` 长度为 1–100 个字符。
- `version` 使用语义版本格式。
- 当前只支持 `apiVersion: "1"`。
- `runtime` 只能是 `sandbox` 或 `kernel`。
- 权限必须在已知权限集合内。
- ID 为 2–64 位字母、数字、点、下划线或连字符；支持 Unicode 字母。
- Sandbox 必须包含非空 `script`，Kernel 必须包含非空 `kernelBundle`。

旧包没有 `id` 时会从 `name` 推导，以保持兼容。新导出的包总会写入稳定的 `id` 和 `apiVersion`。

## 9. 持久化

当前持久化尚未完全统一：

| 数据 | 位置 |
|---|---|
| 用户插件定义、脚本和 manifest | `localStorage["plugin-manager-user-plugins"]` |
| 插件私有数据及配置 | `localStorage["pksdk:data:<pluginId>"]` |
| 内置插件启用差量 | 数据库 setting：`plugin.enabled.delta` |
| Registry 状态和生命周期 | 当前 Renderer 内存 |

删除用户插件会删除插件定义并从 Registry 卸载，但私有数据目前不会自动删除。完整卸载、数据保留策略和统一数据库存储仍是后续工作。

## 10. 开发一个 Sandbox 插件

最小脚本：

```js
const { ui, store } = PluginSDK;

await ui.setContent(`
  <section class="pk-card">
    <h1>提示词统计</h1>
    <button id="load" class="pk-btn pk-primary">加载</button>
    <p id="result"></p>
  </section>
`);

document.getElementById('load').addEventListener('click', async () => {
  const prompts = await store.getPrompts();
  document.getElementById('result').textContent = `共 ${prompts.length} 条`;
});
```

Manifest 必须声明 `store.read`，否则调用会被 Bridge 拒绝。

开发建议：

- 默认选择 Sandbox，不要因为需要 React 就直接选择 Kernel。
- 只申请实际使用的权限。
- 所有 SDK 调用都处理 Promise rejection。
- 不在插件数据中保存密钥和敏感凭据。
- 使用稳定 ID；插件名称可以变化，ID 不应变化。
- 在 `apiVersion` 升级前完成兼容测试。

## 11. 关键文件

| 文件 | 职责 |
|---|---|
| `prompt-lab/src/App.tsx` | 初始化插件系统并渲染面板 |
| `prompt-lab/src/plugins/types.ts` | Plugin、Contributions、生命周期类型 |
| `prompt-lab/src/plugins/registry.ts` | 注册、启用、命令、生命周期与资源回收 |
| `prompt-lab/src/plugins/usePluginRegistry.ts` | React `useSyncExternalStore` 适配 |
| `prompt-lab/src/plugins/built-in/index.ts` | 内置插件清单 |
| `prompt-lab/src/plugins/ai/` | AI 导航、WebView、欢迎页与会话保存 |
| `prompt-lab/src/plugins/chat/` | AI 对话面板及其专属子组件 |
| `prompt-lab/src/plugins/prompts/` | 提示词侧栏与全局抽屉 |
| `prompt-lab/src/plugins/history/` | 会话历史插件 |
| `prompt-lab/src/plugins/knowledge-graph/` | 知识图谱面板、画布与类型 |
| `prompt-lab/src/plugins/database/` | 数据库浏览器插件 |
| `prompt-lab/src/plugins/terminal/` | 终端 UI 与主进程 backend |
| `prompt-lab/src/plugins/dynamic/DynamicPlugin.tsx` | content、Sandbox、Kernel 模式分发 |
| `prompt-lab/src/plugins/plugin-manager/` | 创建、导入、导出、持久化和管理 UI |
| `prompt-lab/src/plugins/sandbox/types.ts` | Manifest、权限与 Bridge 协议类型 |
| `prompt-lab/src/plugins/sandbox/PluginSandbox.tsx` | iframe 与 CSP 容器 |
| `prompt-lab/src/plugins/sandbox/plugin-sdk.ts` | SDK 类型及唯一运行时源码 |
| `prompt-lab/src/plugins/sandbox/usePluginBridge.ts` | Host API 路由、权限和参数校验 |
| `prompt-lab/tests/plugin-lifecycle.test.ts` | 生命周期及异步竞态测试 |

## 12. 已知限制与路线

近期优先级：

1. 将 Kernel 移至 Utility Process，或关闭用户 Kernel 安装入口。
2. 增加权限授权记录、权限变更确认和撤销界面。
3. 统一插件定义、设置、授权和私有数据的持久化。
4. 增加内置插件动态 import、按需挂载和 `keepAlive`。
5. 完成 `views`、`menus`、`settings`、`fileEditors` 等声明式扩展点。
6. 将命令 fallback 替换为明确的导航与命令执行结果。
7. 增加插件更新、回滚、日志、崩溃熔断和安全模式。
