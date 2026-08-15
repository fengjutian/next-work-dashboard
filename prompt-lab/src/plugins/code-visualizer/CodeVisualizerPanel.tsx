import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Select, Spin, Tag, message } from 'antd';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { Code, Database, FolderOpen, History, Network, RefreshCw, Rows3, Search, XCircle } from '@/components/icons';
import type { AnalysisNode, ApiEndpoint, CodeVisualizerProjectHistory, CodeVisualizerScanSnapshot, RepositoryAnalysis } from '../../core/code-visualizer';
import { RelationshipGraph } from './RelationshipGraph';
import { configureMonaco } from '@/lib/monaco-setup';

configureMonaco();

const METHOD_COLOR: Record<string, string> = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'gold', DELETE: 'red' };
const KIND_LABEL: Record<AnalysisNode['kind'], string> = { frontend: 'Vue', endpoint: '接口', controller: 'Controller', service: 'Service', repository: 'Repository', model: 'Model', database: '数据库' };
type SourceTab = { path: string; content: string; line: number };

export function CodeVisualizerPanel(): JSX.Element {
  const [result, setResult] = useState<RepositoryAnalysis | null>(null);
  const [selected, setSelected] = useState<ApiEndpoint | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<CodeVisualizerProjectHistory[]>([]);
  const [snapshots, setSnapshots] = useState<CodeVisualizerScanSnapshot[]>([]);
  const [sourceTabs, setSourceTabs] = useState<SourceTab[]>([]);
  const [activeSourcePath, setActiveSourcePath] = useState<string | null>(null);
  const source = sourceTabs.find((tab) => tab.path === activeSourcePath) ?? null;
  const endpoints = useMemo(() => result?.endpoints.filter((item) => `${item.method} ${item.path} ${item.handler}`.toLowerCase().includes(query.toLowerCase())) ?? [], [query, result]);

  const loadHistory = useCallback(() => {
    void window.electronAPI.codeVisualizer.history.list().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const chooseAndScan = async (): Promise<void> => {
    try {
      const chosen = await window.electronAPI.codeVisualizer.repository.select();
      if (!chosen.ok || !chosen.rootPath) return;
      await scan(chosen.rootPath);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const scan = async (rootPath: string): Promise<void> => {
    setLoading(true); setSelected(null); setSourceTabs([]); setActiveSourcePath(null);
    try { const next = await window.electronAPI.codeVisualizer.repository.scan(rootPath); setResult(next); if (next.endpoints[0]) setSelected(next.endpoints[0]); setSnapshots(await window.electronAPI.codeVisualizer.snapshot.list(rootPath)); loadHistory(); }
    catch (error) { message.error(`扫描失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setLoading(false); }
  };
  const openSource = useCallback(async (node: AnalysisNode): Promise<void> => {
    if (!result || !node.location) return;
    try { const file = await window.electronAPI.codeVisualizer.source.read(result.rootPath, node.location.file); setSourceTabs((tabs) => [...tabs.filter((tab) => tab.path !== file.path), { ...file, line: node.location?.line ?? 1 }]); setActiveSourcePath(file.path); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  }, [result]);

  if (!result && !loading) return <div className="h-full overflow-auto bg-background px-6 py-12 text-foreground"><div className="mx-auto max-w-3xl text-center"><div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl border bg-card text-primary shadow-sm"><Code className="h-10 w-10"/></div><h1 className="mb-2 text-2xl font-semibold">代码接口地图</h1><p className="mx-auto mb-6 max-w-lg text-sm leading-6 text-muted-foreground">扫描本地 Python + Vue 仓库，汇总全部 HTTP 接口，并追踪前端请求、后端调用和数据库线索。</p><Button type="primary" size="large" icon={<FolderOpen className="h-4 w-4"/>} onClick={() => void chooseAndScan()}>选择本地仓库</Button>{history.length > 0 && <section className="mt-12 text-left"><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-primary"/><h2 className="text-sm font-semibold">最近项目</h2><span className="text-xs text-muted-foreground">自动保存在本机</span></div><div className="grid gap-3 sm:grid-cols-2">{history.map((entry) => <div key={entry.rootPath} className={`group rounded-xl border bg-card p-4 shadow-sm transition ${entry.available ? 'hover:border-primary/40 hover:shadow-md' : 'opacity-60'}`}><div className="flex items-start gap-3"><button type="button" disabled={!entry.available} onClick={() => void window.electronAPI.codeVisualizer.history.open(entry.rootPath).then((opened) => scan(opened.rootPath)).catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)))} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"><div className="truncate text-sm font-semibold">{entry.name}</div><div className="mt-1 truncate text-xs text-muted-foreground" title={entry.rootPath}>{entry.rootPath}</div><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span>{entry.endpointCount} 个接口</span><span>{entry.pythonFiles} Python</span><span>{entry.vueFiles} Vue/TS</span><span>{formatHistoryTime(entry.lastScannedAt)}</span></div>{!entry.available && <div className="mt-2 text-xs text-destructive">目录已移动或删除</div>}</button><button type="button" title="从历史中移除" onClick={() => void window.electronAPI.codeVisualizer.history.remove(entry.rootPath).then(loadHistory)} className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"><XCircle className="h-4 w-4"/></button></div></div>)}</div></section>}</div></div>;
  if (loading) return <div className="flex h-full items-center justify-center bg-background"><Spin size="large" tip="正在分析接口与调用关系…"/></div>;

  return <div className="flex h-full min-h-0 bg-background text-foreground">
    <aside className="flex w-[350px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="border-b border-sidebar-border p-4"><div className="mb-3 flex items-center justify-between"><div><div className="font-semibold">接口列表</div><div className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground" title={result?.rootPath}>{result?.rootPath}</div></div><Button type="text" title="重新扫描" icon={<RefreshCw className="h-4 w-4"/>} onClick={() => result && void scan(result.rootPath)}/></div><Input allowClear prefix={<Search className="h-4 w-4"/>} placeholder="搜索 URL、方法、处理函数" value={query} onChange={(event) => setQuery(event.target.value)}/><div className="mt-3 flex gap-3 text-xs text-muted-foreground"><span>{result?.endpoints.length} 个接口</span><span>{result?.pythonFiles} Python</span><span>{result?.vueFiles} Vue/TS</span></div></div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{endpoints.length ? endpoints.map((endpoint) => <button key={endpoint.id + endpoint.location.file} type="button" onClick={() => setSelected(endpoint)} className={`mb-1 w-full rounded-lg border p-3 text-left transition ${selected === endpoint ? 'border-primary/50 bg-sidebar-active text-sidebar-active-foreground' : 'border-transparent hover:bg-sidebar-hover'}`}><div className="flex items-center gap-2"><Tag color={METHOD_COLOR[endpoint.method]}>{endpoint.method}</Tag><span className="truncate text-sm font-medium">{endpoint.path}</span></div><div className="mt-2 truncate text-xs text-muted-foreground">{endpoint.framework} · {endpoint.handler} · 前端 {endpoint.frontendCalls.length}</div></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的接口"/>}</div>
      <div className="border-t border-sidebar-border p-3"><Button block icon={<FolderOpen className="h-4 w-4"/>} onClick={() => void chooseAndScan()}>更换仓库</Button></div>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto p-5"><div className="mx-auto mb-4 flex max-w-5xl items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"><div className="flex gap-4"><span>{result?.scan?.mode === 'incremental' ? '增量扫描' : '完整扫描'}</span><span>变化 {result?.scan?.changedFiles ?? result?.filesScanned} 文件</span><span>复用 {result?.scan?.reusedFiles ?? 0}</span><span>{result?.scan?.durationMs ?? 0} ms</span><span className={(result?.diagnostics?.filter((item) => item.severity === 'error').length ?? 0) ? 'text-destructive' : ''}>{result?.diagnostics?.length ?? 0} 个诊断</span></div><Select size="small" className="w-52" placeholder="扫描快照" value={result?.scan?.snapshotId} options={snapshots.map((snapshot) => ({ value: snapshot.id, label: `${new Date(snapshot.scannedAt).toLocaleString('zh-CN')} · ${snapshot.endpointCount} 接口` }))} onChange={(id) => result && void window.electronAPI.codeVisualizer.snapshot.load(result.rootPath, id).then((snapshot) => { setResult(snapshot); setSelected(snapshot.endpoints[0] ?? null); setSourceTabs([]); setActiveSourcePath(null); })}/></div>{selected && result ? <EndpointDetail endpoint={selected} result={result} onOpenSource={openSource}/> : <Empty description="选择一个接口开始分析"/>}</main>
    {source && <SourcePanel tabs={sourceTabs} active={source} onActivate={setActiveSourcePath} onClose={(path) => { const remaining = sourceTabs.filter((tab) => tab.path !== path); setSourceTabs(remaining); if (activeSourcePath === path) setActiveSourcePath(remaining.at(-1)?.path ?? null); }}/>} 
  </div>;
}

type DetailTab = 'overview' | 'relations' | 'parameters' | 'frontend' | 'database' | 'diagnostics' | 'impact';
const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [{ id: 'overview', label: '概览' }, { id: 'relations', label: '关系图' }, { id: 'parameters', label: '参数与响应' }, { id: 'frontend', label: '前端调用' }, { id: 'database', label: '数据库' }, { id: 'diagnostics', label: '问题诊断' }, { id: 'impact', label: '影响分析' }];

function EndpointDetail({ endpoint, result, onOpenSource }: { endpoint: ApiEndpoint; result: RepositoryAnalysis; onOpenSource: (node: AnalysisNode) => void }): JSX.Element {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [impactNode, setImpactNode] = useState<AnalysisNode>(() => endpoint.nodes.find((node) => node.kind === 'controller') ?? endpoint.nodes[0]);
  useEffect(() => { setImpactNode(endpoint.nodes.find((node) => node.kind === 'controller') ?? endpoint.nodes[0]); setTab('overview'); }, [endpoint]);
  const impact = useMemo(() => calculateImpact(result, impactNode?.id), [impactNode?.id, result]);
  const diagnostics = result.diagnostics ?? [];
  return <div className="mx-auto max-w-5xl"><div className="mb-4 flex items-start justify-between"><div><div className="flex items-center gap-3"><Tag color={METHOD_COLOR[endpoint.method]}>{endpoint.method}</Tag><h2 className="text-xl font-semibold">{endpoint.path}</h2></div><div className="mt-2 text-sm text-muted-foreground">{endpoint.framework} · {endpoint.location.file}:{endpoint.location.line}</div></div><div className="flex gap-2">{endpoint.tables.map((table) => <Tag key={table} icon={<Database className="h-3 w-3"/>}>{table}</Tag>)}</div></div>
    <nav className="mb-4 flex overflow-x-auto border-b">{DETAIL_TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 border-b-2 px-4 py-2 text-xs transition ${tab === item.id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item.label}{item.id === 'diagnostics' && diagnostics.length > 0 ? ` (${diagnostics.length})` : ''}</button>)}</nav>
    {tab === 'overview' && <div className="grid gap-4 md:grid-cols-3"><Metric label="处理函数" value={endpoint.handler}/><Metric label="前端调用" value={String(endpoint.frontendCalls.length)}/><Metric label="关系节点" value={String(endpoint.nodes.length)}/><section className="rounded-xl border bg-card p-4 md:col-span-3"><h3 className="mb-3 text-sm font-semibold">接口契约</h3><div className="grid gap-3 text-sm sm:grid-cols-3"><Info label="请求模型" value={endpoint.contract.requestModel ?? '—'}/><Info label="响应模型" value={endpoint.contract.responseModel ?? '—'}/><Info label="状态码" value={endpoint.contract.statusCodes.join(', ')}/></div></section></div>}
    {tab === 'relations' && <RelationshipGraph endpoint={endpoint} onOpenSource={onOpenSource} onSelectNode={(node) => setImpactNode(node)}/>} 
    {tab === 'parameters' && <section className="overflow-hidden rounded-xl border bg-card"><div className="grid grid-cols-[1fr_100px_1fr_90px] border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground"><span>名称</span><span>来源</span><span>类型/默认值</span><span>必填</span></div>{endpoint.contract.parameters.length ? endpoint.contract.parameters.map((parameter) => <div key={`${parameter.source}:${parameter.name}`} className="grid grid-cols-[1fr_100px_1fr_90px] border-b px-4 py-3 text-sm last:border-0"><code>{parameter.name}</code><Tag>{parameter.source}</Tag><span>{parameter.type}{parameter.defaultValue ? ` = ${parameter.defaultValue}` : ''}</span><span>{parameter.required ? '是' : '否'}</span></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未解析到显式参数"/>}</section>}
    {tab === 'frontend' && <CardList empty="未找到匹配的前端调用">{endpoint.frontendCalls.map((call) => <button key={call.id} type="button" onClick={() => onOpenSource({ id: call.id, kind: 'frontend', label: call.path, location: call.location })} className="w-full rounded-lg border bg-background p-3 text-left hover:border-primary/40"><div className="flex gap-2"><Tag color={METHOD_COLOR[call.method]}>{call.method}</Tag><code className="text-sm">{call.path}</code></div><div className="mt-2 text-xs text-muted-foreground">{call.location.file}:{call.location.line}</div></button>)}</CardList>}
    {tab === 'database' && <CardList empty="该调用链没有识别到数据库表">{endpoint.tables.map((table) => <div key={table} className="flex items-center gap-3 rounded-lg border bg-background p-4"><Database className="h-5 w-5 text-primary"/><div><div className="font-medium">{table}</div><div className="text-xs text-muted-foreground">由 ORM 模型或 SQL 语句推断</div></div></div>)}</CardList>}
    {tab === 'diagnostics' && <CardList empty="当前仓库未发现前后端接口不一致">{diagnostics.map((diagnostic) => <div key={diagnostic.id} className={`rounded-lg border p-3 ${diagnostic.severity === 'error' ? 'border-destructive/30 bg-destructive/5' : 'bg-card'}`}><div className="flex items-center justify-between"><span className={diagnostic.severity === 'error' ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}>{diagnostic.message}</span><Tag color={diagnostic.severity === 'error' ? 'red' : 'default'}>{diagnostic.kind}</Tag></div><div className="mt-2 text-xs text-muted-foreground">{diagnostic.location.file}:{diagnostic.location.line}</div></div>)}</CardList>}
    {tab === 'impact' && <section className="space-y-4"><div className="rounded-xl border bg-card p-4"><label className="mb-2 block text-xs text-muted-foreground">分析节点</label><Select className="w-full" value={impactNode?.id} options={endpoint.nodes.map((node) => ({ value: node.id, label: `${KIND_LABEL[node.kind]} · ${node.label}` }))} onChange={(id) => { const node = endpoint.nodes.find((item) => item.id === id); if (node) setImpactNode(node); }}/></div><div className="grid gap-4 sm:grid-cols-3"><Metric label="受影响接口" value={String(impact.endpoints.length)}/><Metric label="前端调用" value={String(impact.frontendCalls)}/><Metric label="数据库表" value={String(impact.tables.length)}/></div><CardList empty="没有发现跨接口影响">{impact.endpoints.map((item) => <div key={`${item.id}:${item.location.file}`} className="rounded-lg border bg-card p-3"><Tag color={METHOD_COLOR[item.method]}>{item.method}</Tag><span className="ml-2 text-sm font-medium">{item.path}</span></div>)}</CardList>{impact.tables.length > 0 && <div className="flex flex-wrap gap-2">{impact.tables.map((table) => <Tag key={table} icon={<Database className="h-3 w-3"/>}>{table}</Tag>)}</div>}</section>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element { return <div className="rounded-xl border bg-card p-4 shadow-sm"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-2 truncate text-lg font-semibold">{value}</div></div>; }
function Info({ label, value }: { label: string; value: string }): JSX.Element { return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>; }
function CardList({ children, empty }: { children: React.ReactNode; empty: string }): JSX.Element { const items = React.Children.toArray(children); return <section className="space-y-2 rounded-xl border bg-card p-4">{items.length ? items : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty}/>}</section>; }

function calculateImpact(result: RepositoryAnalysis, nodeId?: string): { endpoints: ApiEndpoint[]; frontendCalls: number; tables: string[] } {
  if (!nodeId) return { endpoints: [], frontendCalls: 0, tables: [] };
  const endpoints = result.endpoints.filter((endpoint) => endpoint.nodes.some((node) => node.id === nodeId));
  return { endpoints, frontendCalls: endpoints.reduce((total, endpoint) => total + endpoint.frontendCalls.length, 0), tables: [...new Set(endpoints.flatMap((endpoint) => endpoint.tables))] };
}

export function LegacyEndpointDetail({ endpoint, onOpenSource }: { endpoint: ApiEndpoint; onOpenSource: (node: AnalysisNode) => void }): JSX.Element {
  const ordered = orderNodes(endpoint);
  const [view, setView] = useState<'graph' | 'chain'>('graph');
  return <div className="mx-auto max-w-5xl"><div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-3"><Tag color={METHOD_COLOR[endpoint.method]}>{endpoint.method}</Tag><h2 className="text-xl font-semibold">{endpoint.path}</h2></div><div className="mt-2 text-sm text-muted-foreground">{endpoint.framework} · {endpoint.location.file}:{endpoint.location.line}</div></div><div className="flex gap-2">{endpoint.tables.map((table) => <Tag key={table} icon={<Database className="h-3 w-3"/>}>{table}</Tag>)}</div></div>
    <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">端到端调用关系</h3><div className="flex rounded-lg border bg-card p-1"><button type="button" className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === 'graph' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`} onClick={() => setView('graph')}><Network className="h-3.5 w-3.5"/>关系图</button><button type="button" className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === 'chain' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`} onClick={() => setView('chain')}><Rows3 className="h-3.5 w-3.5"/>链路</button></div></div>
    {view === 'graph' ? <RelationshipGraph endpoint={endpoint} onOpenSource={onOpenSource}/> : <section className="rounded-xl border bg-card p-4 shadow-sm"><div className="flex flex-col gap-2">{ordered.map((node, index) => <React.Fragment key={node.id}>{index > 0 && <div className="ml-6 h-4 border-l border-dashed"/>}<button type="button" disabled={!node.location} onClick={() => void onOpenSource(node)} className="flex w-full items-center gap-3 rounded-lg border bg-background px-4 py-3 text-left transition hover:border-primary/50 hover:bg-primary/5 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-background"><span className="w-20 shrink-0 text-xs font-medium uppercase text-primary">{KIND_LABEL[node.kind]}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{node.label}</span>{node.detail && <span className="mt-1 block truncate text-xs text-muted-foreground">{node.detail}</span>}</span>{node.location && <span className="text-xs text-muted-foreground">{node.location.file}:{node.location.line}</span>}</button></React.Fragment>)}</div></section>}
    {endpoint.frontendCalls.length === 0 && <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">未找到静态可匹配的 Vue 请求。动态拼接 URL 或封装较深的请求需要后续适配。</div>}
  </div>;
}

function SourcePanel({ tabs, active, onActivate, onClose }: { tabs: SourceTab[]; active: SourceTab; onActivate: (path: string) => void; onClose: (path: string) => void }): JSX.Element {
  const dark = document.documentElement.classList.contains('dark');
  const language = active.path.endsWith('.py') ? 'python' : active.path.endsWith('.vue') ? 'html' : active.path.endsWith('.ts') || active.path.endsWith('.tsx') ? 'typescript' : 'javascript';
  const handleMount: OnMount = (editor) => {
    editor.revealLineInCenter(active.line);
    editor.setPosition({ lineNumber: active.line, column: 1 });
    editor.focus();
  };
  return <aside className="flex w-[46%] min-w-[440px] flex-col border-l bg-card"><div className="flex h-10 shrink-0 overflow-x-auto border-b bg-background">{tabs.map((tab) => <button key={tab.path} type="button" onClick={() => onActivate(tab.path)} className={`group flex max-w-56 shrink-0 items-center gap-2 border-r px-3 text-xs ${tab.path === active.path ? 'border-t-2 border-t-primary bg-card text-foreground' : 'text-muted-foreground hover:bg-accent'}`}><span className="truncate">{tab.path.split('/').at(-1)}</span><span role="button" tabIndex={0} aria-label={`关闭 ${tab.path}`} onClick={(event) => { event.stopPropagation(); onClose(tab.path); }} onKeyDown={(event) => { if (event.key === 'Enter') onClose(tab.path); }} className="rounded p-0.5 opacity-0 transition hover:bg-muted group-hover:opacity-100"><XCircle className="h-3 w-3"/></span></button>)}</div><div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">{active.path} · 第 {active.line} 行</div><div className="min-h-0 flex-1"><MonacoEditor key={`${active.path}:${active.line}`} value={active.content} language={language} theme={dark ? 'vs-dark' : 'light'} loading={<div className="grid h-full place-items-center text-xs text-muted-foreground">正在加载本地源码编辑器…</div>} onMount={handleMount} options={{ automaticLayout: true, readOnly: true, minimap: { enabled: false }, lineNumbersMinChars: 3, fontSize: 12, scrollBeyondLastLine: false, renderLineHighlight: 'all', wordWrap: 'off' }}/></div></aside>;
}

function formatHistoryTime(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function orderNodes(endpoint: ApiEndpoint): AnalysisNode[] {
  const byId = new Map(endpoint.nodes.map((node) => [node.id, node]));
  const incoming = new Set(endpoint.edges.map((edge) => edge.target));
  const roots = endpoint.nodes.filter((node) => !incoming.has(node.id));
  const ordered: AnalysisNode[] = []; const seen = new Set<string>();
  const walk = (node: AnalysisNode): void => { if (seen.has(node.id)) return; seen.add(node.id); ordered.push(node); for (const edge of endpoint.edges.filter((item) => item.source === node.id)) { const child = byId.get(edge.target); if (child) walk(child); } };
  for (const root of roots) walk(root); for (const node of endpoint.nodes) walk(node); return ordered;
}
