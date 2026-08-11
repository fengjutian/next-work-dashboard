/**
 * GraphView — Workspace 内 Research Graph 可视化
 *
 * 节点：Document（来自 props.documents；边中引用到但本地不存在的也画为"孤儿"灰色节点）
 * 边：5 种 kind，分别染色
 *  - cited-by        — 蓝色
 *  - similar-to      — 紫色
 *  - searched-from   — 绿色
 *  - opened-from     — 橙色
 *  - saved-with      — 灰色
 * 布局：fcose 力导向
 * 交互：节点点击 → 调 onOpenDocument(url)；hover 显示 metadata
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Select, Space, Tag, Typography, Button, Tooltip } from 'antd';
import { RotateCw, Maximize2 } from 'lucide-react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { Document, DocumentId } from '../../../core/work-browser/types';
import type { PageEdge, EdgeKind } from '../../../core/work-browser/graph/edges';

// 注册 fcose layout（幂等）
let fcoseRegistered = false;
function ensureFcoseRegistered() {
  if (fcoseRegistered) return;
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

const EDGE_COLOR: Record<EdgeKind, string> = {
  'cited-by': '#1677ff',
  'similar-to': '#722ed1',
  'searched-from': '#52c41a',
  'opened-from': '#fa8c16',
  'saved-with': '#8c8c8c',
};
const EDGE_LABEL: Record<EdgeKind, string> = {
  'cited-by': '引用',
  'similar-to': '相似',
  'searched-from': '搜索',
  'opened-from': '打开',
  'saved-with': '同存',
};

const KIND_FILTERS: Array<{ value: 'all' | EdgeKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'cited-by', label: EDGE_LABEL['cited-by'] },
  { value: 'similar-to', label: EDGE_LABEL['similar-to'] },
  { value: 'searched-from', label: EDGE_LABEL['searched-from'] },
  { value: 'opened-from', label: EDGE_LABEL['opened-from'] },
  { value: 'saved-with', label: EDGE_LABEL['saved-with'] },
];

export interface GraphViewProps {
  workspaceId: string;
  documents: Document[];
  onOpenDocument: (url: string) => void;
}

export function GraphView({ workspaceId, documents, onOpenDocument }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [edges, setEdges] = useState<PageEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | EdgeKind>('all');
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; url?: string } | null>(null);

  const docById = useMemo(() => {
    const m = new Map<DocumentId, Document>();
    for (const d of documents) m.set(d.id, d);
    return m;
  }, [documents]);

  // 拉取边
  const refresh = async () => {
    setLoading(true);
    try {
      const kindArg = filter === 'all' ? undefined : filter;
      const data = (await window.electronAPI.workBrowser.graph.listByWorkspace(workspaceId, kindArg)) as PageEdge[];
      setEdges(data);
    } catch (e) {
      console.error('[GraphView] listByWorkspace failed', e);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [workspaceId, filter]);

  // 构造 elements
  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes = new Map<string, ElementDefinition>();
    const pushDoc = (id: string) => {
      if (nodes.has(id)) return;
      const doc = docById.get(id);
      nodes.set(id, {
        data: {
          id,
          label: doc?.title || id.slice(0, 8),
          url: doc?.url,
          orphan: !doc,
        },
        classes: doc ? 'doc' : 'orphan',
      });
    };

    for (const e of edges) {
      // 只画 document-document 边（tab/annotation 留 Phase 4）
      if (e.fromType !== 'document' || e.toType !== 'document') continue;
      // 自引用边（如 cited-by 记录 search 来源）跳过
      if (e.fromId === e.toId) continue;
      pushDoc(e.fromId);
      pushDoc(e.toId);
    }
    // 兜底：documents 里没在边里出现的也画（孤立 doc）
    for (const d of documents) pushDoc(d.id);

    const nodeList = Array.from(nodes.values());
    const edgeList: ElementDefinition[] = edges
      .filter((e) => e.fromType === 'document' && e.toType === 'document' && e.fromId !== e.toId)
      .map((e) => ({
        data: {
          id: e.id,
          source: e.fromId,
          target: e.toId,
          kind: e.kind,
          weight: e.weight,
          label: `${EDGE_LABEL[e.kind]} (${e.weight})`,
        },
        classes: `edge-${e.kind}`,
      }));
    return [...nodeList, ...edgeList];
  }, [edges, documents, docById]);

  // 初始化 / 更新 cytoscape
  useEffect(() => {
    ensureFcoseRegistered();
    if (!containerRef.current) return;
    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [],
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#1677ff',
              'label': 'data(label)',
              'color': '#222',
              'font-size': 10,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              'text-wrap': 'wrap' as any,
              'text-max-width': 100 as any,
              'width': 24,
              'height': 24,
              'border-width': 1,
              'border-color': '#fff',
            },
          },
          { selector: 'node.orphan', style: { 'background-color': '#bfbfbf', 'opacity': 0.5 } },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#fa541c' } },
          {
            selector: 'edge',
            style: {
              'width': 'mapData(weight, 1, 10, 1, 6)',
              'line-color': '#8c8c8c',
              'target-arrow-color': '#8c8c8c',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'label': 'data(label)',
              'font-size': 9,
              'color': '#595959',
              'text-rotation': 'autorotate' as any,
              'text-background-color': '#fff',
              'text-background-opacity': 0.8,
              'text-background-padding': 2,
            },
          },
          ...Object.entries(EDGE_COLOR).map(([kind, color]) => ({
            selector: `edge.edge-${kind}`,
            style: {
              'line-color': color,
              'target-arrow-color': color,
            },
          })),
        ],
        layout: { name: 'fcose', animate: false, randomize: true, nodeSeparation: 80 } as any,
        wheelSensitivity: 0.2,
        minZoom: 0.2,
        maxZoom: 3,
      });

      cyRef.current.on('tap', 'node', (evt) => {
        const node = evt.target;
        const id = node.id();
        const label = node.data('label') as string;
        const url = node.data('url') as string | undefined;
        setSelectedNode({ id, label, url });
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) setSelectedNode(null);
      });
    }

    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    const layout = cy.layout({ name: 'fcose', animate: false, randomize: true, nodeSeparation: 80 } as any);
    layout.run();

    return () => {
      // 组件卸载时销毁
    };
  }, [elements]);

  // 卸载
  useEffect(() => {
    return () => {
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    };
  }, []);

  const fit = () => cyRef.current?.fit(undefined, 30);
  const redraw = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const layout = cy.layout({ name: 'fcose', animate: true, randomize: true, nodeSeparation: 80 } as any);
    layout.run();
  };

  const nodeCount = elements.filter((e) => !('source' in e.data)).length;
  const edgeCount = elements.length - nodeCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>🔗 Research Graph</Typography.Text>
            <Space size={4}>
              <Tooltip title="重新布局">
                <Button size="small" icon={<RotateCw size={12} />} onClick={redraw} />
              </Tooltip>
              <Tooltip title="适应屏幕">
                <Button size="small" icon={<Maximize2 size={12} />} onClick={fit} />
              </Tooltip>
            </Space>
          </Space>
          <Space size={4} wrap>
            <Select
              size="small"
              value={filter}
              onChange={(v) => setFilter(v as 'all' | EdgeKind)}
              options={KIND_FILTERS}
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {nodeCount} 节点 · {edgeCount} 边
            </Typography.Text>
          </Space>
        </Space>
      </div>

      <div ref={containerRef} style={{ flex: 1, background: '#fafafa', minHeight: 200 }} />

      {selectedNode && (
        <div style={{ padding: 8, borderTop: '1px solid #f0f0f0', background: '#fff' }}>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text strong style={{ fontSize: 12 }} ellipsis>
              {selectedNode.label}
            </Typography.Text>
            {selectedNode.url && (
              <Typography.Text type="secondary" style={{ fontSize: 10 }} ellipsis>
                {selectedNode.url}
              </Typography.Text>
            )}
            <Space size={4}>
              <Button
                size="small"
                type="primary"
                disabled={!selectedNode.url}
                onClick={() => selectedNode.url && onOpenDocument(selectedNode.url)}
              >
                打开
              </Button>
            </Space>
          </Space>
        </div>
      )}

      {!loading && edges.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有边 — 保存页面、搜索、打开 Tab 后会建立引用" />
        </div>
      )}

      <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(EDGE_LABEL).map(([k, label]) => (
          <Tag key={k} color={EDGE_COLOR[k as EdgeKind]} style={{ fontSize: 10, margin: 0 }}>
            {label}
          </Tag>
        ))}
      </div>
    </div>
  );
}
