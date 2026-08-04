import React, { useEffect, useRef } from 'react';
import { Graph, type IEvent } from '@antv/g6';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, GitBranch } from '@/components/icons';
import type { GraphData } from './graph-types';

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
    if (!graphData || !containerRef.current) return;

    if (graphRef.current) { graphRef.current.destroy(); graphRef.current = null; }

    const container = containerRef.current;
    const { clientWidth: w, clientHeight: h } = container;

    const maxWeight = Math.max(...graphData.edges.map((e) => e.weight), 1);
    const maxDegree = Math.max(...graphData.nodes.map((n) => n.degree), 1);
    const minSize = 28;
    const maxSize = 48;

    // 按度数分配颜色
    const sortedByDegree = [...graphData.nodes].sort((a, b) => b.degree - a.degree);
    const colorMap = new Map<string, string>();
    sortedByDegree.forEach((n, i) => {
      colorMap.set(n.id, NODE_COLORS[i % NODE_COLORS.length]);
    });

    const graph = new Graph({
      container,
      width: w,
      height: h,
      autoFit: 'view',
      padding: [40, 100, 40, 40],
      data: {
        nodes: graphData.nodes.map((n) => ({
          id: n.id,
          data: { label: n.label, degree: n.degree, edges: graphData.edges.filter((e) => e.source === n.id || e.target === n.id) },
        })),
        edges: graphData.edges.map((e) => ({
          source: e.source,
          target: e.target,
          data: { weight: e.weight, label: e.label, kind: e.kind },
        })),
      },
      layout: {
        type: 'd3-force',
        linkDistance: 150,
        nodeStrength: -300,
        collide: { radius: 50 },
        animate: true,
      },
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
          labelText: (d: any) => d.data?.label ?? d.id,
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
            const alpha = 0.15 + (wgt / maxWeight) * 0.55;
            return `rgba(100, 116, 139, ${alpha.toFixed(2)})`;
          },
          lineWidth: (d: any) => {
            const wgt: number = d.data?.weight ?? 1;
            return 0.8 + (wgt / maxWeight) * 4;
          },
          endArrow: false,
          labelText: (d: any) => {
            const wgt: number = d.data?.weight ?? 0;
            return d.data?.label || (wgt > 0 ? String(wgt) : '');
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
        { type: 'minimap', size: [200, 140], padding: 8 },
      ],
      behaviors: [
        'drag-element',
        'drag-canvas',
        'zoom-canvas',
        'hover-activate',
        { type: 'scroll-canvas', sensitivity: 1 },
      ],
      animation: true,
    });

    if (onNodeSelect) graph.on('node:click', (event: IEvent) => {
      if ('target' in event && event.target && 'id' in event.target) onNodeSelect(String(event.target.id));
    });
    graph.render();
    graphRef.current = graph;

    const onResize = () => {
      if (!containerRef.current) return;
      graph.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      graph.destroy();
      graphRef.current = null;
    };
  }, [graphData, onNodeSelect]);

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
      {/* G6 画布 */}
      <div ref={containerRef} className="flex-1 w-full h-full" />

      {/* 工具栏浮层 */}
      <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
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
      </div>

      {/* 图例浮层 */}
      <div className="absolute bottom-3 left-3 z-10 bg-white/90 bg-muted/90 backdrop-blur border border-border rounded-md px-3 py-2 shadow-sm text-[10px] text-muted-foreground space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" /> 节点大小 = 关联强度
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="12" height="2"><line x1="0" y1="1" x2="12" y2="1" stroke="#94a3b8" strokeWidth="3" opacity="0.4"/></svg>
          {' '}← 边粗细 & 数字 = 共现次数
        </div>
      </div>
    </>
  );
};
