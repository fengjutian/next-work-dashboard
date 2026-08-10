# MyCast · 局域网手机投屏 + 文件传输 插件

> 在同一局域网内，把手机的屏幕/摄像头/文件投到这台 prompt-lab 桌面工作台。**零云服务、零中继、纯 P2P**。

---

## 概览

| 维度 | 选型 |
| --- | --- |
| 桌面端技术栈 | Electron + React + TypeScript（prompt-lab 插件） |
| 本地核心 | Rust sidecar (`nwd-mycast.exe`)，通过 stdin/stdout JSONL 与 Electron Main 通信 |
| 网络 | HTTP (axum) + WebSocket (axum-ws) + mDNS (`mdns-sd`) |
| 信令 | WebRTC offer/answer/ICE 透传（视频流在 renderer 里用 Chromium 原生 WebRTC 接收） |
| 移动端 | 内置移动 Web UI（`web/index.html`，编译时 `include_str!` 进 Rust），用 `getDisplayMedia` 模拟屏幕采集 |
| 安全 | 一次性 6 位配对码 → 升级为长生命周期 session token → 后续 API Bearer 鉴权 |
| 协议文件 | Rust sidecar → Electron Main (JSONL RPC)，HTTP/WS → 手机 (JSON / 文本帧) |

---

## 模块布局

```
prompt-lab/
├── native/mycast/                ← Rust sidecar (独立 cargo project)
│   ├── Cargo.toml
│   ├── build.log                 ← 编译日志
│   ├── web/
│   │   └── index.html            ← 移动端 Web UI (编译期嵌入二进制)
│   └── src/
│       ├── main.rs               ← entry
│       ├── daemon.rs             ← 编排：HTTP + WS + mDNS + RPC 循环
│       ├── config.rs             ← 设备信息 / 端口 / 存储目录
│       ├── protocol.rs           ← parent ↔ sidecar 的 JSONL RPC
│       ├── state.rs              ← 共享状态
│       ├── security.rs           ← 配对 token + SHA-256
│       ├── signaling.rs          ← WebRTC 信令转发
│       ├── transfer.rs           ← 上传元数据 + 流式 SHA-256
│       ├── http.rs               ← axum 路由 + 鉴权 + WebSocket
│       └── mdns.rs               ← _nwd-mycast._tcp.local 注册
├── resources/mycast/             ← build 产物（被打进 .exe）
│   └── nwd-mycast.exe
├── scripts/build-mycast.mjs      ← cargo build --release + 复制到 resources
└── src/plugins/mycast/           ← Renderer / TS 后端
    ├── index.ts
    ├── MyCastPanel.tsx           ← 主面板：4 个 tab (Home/Devices/Screen/Files)
    └── backend/
        ├── mycast-service.ts     ← spawn sidecar + IPC handlers
        └── mycast-types.ts       ← 类型契约 (MyCastApi)
```

---

## 端到端流程

```text
1. 用户在桌面端「主页」点击「生成配对码」
   └── MyCastPanel 调 mycast.issuePairing()  ──IPC──>  mycast-service
       └── sendRequest({type:'issue_pairing'})  ──stdin──>  nwd-mycast daemon
           └── 返回 {pair_code, session_token, ...}

2. QR 码 (内嵌 session_token + LAN IP) 显示在桌面端

3. 用户用手机扫码（或在手机浏览器手动输 http://<PC_IP>:17890）
   └── 手机 web UI 自动调 /api/pair/request → 拿到 session_token
   └── 手机 web UI 连 ws://<PC_IP>:17891/ws  ──WebSocket──>  axum
       └── 第一帧必须是 Hello（device_id/name/platform）
       └── 服务端标记设备为「已配对」

4. 手机端在 UI 里点「开始投屏」→ getDisplayMedia → 拿到 MediaStream
   └── 创建 RTCPeerConnection → 收集 ICE → send Offer  ──WS──>  服务端
       └── 服务端透传 `webrtc.offer` 事件  ──IPC──>  Electron Renderer
           └── MyCastPanel 收到 offer → 创建 PC → 收集 answer → 发回

5. 视频流：手机 (SRTP) ──WebRTC──>  Chromium (Renderer) → <video> 元素
   DataChannel：手机 ↔ 桌面 控制消息（停止 / 暂停 / 截图等）

6. 文件传输：手机浏览器 multipart upload → axum /api/files/upload
   └── 流式写盘 + 实时 SHA-256
   └── 完成后通过 event:transfer.completed 事件通知桌面
```

---

## 安全模型

| 层级 | 机制 |
| --- | --- |
| 配对入口 | `/api/pair/request` 6 位数字 + 长 session_token；后者通过 QR 码发给手机 |
| 上传/下载 | `Authorization: Bearer <session_token>`；`require_session()` 校验 |
| WebSocket | `Sec-WebSocket-Protocol: bearer, <token>`；或首帧后服务端通过 session 关联 |
| mDNS | TXT 记录带 `device_id`，但**不暴露 secret** |
| Token 失效 | pair token 5 分钟过期；session token 跟随 daemon 生命周期 |

> 仍建议在同一受信任局域网（家庭 / 办公 WiFi）使用，不应在公网 / 公共 WiFi 暴露。

---

## HTTP API 一览

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | - | 移动端 Web UI |
| GET | `/api/info` | - | 桌面端元信息、pair_code、LAN 地址 |
| POST | `/api/pair/request` | - | 手机首次连接拿 session_token |
| POST | `/api/pair/complete` | - | 兼容旧流程（6 位码兑换） |
| GET | `/api/sessions` | - | 桌面端活动信令会话（诊断用） |
| GET | `/api/files` | Bearer | 列出本地存储文件 |
| POST | `/api/files/upload` | Bearer | multipart 上传 |
| GET | `/api/files/download/:id` | Bearer | 下载 |
| GET | `/api/transfers` | Bearer | 传输记录 |
| WS | `/ws` | 可选 Bearer | WebRTC 信令通道 |

---

## IPC API（Renderer ↔ Electron Main）

`window.electronAPI.mycast.*`：

```ts
mycast.start()          // 启动 daemon，返回 MyCastState
mycast.state()          // 当前状态
mycast.systemInfo()     // 主机信息
mycast.issuePairing()   // 申请新配对码
mycast.listSessions()   // 活动会话列表
mycast.listTransfers()  // 传输记录
mycast.sendToPhone(deviceId, frame)  // 通过 daemon 转发信令
mycast.endSession(id)   // 结束会话
mycast.cancelTransfer(id)
mycast.onEvent(handler) // 订阅事件
```

事件类型见 `backend/mycast-types.ts`（`MyCastEvent`）。

---

## 编译 & 启动

```bash
cd prompt-lab
npm run build:mycast     # 编译 Rust sidecar，产物落到 resources/mycast/
npm start                # 完整链路：prepare + 4 个 native + electron-forge start
```

`npm start` 会依次构建 `rag-worker / disk-scanner / net-probe / mycast` 然后启动 Electron。

---

## 已知边界

- **不实现原生 Android/iOS App**：MVP 阶段用浏览器 `getDisplayMedia` 替代。后续如需 iOS ReplayKit / Android MediaProjection 原生路径，需要单独 `apps/mycast-android/` 和 `apps/mycast-ios/`。
- **远程控制**（鼠标 / 键盘回控）：未实现。MVP 阶段只做投屏 + 文件。
- **多设备同时**：服务端允许多 session，但 UI 暂时只渲染一个 active screen。
- **断点续传**：未实现。前端用 `XMLHttpRequest` 一次性 multipart 上传，大文件可能需要后续改成 chunked upload。
- **STUN/TURN**：纯局域网；ICE 不用服务器候选，后续公网扩展时再加。

---

## 调试

```bash
# 直接跑 daemon 看日志
RUST_LOG=info ./resources/mycast/nwd-mycast.exe daemon

# 测试 HTTP API
curl http://127.0.0.1:17890/api/info | jq
curl -X POST http://127.0.0.1:17890/api/pair/request \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test","device_name":"Test Phone","platform":"web"}'
```
