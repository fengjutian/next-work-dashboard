import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography, message } from '../ui';

type SyncKind = 'webdav' | 's3' | 'syncthing';

export function SyncPanel({ workspaceId }: { workspaceId: string }) {
  const [kind, setKind] = useState<SyncKind>('syncthing');
  const [targetId, setTargetId] = useState('default');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [savedTargets, setSavedTargets] = useState<Array<{ id: string; kind: SyncKind; updatedAt: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ upload: string[]; download: string[]; conflicts: Array<{ path: string }> } | null>(null);
  const fields = useMemo(() => kind === 'syncthing'
    ? [['rootPath', 'Syncthing 同步目录']]
    : kind === 'webdav'
      ? [['baseUrl', 'WebDAV URL'], ['username', '用户名'], ['password', '密码']]
      : [['endpoint', 'S3 Endpoint'], ['region', 'Region'], ['bucket', 'Bucket'], ['accessKeyId', 'Access Key'], ['secretAccessKey', 'Secret Key'], ['prefix', 'Prefix（可选）']], [kind]);
  const target = { id: targetId.trim() || 'default', kind, config };
  const refreshTargets = async () => setSavedTargets(await window.electronAPI.workBrowser.sync.listTargets());
  useEffect(() => { void refreshTargets(); }, []);

  const loadTarget = async (id: string) => {
    const loaded = await window.electronAPI.workBrowser.sync.getTarget(id);
    if (!loaded) return;
    setTargetId(loaded.id); setKind(loaded.kind); setConfig(loaded.config); setPreview(null);
  };
  const saveTarget = async () => {
    try { await window.electronAPI.workBrowser.sync.saveTarget(target); await refreshTargets(); message.success('同步配置已由系统安全存储加密保存'); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const inspect = async () => {
    setBusy(true);
    try { setPreview(await window.electronAPI.workBrowser.sync.preview(workspaceId, target)); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const transfer = async (direction: 'push' | 'pull') => {
    setBusy(true);
    try {
      const result = await window.electronAPI.workBrowser.sync[direction](workspaceId, target, false);
      if (!result.ok) message.warning(`检测到 ${result.conflicts.length} 个双向修改冲突，请先人工处理`);
      else message.success(`同步完成：传输 ${result.transferred} 个文件`);
      await inspect();
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3 p-3">
    <div><Typography.Text strong>Workspace Sync</Typography.Text><div className="mt-1 text-[11px] text-muted-foreground">默认拒绝覆盖双向修改，凭据仅用于本次会话。</div></div>
    <Select value={kind} onChange={(value) => { setKind(value); setConfig({}); setPreview(null); }} options={[
      { value: 'syncthing', label: 'Syncthing 目录' }, { value: 'webdav', label: 'WebDAV' }, { value: 's3', label: 'S3 Compatible' },
    ]} />
    <Input value={targetId} placeholder="配置名称" onChange={(event) => setTargetId(event.target.value)} />
    {savedTargets.length > 0 && <Select value={undefined} onChange={(id) => void loadTarget(id)} options={savedTargets.map((item) => ({ value: item.id, label: `载入 ${item.id} · ${item.kind}` }))} />}
    {fields.map(([key, label]) => <Input key={key} type={/password|secret/i.test(key) ? 'password' : 'text'} value={config[key] || ''} placeholder={label} onChange={(event) => setConfig((current) => ({ ...current, [key]: event.target.value }))} />)}
    <Space wrap><Button onClick={() => void saveTarget()}>安全保存配置</Button><Button loading={busy} onClick={() => void inspect()}>预览</Button><Button loading={busy} onClick={() => void transfer('push')}>推送</Button><Button loading={busy} onClick={() => void transfer('pull')}>拉取</Button></Space>
    {preview && <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex gap-2"><Tag color="blue">上传 {preview.upload.length}</Tag><Tag color="green">下载 {preview.download.length}</Tag><Tag color={preview.conflicts.length ? 'red' : 'default'}>冲突 {preview.conflicts.length}</Tag></div>
      {preview.conflicts.slice(0, 8).map((conflict) => <div key={conflict.path} className="truncate text-red-600">冲突：{conflict.path}</div>)}
    </div>}
  </div>;
}
