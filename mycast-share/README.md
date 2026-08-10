# MyCast · 手机端

> Flutter 客户端：扫码 / 输入配对码连接桌面 MyCast 插件，发送 WebRTC 投屏 + HTTP 文件传输。

---

## 目录结构

```
mycast-share/
├── lib/                        # Dart 业务层
│   ├── main.dart               # 入口：初始化 Provider，跑 MyCastApp
│   ├── app/                    # MaterialApp、路由、主题
│   ├── pairing/                # 配对流程：device profile / QR 解析 / service / 页面
│   ├── signaling/              # WebSocket 客户端 + 帧类型
│   ├── casting/                # WebRTC PeerConnection + 画质预设
│   ├── transfer/               # HTTP 上传 / 下载 / 进度
│   ├── settings/               # SharedPreferences 存储 + 设置页
│   └── shared/                 # 公共工具（占位）
│
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml                  # 权限 + Service + deep link
│       ├── kotlin/com/nextworkdashboard/mycast/
│       │   ├── MainActivity.kt                  # FlutterActivity + MethodChannel
│       │   └── capture/
│       │       ├── CaptureController.kt         # MediaProjection 持有者
│       │       ├── CaptureMethodHandler.kt      # MethodChannel 接口
│       │       ├── ScreenCaptureService.kt      # Foreground service
│       │       ├── ScreenCapturer.kt            # VirtualDisplay
│       │       └── MicrophoneCapturer.kt        # AudioRecord
│       └── res/...
│
├── ios/                        # 仅 Flutter 默认骨架（待 Phase 4 加 ReplayKit 扩展）
└── pubspec.yaml                # 依赖
```

---

## 当前阶段

> **Phase 1：Android MVP**（已完成代码；真实 build 需要 Android SDK + 真机/模拟器）

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Dart 业务层（pairing / signaling / casting / transfer / settings） | ✅ 完整 | `flutter analyze` 0 error |
| Android Manifest + 权限 + Foreground Service | ✅ 完整 | 声明 `mediaProjection` 服务类型 + POST_NOTIFICATIONS + RECORD_AUDIO + CAMERA |
| `MainActivity` MethodChannel | ✅ 完整 | `com.nextworkdashboard.mycast/capture` |
| `CaptureController` MediaProjection 生命周期 | ✅ 完整 | 申请 → 启动服务 → 拿 VirtualDisplay |
| `ScreenCapturer` VirtualDisplay | ✅ 占位 | 渲染到 off-screen Surface，未接 libwebrtc |
| `MicrophoneCapturer` AudioRecord | ✅ 占位 | 仅申请权限，帧丢弃 |
| WebRTC 视频源接入（MediaProjection → libwebrtc VideoSource） | ⏳ **Phase 2** | 需要在 Android 端用 libwebrtc 的 `JavaVideoTrackSource` 接管 Surface 的 YUV 帧，再通过 `VideoCapturer` 接口暴露给 flutter_webrtc |
| iOS ReplayKit Broadcast Extension | ⏳ Phase 4 | 当前 `ios/` 仅 Flutter 默认骨架 |

**MVP 行为**：打开 App → 扫码或输入配对码 → 配对成功 → 投屏页面。前台服务会启动 + 显示 "MyCast 正在共享屏幕" 通知。**视频流暂时是前摄像头**（占位，让信令 / SDP / ICE 全链路可走通；真实 MediaProjection 视频流在 Phase 2 接入）。文件传输和配对都是真的。

---

## 桌面端依赖

桌面端需要先跑 prompt-lab MyCast 插件（sidecar + Electron 接收端）。**重要**：桌面端的 `/api/pair/complete` 期望 `pairing_code` 是 6 位数字，并且只能消费**当前**活动的配对码（每次点"生成配对码"或 daemon 启动时会自动续期）。QR 码里的 URL 是 `http://<lan-ip>:17890/?pair=<code>`，mobile web UI 已经会从 URL 自动填入。

---

## 端到端调试

```bash
# 1. 桌面端：先跑 MyCast sidecar + Electron
cd prompt-lab
npm run build:mycast
npm start

# 2. 桌面端：MyCast 插件 → 点 "生成配对码"，记下 6 位码（也出现在 QR 码 URL 里）

# 3. 手机端（需要装了 Android Studio + SDK 的电脑）
cd mycast-share
flutter pub get
flutter run -d <device-id>     # 列出已连接设备 / 启动的模拟器

# 4. App → "手动输入" → 主机地址 192.168.x.x + 6 位码 → "连接"
# 5. 配对成功 → 投屏页 → "开始投屏" → Android 系统弹"开始录制"对话框 → 同意
# 6. 桌面端 MyCast 插件 → "投屏" tab 应能看到手机画面（暂时是前摄像头）
```

防火墙：第一次会弹 Windows / Android 系统的"是否允许共享屏幕"对话框，需要同意。

---

## 关键协议

- **配对**：`POST /api/pair/complete`，body `{device_id, device_name, pairing_code}`，返 `{session_token, ws_url, http_url}`。Pair code 来自 `?pair=` query 或手动输入。
- **信令 WebSocket**：`ws://<host>:17891/ws?`，通过 `Sec-WebSocket-Protocol: bearer, <session_token>` 鉴权。JSON 帧定义见 `lib/signaling/signaling_frames.dart`。
- **WebRTC**：单方向 video（phone → desktop）。Offer 由 phone 创建，Answer 由 desktop 通过 Electron renderer 走 Chromium 原生 `RTCPeerConnection` 回。ICE 不配置 STUN/TURN，LAN 即可。
- **文件传输**：复用桌面 `/api/files` 系列端点（list / upload / download）。Bearer token 走 `Authorization` header。

---

## 已知边界

1. **Phase 1 不传真实屏幕帧**：`ScreenCapturer` 只持有 VirtualDisplay 但不接 libwebrtc。MVP 用前摄像头作为 video source，让完整链路跑通。Phase 2 替换。
2. **iOS 暂未实现**：仅有 `flutter create` 生成的项目壳。要做 iOS 需要 macOS + Xcode + ReplayKit Broadcast Extension。
3. **大文件无断点续传**：MVP 用 multipart 一次性上传。>1 GiB 文件需要 Phase 2 加 chunked upload。
4. **不传系统音频**：第一版只支持麦克风（opt-in）。系统音频在 Android 上涉及 DRM，单独 Phase。

---

## 调试提示

- `flutter logs` 看 Dart 端日志
- Android Studio Logcat 过滤 `MyCast` 看 native 日志
- `adb shell dumpsys media_projection` 看 MediaProjection 状态
- 桌面端用 `npm start` 启动后，浏览器开发者工具 → console 看 WebSocket 帧
