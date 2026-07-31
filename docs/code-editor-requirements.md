# 代码编辑器模块需求

## 1. 背景与目标

当前内置代码编辑器仅支持通过文件选择器打开单个文本文件，并使用 `textarea` 提供基础编辑能力。该实现无法满足项目级代码浏览、多文件编辑和开发工作流需求。

本模块参考 Visual Studio Code 的核心交互，将代码编辑器升级为轻量本地工作区，形成以下闭环：

> 打开文件夹 → 浏览文件 → 多文件编辑 → 查找替换 → 保存 → 在工作区终端运行

本阶段不以完整复刻 VS Code 为目标，不包含扩展市场、调试器、远程开发和完整 LSP。

## 2. 用户故事

1. 用户可以选择一个本地目录作为工作区，并浏览目录中的文件。
2. 用户可以同时打开多个文本文件，通过标签页快速切换。
3. 用户可以获得语法高亮、行号、代码折叠、查找替换和常用编辑快捷键。
4. 文件修改后有明确的未保存标识，关闭文件或切换工作区前不会静默丢失内容。
5. 用户可以保存当前文件或保存全部文件。
6. 用户可以从状态栏看到当前语言、光标位置、缩进和文件状态。
7. 用户可以在当前工作区目录打开集成终端。

## 3. 功能范围

### 3.1 P0：编辑闭环

- 打开本地文件夹和单个文件。
- 文件树按目录懒加载，默认忽略 `.git`、`node_modules` 和常见构建目录。
- 多标签打开、切换、关闭。
- Monaco Editor 提供语法高亮、行号、折叠、多光标、查找替换。
- 支持 `Ctrl/Cmd+S` 保存和“全部保存”。
- 标签显示未保存状态；关闭脏文件和切换工作区时进行确认。
- 状态栏显示工作区、行列、缩进、编码和语言。
- 空状态提供“打开文件夹”和“打开文件”入口。

### 3.2 P1：工作区增强

- 新建文件/目录、重命名和删除。
- `Ctrl/Cmd+P` 快速打开。
- `Ctrl/Cmd+Shift+F` 工作区全文搜索。
- 监听外部文件变化并处理冲突。
- 最近工作区、已打开标签和编辑器视图状态恢复。
- 底部面板复用现有 xterm 终端，并将工作目录设置为工作区根目录。

### 3.3 P2：开发辅助

- Problems、Output 面板。
- TypeScript、JavaScript、JSON 基础诊断。
- 格式化文档、文档大纲和 Breadcrumb。
- 自动保存、字体、Tab Size、自动换行、Minimap 等偏好设置。
- AI 操作：解释选中代码、重构、生成测试、修复错误。
- Git 状态、Diff 编辑器及 LSP 客户端。

### 3.4 当前实现状态（2026-07-31）

- P1：已接入工作区终端、可拖动底部面板、持久化编辑器设置，以及大小写/全字/正则/包含/排除全文搜索。
- P2：已接入 Problems、Output、Outline、Breadcrumb、Monaco TypeScript/JavaScript/JSON 基础诊断、文档格式化、保存时格式化和 Git 状态列表。
- 已有 Diff Editor 用于外部文件冲突比较。
- 后续增强：工作区批量替换、多终端标签、基于 HEAD 的 Git Diff/暂存提交、完整 LSP、Code Action 和 AI 代码操作。

## 4. 界面结构

```text
┌ 工具栏：打开文件夹 | 打开文件 | 保存 | 全部保存 ───────┐
├──────────────┬───────────────────────────────────────┤
│ EXPLORER     │ App.tsx × │ store.ts ● │ README.md   │
│ ▾ workspace  ├───────────────────────────────────────┤
│   ▾ src      │                                       │
│     App.tsx  │            Monaco Editor              │
│     store.ts │                                       │
│   package…   │                                       │
├──────────────┴───────────────────────────────────────┤
│ workspace  Ln 12, Col 8  Spaces: 2  UTF-8 TypeScript│
└──────────────────────────────────────────────────────┘
```

- 左侧资源管理器宽度默认 `240px`，允许后续增加拖动调整和折叠。
- 标签栏高度遵循现有紧凑布局规范。
- 编辑器颜色跟随应用主题，不硬编码 VS Code 颜色。
- 状态栏使用现有语义色与字体规范。

## 5. 数据模型

```ts
interface WorkspaceState {
  rootPath: string | null;
  rootName: string;
  expandedPaths: string[];
}

interface OpenDocument {
  path: string;
  name: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
}

interface EditorState {
  workspace: WorkspaceState;
  documents: Record<string, OpenDocument>;
  tabOrder: string[];
  activePath: string | null;
}
```

Monaco Model 使用文件 URI 作为唯一标识。切换标签时复用 Model，关闭文档后释放 Model，避免状态丢失和内存泄漏。

## 6. Electron 文件接口

Renderer 不直接访问 Node 文件系统。主进程提供：

- `workspace:openFolder`
- `workspace:listDirectory`
- `workspace:readTextFile`
- `workspace:writeTextFile`

后续扩展：

- `workspace:createFile`
- `workspace:createDirectory`
- `workspace:renameEntry`
- `workspace:deleteEntry`
- `workspace:search`
- `workspace:watch`

所有工作区操作必须满足：

1. Renderer 仅提交已授权工作区根路径和相对路径。
2. 主进程对路径进行 `resolve` 和边界校验，拒绝 `..` 越界。
3. 不通过打开工作区接口返回所有文件内容。
4. 文本文件设定大小上限；二进制文件拒绝进入文本编辑器。
5. 文件树采用懒加载，避免大型仓库首次打开时递归扫描。

## 7. 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl/Cmd+O` | 打开文件 |
| `Ctrl/Cmd+K Ctrl/Cmd+O` | 打开文件夹 |
| `Ctrl/Cmd+S` | 保存 |
| `Ctrl/Cmd+Alt+S` | 全部保存 |
| `Ctrl/Cmd+F` | 当前文件查找 |
| `Ctrl/Cmd+H` | 当前文件替换 |
| `Ctrl/Cmd+W` | 关闭当前标签 |
| `Ctrl+Tab` | 切换标签 |
| `Ctrl+\`` | 显示或隐藏终端 |

## 8. 非功能要求

- 1 万文件规模的仓库可打开，首次加载不递归遍历整个仓库。
- 切换已打开标签无明显延迟。
- 切换应用面板和主题不得丢失未保存内容。
- 文件系统错误需保留编辑内容并给出可理解的错误提示。
- 所有按钮具备 Tooltip 或可读标签，文件树支持键盘聚焦。
- 代码模块遵循现有主题 Token，不新增固定主题色。

## 9. 验收标准

1. 用户能够打开目录、展开文件夹并打开多个文本文件。
2. Monaco 正确识别常见文件语言并提供编辑能力。
3. 修改文件后标签出现脏状态，保存成功后状态清除。
4. 关闭脏文件、切换工作区时存在防丢失确认。
5. 文件读写不能通过相对路径逃逸到工作区之外。
6. 单个目录的读取按需执行，未展开目录不会被递归扫描。
7. 核心路径、语言识别、二进制检测和标签状态具备自动化测试。
