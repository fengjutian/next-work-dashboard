import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Plus, X, Search, FileText, GitBranch,
  ZoomIn, ZoomOut, Maximize2, RotateCcw,
} from 'lucide-react';
import { Graph } from '@antv/g6';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile } from '@/types/electron';

// ── 图谱数据类型 ──

interface GraphNode {
  id: string;
  label: string;
  degree: number; // 相连边数
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── 常量 ──

const defaultNodes = [
  'React', 'TypeScript', 'Electron', 'Zustand',
  'Vite', 'Tailwind', 'SQLite', 'Drizzle',
];

// ── 调色板 ──

const NODE_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#06b6d4', '#f97316', '#ef4444',
  '#6366f1', '#14b8a6',
];

// ── 对话文件列表项 ──

const FileCheckItem: React.FC<{
  file: ConversationFile;
  checked: boolean;
  onChange: (path: string, checked: boolean) => void;
}> = ({ file, checked, onChange }) => {
  return (
    <label
      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs border-b border-zinc-100 dark:border-zinc-800 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
        checked ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(file.path, e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
      />
      <div className="flex-1 min-w-0">
        <div className="truncate">{file.title || file.fileName}</div>
        <div className="text-[10px] text-zinc-400">{file.date}</div>
      </div>
    </label>
  );
};

// ── 主组件 ──

export const KnowledgeGraph: React.FC = () => {
  const { toast } = useToast();
  const conversationSavedAt = useStore((s) => s.conversationSavedAt);

  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [nodeInput, setNodeInput] = useState('');
  const [nodes, setNodes] = useState<string[]>([...defaultNodes]);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [generating, setGenerating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  // ── 加载对话文件列表 ──

  const loadFiles = useCallback(async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api?.listConversations) return;
      const list = await api.listConversations();
      setFiles(list);
    } catch (err) {
      console.error('[KnowledgeGraph] loadFiles failed:', err);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles, conversationSavedAt]);

  // ── 切换文件选中 ──

  const toggleFile = useCallback((path: string, checked: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      checked ? next.add(path) : next.delete(path);
      return next;
    });
  }, []);

  // ── 节点管理 ──

  const addNode = useCallback(() => {
    const name = nodeInput.trim();
    if (!name) return;
    if (nodes.includes(name)) { toast('节点已存在', 'error'); return; }
    setNodes((prev) => [...prev, name]);
    setNodeInput('');
  }, [nodeInput, nodes, toast]);

  const removeNode = useCallback((name: string) => {
    setNodes((prev) => prev.filter((n) => n !== name));
  }, []);

  const handleNodeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addNode(); }
  }, [addNode]);

  // ── 生成图谱 ──

  const generateGraph = useCallback(async () => {
    const selected = files.filter((f) => selectedPaths.has(f.path));
    if (selected.length === 0) { toast('请至少选择一篇对话', 'error'); return; }
    if (nodes.length < 2) { toast('请至少添加 2 个节点', 'error'); return; }

    setGenerating(true);
    try {
      const api = (window as any).electronAPI;
      if (!api?.readConversation) return;

      const contents: string[] = [];
      for (const file of selected) {
        const result = await api.readConversation(file.path);
        if (result.success && result.content) contents.push(result.content);
      }
      if (contents.length === 0) { toast('未能读取任何对话内容', 'error'); return; }

      const edgeMap = new Map<string, number>();
      for (const content of contents) {
        const lowerContent = content.toLowerCase();
        const present = nodes.filter((n) => lowerContent.includes(n.toLowerCase()));
        for (let i = 0; i < present.length; i++) {
          for (let j = i + 1; j < present.length; j++) {
            const [a, b] = present[i] < present[j] ? [present[i], present[j]] : [present[j], present[i]];
            const key = `${a}||${b}`;
            edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
          }
        }
      }

      // 计算节点度数
      const degreeMap = new Map<string, number>();
      nodes.forEach((n) => degreeMap.set(n, 0));
      edgeMap.forEach((w, key) => {
        const [s, t] = key.split('||');
        degreeMap.set(s, (degreeMap.get(s) ?? 0) + w);
        degreeMap.set(t, (degreeMap.get(t) ?? 0) + w);
      });

      const graphNodes: GraphNode[] = nodes.map((n) => ({
        id: n,
        label: n,
        degree: degreeMap.get(n) ?? 0,
      }));

      const graphEdges: GraphEdge[] = [];
      edgeMap.forEach((weight, key) => {
        const [source, target] = key.split('||');
        graphEdges.push({ source, target, weight });
      });

      setGraphData({ nodes: graphNodes, edges: graphEdges });
      toast(`生成完成：${graphNodes.length} 个节点，${graphEdges.length} 条边`, 'success');
    } catch (err) {
      console.error('[KnowledgeGraph] generate failed:', err);
      toast('生成图谱失败', 'error');
    } finally {
      setGenerating(false);
    }
  }, [files, selectedPaths, nodes, toast]);

  // ── G6 工具栏操作 ──

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
          data: { weight: e.weight },
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
            return wgt > 0 ? String(wgt) : '';
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
                共现权重: <b>${d?.weight ?? 0}</b>
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
  }, [graphData]);

  // ── 全选/取消全选 ──

  const toggleAll = useCallback(() => {
    if (selectedPaths.size === files.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(files.map((f) => f.path)));
    }
  }, [files, selectedPaths]);

  // ── 渲染 ──

  return (
    <div className="flex h-full">
      {/* 左侧配置面板 */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col bg-zinc-50 dark:bg-zinc-900">
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              对话文件 ({selectedPaths.size}/{files.length})
            </span>
            <div className="flex items-center gap-1">
              <button
                className="text-[10px] px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                onClick={toggleAll}
              >
                {selectedPaths.size === files.length ? '取消全选' : '全选'}
              </button>
              <button
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
                onClick={loadFiles}
                title="刷新"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
                <FileText className="h-6 w-6" />
                <p className="text-xs">暂无对话记录</p>
              </div>
            ) : (
              files.map((f) => (
                <FileCheckItem
                  key={f.path}
                  file={f}
                  checked={selectedPaths.has(f.path)}
                  onChange={toggleFile}
                />
              ))
            )}
          </div>
        </div>

        {/* 节点编辑区 */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">图谱节点</span>
            <button
              className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              onClick={() => setNodes([...defaultNodes])}
              title="重置为默认节点"
            >
              重置默认
            </button>
          </div>

          <div className="flex gap-1">
            <input
              type="text"
              value={nodeInput}
              onChange={(e) => setNodeInput(e.target.value)}
              onKeyDown={handleNodeKeyDown}
              placeholder="输入节点名称…"
              className="flex-1 h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-400"
            />
            <button
              className="h-7 w-7 flex items-center justify-center rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
              onClick={addNode}
              title="添加节点"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {nodes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {nodes.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                >
                  {name}
                  <button
                    className="hover:text-red-500 transition-colors"
                    onClick={() => removeNode(name)}
                    title="删除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <button
            className="w-full h-8 flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
            disabled={generating || nodes.length < 2 || selectedPaths.size === 0}
            onClick={generateGraph}
          >
            <Search className="h-4 w-4" />
            {generating ? '生成中…' : '生成图谱'}
          </button>
        </div>
      </div>

      {/* 右侧图谱区 */}
      <div className="flex-1 flex flex-col bg-white dark:bg-zinc-950 overflow-hidden relative">
        {graphData ? (
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
                  className="h-7 w-7 flex items-center justify-center rounded-md bg-white/90 dark:bg-zinc-800/90 backdrop-blur border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 shadow-sm transition-colors"
                  onClick={onClick}
                  title={label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>

            {/* 图例浮层 */}
            <div className="absolute bottom-3 left-3 z-10 bg-white/90 dark:bg-zinc-800/90 backdrop-blur border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 shadow-sm text-[10px] text-zinc-500 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-zinc-300" /> 节点大小 = 关联强度
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="12" height="2"><line x1="0" y1="1" x2="12" y2="1" stroke="#94a3b8" strokeWidth="3" opacity="0.4"/></svg>
                {' '}← 边粗细 & 数字 = 共现次数
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 gap-3">
            <GitBranch className="h-12 w-12 text-zinc-300" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-500">知识图谱</p>
              <p className="text-xs mt-1">选择对话文件，添加节点，然后生成图谱</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
