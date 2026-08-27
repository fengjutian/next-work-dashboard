# 插件按需下载安装与运行时加载方案

> 状态：设计提案  
> 适用范围：`prompt-lab` Electron 应用、根目录 `packages/*` 可发布插件包  
> 目标：应用安装包不再内置全部可选插件；用户启动应用后可在插件市场下载、启用、升级、回滚和卸载插件。

## 1. 背景

仓库已经将以下功能抽取为独立 npm workspace package：

- `@next-work-dashboard/outline-scaffolder`
- `@next-work-dashboard/rss-reader`
- `@next-work-dashboard/video-generation`
- `@next-work-dashboard/weread`

目前这些 package 仍然是 `prompt-lab/package.json` 的固定依赖。renderer 中虽然使用了 `React.lazy()` 和动态 `import()`，能够延迟执行 UI chunk，但 package 仍会进入应用依赖和最终安装包。因此，当前实现属于“代码分块加载”，不是“用户点击后下载安装”。

本方案把插件生命周期拆成两个阶段：

1. **分发阶段**：插件独立构建、签名、压缩并发布到插件市场。
2. **运行阶段**：应用获取市场目录，用户点击安装后下载到 `userData/plugins`，校验并注册，首次打开时才加载插件入口。

## 2. 目标与非目标

### 2.1 目标

- 未安装的可选插件不进入主应用安装包。
- 插件市场展示可安装版本、大小、兼容性和权限。
- 下载支持进度、取消和断点续传。
- 安装前验证目录签名、包签名、SHA-256、包大小和路径安全。
- 同一插件允许保留多个版本，并支持切换、回滚和卸载。
- 安装完成后无需重启应用即可出现插件入口。
- renderer 插件默认运行在受限沙箱中，不直接获得 Node/Electron 权限。
- 插件只能通过版本化 Plugin API 请求宿主能力。
- 保留内置插件和“官方资源包”模式，以便渐进迁移。

### 2.2 非目标

- 第一阶段不允许运行任意第三方主进程 Node.js 代码。
- 第一阶段不支持插件自行修改 preload。
- 不把 npm registry 当作应用运行时模块加载器。
- 不保证普通 npm package 未经专门构建即可安装为应用插件。
- 不在第一阶段实现插件间直接依赖；共享能力由宿主 Plugin API 提供。

## 3. 当前能力盘点

仓库已经具备插件市场的大部分安装基础设施。

### 3.1 已具备

| 能力 | 当前位置 |
|---|---|
| 插件包、市场目录、安装状态类型 | `prompt-lab/src/core/plugin-platform/types.ts` |
| 市场目录缓存和远程刷新 | `prompt-lab/src/main/plugin-marketplace.ts` |
| HTTPS 下载、取消、断点续传 | `prompt-lab/src/main/plugin-marketplace.ts` |
| SHA-256、签名和包大小校验 | `prompt-lab/src/main/plugin-marketplace.ts` |
| ZIP 解压与路径穿越防护 | `prompt-lab/src/main/plugin-marketplace.ts` |
| staging 原子安装 | `prompt-lab/src/main/plugin-marketplace.ts` |
| 多版本、激活、回滚、卸载 | `prompt-lab/src/main/plugin-marketplace.ts` |
| 数据迁移与失败恢复 | `prompt-lab/src/main/plugin-marketplace.ts` |
| 安装 IPC 和进度事件 | `prompt-lab/src/main/ipc-handlers.ts`、`prompt-lab/src/preload.ts` |
| 插件市场安装 UI | `prompt-lab/src/plugins/plugin-manager/PluginManagerPanel.tsx` |
| 用户插件定义和运行时注册 | `prompt-lab/src/plugins/plugin-manager/user-plugin-store.tsx` |
| 沙箱 Plugin Bridge | `prompt-lab/src/plugins/sandbox/` |
| 主进程资源切换 hook | `prompt-lab/src/main/plugin-runtime-hooks.ts` |

### 3.2 关键缺口

当前安装器会读取和验证 `plugin.json` 中的 `entrypoints`，但尚未形成通用的运行时加载闭环：

```text
已安装版本
  -> 读取 active manifest
  -> 根据 manifest 创建 Plugin 定义
  -> 注册到 pluginRegistry
  -> 首次打开时加载 renderer entrypoint
  -> 禁用/升级/卸载时销毁运行实例
```

此外，目前 `resolveActivePluginPath` 可以返回本地文件路径。renderer 不应获得任意插件目录读取能力，正式实现应改成受控的资源读取或自定义协议。

## 4. 总体架构

```text
HTTPS 插件市场
  ├── catalog.json + catalog signature
  └── artifacts/{plugin}/{version}/{platform}.zip
                 |
                 v
Electron main: Plugin Package Manager
  下载 -> 校验 -> staging 解压 -> manifest 校验 -> 原子安装 -> 更新状态
                 |
                 v
userData/plugins/
  ├── catalog.json
  ├── state/{pluginId}.json
  ├── packages/{pluginId}/{version}/
  │   ├── plugin.json
  │   ├── renderer.js
  │   ├── styles.css
  │   └── assets/
  ├── data/{pluginId}/
  └── downloads/*.zip.part
                 |
                 v
Renderer: InstalledPluginLoader
  manifest -> pluginRegistry -> SandboxPluginPanel -> Plugin Bridge
```

职责边界：

- **市场服务**只提供签名目录和不可变版本包。
- **main**负责网络、签名、文件系统、版本状态和资源访问控制。
- **preload**只暴露窄类型 IPC，不暴露 Node API 或任意文件路径。
- **renderer**负责商店交互、插件注册和沙箱 UI 生命周期。
- **插件代码**只能调用 Plugin SDK 中明确授予的能力。

## 5. 插件类型

### 5.1 Sandbox UI 插件（默认）

适合纯 UI、网络请求、宿主数据访问等功能。插件输出一个自包含 renderer bundle，在隔离环境中执行，通过消息桥调用宿主。

优点：

- 安装后可立即加载。
- 不需要重启 Electron 主进程。
- 权限边界清楚。
- 第三方插件发生异常时更容易隔离和自动禁用。

限制：

- 不能直接导入 Electron、Node.js 或宿主内部源码。
- React、路由、存储等能力需要通过 SDK 或明确的共享运行时提供。
- 需要将动态 chunk 合并为单文件，或者让自定义协议支持相对 chunk 和资源加载。

第一阶段建议强制生成单文件 `renderer.js`，降低加载复杂度。

### 5.2 官方资源包

适合本地模型、sidecar、词典、模板等大体积资源。宿主适配代码随应用发布，资源在用户启用功能时下载。当前 `ensureResource()` 和 `registerPluginRuntimeHook()` 已接近这种模型。

优点是安全和稳定；缺点是宿主适配代码仍占用少量应用体积，UI 不能完全独立更新。

### 5.3 受信任主进程插件（后续阶段）

只有官方签名且经过审核的插件才能声明 `entrypoints.main`。第三方包不得运行主进程代码。

即使后续开放，也应采用以下限制：

- 只接受内置公钥信任链签名。
- 明确声明权限。
- 不允许自定义 preload。
- main entrypoint 只获得冻结后的宿主 API，而不是完整 Electron 对象。
- 激活失败必须回滚版本状态。
- 安装或升级 main 插件时可提示需要重启应用。

## 6. 插件包格式

建议发布扩展名为 `.nwd-plugin.zip`，内容如下：

```text
outline-scaffolder-0.2.0.nwd-plugin.zip
├── plugin.json
├── renderer.js
├── styles.css
├── assets/
│   └── icon.svg
└── THIRD_PARTY_LICENSES.txt
```

### 6.1 manifest 示例

```json
{
  "schemaVersion": 1,
  "id": "outline-scaffolder",
  "name": "章节文档生成器",
  "version": "0.2.0",
  "description": "批量创建章节文档",
  "pluginApiVersion": 1,
  "channel": "stable",
  "engines": {
    "app": ">=1.4.0 <2.0.0"
  },
  "entrypoints": {
    "renderer": "renderer.js"
  },
  "permissions": [
    "storage"
  ],
  "contributes": {
    "activityBar": {
      "title": "章节文档生成器",
      "icon": "assets/icon.svg",
      "order": 12
    },
    "commands": [
      {
        "id": "outline-scaffolder.create",
        "title": "批量创建章节文档"
      }
    ]
  }
}
```

当前 `PluginPackageManifest` 尚无 `contributes` 字段。实施时应将其加入核心类型，并保持 manifest 是纯数据，禁止在 manifest 中放可执行表达式。

### 6.2 构建要求

- `renderer.js` 必须是浏览器目标的 ESM 或宿主规定的单文件格式。
- 第一阶段不得包含运行时 `import()` 产生的额外 chunk。
- React/ReactDOM 的处理必须统一：要么完全打入隔离 iframe，要么由 SDK 提供固定版本；不能从磁盘 package 向宿主 React 树直接注入另一份 React。
- 所有资源必须使用相对路径。
- 包内禁止符号链接、绝对路径和 `..` 路径段。
- 构建产物应包含第三方许可证清单。

推荐为每个可发布 package 增加：

```json
{
  "scripts": {
    "build:plugin": "vite build -c vite.plugin.config.ts",
    "pack:plugin": "node scripts/pack-plugin.mjs"
  }
}
```

## 7. 市场目录格式

现有 `MarketplaceCatalog` 与 `MarketplacePluginVersion` 可继续使用：

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "outline-scaffolder",
      "name": "章节文档生成器",
      "description": "批量创建章节文档",
      "versions": [
        {
          "version": "0.2.0",
          "channel": "stable",
          "engines": { "app": ">=1.4.0 <2.0.0" },
          "artifacts": {
            "win32-x64": {
              "url": "https://plugins.example.com/outline-scaffolder/0.2.0/win32-x64.zip",
              "sha256": "...",
              "size": 245760,
              "signature": "..."
            }
          }
        }
      ]
    }
  ],
  "signature": {
    "keyId": "marketplace-2026-01",
    "value": "..."
  }
}
```

要求：

- catalog 必须通过 HTTPS 获取。
- catalog 整体签名用于防止条目被替换。
- artifact 的 SHA-256 用于完整性验证。
- artifact 独立签名用于内容来源验证。
- 发布后的版本文件应不可变；修改内容必须提升版本号。
- 正式环境不允许插件包自带任意 `publicKey` 并自我证明可信。应使用应用内置的受信任 key ID 映射。

## 8. 安装流程

### 8.1 用户操作

1. 打开“插件管理器 → 插件市场”。
2. 应用读取缓存目录，同时后台刷新远端目录。
3. 用户查看版本、大小、权限和兼容性。
4. 用户点击“安装”。
5. 如果插件申请敏感权限，弹出确认对话框。
6. UI 展示下载、验证、解压和安装进度。
7. 安装成功后自动注册；默认可选择“安装并启用”或“仅安装”。
8. ActivityBar 出现插件入口。
9. 用户首次打开插件时才创建 sandbox 并执行 `renderer.js`。

### 8.2 main 安装事务

现有 `installPluginPackage()` 的事务模型可以保留：

```text
校验请求
 -> 下载到 downloads/*.part
 -> 验证大小
 -> 验证 SHA-256
 -> 验证签名
 -> 解压到唯一 staging 目录
 -> 解析并校验 plugin.json
 -> 执行声明式数据迁移
 -> rename 到 packages/{id}/{version}
 -> 原子写入 state
 -> 通知 renderer 刷新已安装插件
```

安装失败时：

- 删除 `.part`，网络取消除外，以便续传。
- 删除 staging。
- 不修改 active version。
- 数据迁移失败时从备份恢复。
- 向 renderer 返回稳定错误码，不直接展示内部文件路径或堆栈。

## 9. 运行时加载设计

### 9.1 新增 InstalledPluginLoader

建议新增：

```text
prompt-lab/src/plugins/plugin-runtime/
├── installed-plugin-loader.ts
├── InstalledPluginPanel.tsx
├── manifest-adapter.ts
└── types.ts
```

职责：

- 启动时查询已安装且启用的插件。
- 将 manifest 的纯数据贡献转换成宿主 `Plugin`。
- 向 `pluginRegistry` 注册占位组件。
- 首次激活时加载 bundle。
- 禁用、版本切换和卸载时销毁实例并注销贡献。

伪代码：

```ts
export async function synchronizeInstalledPlugins(): Promise<void> {
  const installed = await window.electronAPI.plugins.listRuntimePlugins()

  for (const descriptor of installed) {
    if (pluginRegistry.get(descriptor.manifest.id)) continue

    pluginRegistry.register({
      id: descriptor.manifest.id,
      name: descriptor.manifest.name,
      source: 'user',
      icon: resolveManifestIcon(descriptor.manifest),
      enabled: descriptor.enabled,
      order: descriptor.manifest.contributes?.activityBar?.order ?? 1000,
      component: () => (
        <InstalledPluginPanel pluginId={descriptor.manifest.id} />
      ),
    })
  }
}
```

### 9.2 资源访问

不建议继续让 renderer 使用 `resolveActivePluginPath()` 获得磁盘绝对路径。推荐注册只读自定义协议：

```text
nwd-plugin://outline-scaffolder/renderer.js
nwd-plugin://outline-scaffolder/styles.css
nwd-plugin://outline-scaffolder/assets/icon.svg
```

协议处理器在 main 中执行：

1. 校验 URL 中的插件 ID。
2. 查询 active version，忽略客户端传入的版本目录。
3. 验证插件处于 enabled 状态。
4. 规范化资源相对路径并防止逃逸插件根目录。
5. 限制允许返回的 MIME 类型。
6. 添加 CSP、`nosniff` 和禁止缓存或版本化缓存策略。

如果第一阶段不注册协议，也可以提供：

```ts
readActiveFile(pluginId, relativePath): Promise<ArrayBuffer | string>
```

但必须设置单次读取上限，并只允许 manifest 入口及其声明资源。

### 9.3 沙箱实例

推荐用 sandboxed iframe 承载第三方 UI：

```html
<iframe sandbox="allow-scripts" src="plugin-host.html"></iframe>
```

注意：

- 不添加 `allow-same-origin`，除非已经评估其与脚本组合的逃逸影响。
- plugin-host 页面设置严格 CSP。
- 插件与宿主仅通过结构化 `postMessage` 通讯。
- 每条消息包含 `pluginId`、请求 ID、API 版本和动作名。
- 宿主根据已授权权限逐条判定请求。
- 不把 `window.electronAPI` 传入 iframe。
- 插件卸载或禁用时移除 iframe，取消未完成请求并释放订阅。

现有 `prompt-lab/src/plugins/sandbox/` 应作为第一实现基础，避免另建一套消息协议。

## 10. Plugin API 与权限

建议 API 按能力划分，默认拒绝：

| 权限 | 可用能力示例 | 风险等级 |
|---|---|---|
| `storage` | 读写插件自己的命名空间 | 低 |
| `commands` | 注册和执行插件命令 | 低 |
| `notifications` | 显示应用内通知 | 低 |
| `network` | 通过宿主代理访问声明域名 | 中 |
| `workspace.read` | 读取当前工作区授权文件 | 中 |
| `workspace.write` | 修改用户明确选择的文件 | 高 |
| `clipboard.read` | 读取剪贴板 | 高 |
| `clipboard.write` | 写入剪贴板 | 中 |
| `process` | 启动进程或 sidecar | 官方插件专用 |

权限原则：

- manifest 声明的是“申请权限”，用户安装确认后才形成“授予权限”。
- 插件升级新增权限时必须再次确认。
- 网络能力应使用域名 allowlist，不直接提供任意 `fetch` 代理。
- 存储路径固定在 `userData/plugins/data/{pluginId}`。
- 工作区访问应使用用户选择的文件或受控 handle，不能传递任意绝对路径。
- API 不兼容升级时提升 `pluginApiVersion`。

## 11. IPC 契约

现有 IPC 应保留，建议新增以下通道：

```text
plugins:runtime:list
plugins:runtime:get-manifest
plugins:runtime:read-resource
plugins:runtime:set-enabled
plugins:runtime:changed        # main -> renderer push event
```

推荐类型：

```ts
interface RuntimePluginDescriptor {
  id: string
  enabled: boolean
  activeVersion: string
  manifest: PluginPackageManifest
}

interface PluginResourceRequest {
  pluginId: string
  path: string
}
```

按照项目约定，每个新 channel 必须同步修改：

- `prompt-lab/src/main/ipc-handlers.ts`
- `prompt-lab/src/preload.ts`，或拆分出的插件 preload bridge
- `prompt-lab/src/types/electron.d.ts`

并运行 `npm run check:ipc`。

## 12. 启用、禁用、升级和卸载

### 12.1 启用

```text
写 enabled=true
 -> 读取并验证 active manifest
 -> renderer 收到 runtime:changed
 -> 注册 pluginRegistry
 -> 用户首次打开时加载入口
```

### 12.2 禁用

```text
调用 plugin.deactivate
 -> 释放 commands/subscriptions
 -> 销毁 iframe
 -> pluginRegistry 注销或隐藏
 -> 写 enabled=false
```

### 12.3 升级

```text
安装新版本但不覆盖旧版本
 -> 验证并完成迁移
 -> 停止旧 runtime
 -> 原子切换 activeVersion
 -> 启动新 runtime
 -> 失败时恢复旧 state 和旧 runtime
```

### 12.4 回滚

- 先检查新版本是否提升了不可逆的数据版本。
- 可回滚时停止当前实例，切换 previous version 并重新注册。
- 不可回滚时给出明确提示，不能静默丢弃数据。

### 12.5 卸载

- 活跃版本不能直接删除，应先禁用或切换版本。
- 删除插件代码不默认删除用户数据。
- UI 提供独立的“同时删除插件数据”选项，并二次确认。
- 删除后注销 registry、命令、菜单、状态栏项目和消息监听。

## 13. 将 `packages/*` 迁移为可下载插件

### 13.1 共通改造

每个 package 需要形成三层边界：

```text
core/       纯业务逻辑和类型
plugin/     Plugin SDK 适配层
host/       可选；只存在于 prompt-lab 内的官方宿主适配
```

迁移完成后：

- 从 `prompt-lab/package.json` 移除对应 `file:../packages/...` 依赖。
- 从 `src/plugins/built-in/index.ts` 移除直接 import 和内置注册。
- 插件元数据改由下载包的 `plugin.json` 提供。
- 包构建输出独立 artifact，不再假设宿主能解析 workspace 源码。
- 与宿主数据库、IPC、AI 服务的调用改为 Plugin SDK 能力。

### 13.2 推荐迁移顺序

#### 第一阶段：`outline-scaffolder`

原因：主要是 renderer UI 和纯逻辑，最适合验证完整闭环。

验收：主应用不依赖该 package；初始无入口；点击安装后无需重启出现入口并可使用。

#### 第二阶段：`rss-reader`

将抓取、持久化和定时刷新改成宿主能力调用。不要允许下载插件自行注册 `ipcMain.handle`。

可新增受控 SDK：

```text
network.fetchFeed
storage.get/set
scheduler.registerRefresh
```

#### 第三阶段：`weread`

将数据库、AI 摘要、推荐和任务仓库通过 capability adapter 提供。需要重点验证数据迁移和权限升级。

#### 第四阶段：`video-generation`

视频生成涉及网络、文件、任务状态和可能的本地处理，建议先采用“sandbox UI + 官方 host service”的混合结构。UI 可独立下载，受信任宿主服务暂时随应用发布。

## 14. 发布流水线

建议 CI 对每个插件执行：

1. typecheck、lint、unit test。
2. 构建 plugin renderer bundle。
3. 检查 bundle 不包含禁止模块和额外动态 chunk。
4. 生成 `plugin.json`。
5. 生成许可证清单。
6. 压缩 artifact。
7. 计算大小和 SHA-256。
8. 使用离线私钥签名 artifact。
9. 上传到版本化不可变 URL。
10. 更新 catalog。
11. 签名 catalog。
12. 发布 catalog。

私钥不得进入仓库或普通 CI 日志。应用只携带公钥或公钥 ID 映射。

## 15. 安全要求

### 15.1 必须满足

- 只允许 HTTPS 下载，生产环境拒绝重定向到其他 origin。
- catalog 与 artifact 都必须验证签名。
- 限制 catalog、ZIP、单文件和解压后总大小。
- 拒绝 ZIP Slip、绝对路径、符号链接和重复敏感文件。
- staging 与最终安装目录必须位于验证后的 `userData/plugins` 下。
- 使用原子 rename 和原子状态写入。
- 普通插件不能直接访问 Node/Electron。
- renderer 不能获得任意磁盘路径。
- 插件网络、文件、剪贴板和进程能力默认拒绝。
- 插件崩溃达到阈值后自动禁用；现有 crash-disabled 逻辑应继续使用。
- 日志去除 token、cookie、文件内容等敏感信息。

### 15.2 CSP 建议

插件 host 页面至少使用：

```text
default-src 'none';
script-src nwd-plugin:;
style-src nwd-plugin: 'unsafe-inline';
img-src nwd-plugin: data:;
font-src nwd-plugin:;
connect-src 'none';
```

网络请求必须通过 Plugin Bridge；不要通过放宽 `connect-src` 让插件直接联网。

## 16. 错误处理与可观测性

建议使用稳定错误码：

```text
MARKETPLACE_UNAVAILABLE
MARKETPLACE_SIGNATURE_INVALID
PLUGIN_PLATFORM_NOT_SUPPORTED
PLUGIN_APP_VERSION_INCOMPATIBLE
PLUGIN_DOWNLOAD_CANCELLED
PLUGIN_PACKAGE_TOO_LARGE
PLUGIN_SHA256_MISMATCH
PLUGIN_SIGNATURE_INVALID
PLUGIN_MANIFEST_INVALID
PLUGIN_PERMISSION_DENIED
PLUGIN_ACTIVATION_FAILED
PLUGIN_DATA_MIGRATION_FAILED
PLUGIN_DATA_VERSION_PREVENTS_ROLLBACK
```

每次安装生成 operation ID，并记录：

- 插件 ID 和版本
- 阶段与耗时
- 下载字节数
- 结果错误码
- 是否发生回滚

不得记录 API key、签名私钥、cookie 或用户文档正文。

## 17. 测试方案

### 17.1 单元测试

- manifest schema 和版本兼容判断。
- catalog 签名、artifact 签名和 SHA-256。
- 路径规范化、ZIP Slip、绝对路径和符号链接。
- 包大小与解压炸弹限制。
- 权限 allowlist。
- manifest contributions 到 `Plugin` 的映射。
- 数据迁移规划与回滚限制。

### 17.2 集成测试

- 本地 HTTP 测试服务提供 catalog 和 artifact。
- 完整安装、取消、续传、升级、切换、回滚和卸载。
- 安装后无需重启即可注册。
- 禁用后 iframe、命令和订阅全部释放。
- 损坏包、错误签名、错误平台和不兼容 app 版本被拒绝。
- 新版本激活失败后恢复旧版本。

### 17.3 E2E 验收

以 `outline-scaffolder` 为试点：

1. 构建主应用前确认 package 不在 `prompt-lab` 依赖中。
2. 首次启动时 ActivityBar 不显示该插件。
3. 市场正确展示插件、大小、版本和权限。
4. 点击安装时显示各阶段进度。
5. 安装完成后无需重启出现入口。
6. 首次打开才执行 renderer bundle。
7. 禁用后入口消失且 runtime 被销毁。
8. 安装新版本后可切换和回滚。
9. 卸载代码后用户数据仍保留。
10. 清除数据必须经过单独确认。

## 18. 分阶段实施清单

### Phase A：补齐运行时只读接口

- [ ] 扩展 `PluginPackageManifest` 的 `contributes` 类型。
- [ ] 新增 runtime descriptor 查询接口。
- [ ] 新增安全资源读取或 `nwd-plugin://` 协议。
- [ ] IPC、preload 和 `electron.d.ts` 同步。
- [ ] 增加安全和 IPC contract 测试。

### Phase B：接入 renderer loader

- [ ] 实现 `InstalledPluginLoader`。
- [ ] 复用现有 sandbox bridge 加载 `renderer.js`。
- [ ] 实现安装后实时注册。
- [ ] 实现禁用、切换、卸载后的销毁与注销。
- [ ] 统一激活错误、日志和 crash auto-disable。

### Phase C：打包与市场发布

- [ ] 为 `outline-scaffolder` 增加 plugin build。
- [ ] 生成 artifact、hash 和签名。
- [ ] 建立测试 catalog。
- [ ] 完成端到端下载测试。
- [ ] 建立正式发布 CI 和密钥管理。

### Phase D：解除主应用固定依赖

- [ ] 删除 `outline-scaffolder` 的固定依赖和 built-in 注册。
- [ ] 对比应用安装包体积和启动性能。
- [ ] 依次迁移 RSS、Weread 和视频生成。
- [ ] 为需要宿主服务的插件建立版本化 capability API。

## 19. 必跑验证

修改插件 IPC 或 runtime 后，在 `prompt-lab` 目录运行：

```bash
npm run check:ipc
npm run typecheck
npm run lint
npx vitest run tests/plugin-platform/
```

迁移具体插件时，还应运行该 package 自身的 typecheck、test 和 build，并检查 Electron 打包产物中已经不存在被迁移 package 的代码和依赖。

## 20. 关键决策总结

1. **下载包不是普通 npm 运行时依赖**，而是经过专门构建和签名的应用插件 artifact。
2. **第三方插件默认运行在 sandbox iframe**，不能执行任意 Electron/Node 代码。
3. **main 负责所有高权限行为**，renderer 和插件只使用窄类型 Plugin API。
4. **安装与执行解耦**：安装后完成注册，首次打开才加载代码。
5. **版本目录不可变、状态原子切换**，从而支持可靠升级和回滚。
6. **先迁移 `outline-scaffolder`** 验证闭环，再处理依赖主进程服务的插件。
7. 当前仓库的下载、校验、版本和市场 UI 可以复用；主要工作集中在运行时 loader、安全资源加载和 package 插件构建格式。
