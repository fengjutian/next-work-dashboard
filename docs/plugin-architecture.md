# next-work-dashboard 插件系统

> 本文描述 `prompt-lab/src/plugins/` 当前实现。最后更新：2026-08-04。

## 1. 总览

插件系统采用统一注册、两类插件的设计：

```text
内置 React 插件 ───────────────────┐
用户 Sandbox 插件 ─ iframe/Bridge ─┴─> PluginRegistry
                                             ├─ ActivityBar / TitleBar
                                             ├─ App 主面板
                                             ├─ CommandPalette
                                             └─ PluginStatusBar
```

两类插件的定位不同：

| 模式 | 代码来源 | 运行位置 | 信任级别 | 典型用途 |
|---|---|---|---|---|
| 内置插件 | 随应用编译 | 宿主 React 树 | 完全信任 | 核心工作台功能 |
| Sandbox | 用户脚本或 `.nwd` | `sandbox="allow-scripts"` iframe | 低信任 | 数据面板、轻量工具 |
旧版纯文本 `content` 插件仍可由 `DynamicPlugin` 渲染，以保证向后兼容。历史 Kernel 定义只会被识别并跳过，不存在执行路径。

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

## 10. Sandbox 插件开发指南

用户插件是一个扩展名为 `.nwd` 的 JSON 文件。插件脚本运行在带 `sandbox="allow-scripts"` 的独立 iframe 中，不能直接访问宿主 DOM、Node.js、Electron API 或宿主 JavaScript 对象。需要宿主能力时，只能调用全局对象 `PluginSDK`。

### 10.1 开发流程

推荐按以下顺序开发：

1. 确定稳定的插件 ID、功能和最小权限集合。
2. 编写普通 JavaScript 脚本和可选 CSS。
3. 在应用的“插件管理 → 新建插件 → 高级模式”中粘贴脚本测试。
4. 在“设置 → 插件”检查或调整授权和配置。
5. 导出 `.nwd`，或按下文格式自行打包。
6. 用“插件管理 → 导入”完成一次干净安装测试。

插件不需要 React、Node.js 或构建工具。iframe 的 `#root` 是插件自己的页面根节点，可以使用原生 DOM API。当前不支持用户 Kernel 插件。

### 10.2 最小可运行插件

创建 `hello.nwd`：

```json
{
  "format": "nwd-v1",
  "manifest": {
    "id": "example.hello",
    "name": "Hello Plugin",
    "version": "1.0.0",
    "apiVersion": "1",
    "runtime": "sandbox",
    "description": "最小 Sandbox 插件示例",
    "author": "Your Name",
    "iconEmoji": "👋",
    "permissions": []
  },
  "script": "document.getElementById('root').innerHTML = '<section class=\"pk-card\"><h1>Hello Plugin</h1><p>插件运行成功。</p></section>';",
  "style": "h1 { margin-bottom: 8px; font-size: 18px; }"
}
```

在插件管理器导入该文件。成功后会出现一个用户插件卡片和对应活动栏入口。

### 10.3 推荐的源码组织方式

直接手写 JSON 时，换行和引号需要转义。更适合维护的目录结构是：

```text
example-plugin/
├── manifest.json
├── index.js
├── style.css
└── build.mjs
```

`manifest.json` 只保存 manifest 对象，`index.js` 和 `style.css` 保持正常源码。可使用下面的 Node.js 脚本生成 `.nwd`：

```js
// build.mjs
import { readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const script = await readFile('index.js', 'utf8');
const style = await readFile('style.css', 'utf8').catch(() => '');

await writeFile(
  `${manifest.id}.nwd`,
  JSON.stringify({ format: 'nwd-v1', manifest, script, style }, null, 2),
  'utf8',
);
```

在插件目录执行：

```bash
node build.mjs
```

生成的 `.nwd` 不得超过 2 MB。

### 10.4 Manifest 字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `id` | 推荐 | 2–64 位稳定标识，可使用 Unicode 字母、数字、`.`、`_`、`-`；发布后不要修改 |
| `name` | 是 | 显示名称，1–100 个字符 |
| `version` | 是 | 语义版本，例如 `1.2.0` 或 `1.2.0-beta.1` |
| `apiVersion` | 推荐 | 当前必须使用 `"1"` |
| `runtime` | 推荐 | 当前只能是 `"sandbox"` |
| `description` | 否 | 插件用途说明 |
| `author` | 否 | 作者或组织名称 |
| `iconEmoji` | 否 | 插件图标字符 |
| `permissions` | 是 | 权限字符串数组；无权限时写 `[]` |
| `config` | 否 | 宿主自动生成的插件设置项 |
| `activationEvents` | 否 | 预留字段，当前不会改变加载行为 |

如果旧包缺少 `id`，宿主会从名称推导，但新插件应始终显式填写 ID。ID 用于数据、配置、授权和版本历史分区，更改 ID 会被视为另一个插件。

配置声明示例：

```json
{
  "config": [
    {
      "key": "pageSize",
      "label": "每页数量",
      "description": "列表一次显示的项目数量",
      "type": "number",
      "default": 20
    },
    {
      "key": "showTimestamp",
      "label": "显示时间",
      "type": "boolean",
      "default": true
    },
    {
      "key": "title",
      "label": "面板标题",
      "type": "string",
      "default": "我的插件"
    }
  ]
}
```

用户可以在“设置 → 插件”编辑这些配置。脚本使用 `PluginSDK.config` 读取和修改。

### 10.5 权限与 SDK 对照

权限必须同时出现在 manifest 声明和用户当前授权中。用户撤销权限后，后续调用会立即失败。

| 权限 | 允许调用 |
|---|---|
| 无需权限 | `ui.*`、`config.*` |
| `store.read` | `store.getPrompts/getSites/getTabs/getActiveTab/getTheme/getConversations` |
| `clipboard` | `actions.copyToClipboard` |
| `inject` | `actions.injectPrompt` |
| `external.open` | `actions.openUrl` |
| `data` | `data.get/set/delete/list` |
| `preview` | `preview.markdown/image/pdf/code` |
| `file.read` | `file.pickOpen` |
| `file.write` | `file.pickSave` |

只声明实际使用的权限。不要为了避免报错申请全部权限。

### 10.6 PluginSDK API

所有 SDK 方法都是异步方法并返回 Promise。插件脚本作为普通 `<script>` 执行，不支持顶层 `await`；使用异步函数包装初始化代码：

```js
(async function main() {
  try {
    await PluginSDK.ui.setContent('<section class="pk-card">加载完成</section>');
  } catch (error) {
    console.error(error);
    await PluginSDK.ui.showToast(error.message || String(error), 'error');
  }
})();
```

#### UI

```js
await PluginSDK.ui.setContent('<main>HTML 内容</main>');
const tokens = await PluginSDK.ui.getThemeTokens();
const size = await PluginSDK.ui.getContainerSize(); // { w, h }
await PluginSDK.ui.showToast('保存成功', 'success');
```

`setContent` 会替换 `#root` 内容。不要把不可信文本直接拼入 HTML；优先创建 DOM 节点并设置 `textContent`。

#### 读取宿主数据

```js
const prompts = await PluginSDK.store.getPrompts();
const sites = await PluginSDK.store.getSites();
const tabs = await PluginSDK.store.getTabs();
const activeTab = await PluginSDK.store.getActiveTab();
const theme = await PluginSDK.store.getTheme();
const conversations = await PluginSDK.store.getConversations();
```

返回值是可序列化快照，修改它不会修改宿主状态。

#### 操作

```js
await PluginSDK.actions.copyToClipboard('需要复制的文本');
await PluginSDK.actions.openUrl('https://example.com');
await PluginSDK.actions.injectPrompt('deepseek', '请总结这段内容', false);
```

`injectPrompt(siteId, text, autoSubmit)` 要求对应 AI 站点已经打开；第三个参数为 `true` 时会尝试自动提交。

#### 插件私有数据

```js
await PluginSDK.data.set('draft', { title: '草稿', updatedAt: Date.now() });
const draft = await PluginSDK.data.get('draft');
const keys = await PluginSDK.data.list();
await PluginSDK.data.delete('draft');
```

数据按插件 ID 隔离。只保存可 JSON 序列化的数据，不要保存函数、DOM 节点、循环引用、密码或访问令牌。

#### 配置

```js
const defaults = await PluginSDK.config.getDefaults();
const saved = await PluginSDK.config.getAll();
const pageSize = await PluginSDK.config.get('pageSize');
await PluginSDK.config.set('pageSize', 50);
```

`get` 在用户尚未保存该字段时可能返回 `null`。常用读取方式：

```js
const defaults = await PluginSDK.config.getDefaults();
const saved = await PluginSDK.config.getAll();
const config = { ...defaults, ...saved };
```

#### 文件

```js
const selected = await PluginSDK.file.pickOpen({ accept: '.json,.txt', multiple: false });
if (selected) {
  // selected.content 是 base64；selected 还包含 path、name、size、mimeType
}

await PluginSDK.file.pickSave('hello\n', 'hello.txt');
```

文件选择只在 Electron 环境可用。不要假定用户一定选择了文件；取消时应直接返回。

#### 预览

```js
await PluginSDK.preview.markdown('# 标题');
await PluginSDK.preview.code('const answer = 42;', 'javascript');
await PluginSDK.preview.image('data:image/png;base64,...', '图片说明');
await PluginSDK.preview.pdf('data:application/pdf;base64,...');
```

每次预览调用会替换插件当前内容。

#### 事件

```js
const unsubscribe = PluginSDK.on('event-name', (payload) => {
  console.log(payload);
});

// 不再需要时解除订阅
unsubscribe();
```

`PluginSDK.store.subscribe` 与 `PluginSDK.on` 使用同一事件机制。当前公开的业务事件有限，不要依赖未记录的内部事件名。

### 10.7 完整示例：提示词统计

Manifest 需要声明 `store.read`：

```json
{
  "id": "example.prompt-stats",
  "name": "提示词统计",
  "version": "1.0.0",
  "apiVersion": "1",
  "runtime": "sandbox",
  "permissions": ["store.read", "clipboard"],
  "config": [
    { "key": "showCategories", "label": "显示分类", "type": "boolean", "default": true }
  ]
}
```

`index.js`：

```js
(async function main() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <section class="pk-card">
      <h1>提示词统计</h1>
      <div class="pk-separator"></div>
      <button id="load" class="pk-btn pk-primary">加载统计</button>
      <button id="copy" class="pk-btn" disabled>复制结果</button>
      <pre id="result" aria-live="polite">尚未加载</pre>
    </section>`;

  let resultText = '';
  const loadButton = document.getElementById('load');
  const copyButton = document.getElementById('copy');
  const result = document.getElementById('result');

  loadButton.addEventListener('click', async () => {
    loadButton.disabled = true;
    try {
      const prompts = await PluginSDK.store.getPrompts();
      const defaults = await PluginSDK.config.getDefaults();
      const saved = await PluginSDK.config.getAll();
      const config = { ...defaults, ...saved };
      const categories = new Set(prompts.map((item) => item.category).filter(Boolean));
      resultText = `提示词：${prompts.length} 条`;
      if (config.showCategories) resultText += `\n分类：${categories.size} 个`;
      result.textContent = resultText;
      copyButton.disabled = false;
    } catch (error) {
      result.textContent = `加载失败：${error.message || String(error)}`;
    } finally {
      loadButton.disabled = false;
    }
  });

  copyButton.addEventListener('click', async () => {
    try {
      await PluginSDK.actions.copyToClipboard(resultText);
      await PluginSDK.ui.showToast('统计结果已复制', 'success');
    } catch (error) {
      await PluginSDK.ui.showToast(error.message || String(error), 'error');
    }
  });
})();
```

`style.css`：

```css
h1 { margin-bottom: 8px; font-size: 18px; }
.pk-btn + .pk-btn { margin-left: 8px; }
pre { margin-top: 12px; white-space: pre-wrap; color: var(--foreground); }
```

### 10.8 更新、导出和回滚

- 导入相同 ID 的更高版本会覆盖更新，并保存旧定义为 revision。
- 当前保留最近 5 个 revision。
- 插件管理器卡片提供导出、日志和回滚入口。
- 更新时保持稳定 ID，并递增语义版本。
- 当前自动健康检查和失败自动回滚尚未开发，更新前应先导出可用版本备份。

### 10.9 调试与错误处理

- 语法错误、未处理的 Promise rejection 和 Bridge 报告的错误会写入插件日志；普通 `console.error` 当前只出现在 iframe 开发者工具中。
- 插件连续发生 3 次运行错误后会被熔断禁用。
- 可在插件管理器查看日志和回滚版本；也可以进入安全模式禁用全部用户插件。
- 每个 SDK 请求的当前超时时间为 30 秒。
- CSP 禁止任意脚本和网络请求；图片只允许 `data:` 和 `https:` 来源。

建议统一包装异步事件：

```js
function run(action) {
  return async function handler(event) {
    try {
      await action(event);
    } catch (error) {
      console.error(error);
      await PluginSDK.ui.showToast(error.message || String(error), 'error');
    }
  };
}

document.getElementById('save').addEventListener('click', run(async () => {
  await PluginSDK.data.set('value', { savedAt: Date.now() });
}));
```

常见错误：

| 错误 | 原因与处理 |
|---|---|
| `缺少权限: ...` | manifest 未声明或用户已撤销权限；检查“设置 → 插件” |
| `PluginSDK request timed out` | 宿主未响应或操作超过 30 秒；查看插件日志并避免并发大量请求 |
| `文件选择仅在 Electron 环境下可用` | 当前运行环境没有 Electron 文件 API |
| `未知 channel/method` | SDK 与 `apiVersion` 不匹配或调用了未公开接口 |
| 插件被自动禁用 | 连续错误触发熔断；先查看日志并修复脚本 |
| 导入提示格式无效 | 检查 `format`、版本、ID、权限、runtime 和非空 `script` |

### 10.10 发布前检查清单

- [ ] ID 稳定且符合格式，版本已经递增。
- [ ] `apiVersion` 为 `"1"`，`runtime` 为 `"sandbox"`。
- [ ] 只声明实际使用的权限。
- [ ] 所有事件处理器都捕获异步错误。
- [ ] 用户输入通过 `textContent` 渲染，未直接拼接到 HTML。
- [ ] 文件取消、空数据、权限拒绝和 SDK 超时都有处理。
- [ ] 私有数据可 JSON 序列化，且不包含密钥或密码。
- [ ] 浅色和深色主题下均可阅读。
- [ ] `.nwd` 小于 2 MB，并完成全新导入和覆盖更新测试。
- [ ] 保留了上一个可用版本，以便当前阶段手动回滚。

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
| `prompt-lab/src/plugins/dynamic/DynamicPlugin.tsx` | 静态 content 与 Sandbox 模式分发 |
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
