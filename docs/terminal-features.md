# 终端功能文档

> 对标 VS Code 集成终端，基于 xterm.js + node-pty 实现。

## 架构

```
Renderer            IPC              Main              OS
Terminal.tsx  ←→  electronAPI  ←→  terminal-manager  ←→  PTY
 (xterm.js)       (preload)         (node-pty)          (shell)
```

## 功能清单

### ✅ 已实现

| # | 功能 | 说明 |
|---|------|------|
| — | PTY 终端 | xterm.js 6.0 + node-pty 1.1 |
| — | GPU 加速 | WebglAddon，失败回退 canvas |
| — | 自适应大小 | FitAddon + ResizeObserver |
| — | Dark/Light 主题 | 自动跟随系统 |
| — | 滚动缓冲 | 10000 行 |
| 1 | 多 Tab 终端 | 创建/切换/关闭多个终端 |
| 2 | Tab 栏 | 顶部标签页切换器，拖拽排序 |
| 3 | 终端内搜索 | Ctrl+F 触发 @xterm/addon-search |
| 4 | 复制/粘贴 | Ctrl+Shift+C/V 快捷键 |
| 5 | URL 链接 | WebLinksAddon，自动高亮+点击 |
| 6 | Profile 配置 | PowerShell/cmd/Git Bash/zsh/bash/fish |
| 7 | 重启终端 | 进程退出后一键重启 |
| 8 | 工具栏 | + 新建(含 profile 下拉) / 关闭 / 重启 |
| 9 | 右键菜单 | 新建/重启/关闭终端 |
| 10 | 面板快捷键 | Ctrl+` 切换终端面板 |
| 11 | 状态栏 | 进程状态、终端数量、帮助提示 |
| 15 | 字体连字 | LigaturesAddon (Fira Code 等) |
| 16 | Unicode 11 | Unicode11Addon (emoji 宽度修正) |
| 17 | CWD 显示 | Tab 标题可跟随 OSC 标题序列 |
| 18 | Tab 重命名 | 双击 Tab 改名 |
| 21 | 序列化 | SerializeAddon (buffer 导出) |

### ❌ 待实现

| # | 功能 | 说明 |
|---|------|------|
| 12 | 视觉铃 | 终端 bell 视觉闪烁 (xterm 6.0 移除了 bellStyle) |
| 13 | 窗格分割 | 左右/上下分屏 |
| 14 | 会话持久化 | 窗口重载后恢复终端内容 |
| 19 | 可配置设置 UI | 字号/字体/光标样式设置界面 |
| 20 | Shell 集成 | VS Code shell integration 命令追踪 |
| 22 | Sixel/图片 | @xterm/addon-image |

---

## 技术栈

| 包 | 版本 | 用途 |
|---|---|---|
| @xterm/xterm | 6.0.0 | 终端渲染引擎 |
| node-pty | 1.1.0 | 伪终端（PTY） |
| @xterm/addon-fit | 0.11.0 | 自适应大小 |
| @xterm/addon-webgl | 0.19.0 | GPU 渲染 |
| @xterm/addon-search | 0.16.0 | 终端内搜索 |
| @xterm/addon-web-links | 0.12.0 | URL 链接 |
| @xterm/addon-unicode11 | 0.9.0 | Unicode 11 宽度 |
| @xterm/addon-ligatures | 0.10.0 | 字体连字 |
| @xterm/addon-serialize | 0.14.0 | 序列化导出 |

## 文件索引

| 文件 | 说明 |
|------|------|
| `src/terminal/terminal-manager.ts` | 主进程 PTY 管理器 (profile 支持) |
| `src/components/Terminal.tsx` | React 终端组件 (TerminalSingle + TerminalHandle) |
| `src/plugins/built-in/terminal.plugin.tsx` | 终端插件面板 (Tab bar + 工具栏 + 右键菜单 + 状态栏) |
| `src/plugins/built-in/index.ts` | 内置插件列表 |
| `src/main.ts` | IPC handler (terminal:*, shell:open-external) |
| `src/preload.ts` | contextBridge API |
| `src/types/electron.d.ts` | 类型声明 |
