---
layout: default
title: "MyCast：未完成功能交接单"
---

# MyCast：未完成功能交接单

- 更新日期：2026-08-11
- 目标读者：接手 MyCast Phase 2 / Phase 3 的开发者
- 项目目录：`prompt-lab/native/mycast/`（Rust sidecar）、`prompt-lab/src/plugins/mycast/`（Electron 插件）、`../mycast-share/`（Flutter 客户端）
- 关联设计：[mycast-plugin.md](./mycast-plugin.md)

## 0. 状态总览

| 优先级 | 项 | 工作量 | 阻塞因素 |
| --- | --- | --- | --- |
| P0 | 真投屏：MediaProjection → libwebrtc C++ JNI 桥 | 2-3 天 | 需 Android Studio + 真机联调；当前 dev box 无 Android SDK |
| P0 | 真机联调：Android 手机 + 桌面端 end-to-end | 1-2 天 | 依赖 P0 JNI 桥；需真机 + 局域网 |
| P1 | 断点续传：upload chunked + resume | 1 天 | 无；可独立做 |
| P1 | UI/UX 打磨：Home tab 当前过于"工程感" | 0.5 天 | 无 |
| P2 | iOS ReplayKit：mycast-share iOS 端真投屏 | 2-3 天 | 需 macOS + Xcode |
| P2 | 远程控制（鼠标/键盘回控） | 1-2 天 | 需 P0 真投屏先通 |
| P2 | 多设备同时投屏（服务端已支持，UI 暂无） | 0.5-1 天 | 需补 UI |
| P3 | WebRTC 统计：带宽、延迟、丢包率面板 | 0.5 天 | 无 |
| P3 | mDNS 服务发现后的"邻居设备列表" | 0.5 天 | 无 |

## 1. 已有能力（不要重复开发）

以下模块已经实现并通过 22/22 项 E2E 验证，**接手者先通读 mycast-plugin.md §2 再决定改什么**：

- Rust sidecar：HTTP / WebSocket / mDNS / RPC 全部跑通；token 管理、上传、流式 SHA-256
- 配对流程：QR 解析 + 6 位码兑换 + session_token 鉴权
- WebSocket 信令：hello / create_session / offer / answer / ice 透传
- WebSocket auth：Authorization header + Sec-WebSocket-Protocol 双轨
- 文件传输：32KB 上传 + SHA-256 验证 + 列表 + 下载 byte-compare
- CLI flags：--http-port / --ws-port / --bind / --no-mdns / --storage-dir / --device-name
- Flutter App：pairing / signaling / casting / transfer / settings 五模块
- 桌面端 UI：4 tab（Home / Devices / Screen / Files）+ IPC 入口齐全
- 移动 Web UI：投屏禁用，文件传输可用
- E2E 脚本：8 section / 22 check 全绿
- README 同步：插件子模块 README + 根 docs 都有

## 2. P0：真投屏 — MediaProjection → libwebrtc C++ JNI 桥

### 2.1 目标

把 `mycast-share` 端 `CastingService._acquireLocalStream` 当前的"前置摄像头占位"换成 **真实屏幕帧**。最终用户在桌面端 `<video>` 元素看到的是手机屏幕，不是前置摄像头自拍。

### 2.2 功能需求

1. **Android 端 MediaProjection 接管**：
   - `ScreenCaptureService`（已有）继续负责 Foreground 通知 + `MediaProjection` / `VirtualDisplay` 生命周期
   - 新增 C++ JNI 桥接：把 `VirtualDisplay` 的 `Surface` 纹理转成 libwebrtc 的 `VideoTrack`
   - 通过 `flutter_webrtc` 的自定义 `VideoCapturer` 接口（`AndroidVideoCapturer`）注入
2. **帧格式**：
   - 优先 NV21 / I420 转 RGBA（libwebrtc 接受 I420）
   - 目标分辨率 720p / 1080p，质量预设映射到 `MediaProjection` capture hint
3. **音频轨道**：
   - 屏幕内音频（Internal Audio）需要 `MediaProjection.AudioPlaybackCaptureConfiguration`（API 29+）
   - 配合 `MicrophoneCapturer`（已有）支持外麦
4. **性能**：
   - 帧率 30fps 起步，按 `QualityPreset` 切档
   - CPU 占用 < 30%（中端机）
5. **错误处理**：
   - 用户拒绝 `MediaProjection` 授权 → 回退到"前置摄像头" + 黄色横幅（当前已经有）
   - 设备不支持 Internal Audio → 降级只推视频

### 2.3 验收标准

- 真机 Android 14+ 启动 App → 桌面端 `<video>` 实时显示手机屏幕
- 切到桌面 / 切到其他 App → 桌面端画面实时跟随（延迟 < 300ms）
- 录屏时通知中心显示"MyCast 正在共享屏幕"
- 关闭 App 投屏 → `VirtualDisplay.release()` 调用、`MediaProjection.stop()` 调用、无泄漏
- 拒绝授权 → casting_page 显示降级横幅

### 2.4 阻塞因素

- **Android Studio + 真机**：当前 dev box 没有 Android SDK，只能写到"能编译过"的程度。**真机联调必须**由有 SDK + 真机的开发者做。
- **libwebrtc 自定义 VideoCapturer**：flutter_webrtc 0.14.x 对自定义 capturer 暴露不完整，可能需要 fork 或本地 patch
- **NDK C++ 编译**：当前 build.gradle.kts 已配 NDK ABIs，但未实际跑过 JNI 编译

### 2.5 关键文件

- `mycast-share/lib/casting/casting_service.dart:207` — 当前占位 `Helper.openCamera(facingMode:'user')` 的位置
- `mycast-share/android/app/src/main/kotlin/com/nextworkdashboard/mycast/capture/ScreenCapturer.kt` — 已有 `Surface` 句柄
- `mycast-share/android/app/src/main/kotlin/com/nextworkdashboard/mycast/capture/ScreenCaptureService.kt` — 已有 Foreground service
- `mycast-share/pubspec.yaml` — flutter_webrtc 0.14.2

## 3. P0：真机联调

### 3.1 目标

把 Phase 2 的真投屏结果在真机 + 真局域网上跑一次端到端。

### 3.2 验收标准

- 桌面端 `npm start` 启动后，daemon 启动并广播 mDNS
- 手机连接同一 WiFi → 打开 mycast-share App → 扫码配对成功
- App 启动投屏 → 桌面端 MyCast 插件 Screen tab 看到手机屏幕
- 切到桌面 / 浏览器 / 其他 App → 桌面端画面跟随
- 桌面端 Files tab 看到手机上传的文件，下载成功

### 3.3 阻塞因素

- **完全依赖 P0 第一节**
- 当前 dev box 无 Android Studio / 真机

## 4. P1：断点续传

### 4.1 目标

把 `/api/files/upload` 改成 chunked + resume 协议，支持 1GB+ 大文件上传和中断续传。

### 4.2 功能需求

1. **协议**：自实现 chunked，参考 tus.io 简化版
   - `POST /api/files/upload/init { filename, size, sha256? }` → `{ upload_id, chunk_size }`
   - `PUT /api/files/upload/:upload_id/chunk/:index` → 单个分片
   - `POST /api/files/upload/:upload_id/complete` → 合并 + 校验 SHA-256
   - `HEAD /api/files/upload/:upload_id` → 续传时查询已收到的分片
2. **分片大小**：默认 4 MiB，按文件大小自适应
3. **客户端**：Flutter 端 `TransferService` 改用 `http` 包的 `send()` 流式上传
4. **进度**：保留现有进度事件（每收到 256KB 触发）

### 4.3 验收标准

- 上传 1GB 随机文件到 desktop
- 中途 kill 客户端（模拟断网）
- 重启客户端 → 自动续传剩余部分
- 完成后 SHA-256 与本地一致
- 桌面端 Files 列表显示该文件，下载 byte-compare 通过

### 4.4 阻塞因素

无。可独立做。

### 4.5 关键文件

- `prompt-lab/native/mycast/src/http.rs:230-319` — `post_upload` handler
- `prompt-lab/native/mycast/src/transfer.rs` — TransferManager
- `mycast-share/lib/transfer/transfer_service.dart`

## 5. P1：UI/UX 打磨

### 5.1 目标

MyCastPanel 的 Home tab 当前像"工程控制台"（QR 旁边直接是 6 位码 + 设备列表 + LAN IP 表格）。改成更接近产品的视觉。

### 5.2 验收标准

- Home tab 主视觉是大 QR + 简短文案（"用 MyCast App 扫码配对"）
- 6 位码用大字号 mono 字体（更易读）
- 设备卡分组：当前配对 / 历史配对
- 状态指示颜色一致：绿（就绪）/ 黄（等待）/ 红（异常）
- 暗色模式适配

### 5.3 阻塞因素

无。

## 6. P2：iOS ReplayKit

### 6.1 目标

实现 mycast-share iOS 端的真投屏，使用 ReplayKit + libwebrtc。

### 6.2 阻塞因素

- **必须 macOS + Xcode**：当前 dev box 是 Windows，无法实现
- 接手者：建议用 `broadcast upload extension`（iOS 14+），不要用老的 in-app ReplayKit

### 6.3 已知 iOS 限制

- App Store 审核要求：屏幕录制 App 必须有明显指示
- 后台录制限制：iOS 后台不允许录屏，必须前台
- 与 macOS Catalyst 的兼容性：建议直接 native iOS

## 7. P2：远程控制

### 7.1 目标

桌面端 MyCast 插件 Screen tab 上叠加一个透明层，鼠标点击 / 键盘事件通过 WebRTC DataChannel 转发到手机端，模拟触屏输入。

### 7.2 阻塞因素

- 依赖 P0 真投屏先通
- 需新增：DesktopRenderer overlay 透明层 + DataChannel 信令 + 手机端 MotionEvent 模拟
- iOS 上 UIApplication 模拟触屏受 App Store 政策限制（jailbreak only）

## 8. P2：多设备同时投屏

### 8.1 目标

sidecar 允许多 session（已实现），但 UI 只能渲染一个 active screen。改成 tab 切换或画中画。

### 8.2 验收标准

- 2 台手机同时配对并投屏
- 桌面端可在 2 路画面间切换
- 单台断开不影响另一台

## 9. P3：WebRTC 统计面板

### 9.1 目标

桌面端 Screen tab 加一个 stats 浮窗，显示 RTT、丢包率、带宽、分辨率、帧率（来自 `RTCPeerConnection.getStats()`）。

### 9.2 阻塞因素

无。需在 Electron renderer 加 stats 拉取 + 展示。

## 10. P3：mDNS 邻居设备列表

### 10.1 目标

mDNS 已经广播 + 接收（侧）。在桌面端 Home tab 顶部加一个"局域网其他 NWD 设备"列表，点一下直接配对。

### 10.2 验收标准

- 同局域网另一台电脑运行 prompt-lab，桌面端 Home tab 显示该设备
- 点击 → 自动发起 pair_request，跳过 QR 扫码

## 11. 接手清单

按以下顺序进入项目（每步 10-30 分钟）：

1. 通读 [mycast-plugin.md](./mycast-plugin.md) §1-§3
2. 跑 `node scripts/e2e-mycast.mjs`，确认 22/22 通过
3. 跑 `flutter analyze`，确认 0 errors
4. 跑 `npx tsc --noEmit`，确认 0 errors（注意：markdown-editor 可能在并行改，会临时有错，跟 MyCast 无关）
5. `npm start` 启动桌面端，打开 MyCast 插件看 UI
6. 选一个 P0 / P1 项，按对应章节的"关键文件"路径开干

## 12. 经验沉淀（agent memory）

接手前可以翻下 `~/.minimax/agents/mavis/memory/MEMORY.md`，里面记了 3 条跟本项目相关的稳定经验：

- Windows + PowerShell 跑 native CLI 的 stderr 坑
- Electron + 长期 sidecar 进程的端口隔离
- WebSocket auth 在不同客户端下的差异（subprotocol 不允许逗号）
