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

