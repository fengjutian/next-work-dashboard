import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Select, Space, Tag, Typography, message } from '../ui';

type SyncKind = 'webdav' | 's3' | 'syncthing';
type SyncPreview = {
  upload: string[];
  download: string[];
  deleteLocal: string[];
  deleteRemote: string[];
  conflicts: Array<{ path: string; kind: string }>;
};

export function SyncPanel({ workspaceId }: { workspaceId: string }) {
  const [kind, setKind] = useState<SyncKind>('syncthing');
  const [targetId, setTargetId] = useState('default');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [savedTargets, setSavedTargets] = useState<Array<{ id: string; kind: SyncKind; updatedAt: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const fields = useMemo(() => kind === 'syncthing'
    ? [['rootPath', 'Syncthing 同步目录']]
    : kind === 'webdav'
      ? [['baseUrl', 'WebDAV URL'], ['username', '用户名'], ['password', '密码']]
      : [['endpoint', 'S3 Endpoint'], ['region', 'Region'], ['bucket', 'Bucket'], ['accessKeyId', 'Access Key'], ['secretAccessKey', 'Secret Key'], ['sessionToken', 'Session Token（可选）'], ['prefix', 'Prefix（可选）']], [kind]);
  const target = { id: targetId.trim() || 'default', kind, config };
  const refreshTargets = useCallback(async () => setSavedTargets(await window.electronAPI.workBrowser.sync.listTargets()), []);
  useEffect(() => { void refreshTargets(); }, [refreshTargets]);

  const loadTarget = async (id: string) => {
    const loaded = await window.electronAPI.workBrowser.sync.getTarget(id);
    if (!loaded) return;
    setTargetId(loaded.id); setKind(loaded.kind); setConfig(loaded.config); setPreview(null);
  };
  const saveTarget = async () => {
    try { await window.electronAPI.workBrowser.sync.saveTarget(target); await refreshTargets(); message.success('同步配置已由系统安全存储加密保存'); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const deleteTarget = async () => {
    try {
      await window.electronAPI.workBrowser.sync.deleteTarget(target.id);
      setConfig({}); setPreview(null); await refreshTargets();
      message.success(`已删除同步配置：${target.id}`);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
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
  const resolveConflict = async (path: string, resolution: 'local' | 'remote' | 'keep-both') => {
    setBusy(true);
    try { await window.electronAPI.workBrowser.sync.resolve(workspaceId, target, path, resolution); await inspect(); message.success(`冲突已处理：${path}`); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3 p-3">
    <div><Typography.Text strong>Workspace Sync</Typography.Text><div className="mt-1 text-[11px] text-muted-foreground">增量同步会追踪删除与双向修改；保存的凭据由系统安全存储加密。</div></div>
    <Select value={kind} onChange={(value) => { setKind(value); setConfig({}); setPreview(null); }} options={[
      { value: 'syncthing', label: 'Syncthing 目录' }, { value: 'webdav', label: 'WebDAV' }, { value: 's3', label: 'S3 Compatible' },
    ]} />
    <Input value={targetId} placeholder="配置名称" onChange={(event) => setTargetId(event.target.value)} />
    {savedTargets.length > 0 && <Select value={undefined} onChange={(id) => void loadTarget(id)} options={savedTargets.map((item) => ({ value: item.id, label: `载入 ${item.id} · ${item.kind}` }))} />}
    {fields.map(([key, label]) => <Input key={key} type={/password|secret/i.test(key) ? 'password' : 'text'} value={config[key] || ''} placeholder={label} onChange={(event) => setConfig((current) => ({ ...current, [key]: event.target.value }))} />)}
    <Space wrap>
      <Button onClick={() => void saveTarget()}>安全保存配置</Button>
      {savedTargets.some((item) => item.id === target.id) && <Popconfirm title={`删除同步配置“${target.id}”？`} onConfirm={() => void deleteTarget()}><Button>删除配置</Button></Popconfirm>}
      <Button loading={busy} onClick={() => void inspect()}>预览</Button><Button loading={busy} onClick={() => void transfer('push')}>推送</Button><Button loading={busy} onClick={() => void transfer('pull')}>拉取</Button>
    </Space>
    {preview && <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap gap-2"><Tag color="blue">上传 {preview.upload.length}</Tag><Tag color="green">下载 {preview.download.length}</Tag><Tag color="orange">删除本地 {preview.deleteLocal.length}</Tag><Tag color="orange">删除远端 {preview.deleteRemote.length}</Tag><Tag color={preview.conflicts.length ? 'red' : 'default'}>冲突 {preview.conflicts.length}</Tag></div>
      {preview.conflicts.slice(0, 8).map((conflict) => <div key={conflict.path} className="space-y-1 rounded border border-red-200 p-2 text-red-600"><div className="truncate">冲突：{conflict.path} · {conflict.kind}</div><Space wrap><Button size="small" disabled={busy} onClick={() => void resolveConflict(conflict.path, 'local')}>保留本地</Button><Button size="small" disabled={busy} onClick={() => void resolveConflict(conflict.path, 'remote')}>保留远端</Button><Button size="small" disabled={busy} onClick={() => void resolveConflict(conflict.path, 'keep-both')}>两份都保留</Button></Space></div>)}
    </div>}
  </div>;
}
