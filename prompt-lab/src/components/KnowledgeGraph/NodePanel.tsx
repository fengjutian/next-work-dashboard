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
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full ${
        isExtracted
          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      }`}
      title={
        isExtracted
          ? `AI 抽取${node.category ? ` · ${node.category}` : ''}${node.confidence != null ? ` · 置信度 ${Math.round(node.confidence * 100)}%` : ''}`
          : '手动添加'
      }
    >
      {node.label}
      <button
        className="hover:text-red-500 transition-colors"
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
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onAddNode(); }
  };

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">图谱节点</span>
        <button
          className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
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
          className="flex-1 h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-400"
        />
        <button
          className="h-7 w-7 flex items-center justify-center rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          onClick={onAddNode}
          title="添加节点"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 节点列表 */}
      {nodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nodes.map((node) => (
            <NodeTag key={node.id} node={node} onRemove={onRemoveNode} />
          ))}
        </div>
      )}
    </div>
  );
};
