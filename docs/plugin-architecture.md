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
| Kernel | 历史兼容代码 | Renderer 宿主上下文 | 已关闭 | 不再允许用户创建或导入 |

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

内置插件使用 `React.lazy()` 动态 import。App 只挂载当前面板；声明 `keepAlive: true` 的插件会在首次访问后保持挂载。目前 Terminal、Code Editor、Excel 和 Excalidraw 使用 keepAlive。

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
  views?: PluginViewDef[];
  menus?: PluginMenuItemDef[];
  settings?: PluginSettingDef[];
  fileEditors?: PluginFileEditorDef[];
}
```

- `commands` 已接入命令面板。
- `statusBarItems` 已接入底部状态栏。
- `views` 通过 `getViews()` 解析。
- `menus` 可贡献到文件、模块、视图和上下文菜单；TitleBar 已消费文件与视图菜单。
- `settings` 通过 `getSettings()` 汇总，用户插件 manifest 配置会自动映射。
- `fileEditors` 通过 `resolveFileEditor(fileName)` 按扩展名和优先级选择编辑器。

宿主的“文件 → 打开文件…”会调用 `resolveFileEditor`，切换到目标插件，并发送 `plugin:file-open` 浏览器事件。事件 `detail` 包含 `pluginId`、`editorId` 和文件选择结果。插件设置页会根据 `settings` 自动生成布尔、数字和文本控件。

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

## 7. Kernel 插件（已移除）

用户 Kernel 执行链已经完全移除。当前仅允许 iframe Sandbox 插件：

- `.nwd` 导入器拒绝 `runtime: "kernel"`。
- 创建对话框不提供 Kernel 入口。
- 历史 Kernel 定义在恢复时被跳过。
- `KernelPluginLoader`、`new Function`、React/Store/Electron API 注入代码均已删除。

历史定义中保留的 `bundle` 字段只用于识别并跳过旧数据，不存在任何执行路径。

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

旧版 Kernel 包使用 `kernelBundle` 代替 `script`；该格式仅用于识别和拒绝历史包，当前版本不再允许导入、创建或执行用户 Kernel 插件。

### 8.2 导入校验

导入时检查：

- 文件不超过 2 MB。
- `format` 必须为 `nwd-v1`。
- `name` 长度为 1–100 个字符。
- `version` 使用语义版本格式。
- 当前只支持 `apiVersion: "1"`。
- 新导入包的 `runtime` 必须为 `sandbox`；检测到 `kernel` 会立即拒绝。
- 权限必须在已知权限集合内。
- ID 为 2–64 位字母、数字、点、下划线或连字符；支持 Unicode 字母。
- Sandbox 必须包含非空 `script`。历史 `kernelBundle` 不会被执行。

旧包没有 `id` 时会从 `name` 推导，以保持兼容。新导出的包总会写入稳定的 `id` 和 `apiVersion`。

## 9. 持久化

插件数据已统一到 `PluginPlatformStore`：

| 数据 | 位置 |
|---|---|
| 用户插件定义、脚本和 manifest | `localStorage["plugin-platform-state-v1"]` |
| 插件配置、授权和私有数据 | 同一平台记录，按 pluginId 分区 |
| 更新回滚记录 | 每插件最近 5 个 revision |
| 日志与崩溃状态 | 每插件最近 200 条日志、崩溃计数与熔断状态 |
| 安全模式 | 平台级持久化开关 |
| 内置插件启用差量 | 数据库 setting：`plugin.enabled.delta` |
| Registry 状态和生命周期 | 当前 Renderer 内存 |

首次读取会自动迁移旧的插件定义、`$config` 和 `pksdk:data:*` 数据，且不破坏旧 key。插件连续发生 3 次运行错误会被熔断禁用；插件管理器可切换安全模式、查看日志、覆盖更新和回滚上一版本。“设置 → 插件”支持逐项授予或撤销已声明权限，Bridge 每次调用都会同时检查声明与当前授权。

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

## 12. 待开发功能

以下项目尚未完成。这里不包含已经实现的 Kernel 关闭、动态 import、按需挂载、keepAlive、基础扩展点、统一 LocalStorage、权限撤销、版本快照、日志、崩溃熔断和安全模式开关。

### P0：补齐现有能力闭环

#### 12.1 文件编辑器打开协议

宿主已经能够根据扩展名选择 `fileEditors`，切换目标插件并发送 `plugin:file-open` 事件，但各内置编辑器尚未全部消费该事件。

待开发：

- Word、Excel、PPT、PDF 和 Code Editor 统一监听 `plugin:file-open`。
- 直接使用事件携带的文件内容，不再二次弹出文件选择框。
- 定义统一的打开成功、取消、格式不支持和解析失败结果。
- 多个编辑器匹配同一扩展名时，支持默认编辑器和“打开方式”选择。
- 支持只读编辑器、可编辑编辑器及大文件降级策略。

验收标准：从“文件 → 打开文件…”选择任意已支持文件后，只出现一次文件选择器，并由正确插件打开。

#### 12.2 安装与更新授权确认

当前权限可以在设置页逐项撤销，但安装和更新阶段还没有完整确认流程。

待开发：

- 安装前展示插件申请的全部权限和风险说明。
- 默认不自动授予敏感权限。
- 更新时比较新旧权限，突出显示新增权限。
- 新增敏感权限时要求二次确认；拒绝后允许保留旧版本。
- 记录授权、拒绝和撤销时间，供安全审计查看。
- 未获得必要权限时显示明确的受限运行状态。

验收标准：插件不能仅通过修改 manifest 静默获得新增权限。

#### 12.3 原子更新与自动回滚

当前支持保存最近 5 个 revision 和手动回滚，但更新过程还不是完整事务。

待开发：

- 更新前完成包校验、权限差异确认和旧版本快照。
- 临时安装新版本并执行激活健康检查。
- 激活、迁移或健康检查失败时自动恢复旧版本及旧配置。
- 提供版本历史列表和指定版本回滚，不只回滚上一版本。
- 展示更新、回滚进度和最终结果。

验收标准：任何更新阶段失败后，原版本仍可正常启动，定义、配置和授权保持一致。

### P1：安全与数据治理

#### 12.4 插件包真实性和兼容性

- 为 manifest 提供 JSON Schema，并在导入前严格校验未知字段和字段长度。
- 校验包内文件哈希和整体完整性。
- 支持发布者签名、证书信任和插件 ID 与签名主体绑定。
- 增加最低/最高宿主版本、SDK 版本和平台兼容范围。
- 在安装前报告不兼容 API、权限和扩展点。

#### 12.5 Sandbox 资源限制

- 限制 Bridge 单条消息大小、并发数和每分钟调用频率。
- 为 Bridge 请求增加超时、取消和响应大小限制。
- 限制日志产生速率，防止日志刷屏耗尽存储。
- 为外部链接和网络能力增加允许域名列表。
- 对持续超限或协议违规的插件计入崩溃熔断。
- 评估将高权限任务放入 Electron Utility Process；不重新开放 Renderer Kernel。

#### 12.6 SQLite 私有存储

当前统一平台存储仍使用 LocalStorage。

- 实现 `PluginPlatformStore` SQLite 后端和一次性迁移。
- 为每个插件提供独立命名空间和容量配额。
- 对令牌、密码等敏感配置使用系统密钥链或等效加密能力。
- 支持插件数据导入、导出、清空和卸载时保留/删除选择。
- 增加存储 Schema 版本、事务和失败恢复。

### P2：宿主体验与可观测性

#### 12.7 扩展点增强

- `views`：侧栏、主区、底栏的多标签布局，关闭、恢复和布局持久化。
- `menus`：分组、分隔线、上下文条件、禁用状态、快捷键和冲突处理。
- `settings`：枚举、密码、路径、颜色、校验规则、恢复默认值和搜索。
- `fileEditors`：默认编辑器、打开方式、优先级冲突提示和文件大小限制。
- 命令系统：返回明确执行结果，并用正式导航事件替换当前 fallback。

#### 12.8 日志与诊断中心

当前日志通过简单弹窗查看。

- 提供独立日志面板，支持插件、级别、时间和关键字过滤。
- 展示激活耗时、Bridge 调用、崩溃堆栈和熔断原因。
- 支持复制、导出、清空和容量策略。
- 对插件启动时间、错误率和存储占用提供基础统计。
- 生成可脱敏的诊断包。

#### 12.9 安全模式恢复流程

- 进入安全模式前保存各用户插件的启用状态，退出后准确恢复。
- 支持应用启动时通过快捷键或启动参数进入安全模式。
- 展示触发崩溃和熔断的插件。
- 支持逐个试运行、健康检查和恢复启用。
- 防止安全模式切换覆盖用户原有的禁用选择。

### P3：开发者体验

#### 12.10 插件开发工具

- 提供 Sandbox 插件脚手架和示例工程。
- 支持开发模式热重载、错误覆盖层和 Bridge 调用检查器。
- 提供 manifest 自动补全、Schema 校验和打包命令。
- 建立 SDK 兼容性测试套件和示例插件回归测试。
- 提供扩展点预览器和权限最小化建议。

### 推荐实施顺序

1. 内置编辑器消费 `plugin:file-open`。
2. 安装/更新权限差异确认。
3. 原子更新、健康检查和自动回滚。
4. Bridge 限流、超时与存储配额。
5. SQLite 与敏感配置加密。
6. 日志中心、安全模式恢复和开发工具。
