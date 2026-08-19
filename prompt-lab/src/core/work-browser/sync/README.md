# Work Browser Sync

Work Browser 的本地优先增量同步实现，当前支持：

- Syncthing 共享目录
- WebDAV
- S3 Compatible（SigV4、分页、临时 Session Token）

同步基于三方 manifest（上次基线 / 本地 / 远端）生成计划，区分上传、下载、两端删除和三类冲突。基线按 Workspace + Target 持久化；拉取在写入前创建内存快照，失败会恢复原文件。

冲突必须显式选择“保留本地”“保留远端”或“两份都保留”。路径统一经过 traversal 校验，配置与凭据通过 Electron `safeStorage` 加密后以用户权限文件保存。

## 结构

- `types.ts`：适配器契约、路径规范化、增量计划与冲突检测
- `webdav.ts`：WebDAV 适配器
- `s3.ts`：S3 Compatible 适配器
- `src/main/work-browser/syncthing-sync.ts`：本地共享目录适配器
- `src/main/work-browser/sync-service.ts`：基线、传输、删除、回滚与冲突裁决
- `src/main/work-browser/sync-target-store.ts`：加密配置存储

官方托管 Sync Service、多人权限与移动端不在当前实现范围。
