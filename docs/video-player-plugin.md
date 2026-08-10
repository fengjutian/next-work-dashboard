---
layout: default
title: "视频播放器插件"
permalink: /video-player-plugin.html
---

# 视频播放器插件

> 基于 libmpv 的系统内置插件，提供本地 / 网络视频的播放能力。
> 最后更新：2026-08-10。

---

## 1. 目标

在 `next-work-dashboard` 中新增一个**系统级内置插件**，通过 mpv 二进制作为 sidecar，提供桌面级视频播放能力：

- 打开本地视频文件（MP4 / MKV / MOV / AVI / WebM / FLV / TS 等）
- 标准播放控制（play / pause / seek / stop / speed / volume / mute）
- 多音轨 / 多字幕切换、外挂字幕
- 最近播放列表
- 完整的桌面快捷键
- 媒体信息展示（分辨率 / 编码 / 帧率 / 时长）

V1 不包含：网络协议（HLS / RTSP）、播放列表、嵌入到 BrowserWindow、硬件解码控制。

---

## 2. 架构

### 2.1 Sidecar 模式

延续项目现有的 sidecar 模式（与 disk-scanner / rag-worker / net-probe 一致）：

```
Renderer (React)
   ↓  IPC: video-player:*
Main Process
   ↓  stdio JSON-RPC over named pipe / unix socket
mpv 二进制 (sidecar)
   ↓
libmpv → FFmpeg
```

视频画面显示在 mpv 自己的 OS 窗口中（V1 简化策略）；插件面板作为"遥控器"控制。

### 2.2 工程结构

```
prompt-lab/
├── native/
│   └── video-player/                 # V2 预留：用 Rust N-API 链接 libmpv
├── resources/
│   └── video-player/
│       ├── win32/mpv.exe             # Windows 二进制
│       ├── darwin/mpv                # macOS 二进制（可选）
│       └── linux/mpv                 # Linux 二进制（可选）
├── scripts/
│   ├── fetch-mpv.mjs                 # 下载预编译 mpv
│   └── build-video-player.mjs        # V2 预留：编译 Rust sidecar
├── src/
│   └── plugins/
│       └── video-player/
│           ├── index.ts                       # 入口
│           ├── types.ts                       # 跨进程类型
│           ├── VideoPlayerPanel.tsx           # 主面板
│           ├── Controls.tsx                   # 控件条
│           ├── ProgressBar.tsx                # 进度条
│           ├── MediaInfoPanel.tsx             # 媒体信息
│           ├── RecentList.tsx                 # 最近播放
│           ├── useVideoPlayer.ts              # 状态 hook
│           ├── useShortcuts.ts                # 快捷键 hook
│           ├── recent-store.ts                # localStorage 持久化
│           ├── format.ts                      # 格式化工具
│           ├── icons.tsx                      # 插件图标
│           └── backend/
│               ├── video-service.ts           # 主进程 IPC 服务
│               ├── mpv-client.ts              # mpv JSON-RPC 客户端
│               └── types.ts                   # 主进程内部类型
```

---

## 3. 快速上手

### 3.1 拉 mpv 二进制

```bash
cd prompt-lab
npm run fetch:mpv
```

脚本会：

- Windows：从 [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake/releases) 拉最新 7z，解压到 `resources/video-player/win32/`
- macOS：提示 `brew install mpv`
- Linux：提示 `apt install mpv` / `dnf install mpv` / `pacman -S mpv`

如果机器上已装 mpv，插件会自动探测（PATH + 常见安装路径），无需下载。

### 3.2 启动应用

```bash
cd prompt-lab
npm start
```

在侧栏找到「视频播放器」插件（默认禁用，需在「设置 → 插件」启用），点击打开面板：

1. 点「打开文件」选择视频
2. mpv 独立窗口弹出，开始播放（初始为暂停状态）
3. 控件条 / 快捷键 / 最近播放即可使用

### 3.3 快捷键

| 键位 | 动作 |
|---|---|
| `Space` / `K` | 播放 / 暂停 |
| `←` / `J` | 后退 5 秒 |
| `→` / `L` | 前进 5 秒 |
| `↑` | 音量 +5 |
| `↓` | 音量 -5 |
| `M` | 静音切换 |
| `[` / `<` | 减速 0.1 |
| `]` / `>` | 加速 0.1 |
| `0` | 重置倍速 |
| `Shift + S` | 停止 |

输入框聚焦时快捷键自动失效。

---

## 4. 数据流

### 4.1 打开文件

```
Renderer                    Main                          mpv
─────────                   ────                          ───
open(filePath)  ──IPC──>  spawn mpv
                            └─ input-ipc-server = \\.\pipe\...
                            └─ connect pipe
                            └─ observe_property id 1..7
                            └─ get_property track-list
                          <─ status push
                       ──────────────
<─────── status push (video-player:status)
```

### 4.2 拖拽打开

```ts
// VideoPlayerPanel.tsx
const filePath = e.dataTransfer.files[0].path
                ?? await window.electronAPI.getPathForFile(file);
await player.open(filePath);
```

### 4.3 状态同步

主进程每收到一个 mpv 事件就 `BrowserWindow.webContents.send(VIDEO_IPC.STATUS, status)`，渲染端 `onStatus(callback)` 订阅更新。

---

## 5. 跨平台

| 平台 | mpv 来源 | 打包 |
|---|---|---|
| Windows | shinchiro/mpv-winbuild-cmake release 7z | `extraResource: resources/video-player/` |
| macOS | 用户 `brew install mpv`，或自行拷贝二进制 | 同上 |
| Linux | 系统包管理器 | 同上 |

打包时 `forge.config.ts` 通过 `extraResource` 把整个 `resources/video-player/` 目录打到 `process.resourcesPath/video-player/` 下；运行时 `mpvBinaryPath()` 优先取该目录，回退探测 PATH。

---

## 6. 安全边界

- 视频路径由用户在文件选择器 / 拖拽中提供，不接受 renderer 端任意路径
- mpv 子进程以 `windowsHide: false` 启动（V1 让窗口可见），后续可改为 `true` 并通过 `--wid=` 嵌入
- mpv 启动时加 `--no-config`，不读用户配置，避免被 `~/.config/mpv/` 中的设置干扰
- 关闭主应用时 `app.on('will-quit')` 显式 `videoPlayerService.shutdown()` 优雅退出 mpv

---

## 7. 路线图

### V1（当前）

- [x] Sidecar 模式
- [x] mpv 二进制自动下载
- [x] 播放 / 暂停 / 跳转 / 停止
- [x] 音量 / 倍速 / 静音
- [x] 多音轨 / 多字幕切换
- [x] 外挂字幕
- [x] 媒体信息展示
- [x] 快捷键
- [x] 最近播放

### V2

- [ ] Rust N-API 链接 libmpv（保留 V1 sidecar 作为 fallback）
- [ ] mpv 视频嵌入到 BrowserWindow（`--wid=<hwnd>` 或 Render API）
- [ ] 网络协议（HLS / RTSP / RTMP）
- [ ] 播放列表（队列 / 顺序 / 循环 / 随机）
- [ ] 硬件解码策略选择（`--hwdec=auto-safe` / `d3d11va` / `videotoolbox`）
- [ ] HDR / 8K 适配

### V3

- [ ] 抽离 `PlayerService` 接口，sidecar / N-API 两种实现并存
- [ ] 抽离成独立 npm 包（`@nwd/video-player`）
- [ ] 暴露给用户插件作为 SDK

---

## 8. 故障排查

### 8.1 "未找到 mpv 二进制"

1. 确认 `resources/video-player/<platform>/mpv(.exe)` 存在
2. 没有就执行 `npm run fetch:mpv`
3. 仍找不到则手动安装 mpv 并确保在 PATH 中

### 8.2 视频无画面

V1 视频窗口是 mpv 自己的 OS 窗口。如果没看到：

1. 检查任务栏 / 托盘，是否被遮挡
2. mpv 启动参数默认 `--no-border`，可用 `Alt+Space` 调出窗口菜单
3. 看主进程 stderr（Vite 开发模式下会直接打印）

### 8.3 mpv 启动后立即退出

- 看 mpv 错误：`resources/video-player/win32/mpv.exe --no-config test.mp4` 直接命令行跑
- 常见原因：缺少 `mpv-1.dll`（Windows 7z 包需要手动复制）

### 8.4 字幕不显示

- 检查文件是否含 sid 流：`mpv --msg-level=all=v,ipc=no --idle=yes test.mkv` 启动后 `print-text "track-list"`
- 内嵌字幕用 mpv 的 sid 切换；外挂字幕用「控件条 → 字幕 → 外挂」按钮

### 8.5 IPC 连不上

- Windows：检查 named pipe 路径 `\\.\pipe\nwd-mpv-<pid>-<ts>` 权限
- macOS / Linux：检查 `/tmp/nwd-mpv-*.sock` 文件是否被清理（重启时 `app.on('will-quit')` 应当删除）

---

## 9. 关键文件

| 文件 | 职责 |
|---|---|
| `src/plugins/video-player/types.ts` | 跨进程类型 |
| `src/plugins/video-player/backend/video-service.ts` | 主进程 IPC 服务 + mpv 进程管理 |
| `src/plugins/video-player/backend/mpv-client.ts` | mpv JSON-RPC 客户端 |
| `src/plugins/video-player/VideoPlayerPanel.tsx` | 主面板 |
| `src/plugins/video-player/Controls.tsx` | 控件条 |
| `src/plugins/video-player/ProgressBar.tsx` | 进度条（支持拖拽跳转） |
| `src/plugins/video-player/useShortcuts.ts` | 快捷键 hook |
| `src/plugins/video-player/recent-store.ts` | 最近播放（localStorage） |
| `scripts/fetch-mpv.mjs` | 下载预编译 mpv |
| `forge.config.ts` | 资源打包（`extraResource`） |
| `src/plugins/built-in/index.ts` | 插件注册 |
