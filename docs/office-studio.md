# Office Studio 插件

Office Studio 是基于 OfficeCLI 的系统级内置插件，为 `.docx`、`.xlsx` 和 `.pptx` 提供统一的创建、结构读取与高保真 HTML 预览能力。

当前编辑器还提供 CSS-like 元素查询、DOM 元素 JSON 检查、属性修改、元素新增/删除和显式保存。AI 对话注册了 `office_read`、`office_query`、`office_get_element` 与 `office_update`；其中写操作必须经过用户确认。

编辑操作保留最多 20 个临时历史快照，支持撤销和重做；快照在应用退出时清理。查询结果可以直接点击定位元素。工具栏的“模板合并”接受 JSON 对象，将当前文档中的 `{{key}}` 占位符替换后另存为同格式文件。

工作区支持多个 Office 文档标签、最近打开记录和文件拖拽打开。Agent 工具还包括 `office_create`、`office_add`、`office_remove`、`office_save`、`office_render` 和 `office_merge`；创建和合并使用系统保存对话框，新增与删除必须由用户确认。

## 开发环境

插件按以下顺序查找 OfficeCLI：

1. `OFFICECLI_PATH` 指向的可执行文件；
2. `prompt-lab/resources/officecli/<平台-架构>/` 中的内置二进制；
3. 系统 `PATH` 中的 `officecli`。

支持的内置目录名包括 `win-x64`、`win-arm64`、`darwin-x64`、`darwin-arm64`、`linux-x64` 和 `linux-arm64`。

插件默认关闭。将对应平台的 OfficeCLI 二进制和上游许可证文件放入资源目录后，可在“设置 → 插件”中启用 Office Studio。启用后，它以更高优先级接管三种 Office 文件；禁用时继续使用原有 Word、Excel 和 PPT 插件。

## 安全设计

- OfficeCLI 只由 Electron 主进程通过 `execFile` 和参数数组执行，不经过 Shell。
- IPC 只开放固定的检测、创建、结构读取、渲染和关闭操作。
- 文件扩展名限定为 `.docx`、`.xlsx` 和 `.pptx`。
- 子进程配置超时与输出上限，并禁用 OfficeCLI 自动更新。
- HTML 预览运行在 sandbox iframe 中，并注入禁止联网的 CSP。
- 临时预览目录在读取完成后立即清理。

## 打包

Electron Forge 会在资源目录存在时将其复制到应用的 `resources/officecli`。发布安装包时，需要同时保留 OfficeCLI 的 Apache-2.0 `LICENSE`、`NOTICE` 与第三方声明。
