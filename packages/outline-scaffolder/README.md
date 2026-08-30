# @next-work-dashboard/outline-scaffolder

面向长篇内容生产的章节生成、写作、审校与发布组件。它提供可复用的 TypeScript 核心逻辑和 React 界面，可接入普通 Web 应用、Tauri、Electron 或其他具备 React 运行环境的宿主。

组件不直接依赖 Electron，也不直接访问某个固定后端。文件系统、AI、项目存储、密钥、研究检索、Git、图片生成和发布等能力通过适配器或统一 transport 协议由宿主注入。

## 主要能力

- 解析 Markdown 标题、列表、编号目录和中文“篇/章”目录。
- 编辑目录树并按章、按节或单文件生成 Markdown 文档。
- 按“篇/部”建立目录，生成稳定有序且安全的文件名。
- 为每章配置写作目标、目标字数、核心问题、必用材料和避免重复内容。
- 单章或批量执行 AI 生成、重写、续写和审校。
- 管理章节状态、项目知识库、史料证据、主张和引用。
- 执行结构、事实、专业、语言、引用和全书一致性检查。
- 生成 DOCX、PDF、EPUB、静态站点及发布候选版本。
- 支持 Git、项目快照、协作签核和质量门禁。

## 环境要求

- React `18.3+` 或 React `19`
- React DOM `18.3+` 或 React DOM `19`
- 现代浏览器或基于 WebView 的桌面环境
- 使用完整写作能力时，需要宿主提供文件和 AI 服务

React 和 React DOM 是 peer dependencies，应由宿主应用安装并保持单实例。

## 安装

```bash
npm install @next-work-dashboard/outline-scaffolder
```

使用任何 UI 入口时都必须加载基础样式：

```ts
import "@next-work-dashboard/outline-scaffolder/styles.css";
```

## 包入口

| 入口 | 用途 |
|---|---|
| `@next-work-dashboard/outline-scaffolder` | 导出全部 core 与 React 公共能力 |
| `@next-work-dashboard/outline-scaffolder/core` | 只使用目录解析、文档生成、审校分析等纯 TypeScript 能力 |
| `@next-work-dashboard/outline-scaffolder/react` | 直接注入 `OutlineScaffolderAdapter`，适合自定义宿主 |
| `@next-work-dashboard/outline-scaffolder/web` | 使用 HTTP 或自定义 transport 接入 Web 后端 |
| `@next-work-dashboard/outline-scaffolder/tauri` | 使用 Tauri `invoke` 接入 Rust command |
| `@next-work-dashboard/outline-scaffolder/styles.css` | 组件基础样式 |

## 直接接入 React

当宿主已经具备自己的文件、AI、Git 等服务时，可以直接构造 `OutlineScaffolderAdapter`：

```tsx
import {
  OutlineScaffolderPanel,
  type OutlineScaffolderAdapter,
} from "@next-work-dashboard/outline-scaffolder/react";
import "@next-work-dashboard/outline-scaffolder/styles.css";

const adapter: OutlineScaffolderAdapter = {
  api: hostApi,
  aiConfig: {
    apiKey: "",
    baseUrl: "/api/ai",
    model: "your-model",
  },
  files: {
    openFolder: () => hostApi.workspace.openFolder(),
    readText: (root, path) => hostApi.workspace.readTextFile(root, path),
    writeText: (root, path, content) =>
      hostApi.workspace.writeTextFile(root, path, content),
    readBinary: (root, path) => hostApi.workspace.readBinaryFile(root, path),
    writeBinary: (root, path, contentBase64) =>
      hostApi.workspace.writeBinaryFile(root, path, contentBase64),
    listFiles: (root) => hostApi.workspace.listFiles(root),
    listDirectory: (root, path) => hostApi.workspace.listDirectory(root, path),
    createDirectory: (root, path) =>
      hostApi.workspace.createDirectory(root, path),
    mutate: (root, mutations) => hostApi.workspace.mutateFiles(root, mutations),
    reauthorize: (root) => hostApi.workspace.reauthorize(root),
  },
};

export function ChapterStudio() {
  return <OutlineScaffolderPanel adapter={adapter} />;
}
```

`adapter` 应保持引用稳定。若在 React 组件内创建，请使用 `useMemo`，避免每次渲染重新初始化宿主边界。

## Web 接入

### 使用 HTTP 后端

Web 入口可以将所有宿主调用转发到一个 HTTP 地址：

```tsx
import {
  WebOutlineScaffolderApp,
} from "@next-work-dashboard/outline-scaffolder/web";
import "@next-work-dashboard/outline-scaffolder/styles.css";

export function App() {
  return (
    <WebOutlineScaffolderApp
      options={{
        http: {
          endpoint: "/api/outline-scaffolder",
          credentials: "include",
          headers: async () => ({
            authorization: `Bearer ${await loadSessionToken()}`,
          }),
        },
        ai: {
          baseUrl: "/api/ai",
          model: "your-model",
        },
      }}
    />
  );
}
```

Web 后端接收 JSON：

```json
{
  "operation": "workspace.readTextFile",
  "args": ["project-root", "01-intro.md"]
}
```

成功时返回：

```json
{
  "result": {
    "success": true,
    "data": {
      "content": "# 第一章"
    }
  }
}
```

请求失败可以返回非 `2xx` 状态和错误信息：

```json
{
  "error": "文件不存在或当前用户无权读取"
}
```

### 使用自定义 Web transport

如果项目使用 RPC、Service Worker、OPFS、IndexedDB 或其他通信机制，可以绕过 HTTP transport：

```tsx
import {
  WebOutlineScaffolderApp,
  type OutlineScaffolderTransport,
} from "@next-work-dashboard/outline-scaffolder/web";

const transport: OutlineScaffolderTransport = async (operation, args) => {
  return rpcClient.call("outline-scaffolder", { operation, args });
};

<WebOutlineScaffolderApp
  options={{ transport, ai: { model: "your-model" } }}
/>;
```

也可以只创建 adapter，再嵌入自己的页面布局：

```tsx
import {
  createWebOutlineScaffolderAdapter,
} from "@next-work-dashboard/outline-scaffolder/web";
import {
  OutlineScaffolderPanel,
} from "@next-work-dashboard/outline-scaffolder/react";

const adapter = createWebOutlineScaffolderAdapter({ transport });

<OutlineScaffolderPanel adapter={adapter} />;
```

### Web 安全建议

- 不要把正式 AI API Key 写入前端源码、`localStorage` 或构建环境变量。
- 建议由受信任的服务端代理 AI、研究检索和发布请求。
- 服务端必须验证用户身份和项目权限，不能直接信任客户端传入的项目根目录。
- 文件操作必须限制在用户已授权的项目空间内，并阻止 `../` 路径穿越。
- 对图片、文档和导出文件设置合理的请求大小与执行时间限制。

## Tauri 接入

Tauri 入口通过注入的 `invoke` 工作，因此组件不强制依赖某个特定版本的 `@tauri-apps/api`。

```tsx
import { invoke } from "@tauri-apps/api/core";
import {
  TauriOutlineScaffolderApp,
} from "@next-work-dashboard/outline-scaffolder/tauri";
import "@next-work-dashboard/outline-scaffolder/styles.css";

export function App() {
  return (
    <TauriOutlineScaffolderApp
      options={{
        invoke,
        command: "outline_scaffolder",
        ai: {
          baseUrl: "https://api.example.com/v1",
          model: "your-model",
        },
      }}
    />
  );
}
```

默认 Rust command 名为 `outline_scaffolder`。前端调用形式等价于：

```ts
await invoke("outline_scaffolder", {
  operation: "workspace.writeTextFile",
  args: ["project-root", "01-intro.md", "# 第一章"],
});
```

可以在 Rust 侧实现一个统一路由：

```rust
#[tauri::command]
async fn outline_scaffolder(
    operation: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match operation.as_str() {
        "workspace.readTextFile" => read_text_file(args).await,
        "workspace.writeTextFile" => write_text_file(args).await,
        "workspace.listFiles" => list_files(args).await,
        "shell.openExternal" => open_external(args).await,
        _ => Err(format!("不支持的操作：{operation}")),
    }
}
```

示例省略了参数反序列化和权限检查。实际实现中应：

- 使用 Tauri capability 限制文件、网络、shell 和外链权限。
- 对项目根目录进行授权并阻止路径逃逸。
- 使用 Stronghold、系统 Keychain 或安全插件保存 API Key。
- 不要把任意 shell 命令直接暴露给前端。
- 对 Git、发布和图片生成操作建立明确白名单。

也可以单独创建 Tauri adapter：

```tsx
import {
  createTauriOutlineScaffolderAdapter,
} from "@next-work-dashboard/outline-scaffolder/tauri";

const adapter = createTauriOutlineScaffolderAdapter({
  invoke,
  command: "outline_scaffolder",
});
```

## Transport 协议

Web 与 Tauri 使用相同的协议：

```ts
export type OutlineScaffolderTransport = (
  operation: string,
  args: unknown[],
) => Promise<unknown>;
```

当前组件可能调用以下操作：

### 文件与项目

- `workspace.openFolder`
- `workspace.readTextFile`
- `workspace.writeTextFile`
- `workspace.readBinaryFile`
- `workspace.writeBinaryFile`
- `workspace.listFiles`
- `workspace.listDirectory`
- `workspace.createDirectory`
- `workspace.mutateFiles`
- `workspace.reauthorize`
- `outlineProjects.load`
- `outlineProjects.save`

### Git

- `workspace.gitStatus`
- `workspace.gitInit`
- `workspace.gitStage`
- `workspace.gitCommit`
- `workspace.gitOperation`

### AI、检索与图片

- `llmChat`
- `generateImage`
- `outlineResearch.search`
- `workBrowser.search.run`

### 密钥、外链与发布

- `outlineSecrets.load`
- `outlineSecrets.save`
- `shell.openExternal`
- `copyText`
- `outlineGithub.pagesStatus`

返回值应延续统一结果结构：

```ts
interface HostResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
```

宿主暂不支持某个可选能力时，应返回可读错误，而不是抛出未定义方法异常：

```json
{
  "success": false,
  "error": "当前 Web 宿主未启用 Git 功能"
}
```

文件读取、保存和 AI 写作是主要工作流的基础能力；Git、研究检索、图片生成和 GitHub Pages 可以按产品需要逐步实现。

## 只使用 Core

不需要 React UI 时，可以直接使用纯 TypeScript API：

```ts
import {
  createChapterDocuments,
  createReadme,
  parseOutline,
} from "@next-work-dashboard/outline-scaffolder/core";

const outline = parseOutline(`
# 第一篇 基础
## 第一章 开始
### 1.1 准备
## 第二章 深入
`);

const documents = createChapterDocuments(outline, {
  folder: "book",
  splitMode: "chapter",
  organizeByPart: true,
  projectTitle: "示例书稿",
});

const readme = createReadme(documents, "示例书稿", "book");
```

Core 层不依赖 Electron、Tauri 或浏览器宿主，适合在 Node.js、测试、CLI 和服务端任务中使用。

## 目录结构

```text
packages/outline-scaffolder/
├─ src/
│  ├─ core/       # 目录、审校、证据、导出和交付等纯逻辑
│  ├─ platform/   # 跨端 transport 与宿主 API 映射
│  ├─ react/      # React 主面板、子视图和适配器类型
│  ├─ web/        # Web HTTP/自定义 transport 入口
│  └─ tauri/      # Tauri invoke 入口
├─ tests/         # Vitest 单元测试
├─ example/       # 最小 React/Vite 示例
└─ dist/          # 构建输出
```

包目录不依赖 `prompt-lab/src`，可以迁移到独立 Git 仓库。Prompt Lab 只负责提供 Electron 宿主适配器。

## 本地开发

```bash
cd packages/outline-scaffolder
npm install
npm run typecheck
npm test
npm run build
```

构建独立示例：

```bash
cd example
npm install
npm run build
```

构建产物应包含：

```text
dist/core/index.js
dist/react/index.js
dist/web/index.js
dist/tauri/index.js
dist/styles.css
```

## 发布前检查

```bash
npm run typecheck
npm test
npm run build
npm publish --access public --dry-run
```

确认 dry-run 中包含 Web、Tauri、React、Core、类型声明和样式后再发布：

```bash
npm publish --access public --provenance
```

当前包使用 Changesets 管理版本。合并版本 PR 后，可在已配置 `NPM_TOKEN` 的 CI 中发布带 provenance 的 npm 包。

## 已知边界

- Web 入口提供客户端 transport，不包含服务端文件管理实现。
- Tauri 入口提供前端 `invoke` 映射，不包含 Rust command 的业务实现。
- AI、Git、检索、密钥和发布能力是否可用由宿主决定。
- 浏览器环境无法直接获得桌面文件系统权限时，应使用服务端项目空间、OPFS 或 File System Access API。
- 不支持的可选能力应由宿主返回明确错误，并在产品界面中进行降级处理。

## License

MIT
