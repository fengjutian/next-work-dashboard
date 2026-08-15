import React, { useMemo, useState } from 'react';
import { Button, Empty, Input, Spin, Tag, message } from 'antd';
import { Code, Database, FolderOpen, RefreshCw, Search } from '@/components/icons';
import type { AnalysisNode, ApiEndpoint, RepositoryAnalysis } from '../../core/code-visualizer';

const METHOD_COLOR: Record<string, string> = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'gold', DELETE: 'red' };
const KIND_LABEL: Record<AnalysisNode['kind'], string> = { frontend: 'Vue', endpoint: '接口', controller: 'Controller', service: 'Service', repository: 'Repository', model: 'Model', database: '数据库' };

export function CodeVisualizerPanel(): JSX.Element {
  const [result, setResult] = useState<RepositoryAnalysis | null>(null);
  const [selected, setSelected] = useState<ApiEndpoint | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<{ path: string; content: string; line: number } | null>(null);
  const endpoints = useMemo(() => result?.endpoints.filter((item) => `${item.method} ${item.path} ${item.handler}`.toLowerCase().includes(query.toLowerCase())) ?? [], [query, result]);

  const chooseAndScan = async (): Promise<void> => {
    try {
      const chosen = await window.electronAPI.codeVisualizer.repository.select();
      if (!chosen.ok || !chosen.rootPath) return;
      await scan(chosen.rootPath);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const scan = async (rootPath: string): Promise<void> => {
    setLoading(true); setSelected(null); setSource(null);
    try { const next = await window.electronAPI.codeVisualizer.repository.scan(rootPath); setResult(next); if (next.endpoints[0]) setSelected(next.endpoints[0]); }
    catch (error) { message.error(`扫描失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setLoading(false); }
  };
  const openSource = async (node: AnalysisNode): Promise<void> => {
    if (!result || !node.location) return;
    try { const file = await window.electronAPI.codeVisualizer.source.read(result.rootPath, node.location.file); setSource({ ...file, line: node.location.line }); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  if (!result && !loading) return <div className="flex h-full items-center justify-center bg-slate-950 text-slate-100"><div className="max-w-lg text-center"><Code className="mx-auto mb-5 h-14 w-14 text-cyan-400"/><h1 className="mb-2 text-2xl font-semibold">代码接口地图</h1><p className="mb-6 text-sm leading-6 text-slate-400">扫描本地 Python + Vue 仓库，汇总全部 HTTP 接口，并追踪前端请求、后端调用和数据库线索。</p><Button type="primary" size="large" icon={<FolderOpen className="h-4 w-4"/>} onClick={() => void chooseAndScan()}>选择本地仓库</Button></div></div>;
  if (loading) return <div className="flex h-full items-center justify-center bg-slate-950"><Spin size="large" tip="正在分析接口与调用关系…"/></div>;

  return <div className="flex h-full min-h-0 bg-slate-950 text-slate-100">
    <aside className="flex w-[350px] shrink-0 flex-col border-r border-slate-800">
      <div className="border-b border-slate-800 p-4"><div className="mb-3 flex items-center justify-between"><div><div className="font-semibold">接口列表</div><div className="mt-1 max-w-[240px] truncate text-xs text-slate-500" title={result?.rootPath}>{result?.rootPath}</div></div><Button type="text" title="重新扫描" icon={<RefreshCw className="h-4 w-4"/>} onClick={() => result && void scan(result.rootPath)}/></div><Input allowClear prefix={<Search className="h-4 w-4"/>} placeholder="搜索 URL、方法、处理函数" value={query} onChange={(event) => setQuery(event.target.value)}/><div className="mt-3 flex gap-3 text-xs text-slate-500"><span>{result?.endpoints.length} 个接口</span><span>{result?.pythonFiles} Python</span><span>{result?.vueFiles} Vue/TS</span></div></div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{endpoints.length ? endpoints.map((endpoint) => <button key={endpoint.id + endpoint.location.file} type="button" onClick={() => { setSelected(endpoint); setSource(null); }} className={`mb-1 w-full rounded-lg border p-3 text-left transition ${selected === endpoint ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-transparent hover:bg-slate-900'}`}><div className="flex items-center gap-2"><Tag color={METHOD_COLOR[endpoint.method]}>{endpoint.method}</Tag><span className="truncate text-sm font-medium">{endpoint.path}</span></div><div className="mt-2 truncate text-xs text-slate-500">{endpoint.framework} · {endpoint.handler} · 前端 {endpoint.frontendCalls.length}</div></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的接口"/>}</div>
      <div className="border-t border-slate-800 p-3"><Button block icon={<FolderOpen className="h-4 w-4"/>} onClick={() => void chooseAndScan()}>更换仓库</Button></div>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto p-5">{selected ? <EndpointDetail endpoint={selected} onOpenSource={openSource}/> : <Empty description="选择一个接口开始分析"/>}</main>
    {source && <aside className="flex w-[42%] min-w-[420px] flex-col border-l border-slate-800 bg-[#0d1117]"><div className="border-b border-slate-800 px-4 py-3 text-sm"><span className="text-slate-300">{source.path}</span><span className="ml-2 text-slate-500">第 {source.line} 行</span></div><pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-5 text-slate-300"><code>{source.content.split(/\r?\n/).map((line, index) => <div key={index} className={index + 1 === source.line ? 'bg-cyan-500/15 text-cyan-100' : ''}><span className="mr-4 inline-block w-10 select-none text-right text-slate-600">{index + 1}</span>{line}</div>)}</code></pre></aside>}
  </div>;
}

function EndpointDetail({ endpoint, onOpenSource }: { endpoint: ApiEndpoint; onOpenSource: (node: AnalysisNode) => void }): JSX.Element {
  const ordered = orderNodes(endpoint);
  return <div className="mx-auto max-w-5xl"><div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-3"><Tag color={METHOD_COLOR[endpoint.method]}>{endpoint.method}</Tag><h2 className="text-xl font-semibold">{endpoint.path}</h2></div><div className="mt-2 text-sm text-slate-500">{endpoint.framework} · {endpoint.location.file}:{endpoint.location.line}</div></div><div className="flex gap-2">{endpoint.tables.map((table) => <Tag key={table} icon={<Database className="h-3 w-3"/>}>{table}</Tag>)}</div></div>
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><h3 className="mb-4 text-sm font-semibold text-slate-300">端到端调用链</h3><div className="flex flex-col gap-2">{ordered.map((node, index) => <React.Fragment key={node.id}>{index > 0 && <div className="ml-6 h-4 border-l border-dashed border-slate-600"/>}<button type="button" disabled={!node.location} onClick={() => void onOpenSource(node)} className="flex w-full items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-left hover:border-cyan-600 disabled:cursor-default disabled:hover:border-slate-700"><span className="w-20 shrink-0 text-xs font-medium uppercase text-cyan-400">{KIND_LABEL[node.kind]}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{node.label}</span>{node.detail && <span className="mt-1 block truncate text-xs text-slate-500">{node.detail}</span>}</span>{node.location && <span className="text-xs text-slate-600">{node.location.file}:{node.location.line}</span>}</button></React.Fragment>)}</div></section>
    {endpoint.frontendCalls.length === 0 && <div className="mt-4 rounded-lg border border-amber-700/30 bg-amber-500/5 p-3 text-sm text-amber-300">未找到静态可匹配的 Vue 请求。动态拼接 URL 或封装较深的请求需要后续适配。</div>}
  </div>;
}

function orderNodes(endpoint: ApiEndpoint): AnalysisNode[] {
  const byId = new Map(endpoint.nodes.map((node) => [node.id, node]));
  const incoming = new Set(endpoint.edges.map((edge) => edge.target));
  const roots = endpoint.nodes.filter((node) => !incoming.has(node.id));
  const ordered: AnalysisNode[] = []; const seen = new Set<string>();
  const walk = (node: AnalysisNode): void => { if (seen.has(node.id)) return; seen.add(node.id); ordered.push(node); for (const edge of endpoint.edges.filter((item) => item.source === node.id)) { const child = byId.get(edge.target); if (child) walk(child); } };
  for (const root of roots) walk(root); for (const node of endpoint.nodes) walk(node); return ordered;
}
