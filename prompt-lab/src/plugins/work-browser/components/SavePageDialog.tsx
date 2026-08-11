/**
 * SavePageDialog — 保存页面确认弹窗
 */
import { Modal, Input, Select, Typography, Alert } from '../ui';
import { useEffect, useState } from 'react';

export interface SavePageDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (input: { url: string; title?: string; workspaceId: string }) => Promise<void>;
  workspaces: Array<{ id: string; name: string; icon?: string }>;
  defaultWorkspaceId?: string;
  initialUrl?: string;
  initialTitle?: string;
}

export function SavePageDialog({ open, onCancel, onConfirm, workspaces, defaultWorkspaceId, initialUrl, initialTitle }: SavePageDialogProps) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId || '');
  const [url, setUrl] = useState(initialUrl || '');
  const [title, setTitle] = useState(initialTitle || '');
  useEffect(() => {
    if (!open) return;
    setWorkspaceId(defaultWorkspaceId || workspaces[0]?.id || '');
    setUrl(initialUrl || '');
    setTitle(initialTitle || '');
  }, [open, defaultWorkspaceId, initialUrl, initialTitle, workspaces]);
  const submit = async () => {
    if (!workspaceId || !url.trim()) return;
    try { new URL(url); } catch { return; }
    await onConfirm({ workspaceId, url: url.trim(), title: title.trim() || undefined });
  };
  return (
    <Modal
      title="保存页面到 Workspace"
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="主进程会抓取目标 URL → Readability 净化 → 输出 Markdown + 归档原 HTML；版本变更会自动产生 diff。"
      />
      <div className="space-y-4">
        <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">工作区</span><Select value={workspaceId} onChange={setWorkspaceId} options={workspaces.map((w) => ({ label: `${w.icon || '🌊'} ${w.name}`, value: w.id }))} /></label>
        <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">URL</span><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></label>
        <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">标题（可选）</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="留空将自动从页面提取" /></label>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          隐私模式为「本地」的 Workspace，文档永远不会离开本机。
        </Typography.Text>
      </div>
    </Modal>
  );
}
