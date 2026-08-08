import React, { useCallback, useEffect, useState } from 'react';
import { FileText, FolderOpen, Loader2, Plus, RefreshCw, Save, Trash2 } from '@/components/icons';
import { officeClient } from './office-client';
import type { OfficeCliStatus, OfficeDocumentKind } from './types';

type ViewMode = 'preview' | 'outline';

export const OfficeStudioPanel: React.FC = () => {
  const [status, setStatus] = useState<OfficeCliStatus>();
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<ViewMode>('preview');
  const [html, setHtml] = useState('');
  const [outline, setOutline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selector, setSelector] = useState('*');
  const [selectedPath, setSelectedPath] = useState('/');
  const [elementJson, setElementJson] = useState('');
  const [propertyName, setPropertyName] = useState('text');
  const [propertyValue, setPropertyValue] = useState('');
  const [newType, setNewType] = useState('paragraph');

  const refreshStatus = useCallback(async () => setStatus(await officeClient.status()), []);

  const loadDocument = useCallback(async (nextPath: string, nextName?: string) => {
    setBusy(true);
    setError('');
    setFilePath(nextPath);
    setFileName(nextName || nextPath.split(/[\\/]/).pop() || nextPath);
    const [rendered, structured] = await Promise.all([
      officeClient.render(nextPath),
      officeClient.outline(nextPath),
    ]);
    setHtml(rendered.html || '');
    setOutline(structured.output || '');
    if (!rendered.success) setError(rendered.error || '文档渲染失败');
    else if (!structured.success) setError(structured.error || '文档结构读取失败');
    setBusy(false);
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ pluginId: string; file: { path: string; name: string } }>).detail;
      if (detail?.pluginId === 'office-studio' && detail.file?.path) void loadDocument(detail.file.path, detail.file.name);
    };
    window.addEventListener('plugin:file-open', handler);
    return () => window.removeEventListener('plugin:file-open', handler);
  }, [loadDocument]);

  const openDocument = async () => {
    const selected = await window.electronAPI.pickFile({ accept: '.docx,.xlsx,.pptx' });
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (file) await loadDocument(file.path, file.name);
  };

  const createDocument = async (kind: OfficeDocumentKind) => {
    setBusy(true);
    setError('');
    const result = await officeClient.create(kind);
    setBusy(false);
    if (result.success && result.filePath) await loadDocument(result.filePath);
    else if (result.error !== 'CANCELLED') setError(result.error || '创建文档失败');
  };

  const runOperation = async (operation: () => Promise<{ success: boolean; output?: string; error?: string }>, refresh = false) => {
    setBusy(true);
    setError('');
    const result = await operation();
    if (!result.success) setError(result.error || 'Office 操作失败');
    if (refresh && result.success) await loadDocument(filePath, fileName);
    setBusy(false);
    return result;
  };

  const queryElements = async () => {
    const result = await runOperation(() => officeClient.query(filePath, selector));
    if (result.success) setOutline(result.output || '');
    setMode('outline');
  };

  const inspectElement = async () => {
    const result = await runOperation(() => officeClient.get(filePath, selectedPath, 3));
    if (result.success) setElementJson(result.output || '');
  };

  const setProperty = async () => {
    await runOperation(() => officeClient.set({ filePath, path: selectedPath, properties: { [propertyName]: propertyValue } }), true);
    await inspectElement();
  };

  const addElement = async () => {
    await runOperation(() => officeClient.add({ filePath, path: selectedPath, type: newType, properties: propertyValue ? { [propertyName]: propertyValue } : { text: '' } }), true);
  };

  const removeElement = async () => {
    if (!window.confirm(`确定删除 ${selectedPath}？`)) return;
    await runOperation(() => officeClient.remove(filePath, selectedPath), true);
  };

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-5 w-5 text-blue-500" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Office Studio</h2>
          <p className="truncate text-[11px] text-muted-foreground">{fileName || '由 OfficeCLI 驱动的 Word、Excel 与 PowerPoint 工作区'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-[11px] ${status?.available ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
          {status?.available ? status.version || 'OfficeCLI 可用' : 'OfficeCLI 未就绪'}
        </span>
        <button onClick={() => void refreshStatus()} className="rounded border p-1.5 hover:bg-muted" title="重新检测"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
    </header>

    {!status?.available ? <section className="m-auto max-w-lg p-8 text-center">
      <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="mb-2 font-medium">需要 OfficeCLI</h3>
      <p className="mb-3 text-sm text-muted-foreground">插件会优先使用随应用打包的二进制，也支持系统 PATH 或 OFFICECLI_PATH 环境变量。</p>
      {status?.error && <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-left text-xs text-destructive">{status.error}</pre>}
    </section> : !filePath ? <section className="m-auto p-8 text-center">
      <FileText className="mx-auto mb-4 h-12 w-12 text-blue-500" />
      <h3 className="mb-1 font-medium">打开或创建 Office 文档</h3>
      <p className="mb-5 text-sm text-muted-foreground">支持 .docx、.xlsx 和 .pptx</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={() => void openDocument()} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"><FolderOpen className="h-4 w-4" />打开文档</button>
        {(['docx', 'xlsx', 'pptx'] as const).map((kind) => <button key={kind} onClick={() => void createDocument(kind)} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted"><Plus className="h-4 w-4" />{kind.toUpperCase()}</button>)}
      </div>
    </section> : <>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex gap-1 rounded bg-muted p-0.5">
          {(['preview', 'outline'] as const).map((item) => <button key={item} onClick={() => setMode(item)} className={`rounded px-3 py-1 text-xs ${mode === item ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{item === 'preview' ? '渲染预览' : '文档结构'}</button>)}
        </div>
        <div className="flex gap-2">
          <button onClick={() => void runOperation(() => officeClient.save(filePath))} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"><Save className="h-3.5 w-3.5" />保存</button>
          <button onClick={() => void loadDocument(filePath, fileName)} className="rounded border px-2 py-1 text-xs hover:bg-muted">刷新</button>
          <button onClick={() => void openDocument()} className="rounded border px-2 py-1 text-xs hover:bg-muted">打开其他文档</button>
        </div>
      </div>
      {error && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      <main className="relative flex min-h-0 flex-1 bg-muted/30">
        {busy && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        <section className="min-w-0 flex-1">
          {mode === 'preview' ? <iframe title="Office 文档预览" sandbox="allow-scripts" srcDoc={html} className="h-full w-full border-0 bg-white" /> : <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs leading-6">{outline}</pre>}
        </section>
        <aside className="w-80 shrink-0 overflow-auto border-l bg-background p-3 text-xs">
          <h3 className="mb-3 font-semibold">元素与属性</h3>
          <label className="mb-1 block text-muted-foreground">查询选择器</label>
          <div className="mb-3 flex gap-1"><input value={selector} onChange={(e) => setSelector(e.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5" /><button onClick={() => void queryElements()} className="rounded border px-2 hover:bg-muted">查询</button></div>
          <label className="mb-1 block text-muted-foreground">DOM 路径</label>
          <div className="mb-3 flex gap-1"><input value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5" /><button onClick={() => void inspectElement()} className="rounded border px-2 hover:bg-muted">读取</button></div>
          {elementJson && <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{elementJson}</pre>}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="mb-1 block text-muted-foreground">属性</label><input value={propertyName} onChange={(e) => setPropertyName(e.target.value)} className="w-full rounded border bg-background px-2 py-1.5" /></div>
            <div><label className="mb-1 block text-muted-foreground">值</label><input value={propertyValue} onChange={(e) => setPropertyValue(e.target.value)} className="w-full rounded border bg-background px-2 py-1.5" /></div>
          </div>
          <button disabled={!propertyName} onClick={() => void setProperty()} className="mt-2 w-full rounded bg-primary px-2 py-1.5 text-primary-foreground disabled:opacity-50">更新属性</button>
          <div className="my-3 border-t" />
          <label className="mb-1 block text-muted-foreground">新增元素类型</label>
          <input value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full rounded border bg-background px-2 py-1.5" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => void addElement()} className="inline-flex items-center justify-center gap-1 rounded border px-2 py-1.5 hover:bg-muted"><Plus className="h-3.5 w-3.5" />新增</button>
            <button disabled={selectedPath === '/'} onClick={() => void removeElement()} className="inline-flex items-center justify-center gap-1 rounded border border-destructive/40 px-2 py-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />删除</button>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">写操作会先创建临时备份；命令失败时自动恢复原文件。</p>
        </aside>
      </main>
    </>}
  </div>;
};
