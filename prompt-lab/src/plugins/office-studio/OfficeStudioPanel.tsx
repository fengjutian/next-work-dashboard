import React, { useCallback, useEffect, useState } from 'react';
import { FileText, FolderOpen, Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2 } from '@/components/icons';
import { officeClient } from './office-client';
import type { OfficeCliStatus, OfficeDocumentKind, OfficeOperationResult } from './types';
import { OfficeExcelGrid } from './OfficeExcelGrid';
import { OfficeWordEditor } from './OfficeWordEditor';
import { OfficePptEditor } from './OfficePptEditor';

type ViewMode = 'preview' | 'outline' | 'grid' | 'word' | 'ppt';
interface OfficeTab { path: string; name: string }
const RECENT_KEY = 'office-studio:recent-v1';

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
  const [queryResults, setQueryResults] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [tabs, setTabs] = useState<OfficeTab[]>([]);
  const [recent, setRecent] = useState<OfficeTab[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as OfficeTab[]; } catch { return []; }
  });
  const [dragOver, setDragOver] = useState(false);
  const [gridRevision, setGridRevision] = useState(0);

  const refreshStatus = useCallback(async () => setStatus(await officeClient.status()), []);

  const loadDocument = useCallback(async (nextPath: string, nextName?: string) => {
    setBusy(true);
    setError('');
    setFilePath(nextPath);
    const resolvedName = nextName || nextPath.split(/[\\/]/).pop() || nextPath;
    setFileName(resolvedName);
    setTabs((current) => current.some((tab) => tab.path === nextPath) ? current : [...current, { path: nextPath, name: resolvedName }]);
    setRecent((current) => {
      const updated = [{ path: nextPath, name: resolvedName }, ...current.filter((item) => item.path !== nextPath)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      return updated;
    });
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

  const openDocument = useCallback(async () => {
    const selected = await window.electronAPI.pickFile({ accept: '.docx,.xlsx,.pptx' });
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (file) await loadDocument(file.path, file.name);
  }, [loadDocument]);

  const createDocument = useCallback(async (kind: OfficeDocumentKind) => {
    setBusy(true);
    setError('');
    const result = await officeClient.create(kind);
    setBusy(false);
    if (result.success && result.filePath) await loadDocument(result.filePath);
    else if (result.error !== 'CANCELLED') setError(result.error || '创建文档失败');
  }, [loadDocument]);

  useEffect(() => {
    const handler = (event: Event) => {
      const command = (event as CustomEvent<{ command: 'open' | 'create' }>).detail?.command;
      if (command === 'open') void openDocument();
      if (command === 'create') {
        const kind = window.prompt('文档类型：docx、xlsx 或 pptx', 'docx')?.toLowerCase();
        if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') void createDocument(kind);
      }
    };
    window.addEventListener('office-studio:command', handler);
    return () => window.removeEventListener('office-studio:command', handler);
  }, [createDocument, openDocument]);

  const runOperation = async <T extends { success: boolean; output?: string; error?: string; canUndo?: boolean; canRedo?: boolean }>(operation: () => Promise<T>, refresh = false): Promise<T> => {
    setBusy(true);
    setError('');
    const result = await operation();
    if (!result.success) setError(result.error || 'Office 操作失败');
    if (result.canUndo !== undefined) setCanUndo(result.canUndo);
    if (result.canRedo !== undefined) setCanRedo(result.canRedo);
    if (refresh && result.success) await loadDocument(filePath, fileName);
    setBusy(false);
    return result;
  };

  const queryElements = async () => {
    const result = await runOperation(() => officeClient.query(filePath, selector));
    if (result.success) {
      setOutline(result.output || '');
      setQueryResults((result.output || '').split('\n').filter((line) => line.startsWith('/')));
    }
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

  const restore = async (direction: 'undo' | 'redo') => {
    await runOperation(() => direction === 'undo' ? officeClient.undo(filePath) : officeClient.redo(filePath), true);
    setGridRevision((value) => value + 1);
  };

  const handleGridMutation = useCallback((result: OfficeOperationResult) => {
    if (!result.success) { setError(result.error || 'Excel 单元格更新失败'); return; }
    setCanUndo(result.canUndo ?? true);
    setCanRedo(result.canRedo ?? false);
  }, []);

  const handleGridError = useCallback((message: string) => setError(message), []);

  const switchMode = async (nextMode: ViewMode) => {
    setMode(nextMode);
    if (nextMode === 'preview' && filePath) await loadDocument(filePath, fileName);
  };

  const chooseQueryResult = async (line: string) => {
    const path = line.split('\t')[0];
    setSelectedPath(path);
    const result = await runOperation(() => officeClient.get(filePath, path, 3));
    if (result.success) setElementJson(result.output || '');
  };

  const closeTab = async (tabPath: string) => {
    await officeClient.close(tabPath);
    const remaining = tabs.filter((tab) => tab.path !== tabPath);
    setTabs(remaining);
    if (tabPath !== filePath) return;
    const next = remaining.at(-1);
    if (next) await loadDocument(next.path, next.name);
    else {
      setFilePath(''); setFileName(''); setHtml(''); setOutline(''); setQueryResults([]); setElementJson('');
      setCanUndo(false); setCanRedo(false);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      if (!/\.(docx|xlsx|pptx)$/i.test(file.name)) continue;
      const droppedPath = window.electronAPI.getPathForFile(file);
      if (droppedPath) await loadDocument(droppedPath, file.name);
    }
  };

  const mergeTemplate = async () => {
    const raw = window.prompt('输入模板数据 JSON。文档中的 {{key}} 会被对应值替换：', '{"name":"示例"}');
    if (raw === null) return;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请输入 JSON 对象');
      const result = await runOperation(() => officeClient.merge(filePath, data));
      if (result.success && 'filePath' in result && typeof result.filePath === 'string') await loadDocument(result.filePath);
    } catch (mergeError) { setError(mergeError instanceof Error ? mergeError.message : '模板数据格式错误'); }
  };

  return <div onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => void handleDrop(event)} className={`relative flex h-full min-h-0 flex-col bg-background text-foreground ${dragOver ? 'ring-2 ring-inset ring-primary' : ''}`}>
    {dragOver && <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-primary/10 text-lg font-medium">拖放 Office 文档到这里打开</div>}
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

    {tabs.length > 0 && <nav className="flex gap-1 overflow-x-auto border-b bg-muted/30 px-2 pt-1">
      {tabs.map((tab) => <div key={tab.path} className={`flex shrink-0 items-center rounded-t border border-b-0 text-xs ${tab.path === filePath ? 'bg-background' : 'bg-muted text-muted-foreground'}`}>
        <button onClick={() => void loadDocument(tab.path, tab.name)} className="max-w-48 truncate px-3 py-1.5" title={tab.path}>{tab.name}</button>
        <button onClick={() => void closeTab(tab.path)} className="px-1.5 py-1.5 hover:text-destructive" title="关闭">×</button>
      </div>)}
    </nav>}

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
      {recent.length > 0 && <div className="mt-6 border-t pt-4"><p className="mb-2 text-xs text-muted-foreground">最近文档</p>{recent.map((item) => <button key={item.path} onClick={() => void loadDocument(item.path, item.name)} className="mx-auto mb-1 block max-w-md truncate text-xs text-primary hover:underline" title={item.path}>{item.name}</button>)}</div>}
    </section> : <>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex gap-1 rounded bg-muted p-0.5">
          {(['preview', 'outline', ...(filePath.toLowerCase().endsWith('.xlsx') ? ['grid' as const] : []), ...(filePath.toLowerCase().endsWith('.docx') ? ['word' as const] : []), ...(filePath.toLowerCase().endsWith('.pptx') ? ['ppt' as const] : [])] as ViewMode[]).map((item) => <button key={item} onClick={() => void switchMode(item)} className={`rounded px-3 py-1 text-xs ${mode === item ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{item === 'preview' ? '渲染预览' : item === 'outline' ? '文档结构' : item === 'grid' ? '表格编辑' : item === 'word' ? 'Word 编辑' : 'PPT 编辑'}</button>)}
        </div>
        <div className="flex gap-2">
          <button disabled={!canUndo} onClick={() => void restore('undo')} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />撤销</button>
          <button disabled={!canRedo} onClick={() => void restore('redo')} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />重做</button>
          <button onClick={() => void runOperation(() => officeClient.save(filePath))} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"><Save className="h-3.5 w-3.5" />保存</button>
          <button onClick={() => void mergeTemplate()} className="rounded border px-2 py-1 text-xs hover:bg-muted">模板合并</button>
          <button onClick={() => void loadDocument(filePath, fileName)} className="rounded border px-2 py-1 text-xs hover:bg-muted">刷新</button>
          <button onClick={() => void openDocument()} className="rounded border px-2 py-1 text-xs hover:bg-muted">打开其他文档</button>
        </div>
      </div>
      {error && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
      <main className="relative flex min-h-0 flex-1 bg-muted/30">
        {busy && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        <section className="min-w-0 flex-1">
          {mode === 'grid' && filePath.toLowerCase().endsWith('.xlsx') ? <OfficeExcelGrid key={`${filePath}:${gridRevision}`} filePath={filePath} canUndo={canUndo} canRedo={canRedo} onUndo={() => void restore('undo')} onRedo={() => void restore('redo')} onMutation={handleGridMutation} onError={handleGridError} /> : mode === 'word' && filePath.toLowerCase().endsWith('.docx') ? <OfficeWordEditor filePath={filePath} onMutation={handleGridMutation} onError={handleGridError} /> : mode === 'ppt' && filePath.toLowerCase().endsWith('.pptx') ? <OfficePptEditor filePath={filePath} onMutation={handleGridMutation} onError={handleGridError} /> : mode === 'preview' ? <iframe title="Office 文档预览" sandbox="allow-scripts" srcDoc={html} className="h-full w-full border-0 bg-white" /> : queryResults.length ? <div className="h-full overflow-auto p-3">{queryResults.map((line) => <button key={line} onClick={() => void chooseQueryResult(line)} className={`mb-1 block w-full rounded border px-3 py-2 text-left text-xs hover:bg-muted ${line.startsWith(`${selectedPath}\t`) ? 'border-primary bg-primary/5' : ''}`}><code className="break-all">{line}</code></button>)}</div> : <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs leading-6">{outline}</pre>}
        </section>
        {(mode === 'preview' || mode === 'outline') && <aside className="w-80 shrink-0 overflow-auto border-l bg-background p-3 text-xs">
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
        </aside>}
      </main>
    </>}
  </div>;
};
