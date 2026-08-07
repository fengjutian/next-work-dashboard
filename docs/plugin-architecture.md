# 🔌 next-work-dashboard 插件系统

> 统一注册、两类插件、安全隔离。最后更新：2026-08-04。

---

## 1. 总览

插件系统采用 **统一注册、两类插件** 的设计：

```
内置 React 插件 ───────────────────┐
用户 Sandbox 插件 ─ iframe/Bridge ─┴─> PluginRegistry
                                           ├─ ActivityBar / TitleBar
                                           ├─ App 主面板
                                           ├─ CommandPalette
                                           └─ PluginStatusBar
```

| 模式 | 代码来源 | 运行位置 | 信任级别 | 典型用途 |
|---|---|---|---|---|
| **内置插件** | 随应用编译 | 宿主 React 树 | 完全信任 | 核心工作台功能 |
| **Sandbox** | 用户脚本 / `.nwd` | `sandbox="allow-scripts"` iframe | 低信任 | 数据面板、轻量工具 |

> ℹ️ 旧版纯文本 `content` 插件仍可由 `DynamicPlugin` 渲染以保持向后兼容。历史 Kernel 定义只会被识别并跳过，不存在执行路径。

---

## 2. 启动与渲染流程

```
registerBuiltInPlugins()
  → rehydrateUserPlugins()
  → React 渲染 App
  → useDbPersistence() 恢复启用状态差量
```

- 用户插件无需先打开插件管理器即可出现在导航和主面板
- `App`、`ActivityBar`、`TitleBar`、`CommandPalette`、`PluginStatusBar` 通过 `usePluginRegistryVersion()` 订阅 Registry（基于 `useSyncExternalStore`）
- 内置插件使用 `React.lazy()` 动态 import；App 只挂载当前面板
- 声明 `keepAlive: true` 的插件首次访问后保持挂载（Terminal / Code Editor / Excel / Excalidraw）

---

## 3. Plugin 接口

核心接口位于 `src/plugins/types.ts`：

```ts
interface Plugin {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  component: FC;
  enabled: boolean;
  order: number;
  contributions?: PluginContributions;
  activate?: (context: PluginContext) => void | PluginDisposable | Promise<void | PluginDisposable>;
  deactivate?: () => void | Promise<void>;
}
```

### 3.1 Contributions

```ts
interface PluginContributions {
  commands?: PluginCommand[];       // 命令面板命令
  statusBarItems?: StatusBarItemDef[]; // 状态栏项
  views?: PluginViewDef[];          // 视图声明
  menus?: PluginMenuItemDef[];      // 菜单项（文件/模块/视图/上下文）
  settings?: PluginSettingDef[];    // 设置项（自动生成 UI）
  fileEditors?: PluginFileEditorDef[]; // 文件编辑器注册
}
```

- `fileEditors` 通过 `resolveFileEditor(fileName)` 按扩展名和优先级选择编辑器
- `文件 → 打开文件…` 调用 `resolveFileEditor`，切换到目标插件并发送 `plugin:file-open` 事件

### 3.2 生命周期

```
inactive → activating → active
    ↑                       │
    └──── deactivating ─────┘

激活异常 → error
```

- 启用时调用 `activate(context)`；禁用/卸载/覆盖时先回收资源再 `deactivate()`
- 生命周期使用 **递增 token** 防止异步竞态

```ts
const plugin: Plugin = {
  activate(context) {
    const stopWatching = startWatchingFiles();
    context.subscriptions.add(stopWatching);
    context.commands.register('example.refresh', async () => { await refreshData(); });
    return () => releaseOtherResources();
  },
  async deactivate() { await flushPendingWrites(); },
};
```

| API | 作用 |
|---|---|
| `subscriptions.add(disposable)` | 注册禁用时自动执行的清理函数 |
| `commands.register(id, handler)` | 注册命令处理器并自动纳入资源回收 |

---

## 4. PluginRegistry

`src/plugins/registry.ts` 导出 `PluginRegistry` 类和全局单例 `pluginRegistry`。

### 4.1 注册与状态 API

| 方法 | 说明 |
|---|---|
| `register(plugin)` | 注册插件；重复 ID 停用并覆盖旧实例 |
| `registerAll(plugins)` | 批量注册 |
| `unregister(id)` | 停用并卸载插件，清理命令 |
| `get(id)` | 获取插件 |
| `getAll()` | 按 `order` 返回全部 |
| `getEnabled()` | 按 `order` 返回已启用 |
| `setEnabled(id, enabled)` | 不可变更新启用状态 + 触发生命周期 |
| `setEnabledMap(map)` | 批量更新，只通知真正变化 |
| `getEnabledSnapshot()` | 生成持久化用启用状态快照 |
| `getLifecycleState(id)` | 查询生命周期状态 |

### 4.2 React 订阅

```ts
function MyComponent() {
  usePluginRegistryVersion();
  const plugins = pluginRegistry.getEnabled();
  // ...
}
```

Registry 内部维护稳定版本号，每次有效变化递增并通知订阅者。

### 4.3 命令 API

| 方法 | 说明 |
|---|---|
| `registerCommandHandler(id, handler)` | 注册处理器，返回撤销函数 |
| `executeCommand(id, ...args)` | 执行命令 |
| `getCommands()` | 获取全部命令声明 |
| `getPluginCommands(pluginId)` | 获取指定插件命令 |

> ⚠️ 未注册 handler 的命令保留旧版 fallback 行为，后续应由导航服务替代。

---

## 5. 内置插件

`registerBuiltInPlugins()` 注册 **18 个内置插件**：

| # | ID | 面板 | 默认启用 | order |
|---:|------|------|:---:|---:|
| 0 | `ai` | 🤖 AI 工作台 | ✅ | 0 |
| 1 | `chat` | 💬 AI 对话 | ✅ | 1 |
| 2 | `prompts` | 📝 提示词管理 | ✅ | 2 |
| 3 | `history` | 📜 知识库/会话历史 | ✅ | 3 |
| 4 | `graph` | 🕸️ 知识图谱 | ✅ | 4 |
| 5 | `notes` | 📋 便签 | ❌ | 5 |
| 6 | `weread` | 📚 微信读书 | ❌ | 6 |
| 7 | `windy` | 🌤️ Windy | ❌ | 7 |
| 8 | `plugin-manager` | 🔧 插件管理 | ✅ | 8 |
| 9 | `terminal` | 🖥️ 终端 | ❌ | 9 |
| 10 | `database` | 🗄️ 数据库浏览器 | ✅ | 10 |
| 11 | `translator` | 🌐 百度翻译 | ❌ | 11 |
| 12 | `word-preview` | 📄 Word 预览 | ❌ | 12 |
| 13 | `excel-preview` | 📊 Excel 编辑 | ❌ | 13 |
| 14 | `ppt-preview` | 📽️ PPT 演示 | ❌ | 14 |
| 15 | `excalidraw` | 🎨 Excalidraw 白板 | ✅ | 15 |
| 16 | `pdf-preview` | 📑 PDF 预览 | ✅ | 16 |
| 17 | `code-editor` | 💻 代码编辑器 | ✅ | 17 |

默认状态以 `built-in/index.ts` 和 `plugins/defaults.ts` 为准。数据库中的用户启用差量可覆盖默认值。

---

## 6. Sandbox 插件

### 6.1 隔离边界

```html
<iframe sandbox="allow-scripts" />
```

CSP 核心规则：

```
default-src 'none'
script-src 'unsafe-inline'
style-src 'unsafe-inline'
img-src data: https:
font-src data:
```

未设置 `allow-same-origin`，插件脚本**不能**直接读取宿主 DOM、Cookie 或 localStorage。需要宿主能力只能通过 `PluginSDK → postMessage → usePluginBridge`。

### 6.2 消息协议

```ts
interface SandboxMessage {
  requestId: string;
  channel: 'store' | 'ui' | 'actions' | 'data' | 'preview' | 'file' | 'config';
  method: string;
  args?: unknown[];
}
```

Host 校验规则：

- 消息必须来自当前插件 iframe 的 `contentWindow`
- `requestId`、`channel`、`method`、`args` 结构合法
- 参数最多 8 个
- 单条消息 ≤ 256 KB
- 每个具体能力的参数类型和长度
- SDK 请求默认 30 秒超时

### 6.3 权限

| 权限 | 能力 |
|---|---|
| `store.read` | 读取提示词、站点、标签页、主题和会话元数据 |
| `clipboard` | 写入系统剪贴板 |
| `inject` | 向 AI 站点注入提示词 |
| `external.open` | 打开外部链接（`https:` / `http:` / `mailto:`；拒绝 URL 含用户名密码） |
| `data` | 使用插件私有键值存储（命名空间 `pksdk:data:<pluginId>`，上限 512 KB） |
| `preview` | Markdown、图片、PDF、代码预览 |
| `file.read` | 通过选择器读取文件 |
| `file.write` | 通过保存对话框写入文件 |

### 6.4 SDK API 一览

```js
// Store（需 store.read）
await PluginSDK.store.getPrompts();
await PluginSDK.store.getSites();
await PluginSDK.store.getTabs();
await PluginSDK.store.getActiveTab();
await PluginSDK.store.getTheme();
await PluginSDK.store.getConversations();

// UI（无需额外权限）
await PluginSDK.ui.setContent('<h1>Hello</h1>');
await PluginSDK.ui.getThemeTokens();
await PluginSDK.ui.showToast('完成', 'success');
await PluginSDK.ui.getContainerSize();

// Actions
await PluginSDK.actions.copyToClipboard('text');
await PluginSDK.actions.injectPrompt('deepseek', '你好', false);
await PluginSDK.actions.openUrl('https://example.com');

// 私有数据（需 data）
await PluginSDK.data.set('key', { value: 1 });
await PluginSDK.data.get('key');
await PluginSDK.data.list();
await PluginSDK.data.delete('key');

// 预览（需 preview）
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

SDK 类型和运行时源码统一来自 `sandbox/plugin-sdk.ts`。

---

## 7. Kernel 插件（已移除）

- `.nwd` 导入器拒绝 `runtime: "kernel"`
- 创建对话框不提供 Kernel 入口
- 历史 Kernel 定义在恢复时被跳过
- `KernelPluginLoader`、`new Function`、React/Store/Electron API 注入代码均已删除
- 历史 `bundle` 字段仅用于识别旧数据，不存在执行路径

---

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

### 8.2 导入校验

| 检查项 | 规则 |
|---|---|
| 文件大小 | ≤ 2 MB |
| `format` | 必须 `nwd-v1` |
| `name` | 1–100 字符 |
| `version` | 语义版本格式 |
| `apiVersion` | 当前仅 `"1"` |
| `runtime` | 新包必须 `sandbox`（`kernel` 立即拒绝） |
| `permissions` | 必须在已知权限集合内 |
| `id` | 2–64 位字母/数字/点/下划线/连字符（支持 Unicode） |
| `script` | Sandbox 必须包含非空 `script` |

旧包缺少 `id` 时从 `name` 推导以保持兼容。

---

## 9. 持久化

| 数据 | 位置 |
|---|---|
| 用户插件定义、脚本和 manifest | `localStorage["plugin-platform-state-v1"]` |
| 插件配置、授权和私有数据 | 同一平台记录，按 pluginId 分区 |
| 更新回滚记录 | 每插件最近 5 个 revision |
| 日志与崩溃状态 | 每插件最近 200 条日志、崩溃计数与熔断状态 |
| 安全模式 | 平台级持久化开关 |
| 内置插件启用差量 | 数据库 setting：`plugin.enabled.delta` |
| Registry 状态和生命周期 | 当前 Renderer 内存 |

首次读取自动迁移旧数据且不破坏旧 key。插件连续 3 次运行错误被熔断禁用。

---

## 10. Sandbox 插件开发指南

### 10.1 开发流程

1. 确定稳定的插件 ID、功能和最小权限集合
2. 编写普通 JavaScript + 可选 CSS
3. 在 **插件管理 → 新建插件 → 高级模式** 粘贴测试
4. 在 **设置 → 插件** 检查/调整授权和配置
5. 导出 `.nwd` 或自行打包
6. 用 **插件管理 → 导入** 完成干净安装测试

> ℹ️ 插件不需要 React、Node.js 或构建工具。iframe 的 `#root` 是插件自己的页面根节点。

### 10.2 最小可运行插件

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

### 10.3 推荐的源码组织方式

```
example-plugin/
├── manifest.json
├── index.js
├── style.css
└── build.mjs
```

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

```bash
node build.mjs   # 生成的 .nwd 不得超过 2 MB
```

### 10.4 Manifest 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 推荐 | 2–64 位稳定标识；发布后不要修改 |
| `name` | ✅ | 显示名称，1–100 字符 |
| `version` | ✅ | 语义版本（如 `1.2.0`） |
| `apiVersion` | 推荐 | 当前 `"1"` |
| `runtime` | 推荐 | 当前仅 `"sandbox"` |
| `description` | 否 | 插件用途说明 |
| `author` | 否 | 作者或组织名称 |
| `iconEmoji` | 否 | 插件图标字符 |
| `permissions` | ✅ | 权限数组；无权限写 `[]` |
| `config` | 否 | 设置项声明 |

配置声明示例：

```json
{
  "config": [
    { "key": "pageSize", "label": "每页数量", "type": "number", "default": 20 },
    { "key": "showTimestamp", "label": "显示时间", "type": "boolean", "default": true },
    { "key": "layout", "label": "布局", "type": "select", "options": ["compact", "comfortable"], "default": "compact" }
  ]
}
```

### 10.5 宿主 CSS 变量

插件可直接使用的主题变量：

```css
:root {
  --background:       /* 页面背景 */
  --card-background:  /* 卡片背景 */
  --foreground:       /* 主文字色 */
  --muted-foreground: /* 次要文字色 */
  --border:           /* 边框色 */
  --primary:          /* 主色 */
  --primary-foreground: /* 主色上的文字色 */
}
```

### 10.6 SDK 使用要点

#### Store（数据读取）

```js
const prompts = await PluginSDK.store.getPrompts();
const sites = await PluginSDK.store.getSites();
const theme = await PluginSDK.store.getTheme();
```

返回可序列化的快照数据。

#### Actions（操作触发）

```js
await PluginSDK.actions.copyToClipboard('文本');
await PluginSDK.actions.openUrl('https://example.com');
await PluginSDK.actions.injectPrompt('deepseek', '请总结这段内容', false);
// 第三个参数为 true 时自动提交
```

#### 私有数据

```js
await PluginSDK.data.set('draft', { title: '草稿', updatedAt: Date.now() });
const draft = await PluginSDK.data.get('draft');
const keys = await PluginSDK.data.list();
await PluginSDK.data.delete('draft');
```

> ⚠️ 只保存可 JSON 序列化的数据，不要保存函数、DOM 节点、密码或访问令牌。

#### 配置

```js
const defaults = await PluginSDK.config.getDefaults();
const saved = await PluginSDK.config.getAll();
const config = { ...defaults, ...saved };
```

#### 文件

```js
const selected = await PluginSDK.file.pickOpen({ accept: '.json,.txt' });
await PluginSDK.file.pickSave('hello\n', 'hello.txt');
```

文件选择仅在 Electron 环境可用。

#### 事件

```js
const unsubscribe = PluginSDK.on('event-name', (payload) => { console.log(payload); });
// 不再需要时：unsubscribe();
```

### 10.7 常见错误

| 错误 | 原因与处理 |
|---|---|
| `缺少权限: ...` | manifest 未声明或用户已撤销；检查设置 → 插件 |
| `PluginSDK request timed out` | 30 秒超时；避免并发大量请求 |
| `文件选择仅在 Electron 环境下可用` | 当前环境无 Electron API |
| 插件被自动禁用 | 3 次错误触发熔断；查看日志修复 |
| 导入提示格式无效 | 检查 format / version / id / permissions / non-empty script |

### 10.8 发布前检查清单

- [ ] ID 稳定，版本递增
- [ ] `apiVersion: "1"`，`runtime: "sandbox"`
- [ ] 只声明实际使用的权限
- [ ] 异步错误全部捕获处理
- [ ] 用户输入通过 `textContent` 渲染（防 XSS）
- [ ] 文件取消、空数据、权限拒绝、超时均有处理
- [ ] 私有数据可 JSON 序列化，不含密钥
- [ ] 亮色/暗色主题均可读
- [ ] `.nwd` < 2 MB，通过全新导入和覆盖更新测试
- [ ] 保留上一可用版本以备回滚

---

## 11. 关键文件

| 文件 | 职责 |
|---|---|
| `src/App.tsx` | 初始化插件系统并渲染面板 |
| `src/plugins/types.ts` | Plugin、Contributions、生命周期类型 |
| `src/plugins/registry.ts` | 注册、启用、命令、生命周期与资源回收 |
| `src/plugins/usePluginRegistry.ts` | React `useSyncExternalStore` 适配 |
| `src/plugins/built-in/index.ts` | 内置插件清单 |
| `src/plugins/ai/` | AI 导航、WebView、欢迎页与会话保存 |
| `src/plugins/chat/` | AI 对话面板 |
| `src/plugins/prompts/` | 提示词侧栏与全局抽屉 |
| `src/plugins/history/` | 会话历史 |
| `src/plugins/knowledge-graph/` | 知识图谱面板与画布 |
| `src/plugins/database/` | 数据库浏览器 |
| `src/plugins/terminal/` | 终端 UI 与主进程 backend |
| `src/plugins/dynamic/DynamicPlugin.tsx` | 静态 content 与 Sandbox 模式分发 |
| `src/plugins/plugin-manager/` | 创建、导入、导出、管理 UI |
| `src/plugins/sandbox/types.ts` | Manifest、权限与 Bridge 协议类型 |
| `src/plugins/sandbox/PluginSandbox.tsx` | iframe 与 CSP 容器 |
| `src/plugins/sandbox/plugin-sdk.ts` | SDK 类型及唯一运行时源码 |
| `src/plugins/sandbox/usePluginBridge.ts` | Host API 路由、权限和参数校验 |
| `tests/plugin-lifecycle.test.ts` | 生命周期及异步竞态测试 |

---

## 12. 待开发功能

### 🔴 P0：补齐现有能力闭环

| 功能 | 说明 |
|---|---|
| **文件编辑器打开协议** | Word/Excel/PPT/PDF/Code Editor 统一消费 `plugin:file-open` 事件 |
| **安装与更新授权确认** | 安装前展示权限，更新时对比新旧权限，新敏感权限二次确认 |
| **原子更新与自动回滚** | 事务式更新、健康检查、失败自动回滚、版本历史列表 |

### 🟡 P1：安全与数据治理

| 功能 | 说明 |
|---|---|
| **包真实性和兼容性** | JSON Schema 校验、哈希校验、发布者签名、版本兼容范围 |
| **Sandbox 资源限制** | Bridge 限流、超时、响应大小、域名白名单、熔断升级 |
| **SQLite 私有存储** | 从 LocalStorage 迁移到 SQLite，独立命名空间和容量配额 |

### 🟢 P2：宿主体验与可观测性

| 功能 | 说明 |
|---|---|
| **扩展点增强** | views 多标签布局、menus 分组/条件、settings 高级类型 |
| **日志与诊断中心** | 独立日志面板、过滤、导出、性能统计、诊断包生成 |
| **安全模式恢复** | 启动时快捷键进入、逐个试运行、准确恢复启用状态 |

### 🔵 P3：开发者体验

| 功能 | 说明 |
|---|---|
| **插件开发工具** | 脚手架、热重载、Bridge 检查器、Schema 校验、回归测试 |

### 推荐实施顺序

1. 内置编辑器消费 `plugin:file-open`
2. 安装/更新权限差异确认
3. 原子更新、健康检查和自动回滚
4. Bridge 限流、超时与存储配额
5. SQLite 与敏感配置加密
6. 日志中心、安全模式恢复和开发工具
