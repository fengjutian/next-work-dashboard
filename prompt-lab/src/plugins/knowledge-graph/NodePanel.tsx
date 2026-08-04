import React from 'react';
import { Plus, X } from '@/components/icons';
import type { GraphNode } from './graph-types';

// ── 单个节点标签 ──

interface NodeTagProps {
  node: GraphNode;
  onRemove: (id: string) => void;
}

const NodeTag: React.FC<NodeTagProps> = ({ node, onRemove }) => {
  const isExtracted = node.source === 'extracted';
  const isCode = node.source === 'code';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full ${
        isExtracted
          ? 'bg-success/10 text-success'
          : isCode
            ? 'bg-warning/10 text-warning'
          : 'bg-primary-light text-primary'
      }`}
      title={
        isExtracted
          ? `AI 抽取${node.category ? ` · ${node.category}` : ''}${node.confidence != null ? ` · 置信度 ${Math.round(node.confidence * 100)}%` : ''}`
          : isCode
            ? `代码抽取${node.category ? ` · ${node.category}` : ''}${node.sourcePath ? ` · ${node.sourcePath}` : ''}`
          : '手动添加'
      }
    >
      {node.label}
      <button
        className="hover:text-destructive transition-colors"
        onClick={() => onRemove(node.id)}
        title="删除"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
};

// ── 节点管理面板 ──

interface NodePanelProps {
  nodes: GraphNode[];
  nodeInput: string;
  onNodeInputChange: (value: string) => void;
  onAddNode: () => void;
  onRemoveNode: (id: string) => void;
  onResetDefault: () => void;
  /** 子插槽：抽取控件等 */
  children?: React.ReactNode;
}

export const NodePanel: React.FC<NodePanelProps> = ({
  nodes,
  nodeInput,
  onNodeInputChange,
  onAddNode,
  onRemoveNode,
  onResetDefault,
  children,
}) => {
  const [showNodeList, setShowNodeList] = React.useState(false);
  const [nodeQuery, setNodeQuery] = React.useState('');
  const shouldCollapse = nodes.length > 20;
  const filteredNodes = nodeQuery.trim()
    ? nodes.filter((node) => `${node.label} ${node.category ?? ''} ${node.sourcePath ?? ''}`.toLowerCase().includes(nodeQuery.trim().toLowerCase()))
    : nodes;

  React.useEffect(() => {
    // 首次进入大图模式时保持侧栏折叠。
    if (shouldCollapse) setShowNodeList(false);
  }, [shouldCollapse]);

  React.useEffect(() => {
    if (!showNodeList) { setNodeQuery(''); return undefined; }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowNodeList(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showNodeList]);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onAddNode(); }
  };

  return (
    <div className="border-t border-border p-3 space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">图谱节点</span>
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={onResetDefault}
          title="重置为默认节点"
        >
          重置默认
        </button>
      </div>

      {/* 抽取控件插槽 */}
      {children}

      {/* 手动添加输入框 */}
      <div className="flex gap-1">
        <input
          type="text"
          value={nodeInput}
          onChange={(e) => onNodeInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入节点名称…"
          className="flex-1 h-7 px-2 text-xs rounded border border-input bg-card text-foreground outline-none focus:border-primary"
        />
        <button
          className="h-7 w-7 flex items-center justify-center rounded bg-primary hover:bg-primary-hover text-white transition-colors"
          onClick={onAddNode}
          title="添加节点"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 节点列表 */}
      {nodes.length > 0 && (
        <div className="space-y-1">
          {shouldCollapse && <button
            type="button"
            className="flex h-7 w-full items-center justify-between rounded border border-input px-2 text-[11px] text-muted-foreground hover:bg-accent"
            onClick={() => setShowNodeList((value) => !value)}
          >
            <span>共 {nodes.length} 个节点</span>
            <span>打开管理</span>
          </button>}
          {!shouldCollapse && <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded border border-border p-1">
            {nodes.map((node) => (
              <NodeTag key={node.id} node={node} onRemove={onRemoveNode} />
            ))}
          </div>}
        </div>
      )}

      {showNodeList && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={() => setShowNodeList(false)}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label="图谱节点管理"
          className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">图谱节点管理</h3>
              <p className="text-xs text-muted-foreground">共 {nodes.length} 个节点</p>
            </div>
            <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭" onClick={() => setShowNodeList(false)}>
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="border-b border-border p-3">
            <input
              autoFocus
              value={nodeQuery}
              onChange={(event) => setNodeQuery(event.target.value)}
              placeholder="搜索节点名称、类型或文件路径…"
              className="h-8 w-full rounded border border-input bg-card px-3 text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {filteredNodes.length > 0 ? <div className="flex flex-wrap gap-1.5">
              {filteredNodes.map((node) => <NodeTag key={node.id} node={node} onRemove={onRemoveNode} />)}
            </div> : <p className="py-10 text-center text-xs text-muted-foreground">没有匹配的节点</p>}
          </div>
          <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>显示 {filteredNodes.length} / {nodes.length}</span>
            <button className="h-7 rounded border border-input px-3 hover:bg-accent" onClick={() => setShowNodeList(false)}>关闭</button>
          </footer>
        </section>
      </div>}
    </div>
  );
};
