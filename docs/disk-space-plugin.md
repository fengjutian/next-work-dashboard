---
layout: default
title: "磁盘空间插件"
---

# 磁盘空间插件

磁盘空间插件是内置可信插件，由 Electron 主进程启动 Rust sidecar 完成只读扫描和重复文件复核。

## 安全边界

- Renderer 不能指定未经系统目录选择器授权的扫描根目录。
- Rust sidecar 通过参数数组启动，不经过 Shell。
- 扫描跳过符号链接，排除目录规则仅接受单个目录名。
- 重复文件依次经过大小分组、完整内容哈希和逐字节比较。
- 清理前重新检查真实路径、授权根目录、文件类型、大小和修改时间。
- 每个重复组必须至少保留一个文件。
- 文件仅通过 Electron `shell.trashItem` 移入系统回收站，不提供永久删除接口。

## 开发与打包

```bash
cd prompt-lab
npm run build:disk-scanner
npm start
```

构建脚本将当前平台的 release 二进制复制到 `resources/disk-scanner/`；Electron Forge 将该目录作为 `extraResource` 打包。开发模式会直接从 Rust `target/release` 目录加载。

## 当前限制

- 重复候选元数据保存在 Rust 进程内，极端数量的小文件会增加内存占用。
- 硬链接目前可能作为重复路径展示，预计释放空间可能偏高。
- 扫描结果仅保留在当前应用进程中，重启后需要重新扫描。
- 修改排除规则后需要重新扫描。

## 功能模块

- 资源概览：枚举全部可访问磁盘、物理内存和最近 7 天容量趋势。
- 目录浏览：授权目录内逐层浏览，Markdown、文本和图片使用安全弹层预览。
- 空间分析：Rust 扫描、层级 Treemap、大文件筛选、目录快照对比和重复文件工作台。
- 开发者空间：只读探测 Docker、WSL、Ollama、npm/pnpm、Cargo、Gradle/Maven、Conda、Android SDK、VMware 和 VirtualBox。
- 清理建议：按风险与识别依据展示候选项；官方清理动作使用固定白名单并在执行前显示系统确认框。
- 磁盘医生：只把容量、路径和变化摘要交给已配置的 AI，不读取或上传文件内容。

扫描支持暂停、继续、停止、实时速度和当前路径。权限与读取错误分为拒绝访问、路径失效、文件占用和一般 I/O，并最多保留 100 条明细。
