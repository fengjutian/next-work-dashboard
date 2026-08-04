import React, { useMemo, useState } from 'react';
import type { GraphData } from './graph-types';
import { aggregateGraph, graphModuleName } from './graph-views';

const COLORS = ['#6d2869', '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
type Tooltip = { x: number; y: number; source: string; target: string; weight: number } | null;
type Detail = { kind: 'flow'; sourceId: string; targetId: string } | { kind: 'module'; moduleId: string } | null;

/** 可筛选、可高亮的模块级桑基图。 */
export const SankeyView: React.FC<{ graph: GraphData }> = ({ graph }) => {
  const data = useMemo(() => aggregateGraph(graph), [graph]);
  const [selectedId, setSelectedId] = useState('');
  const [minWeight, setMinWeight] = useState(1);
  const [hoveredKey, setHoveredKey] = useState('');
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const nodeNames = useMemo(() => new Map(data.nodes.map((node) => [node.id, node.label])), [data.nodes]);
  const originalNodes = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const originalGroups = useMemo(() => new Map(graph.nodes.map((node) => [node.id, `group:${graphModuleName(node)}`])), [graph.nodes]);
  const maxWeight = Math.max(1, ...data.edges.map((edge) => edge.weight));
  const visibleEdges = useMemo(() => data.edges.filter((edge) =>
    edge.weight >= minWeight && (!selectedId || edge.source === selectedId || edge.target === selectedId),
  ), [data.edges, minWeight, selectedId]);
  const outgoing = useMemo(() => data.nodes.filter((node) => visibleEdges.some((edge) => edge.source === node.id)), [data.nodes, visibleEdges]);
  const incoming = useMemo(() => data.nodes.filter((node) => visibleEdges.some((edge) => edge.target === node.id)), [data.nodes, visibleEdges]);
  const sourceY = new Map(outgoing.map((node, index) => [node.id, 55 + index * Math.max(36, 520 / Math.max(1, outgoing.length))]));
  const targetY = new Map(incoming.map((node, index) => [node.id, 55 + index * Math.max(36, 520 / Math.max(1, incoming.length))]));
  const height = Math.max(640, Math.max(outgoing.length, incoming.length) * 42 + 90);
  const reset = () => { setSelectedId(''); setMinWeight(1); setHoveredKey(''); setTooltip(null); setDetail(null); };
  const flowRelations = detail?.kind === 'flow' ? graph.edges.filter((edge) =>
    originalGroups.get(edge.source) === detail.sourceId && originalGroups.get(edge.target) === detail.targetId,
  ) : [];
  const moduleNodes = detail?.kind === 'module' ? graph.nodes.filter((node) => originalGroups.get(node.id) === detail.moduleId) : [];
  const moduleIncoming = detail?.kind === 'module' ? data.edges.filter((edge) => edge.target === detail.moduleId) : [];
  const moduleOutgoing = detail?.kind === 'module' ? data.edges.filter((edge) => edge.source === detail.moduleId) : [];

  if (data.edges.length === 0) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前图谱没有可展示的模块流向</div>;

  return <div className="relative h-full w-full overflow-auto bg-background p-12 pt-32">
    <div className="absolute left-3 right-3 top-14 z-20 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
      <label className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">聚焦模块</span>
        <select className="h-7 max-w-56 rounded border border-input bg-card px-2" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">全部模块</option>{data.nodes.slice().sort((a, b) => a.label.localeCompare(b.label)).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">最小权重 {minWeight}</span>
        <input type="range" min="1" max={maxWeight} value={minWeight} onChange={(event) => setMinWeight(Number(event.target.value))} className="w-28 accent-primary" />
      </label>
      <span className="text-xs text-muted-foreground">{visibleEdges.length} 条流向 · 总权重 {visibleEdges.reduce((sum, edge) => sum + edge.weight, 0)}</span>
      <button className="ml-auto h-7 rounded border border-input px-3 text-xs hover:bg-accent" onClick={reset}>返回原始状态</button>
    </div>

    {visibleEdges.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前筛选条件下没有关系</div> : <svg className="min-h-full min-w-[900px]" viewBox={`0 0 1000 ${height}`} role="img" aria-label="模块依赖桑基图">
      <text x="50" y="28" className="fill-muted-foreground text-[13px]">调用 / 依赖方</text>
      <text x="950" y="28" textAnchor="end" className="fill-muted-foreground text-[13px]">被调用 / 被依赖方</text>
      <g fill="none">
        {visibleEdges.map((edge, index) => {
          const y1 = sourceY.get(edge.source); const y2 = targetY.get(edge.target);
          if (y1 == null || y2 == null) return null;
          const key = `${edge.source}:${edge.target}`;
          const active = !hoveredKey || hoveredKey === key;
          const width = 2 + (edge.weight / maxWeight) * 22;
          return <path
            key={key} d={`M 190 ${y1} C 410 ${y1}, 590 ${y2}, 810 ${y2}`}
            stroke={COLORS[index % COLORS.length]} strokeWidth={width} strokeOpacity={active ? (hoveredKey ? 0.85 : 0.4) : 0.06}
            className="cursor-pointer transition-opacity"
            onMouseEnter={(event) => { setHoveredKey(key); setTooltip({ x: event.clientX + 12, y: event.clientY + 12, source: nodeNames.get(edge.source) ?? edge.source, target: nodeNames.get(edge.target) ?? edge.target, weight: edge.weight }); }}
            onMouseMove={(event) => setTooltip((current) => current ? { ...current, x: event.clientX + 12, y: event.clientY + 12 } : null)}
            onMouseLeave={() => { setHoveredKey(''); setTooltip(null); }}
            onClick={() => setDetail({ kind: 'flow', sourceId: edge.source, targetId: edge.target })}
          />;
        })}
      </g>
      {outgoing.map((node, index) => <g key={`source:${node.id}`} className="cursor-pointer" transform={`translate(50 ${sourceY.get(node.id)! - 13})`} onClick={() => { setSelectedId(selectedId === node.id ? '' : node.id); setDetail({ kind: 'module', moduleId: node.id }); }}>
        <rect width="140" height="26" rx="4" fill={COLORS[index % COLORS.length]} fillOpacity={selectedId && selectedId !== node.id ? 0.45 : 0.9} stroke={selectedId === node.id ? '#111827' : 'none'} strokeWidth="2" />
        <text x="8" y="17" className="pointer-events-none fill-white text-[11px]">{node.label}</text>
      </g>)}
      {incoming.map((node, index) => <g key={`target:${node.id}`} className="cursor-pointer" transform={`translate(810 ${targetY.get(node.id)! - 13})`} onClick={() => { setSelectedId(selectedId === node.id ? '' : node.id); setDetail({ kind: 'module', moduleId: node.id }); }}>
        <rect width="140" height="26" rx="4" fill={COLORS[index % COLORS.length]} fillOpacity={selectedId && selectedId !== node.id ? 0.45 : 0.9} stroke={selectedId === node.id ? '#111827' : 'none'} strokeWidth="2" />
        <text x="132" y="17" textAnchor="end" className="pointer-events-none fill-white text-[11px]">{node.label}</text>
      </g>)}
    </svg>}

    {tooltip && <div className="pointer-events-none fixed z-[100] rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg" style={{ left: tooltip.x, top: tooltip.y }}>
      <p className="font-medium">{tooltip.source} → {tooltip.target}</p><p className="mt-1 text-muted-foreground">关系权重：{tooltip.weight}</p>
    </div>}

    {detail && <aside className="absolute bottom-3 right-3 top-20 z-20 flex w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-2xl backdrop-blur">
      <header className="flex items-start justify-between border-b border-border p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{detail.kind === 'flow' ? `${nodeNames.get(detail.sourceId)} → ${nodeNames.get(detail.targetId)}` : nodeNames.get(detail.moduleId)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{detail.kind === 'flow' ? `${flowRelations.length} 条原始关系` : `${moduleNodes.length} 个代码节点 · ${moduleIncoming.length} 个上游 · ${moduleOutgoing.length} 个下游`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="h-7 rounded border border-input px-2 text-xs hover:bg-accent" onClick={reset}>返回原始状态</button>
          <button className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent" title="关闭详情" onClick={() => setDetail(null)}>×</button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {detail.kind === 'flow' ? <div className="space-y-2">
          {flowRelations.map((edge, index) => {
            const source = originalNodes.get(edge.source); const target = originalNodes.get(edge.target);
            return <section key={`${edge.source}:${edge.target}:${index}`} className="rounded border border-border p-2 text-xs">
              <div className="flex items-center gap-1"><span className="truncate font-medium" title={source?.label}>{source?.label ?? edge.source}</span><span className="shrink-0 text-primary">—{edge.label || '关联'}→</span><span className="truncate font-medium" title={target?.label}>{target?.label ?? edge.target}</span></div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={source?.sourcePath}>{source?.sourcePath ?? '未知来源文件'}{target?.sourcePath && target.sourcePath !== source?.sourcePath ? ` → ${target.sourcePath}` : ''}</p>
            </section>;
          })}
          {flowRelations.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">没有可追溯的原始关系</p>}
        </div> : <div className="space-y-3">
          <section><h4 className="mb-1 text-xs font-medium">下游模块</h4><div className="flex flex-wrap gap-1">{moduleOutgoing.map((edge) => <button key={`${edge.source}:${edge.target}`} className="rounded bg-primary/10 px-2 py-1 text-[11px] text-primary" onClick={() => setDetail({ kind: 'flow', sourceId: edge.source, targetId: edge.target })}>{nodeNames.get(edge.target)} · {edge.weight}</button>)}</div></section>
          <section><h4 className="mb-1 text-xs font-medium">上游模块</h4><div className="flex flex-wrap gap-1">{moduleIncoming.map((edge) => <button key={`${edge.source}:${edge.target}`} className="rounded bg-muted px-2 py-1 text-[11px]" onClick={() => setDetail({ kind: 'flow', sourceId: edge.source, targetId: edge.target })}>{nodeNames.get(edge.source)} · {edge.weight}</button>)}</div></section>
          <section><h4 className="mb-1 text-xs font-medium">包含的代码节点</h4><div className="space-y-1">{moduleNodes.map((node) => <div key={node.id} className="rounded border border-border px-2 py-1.5 text-xs"><div className="flex justify-between gap-2"><span className="truncate font-medium">{node.label}</span><span className="shrink-0 text-[10px] text-muted-foreground">{node.category}</span></div>{node.sourcePath && <p className="truncate text-[10px] text-muted-foreground" title={node.sourcePath}>{node.sourcePath}</p>}</div>)}</div></section>
        </div>}
      </div>
    </aside>}
  </div>;
};
