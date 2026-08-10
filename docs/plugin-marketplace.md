# 插件 Marketplace

用户 `.nwd` 插件定义保存在 Electron `userData/plugins/definitions.json`。旧版
`localStorage` 定义会在首次启动时迁移，权限、配置、日志和插件私有数据仍由现有
平台状态管理。

插件管理器的“在线插件”页读取 Marketplace catalog。没有配置公网源时不会发起
网络请求；点击“刷新目录”后可输入 HTTPS catalog URL，开发环境也允许
`http://localhost` 和 `http://127.0.0.1`。

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "example-plugin",
      "name": "Example Plugin",
      "version": "1.0.0",
      "description": "Example sandbox plugin",
      "downloadUrl": "https://plugins.example.com/example-plugin-1.0.0.nwd",
      "sha256": "64-character-lowercase-hex-digest",
      "size": 1024
    }
  ]
}
```

Catalog 缓存到 `userData/plugins/marketplace-catalog.json`。安装由主进程完成：

1. 仅接受 HTTPS（开发环境 localhost HTTP 例外）。
2. catalog 最大 512 KiB，`.nwd` 最大 2 MiB。
3. 下载完成后校验声明大小与 SHA-256。
4. 使用临时文件和重命名原子写入
   `userData/plugins/installed/<id>/<version>/<id>.nwd`。
5. 校验后的内容继续经过 `.nwd v1` manifest 和权限白名单验证。

当前 Windy/翻译仍是内置 Electron `<webview>` 插件。现有 Sandbox CSP 不允许
创建 `<webview>`，因此不能在不改变功能与安全边界的情况下直接转换。后续应先
增加“声明式 Web 内容插件”运行时，由宿主创建 webview，插件包只声明 URL、
partition 和权限；不要允许下载的脚本直接创建 Electron webview。
