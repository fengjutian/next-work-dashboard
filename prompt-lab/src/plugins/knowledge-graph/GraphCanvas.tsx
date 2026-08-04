import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Graph, type IEvent } from '@antv/g6';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, GitBranch } from '@/components/icons';
import type { GraphData, GraphNode } from './graph-types';
import { aggregateGraph, dependencyMatrix, localGraph, sanitizeGraph } from './graph-views';
import { SankeyView } from './SankeyView';

type GraphView = 'relation' | 'layered' | 'aggregate' | 'local' | 'matrix' | 'sankey';

// ── 调色板 ──

const NODE_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#06b6d4', '#f97316', '#ef4444',
  '#6366f1', '#14b8a6',
];

interface GraphCanvasProps {
  graphData: GraphData | null;
  onNodeSelect?: (nodeId: string) => void;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({ graphData, onNodeSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const [view, setView] = useState<GraphView>('aggregate');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  // ── 工具栏操作 ──
  const zoomIn = () => graphRef.current?.zoomBy(1.3);
  const zoomOut = () => graphRef.current?.zoomBy(0.7);
  const fitView = () => graphRef.current?.fitView();
  const resetView = () => {
    graphRef.current?.zoomTo(1);
    graphRef.current?.fitView();
  };

  // ── 渲染 G6 ──
  useEffect(() => {
    if (!displayGraph || view === 'matrix' || view === 'sankey' || !containerRef.current) return;

    const container = containerRef.current;
    const { clientWidth: w, clientHeight: h } = container;

    const maxWeight = Math.max(...displayGraph.edges.map((e) => e.weight), 1);
    const maxDegree = Math.max(...displayGraph.nodes.map((n) => n.degree), 1);
    const minSize = 28;
    const maxSize = 48;
    const isLargeGraph = displayGraph.nodes.length > 180;
    const incidentEdges = new Map<string, typeof displayGraph.edges>();
    displayGraph.nodes.forEach((node) => incidentEdges.set(node.id, []));
    displayGraph.edges.forEach((edge) => {
      incidentEdges.get(edge.source)?.push(edge);
      incidentEdges.get(edge.target)?.push(edge);
    });

    // 按度数分配颜色
    const sortedByDegree = [...displayGraph.nodes].sort((a, b) => b.degree - a.degree);
    const colorMap = new Map<string, string>();
    sortedByDegree.forEach((n, i) => {
      colorMap.set(n.id, NODE_COLORS[i % NODE_COLORS.length]);
    });
    const labeledNodeIds = new Set(sortedByDegree.slice(0, isLargeGraph ? 24 : sortedByDegree.length).map((node) => node.id));

    const graph = new Graph({
      container,
      width: w,
      height: h,
      autoFit: 'view',
      padding: [40, 100, 40, 40],
      data: {
        nodes: displayGraph.nodes.map((n) => ({
          id: n.id,
          data: { label: n.label, degree: n.degree, edges: incidentEdges.get(n.id) ?? [] },
        })),
        edges: displayGraph.edges.map((e, index) => ({
          // G6 默认使用 source-target 作为边 ID；同一对节点的“定义/调用”等
          // 平行关系会因此冲突。显式 ID 同时保留关系类型和原始序号。
          id: `${e.source}->${e.target}:${e.kind ?? 'edge'}:${e.label ?? ''}:${index}`,
          source: e.source,
          target: e.target,
          data: { weight: e.weight, label: e.label, kind: e.kind },
        })),
      },
      layout: view === 'layered'
        ? { type: 'dagre', rankdir: 'LR', nodesep: 28, ranksep: 70 }
        : isLargeGraph
        ? { type: 'circular' }
        : { type: 'd3-force', linkDistance: 150, nodeStrength: -300, collide: { radius: 50 }, animate: true },
      node: {
        style: {
          size: (d: any) => {
            const deg: number = d.data?.degree ?? 0;
            return minSize + (deg / maxDegree) * (maxSize - minSize);
          },
          fill: (d: any) => colorMap.get(d.id) ?? '#3b82f6',
          stroke: (d: any) => colorMap.get(d.id) ?? '#3b82f6',
          lineWidth: 0,
          fillOpacity: 0.9,
          labelText: (d: any) => labeledNodeIds.has(d.id) ? d.data?.label ?? d.id : '',
          labelPlacement: 'bottom',
          labelOffsetY: 4,
          labelFontSize: 11,
          labelFontWeight: 500,
          labelFill: '#475569',
          labelBackground: true,
          labelBackgroundFill: '#fff',
          labelBackgroundRadius: 3,
          labelBackgroundOpacity: 0.85,
          shadowBlur: 4,
          shadowColor: 'rgba(0,0,0,0.08)',
          shadowOffsetX: 0,
          shadowOffsetY: 2,
        },
        state: {
          active: {
            lineWidth: 3,
            stroke: '#1e40af',
            fillOpacity: 1,
            shadowBlur: 8,
            shadowColor: 'rgba(0,0,0,0.18)',
          },
        },
      },
      edge: {
        style: {
          stroke: (d: any) => {
            const wgt: number = d.data?.weight ?? 1;
            const alpha = (isLargeGraph ? 0.04 : 0.15) + (wgt / maxWeight) * (isLargeGraph ? 0.16 : 0.55);
            return `rgba(100, 116, 139, ${alpha.toFixed(2)})`;
          },
          lineWidth: (d: any) => {
            const wgt: number = d.data?.weight ?? 1;
            return 0.8 + (wgt / maxWeight) * 4;
          },
          endArrow: false,
          labelText: (d: any) => {
            const wgt: number = d.data?.weight ?? 0;
            return isLargeGraph ? '' : d.data?.label || (wgt > 0 ? String(wgt) : '');
          },
          labelFontSize: 10,
          labelFill: '#94a3b8',
          labelBackground: true,
          labelBackgroundFill: '#fff',
          labelBackgroundRadius: 2,
          labelBackgroundOpacity: 0.8,
          labelOffsetY: -4,
        },
      },
      plugins: [
        {
          type: 'tooltip',
          getContent: (_event: any, items: any[]) => {
            if (!items?.length) return '';
            const item = items[0];
            if (item.type === 'node') {
              const d = item.data?.data;
              const edges = d?.edges ?? [];
              return `<div style="padding:6px 10px;font-size:12px">
                <b>${d?.label ?? item.id}</b>
                <div style="color:#94a3b8;margin-top:4px">
                  关联 ${edges.length} 条边 · 权重 ${d?.degree ?? 0}
                </div>
              </div>`;
            }
            if (item.type === 'edge') {
              const d = item.data?.data;
              return `<div style="padding:4px 10px;font-size:11px;color:#475569">
                ${d?.label ? `关系: <b>${d.label}</b>` : `共现权重: <b>${d?.weight ?? 0}</b>`}
              </div>`;
            }
            return '';
          },
        },
        ...(!isLargeGraph ? [{ type: 'minimap', size: [200, 140] as [number, number], padding: 8 }] : []),
      ],
      behaviors: [
        'drag-element',
        'drag-canvas',
        'zoom-canvas',
        'hover-activate',
        { type: 'scroll-canvas', sensitivity: 1 },
      ],
      animation: !isLargeGraph,
    });

    graph.on('node:click', (event: IEvent) => {
      if ('target' in event && event.target && 'id' in event.target) {
        const id = String(event.target.id);
        if (validGraph?.nodes.some((node) => node.id === id)) {
          setSelectedNodeId(id);
          onNodeSelect?.(id);
        }
      }
    });
    graphRef.current = graph;
    let disposed = false;
    let renderFinished = false;
    const renderPromise = Promise.resolve(graph.render())
      .catch((error) => { if (!disposed) console.error('[GraphCanvas] render failed:', error); })
      .finally(() => {
        renderFinished = true;
        if (disposed) graph.destroy();
      });

    const onResize = () => {
      if (!containerRef.current) return;
      graph.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      if (graphRef.current === graph) graphRef.current = null;
      if (renderFinished) graph.destroy();
      else void renderPromise;
    };
  }, [displayGraph, onNodeSelect, validGraph, view]);

  // ── 空状态 ──
  if (!graphData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <GitBranch className="h-12 w-12 text-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground">知识图谱</p>
          <p className="text-xs mt-1">选择对话文件，添加节点，然后生成图谱</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
        <select className="h-7 rounded bg-transparent px-2 text-xs outline-none" value={view} onChange={(event) => setView(event.target.value as GraphView)}>
          <option value="aggregate">模块聚合</option><option value="layered">分层依赖</option><option value="local">局部关系</option><option value="sankey">桑基图</option><option value="matrix">依赖矩阵</option><option value="relation">完整关系</option>
        </select>
        {view === 'local' && <select className="h-7 max-w-56 rounded border-l border-border bg-transparent px-2 text-xs outline-none" value={selectedNodeId ?? fallbackNodeId ?? ''} onChange={(event) => setSelectedNodeId(event.target.value)}>
          {(validGraph?.nodes ?? []).slice().sort((a, b) => a.label.localeCompare(b.label)).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>}
      </div>

      {/* G6 画布 */}
      {view === 'sankey' && validGraph ? <SankeyView graph={validGraph} /> : view === 'matrix' && matrix ? <div className="h-full w-full overflow-auto p-16">
        <table className="border-collapse text-[10px]">
          <thead><tr><th className="sticky left-0 bg-background p-1" />{matrix.labels.map((label) => <th key={label} className="max-w-20 rotate-[-45deg] whitespace-nowrap p-2 text-left font-normal">{label}</th>)}</tr></thead>
          <tbody>{matrix.labels.map((label, row) => <tr key={label}><th className="sticky left-0 z-[1] whitespace-nowrap bg-background p-1 text-right font-normal">{label}</th>{matrix.values[row].map((value, column) => <td key={column} className="h-7 w-7 border border-border text-center" title={`${label} → ${matrix.labels[column]}: ${value}`} style={{ backgroundColor: value ? `rgba(109, 40, 105, ${Math.min(.15 + value / 20, .9)})` : undefined, color: value ? 'white' : undefined }}>{value || ''}</td>)}</tr>)}</tbody>
        </table>
      </div> : <div ref={containerRef} className="h-full w-full flex-1" />}

      {/* 工具栏浮层 */}
      {view !== 'matrix' && view !== 'sankey' && <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
        {[
          { icon: ZoomIn, label: '放大', onClick: zoomIn },
          { icon: ZoomOut, label: '缩小', onClick: zoomOut },
          { icon: Maximize2, label: '适应画布', onClick: fitView },
          { icon: RotateCcw, label: '重置视图', onClick: resetView },
        ].map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 bg-muted/90 backdrop-blur border border-border text-muted-foreground hover:text-foreground dark:hover:text-foreground shadow-sm transition-colors"
            onClick={onClick}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>}

      {/* 图例浮层 */}
      {view !== 'matrix' && view !== 'sankey' && <div className="absolute bottom-3 left-3 z-10 bg-white/90 bg-muted/90 backdrop-blur border border-border rounded-md px-3 py-2 shadow-sm text-[10px] text-muted-foreground space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" /> 节点大小 = 关联强度
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="12" height="2"><line x1="0" y1="1" x2="12" y2="1" stroke="#94a3b8" strokeWidth="3" opacity="0.4"/></svg>
          {' '}← 边粗细 & 数字 = 共现次数
        </div>
      </div>}
    </>
  );
};
