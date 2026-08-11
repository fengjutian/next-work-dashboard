/**
 * GraphView — Workspace 内 Research Graph 可视化
 *
 * 节点类型（不同颜色 / shape）：
 *  - Document    — 蓝色圆形
 *  - Tab         — 橙色六边形
 *  - Annotation  — 紫色菱形
 *
 * 边：5 种 kind，分别染色
 *  - cited-by        — 蓝色
 *  - similar-to      — 紫色
 *  - searched-from   — 绿色
 *  - opened-from     — 橙色
 *  - saved-with      — 灰色
 * 布局：fcose 力导向
 * 交互：
 *  - 节点点击 → Document 调 onOpenDocument；Tab 调 onOpenDocument；Annotation 弹 detail 框
 *  - 边 hover 显示 kind + weight
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Empty, Select, Space, Tag, Typography, Button, Tooltip } from '../ui';
import { RotateCw, Maximize2, Highlighter, FileText, Globe } from 'lucide-react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { Annotation, Document, Tab } from '../../../core/work-browser/types';
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

const NODE_COLOR: Record<NodeKind, string> = {
  document: '#1677ff',
  tab: '#fa8c16',
  annotation: '#722ed1',
};
const NODE_SHAPE: Record<NodeKind, 'ellipse' | 'hexagon' | 'diamond' | 'round-rectangle'> = {
  document: 'ellipse',
  tab: 'hexagon',
  annotation: 'diamond',
};
const NODE_LABEL: Record<NodeKind, string> = {
  document: '文档',
  tab: 'Tab',
  annotation: '注释',
};

type NodeKind = 'document' | 'tab' | 'annotation';

const KIND_FILTERS: Array<{ value: 'all' | EdgeKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'cited-by', label: EDGE_LABEL['cited-by'] },
  { value: 'similar-to', label: EDGE_LABEL['similar-to'] },
  { value: 'searched-from', label: EDGE_LABEL['searched-from'] },
  { value: 'opened-from', label: EDGE_LABEL['opened-from'] },
  { value: 'saved-with', label: EDGE_LABEL['saved-with'] },
];

interface SelectedNode {
  kind: NodeKind;
  id: string;
  label: string;
  url?: string;
  note?: string;     // annotation
  rangeText?: string; // annotation
  color?: string;    // annotation
}

export interface GraphViewProps {
  workspaceId: string;
  documents: Document[];
  tabs?: Tab[];
  annotations?: Annotation[];
  onOpenDocument: (url: string) => void;
}

export function GraphView({ workspaceId, documents, tabs = [], annotations = [], onOpenDocument }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [edges, setEdges] = useState<PageEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | EdgeKind>('all');
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [showOnly, setShowOnly] = useState<'all' | NodeKind>('all');

  const docById = useMemo(() => {
    const m = new Map<string, Document>();
    for (const d of documents) m.set(d.id, d);
    return m;
  }, [documents]);
  const tabById = useMemo(() => {
    const m = new Map<string, Tab>();
    for (const t of tabs) m.set(t.id, t);
    return m;
  }, [tabs]);
  const annById = useMemo(() => {
    const m = new Map<string, Annotation>();
    for (const a of annotations) m.set(a.id, a);
    return m;
  }, [annotations]);

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

  // 构造 elements（节点 + 边）
  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes = new Map<string, ElementDefinition>();
    const pushNode = (kind: NodeKind, id: string, force = false) => {
      const key = `${kind}:${id}`;
      if (nodes.has(key)) return;
      if (showOnly !== 'all' && showOnly !== kind) return; // 节点类型过滤
      let label = id.slice(0, 8);
      let url: string | undefined;
      let orphan = false;
      if (kind === 'document') {
        const d = docById.get(id);
        label = d?.title || `缺失文档#${id.slice(0, 4)}`;
        url = d?.url;
        orphan = !d;
      } else if (kind === 'tab') {
        const t = tabById.get(id);
        label = t?.title || t?.url || `Tab#${id.slice(0, 4)}`;
        url = t?.url;
        orphan = !t;
      } else {
        const a = annById.get(id);
        label = a?.note?.slice(0, 24) || a?.rangeText?.slice(0, 24) || `注释#${id.slice(0, 4)}`;
        orphan = !a;
      }
      if (orphan && !force) return; // 孤儿且非边引用：跳过
      nodes.set(key, {
        data: { id: key, realId: id, kind, label, url, orphan },
        classes: `node-${kind}${orphan ? ' orphan' : ''}`,
      });
    };

    // 遍历边建节点
    for (const e of edges) {
      if (e.fromId === e.toId) continue; // 跳过自引用
      const fromKind = e.fromType as NodeKind;
      const toKind = e.toType as NodeKind;
      // 只画 document/tab/annotation 三种
      if (!['document', 'tab', 'annotation'].includes(fromKind)) continue;
      if (!['document', 'tab', 'annotation'].includes(toKind)) continue;
      pushNode(fromKind, e.fromId, true);
      pushNode(toKind, e.toId, true);
    }
    // 兜底：所有 documents / tabs / annotations 强制画（孤立点）
    for (const d of documents) pushNode('document', d.id, true);
    for (const t of tabs) pushNode('tab', t.id, true);
    for (const a of annotations) pushNode('annotation', a.id, true);

    const nodeList = Array.from(nodes.values());
    const edgeList: ElementDefinition[] = edges
      .filter((e) => e.fromId !== e.toId)
      .filter((e) => ['document', 'tab', 'annotation'].includes(e.fromType) && ['document', 'tab', 'annotation'].includes(e.toType))
      .filter((e) => {
        if (showOnly === 'all') return true;
        return e.fromType === showOnly || e.toType === showOnly;
      })
      .map((e) => ({
        data: {
          id: `edge:${e.id}`,
          source: `${e.fromType}:${e.fromId}`,
          target: `${e.toType}:${e.toId}`,
          kind: e.kind,
          weight: e.weight,
          label: `${EDGE_LABEL[e.kind]} (${e.weight})`,
        },
        classes: `edge-${e.kind}`,
      }));
    return [...nodeList, ...edgeList];
  }, [edges, documents, tabs, annotations, docById, tabById, annById, showOnly]);

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
              'label': 'data(label)',
              'color': '#222',
              'font-size': 10,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              'text-wrap': 'wrap',
              'text-max-width': 100,
              'width': 22,
              'height': 22,
              'border-width': 1.5,
              'border-color': '#fff',
            } as any,
          },
          { selector: 'node.node-document', style: { 'background-color': NODE_COLOR.document, 'shape': NODE_SHAPE.document } as any },
          { selector: 'node.node-tab', style: { 'background-color': NODE_COLOR.tab, 'shape': NODE_SHAPE.tab, 'width': 26, 'height': 22 } as any },
          { selector: 'node.node-annotation', style: { 'background-color': NODE_COLOR.annotation, 'shape': NODE_SHAPE.annotation, 'width': 20, 'height': 20 } as any },
          { selector: 'node.orphan', style: { 'background-color': '#bfbfbf', 'opacity': 0.5 } as any },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#fa541c' } as any },
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
              'text-rotation': 'autorotate',
              'text-background-color': '#fff',
              'text-background-opacity': 0.8,
              'text-background-padding': 2,
            } as any,
          },
          ...Object.entries(EDGE_COLOR).map(([kind, color]) => ({
            selector: `edge.edge-${kind}`,
            style: {
              'line-color': color,
              'target-arrow-color': color,
            } as any,
          })),
        ] as any,
        layout: { name: 'fcose', animate: false, randomize: true, nodeSeparation: 80 } as any,
        wheelSensitivity: 0.2,
        minZoom: 0.2,
        maxZoom: 3,
      });

      cyRef.current.on('tap', 'node', (evt) => {
        const node = evt.target;
        const key = node.id();
        const data = node.data() as any;
        const [kind, realId] = (key as string).split(':');
        const selected: SelectedNode = {
          kind: kind as NodeKind,
          id: realId,
          label: data.label as string,
          url: data.url as string | undefined,
        };
        if (kind === 'annotation') {
          const a = annById.get(realId);
          if (a) {
            selected.note = a.note;
            selected.rangeText = a.rangeText;
            selected.color = a.color;
          }
        }
        setSelected(selected);
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) setSelected(null);
      });
    }

    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    const layout = cy.layout({ name: 'fcose', animate: false, randomize: true, nodeSeparation: 80 } as any);
    layout.run();

    return () => {
      // 组件卸载时销毁（见下面 effect）
    };
  }, [elements, annById]);

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
              value={showOnly}
              onChange={(v) => setShowOnly(v as 'all' | NodeKind)}
              options={[
                { value: 'all', label: '所有节点' },
                { value: 'document', label: '仅文档' },
                { value: 'tab', label: '仅 Tab' },
                { value: 'annotation', label: '仅注释' },
              ]}
              style={{ width: 100 }}
            />
            <Select
              size="small"
              value={filter}
              onChange={(v) => setFilter(v as 'all' | EdgeKind)}
              options={KIND_FILTERS}
              style={{ width: 90 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {nodeCount} 节点 · {edgeCount} 边
            </Typography.Text>
          </Space>
        </Space>
      </div>

      <div ref={containerRef} style={{ flex: 1, background: '#fafafa', minHeight: 200 }} />

      {selected && (
        <div style={{ padding: 8, borderTop: '1px solid #f0f0f0', background: '#fff' }}>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space size={4}>
              <Tag color={NODE_COLOR[selected.kind]} style={{ fontSize: 10, margin: 0 }}>
                {selected.kind === 'document' ? <FileText size={10} /> : selected.kind === 'tab' ? <Globe size={10} /> : <Highlighter size={10} />}
                {' '}{NODE_LABEL[selected.kind]}
              </Tag>
              <Typography.Text strong style={{ fontSize: 12 }} ellipsis>
                {selected.label}
              </Typography.Text>
            </Space>
            {selected.kind === 'annotation' && (
              <>
                {selected.rangeText && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 10, marginBottom: 0, fontStyle: 'italic' }} ellipsis>
                    “{selected.rangeText}”
                  </Typography.Paragraph>
                )}
                {selected.note && (
                  <Typography.Paragraph style={{ fontSize: 11, marginBottom: 0, padding: 4, background: '#fafafa', borderRadius: 4 }} ellipsis>
                    📝 {selected.note}
                  </Typography.Paragraph>
                )}
              </>
            )}
            {selected.url && (
              <Space size={4}>
                <Typography.Text type="secondary" style={{ fontSize: 10 }} ellipsis>{selected.url}</Typography.Text>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => onOpenDocument(selected.url!)}
                >
                  打开
                </Button>
              </Space>
            )}
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
        {Object.entries(NODE_LABEL).map(([k, label]) => (
          <Tag key={k} color={NODE_COLOR[k as NodeKind]} style={{ fontSize: 10, margin: 0 }}>
            {label}
          </Tag>
        ))}
      </div>
    </div>
  );
}
