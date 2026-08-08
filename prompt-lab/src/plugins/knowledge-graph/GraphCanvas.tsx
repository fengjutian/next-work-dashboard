import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, GitBranch } from '@/components/icons';
import type { GraphData, GraphEdge, GraphNode } from './graph-types';
import { aggregateGraph, dependencyMatrix, graphModuleName, localGraph, sanitizeGraph } from './graph-views';
import { SankeyView } from './SankeyView';

echarts.use([GraphChart, LegendComponent, TooltipComponent, CanvasRenderer]);

type GraphView = 'relation' | 'layered' | 'aggregate' | 'local' | 'matrix' | 'sankey';

const NODE_COLORS = [
  '#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04',
  '#ea580c', '#dc2626', '#db2777', '#4f46e5', '#0f766e',
];

interface GraphCanvasProps {
  graphData: GraphData | null;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeStatusChange?: (edgeIndex: number, status: 'accepted' | 'rejected') => void;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function layeredPositions(graph: GraphData): Map<string, { x: number; y: number }> {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  graph.edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const depth = new Map<string, number>();
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  if (!queue.length && graph.nodes[0]) queue.push(graph.nodes[0].id);
  queue.forEach((id) => depth.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const target of outgoing.get(id) ?? []) {
      const nextDepth = Math.max(depth.get(target) ?? 0, (depth.get(id) ?? 0) + 1);
      if (!depth.has(target)) queue.push(target);
      depth.set(target, nextDepth);
    }
  }
  graph.nodes.forEach((node) => { if (!depth.has(node.id)) depth.set(node.id, 0); });

  const layers = new Map<number, string[]>();
  graph.nodes.forEach((node) => {
    const level = depth.get(node.id) ?? 0;
    layers.set(level, [...(layers.get(level) ?? []), node.id]);
  });
  const positions = new Map<string, { x: number; y: number }>();
  [...layers.entries()].sort(([a], [b]) => a - b).forEach(([level, ids]) => {
    ids.forEach((id, index) => positions.set(id, { x: level * 220, y: (index - (ids.length - 1) / 2) * 90 }));
  });
  return positions;
}

function nodeCategory(node: GraphNode, view: GraphView): string {
  return view === 'aggregate' ? node.label : node.category || graphModuleName(node);
}

function aggregatePositions(graph: GraphData, width: number, height: number): Map<string, { x: number; y: number }> {
  const connected = new Set<string>();
  graph.edges.forEach((edge) => { connected.add(edge.source); connected.add(edge.target); });
  const core = graph.nodes.filter((node) => connected.has(node.id)).sort((a, b) => b.degree - a.degree);
  const satellites = graph.nodes.filter((node) => !connected.has(node.id)).sort((a, b) => b.degree - a.degree);
  const centerX = width / 2;
  const centerY = height / 2;
  const innerRadius = Math.min(width, height) * Math.min(0.24, 0.09 + core.length * 0.012);
  const outerRadiusX = Math.max(260, width * 0.39);
  const outerRadiusY = Math.max(210, height * 0.39);
  const positions = new Map<string, { x: number; y: number }>();

  core.forEach((node, index) => {
    if (index === 0 && core.length > 2) {
      positions.set(node.id, { x: centerX, y: centerY });
      return;
    }
    const ringIndex = core.length > 2 ? index - 1 : index;
    const ringCount = core.length > 2 ? core.length - 1 : core.length;
    const angle = -Math.PI / 2 + (ringIndex / Math.max(ringCount, 1)) * Math.PI * 2;
    positions.set(node.id, { x: centerX + Math.cos(angle) * innerRadius, y: centerY + Math.sin(angle) * innerRadius });
  });
  satellites.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(satellites.length, 1)) * Math.PI * 2;
    positions.set(node.id, { x: centerX + Math.cos(angle) * outerRadiusX, y: centerY + Math.sin(angle) * outerRadiusY });
  });
  return positions;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({ graphData, onNodeSelect, onEdgeStatusChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const optionRef = useRef<EChartsCoreOption | null>(null);
  const [view, setView] = useState<GraphView>('aggregate');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ edge: GraphEdge; index: number } | null>(null);
  const validGraph = useMemo(() => graphData ? sanitizeGraph(graphData) : null, [graphData]);
  const fallbackNodeId = useMemo(() => validGraph?.nodes.reduce<GraphNode | undefined>(
    (best, node) => !best || node.degree > best.degree ? node : best,
    undefined,
  )?.id ?? null, [validGraph]);
  const displayGraph = useMemo(() => {
    if (!validGraph) return null;
    if (view === 'aggregate' || view === 'matrix') return aggregateGraph(validGraph);
    const selectedExists = Boolean(selectedNodeId && validGraph.nodes.some((node) => node.id === selectedNodeId));
    if (view === 'local') return localGraph(validGraph, selectedExists ? selectedNodeId! : fallbackNodeId ?? '', 1);
    return validGraph;
  }, [fallbackNodeId, selectedNodeId, validGraph, view]);
  const matrix = useMemo(() => validGraph ? dependencyMatrix(validGraph) : null, [validGraph]);
  const categories = useMemo(() => displayGraph
    ? [...new Set(displayGraph.nodes.map((node) => nodeCategory(node, view)))]
    : [], [displayGraph, view]);

  const zoom = (factor: number) => chartRef.current?.dispatchAction({
    type: 'graphRoam', seriesIndex: 0, zoom: factor,
  });
  const resetView = () => {
    if (chartRef.current && optionRef.current) chartRef.current.setOption(optionRef.current, { notMerge: true });
  };

  useEffect(() => {
    if (!displayGraph || view === 'matrix' || view === 'sankey' || !containerRef.current) return;

    const container = containerRef.current;
    const chart = echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const maxWeight = Math.max(...displayGraph.edges.map((edge) => edge.weight), 1);
    const maxDegree = Math.max(...displayGraph.nodes.map((node) => node.degree), 1);
    const isLargeGraph = displayGraph.nodes.length > 180;
    const sortedByDegree = [...displayGraph.nodes].sort((a, b) => b.degree - a.degree);
    const labeledNodeIds = new Set(sortedByDegree.slice(0, isLargeGraph ? 24 : sortedByDegree.length).map((node) => node.id));
    const incidentCount = new Map(displayGraph.nodes.map((node) => [node.id, 0]));
    displayGraph.edges.forEach((edge) => {
      incidentCount.set(edge.source, (incidentCount.get(edge.source) ?? 0) + 1);
      incidentCount.set(edge.target, (incidentCount.get(edge.target) ?? 0) + 1);
    });
    const categoryIndex = new Map(categories.map((category, index) => [category, index]));
    const positions = view === 'layered'
      ? layeredPositions(displayGraph)
      : view === 'aggregate'
        ? aggregatePositions(displayGraph, container.clientWidth, container.clientHeight)
        : null;

    const option: EChartsCoreOption = {
      color: NODE_COLORS,
      animation: !isLargeGraph,
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: any) => {
          const data = params.data ?? {};
          if (params.dataType === 'node') return `<div style="padding:2px 4px;font-size:12px"><b>${escapeHtml(data.name)}</b><div style="color:#94a3b8;margin-top:4px">${escapeHtml(data.categoryName)} · 关联 ${data.incidentCount ?? 0} 条边 · 权重 ${data.degree ?? 0}</div></div>`;
          return `<div style="padding:2px 4px;font-size:11px">${data.label ? `关系：<b>${escapeHtml(data.label)}</b>` : `权重：<b>${data.value ?? 0}</b>`}</div>`;
        },
      },
      legend: { show: false, data: categories },
      series: [{
        type: 'graph',
        layout: positions ? 'none' : isLargeGraph ? 'circular' : 'force',
        data: displayGraph.nodes.map((node) => {
          const categoryName = nodeCategory(node, view);
          const position = positions?.get(node.id);
          const size = view === 'aggregate'
            ? 22 + Math.sqrt(node.degree / maxDegree) * 28
            : 18 + Math.sqrt(node.degree / maxDegree) * 24;
          return {
            id: node.id,
            name: node.label,
            value: node.degree,
            degree: node.degree,
            incidentCount: incidentCount.get(node.id) ?? 0,
            category: categoryIndex.get(categoryName) ?? 0,
            categoryName,
            symbolSize: size,
            x: position?.x,
            y: position?.y,
            label: { show: view === 'aggregate' || labeledNodeIds.has(node.id) },
            itemStyle: {
              borderColor: '#ffffff',
              borderWidth: 2,
              shadowBlur: view === 'aggregate' ? 10 : 5,
              shadowColor: 'rgba(30, 41, 59, 0.16)',
            },
          };
        }),
        links: displayGraph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          value: edge.weight,
          label: edge.label,
          graphEdge: edge,
          originalIndex: validGraph?.edges.indexOf(edge) ?? -1,
          lineStyle: {
            width: 0.7 + Math.sqrt(edge.weight / maxWeight) * 2.6,
            opacity: (isLargeGraph ? 0.05 : 0.12) + (edge.weight / maxWeight) * (isLargeGraph ? 0.14 : 0.34),
            curveness: view === 'aggregate' ? 0.12 : 0.04,
            type: edge.status === 'rejected' ? 'dashed' : 'solid',
            color: edge.status === 'rejected' ? '#ef4444' : undefined,
          },
        })),
        categories: categories.map((name) => ({ name })),
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        force: { repulsion: 900, edgeLength: [140, 260], gravity: 0.04, layoutAnimation: !isLargeGraph },
        circular: { rotateLabel: true },
        label: {
          position: 'right',
          distance: 7,
          color: '#334155',
          fontSize: 11,
          backgroundColor: 'rgba(255,255,255,0.82)',
          borderRadius: 3,
          padding: [2, 4],
          formatter: (params: any) => {
            const name = String(params.data?.name ?? '');
            return name.length > 24 ? `${name.slice(0, 22)}…` : name;
          },
        },
        edgeLabel: { show: false },
        lineStyle: { color: 'source' },
        emphasis: {
          focus: 'adjacency',
          scale: 1.12,
          lineStyle: { opacity: 0.85, width: 3 },
          label: { show: true, color: '#0f172a', fontWeight: 600 },
        },
        select: { itemStyle: { borderColor: '#0f172a', borderWidth: 4 } },
        selectedMode: 'single',
      }],
    };
    optionRef.current = option;
    chart.setOption(option);
    chart.on('click', (params: any) => {
      if (params.dataType === 'edge') {
        const edge = params.data?.graphEdge as GraphEdge | undefined;
        const index = Number(params.data?.originalIndex ?? -1);
        if (edge && index >= 0) setSelectedEdge({ edge, index });
        return;
      }
      if (params.dataType !== 'node') return;
      const id = String(params.data?.id ?? '');
      if (!validGraph?.nodes.some((node) => node.id === id)) return;
      setSelectedNodeId(id);
      onNodeSelect?.(id);
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (chartRef.current === chart) chartRef.current = null;
      chart.dispose();
    };
  }, [categories, displayGraph, onNodeSelect, validGraph, view]);

  if (!graphData) {
    return <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <GitBranch className="h-12 w-12 text-foreground" />
      <div className="text-center"><p className="text-sm font-medium">知识图谱</p><p className="mt-1 text-xs">选择对话文件，添加节点，然后生成图谱</p></div>
    </div>;
  }

  return <>
    <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
      <select className="h-7 rounded bg-transparent px-2 text-xs outline-none" value={view} onChange={(event) => setView(event.target.value as GraphView)}>
        <option value="aggregate">模块聚合</option><option value="layered">分层依赖</option><option value="local">局部关系</option><option value="sankey">桑基图</option><option value="matrix">依赖矩阵</option><option value="relation">完整关系</option>
      </select>
      {view === 'local' && <select className="h-7 max-w-56 rounded border-l border-border bg-transparent px-2 text-xs outline-none" value={selectedNodeId ?? fallbackNodeId ?? ''} onChange={(event) => setSelectedNodeId(event.target.value)}>
        {(validGraph?.nodes ?? []).slice().sort((a, b) => a.label.localeCompare(b.label)).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
      </select>}
    </div>

    {view === 'sankey' && validGraph ? <SankeyView graph={validGraph} /> : view === 'matrix' && matrix ? <div className="h-full w-full overflow-auto p-16">
      <table className="border-collapse text-[10px]">
        <thead><tr><th className="sticky left-0 bg-background p-1" />{matrix.labels.map((label) => <th key={label} className="max-w-20 rotate-[-45deg] whitespace-nowrap p-2 text-left font-normal">{label}</th>)}</tr></thead>
        <tbody>{matrix.labels.map((label, row) => <tr key={label}><th className="sticky left-0 z-[1] whitespace-nowrap bg-background p-1 text-right font-normal">{label}</th>{matrix.values[row].map((value, column) => <td key={column} className="h-7 w-7 border border-border text-center" title={`${label} → ${matrix.labels[column]}: ${value}`} style={{ backgroundColor: value ? `rgba(109, 40, 105, ${Math.min(.15 + value / 20, .9)})` : undefined, color: value ? 'white' : undefined }}>{value || ''}</td>)}</tr>)}</tbody>
      </table>
    </div> : <div ref={containerRef} className="h-full w-full flex-1" />}

    {view !== 'matrix' && view !== 'sankey' && <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
      {[
        { icon: ZoomIn, label: '放大', onClick: () => zoom(1.3) },
        { icon: ZoomOut, label: '缩小', onClick: () => zoom(0.7) },
        { icon: Maximize2, label: '适应画布', onClick: resetView },
        { icon: RotateCcw, label: '重置视图', onClick: resetView },
      ].map(({ icon: Icon, label, onClick }) => <button key={label} type="button" className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground" onClick={onClick} title={label}><Icon className="h-3.5 w-3.5" /></button>)}
    </div>}

    {selectedEdge && <aside className="absolute bottom-3 right-14 top-14 z-30 flex w-80 flex-col overflow-hidden rounded-lg border bg-background/95 shadow-xl backdrop-blur">
      <header className="flex items-start justify-between border-b p-3">
        <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{selectedEdge.edge.source} —{selectedEdge.edge.label || '关联'}→ {selectedEdge.edge.target}</h3><p className="mt-1 text-xs text-muted-foreground">置信度 {Math.round((selectedEdge.edge.confidence ?? .5) * 100)}% · {selectedEdge.edge.status ?? '未审核'}</p></div>
        <button className="ml-2 text-sm text-muted-foreground" onClick={() => setSelectedEdge(null)}>×</button>
      </header>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-xs">
        {(selectedEdge.edge.evidence ?? []).length === 0 ? <p className="text-muted-foreground">该关系没有保存证据。</p> : selectedEdge.edge.evidence?.map((item, index) => <section key={`${item.documentName}:${index}`} className="rounded border p-2">
          <p className="font-medium">{item.documentName}</p>{item.sourcePath && <p className="mt-1 break-all text-[11px] text-muted-foreground">{item.sourcePath}{item.page ? ` · 第 ${item.page} 页` : ''}{item.line ? ` · L${item.line}` : ''}</p>}{item.quote && <blockquote className="mt-2 border-l-2 pl-2 text-muted-foreground">{item.quote}</blockquote>}
        </section>)}
        {selectedEdge.edge.extractionModel && <p className="text-[11px] text-muted-foreground">模型：{selectedEdge.edge.extractionModel}{selectedEdge.edge.extractedAt ? ` · ${new Date(selectedEdge.edge.extractedAt).toLocaleString()}` : ''}</p>}
      </div>
      {onEdgeStatusChange && <footer className="flex justify-end gap-2 border-t p-3"><button className="h-8 rounded border px-3 text-xs" onClick={() => { onEdgeStatusChange(selectedEdge.index, 'rejected'); setSelectedEdge((current) => current ? { ...current, edge: { ...current.edge, status: 'rejected' } } : null); }}>拒绝</button><button className="h-8 rounded bg-primary px-3 text-xs text-primary-foreground" onClick={() => { onEdgeStatusChange(selectedEdge.index, 'accepted'); setSelectedEdge((current) => current ? { ...current, edge: { ...current.edge, status: 'accepted' } } : null); }}>接受</button></footer>}
    </aside>}

    {view !== 'matrix' && view !== 'sankey' && <div className="absolute bottom-3 left-3 z-10 space-y-1 rounded-md border border-border bg-muted/90 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
      <div className="mb-1 flex max-w-72 flex-wrap gap-x-3 gap-y-1">{categories.slice(0, 10).map((category, index) => <span key={category} className="flex items-center gap-1.5" title={category}><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: NODE_COLORS[index % NODE_COLORS.length] }} /><span className="max-w-28 truncate">{category}</span></span>)}</div>
      <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />节点大小 = 关联强度</div>
      <div className="flex items-center gap-1.5"><svg width="12" height="2"><line x1="0" y1="1" x2="12" y2="1" stroke="#94a3b8" strokeWidth="3" opacity="0.4" /></svg>边粗细与数字 = 关系权重</div>
    </div>}
  </>;
};
