import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { quickExtract } from '@/core';
import type { ExtractStrategy, ExtractedEntity, GraphNode } from './graph-types';

// ── 抽取策略标签 ──

const STRATEGY_LABELS: { value: ExtractStrategy; label: string; hint: string }[] = [
  { value: 'keyword', label: '关键词', hint: '提取技术名词/术语' },
  { value: 'entity', label: '实体分类', hint: '提取实体并分类' },
  { value: 'concept-relation', label: '概念关系', hint: '提取实体及关系' },
];

// ── 单个抽取结果项 ──

interface EntityItemProps {
  entity: ExtractedEntity;
  checked: boolean;
  alreadyExists: boolean;
  onToggle: (name: string) => void;
}

const EntityItem: React.FC<EntityItemProps> = ({ entity, checked, alreadyExists, onToggle }) => {
  const confidencePct = Math.round(entity.relevance * 100);
  const confidenceColor =
    confidencePct >= 80 ? 'text-emerald-500' :
    confidencePct >= 50 ? 'text-amber-500' : 'text-red-400';

  return (
    <label
      className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs rounded transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        checked ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'
      } ${alreadyExists ? 'opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={alreadyExists}
        onChange={() => onToggle(entity.name)}
        className="h-3 w-3 rounded border-zinc-300 dark:border-zinc-600"
      />
      <span className="flex-1 truncate">{entity.name}</span>
      <span className="text-[10px] text-zinc-400">{entity.category}</span>
      <span className={`text-[10px] ${confidenceColor} w-8 text-right`}>
        {confidencePct}%
      </span>
    </label>
  );
};

// ── 抽取控件主组件 ──

interface ExtractControlsProps {
  /** 已存在的节点名（用于去重检查） */
  existingLabels: string[];
  /** 对话文件内容获取器 */
  getSelectedContents: () => Promise<{ name: string; content: string }[]>;
  /** 添加抽取节点回调 */
  onAddExtractedNodes: (nodes: GraphNode[]) => void;
}

export const ExtractControls: React.FC<ExtractControlsProps> = ({
  existingLabels,
  getSelectedContents,
  onAddExtractedNodes,
}) => {
  const { toast } = useToast();
  const aiApi = useStore((s) => s.aiApi);

  const [strategy, setStrategy] = useState<ExtractStrategy>('keyword');
  const [extracting, setExtracting] = useState(false);
  const [extractedEntities, setExtractedEntities] = useState<ExtractedEntity[]>([]);
  const [checkedSet, setCheckedSet] = useState<Set<string>>(new Set());

  // ── 执行抽取 ──
  const handleExtract = useCallback(async () => {
    if (!aiApi.apiKey) { toast('请先在设置中配置 AI API', 'error'); return; }

    setExtracting(true);
    try {
      const docs = await getSelectedContents();
      if (docs.length === 0) { toast('请先选择对话文件', 'error'); return; }

      const result = await quickExtract(docs, { strategy }, {
        apiKey: aiApi.apiKey,
        baseUrl: aiApi.baseUrl,
        model: aiApi.model,
      });

      // 过滤掉空的、已存在的
      const valid = result.entities.filter(
        (e) => e.name && e.name.trim().length > 0,
      );

      setExtractedEntities(valid);
      // 默认勾选全部不重复的
      const defaultChecked = new Set(
        valid.filter((e) => !existingLabels.includes(e.name)).map((e) => e.name),
      );
      setCheckedSet(defaultChecked);

      const newCount = valid.filter((e) => !existingLabels.includes(e.name)).length;
      toast(
        `抽取到 ${valid.length} 个实体（${newCount} 个新节点）`,
        'success',
      );
    } catch (err: any) {
      console.error('[ExtractControls] extract failed:', err);
      toast(err?.message ?? 'AI 抽取失败', 'error');
    } finally {
      setExtracting(false);
    }
  }, [aiApi, strategy, getSelectedContents, existingLabels, toast]);

  // ── 切换勾选 ──
  const toggleEntity = useCallback((name: string) => {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  // ── 添加到图谱 ──
  const handleAddToGraph = useCallback(() => {
    const selected = extractedEntities.filter((e) => checkedSet.has(e.name));
    if (selected.length === 0) { toast('请至少勾选一个实体', 'error'); return; }

    const newNodes: GraphNode[] = selected.map((e) => ({
      id: e.name,
      label: e.name,
      degree: 0,
      source: 'extracted',
      category: e.category,
      confidence: e.relevance,
    }));

    onAddExtractedNodes(newNodes);
    setExtractedEntities([]);
    setCheckedSet(new Set());
    toast(`已添加 ${newNodes.length} 个节点`, 'success');
  }, [extractedEntities, checkedSet, onAddExtractedNodes, toast]);

  const existingLabelSet = new Set(existingLabels);

  return (
    <div className="space-y-2">
      {/* 策略选择 + 抽取按钮 */}
      <div className="flex items-center gap-1">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as ExtractStrategy)}
          className="flex-1 h-6 text-[11px] rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none px-1"
          title={STRATEGY_LABELS.find((s) => s.value === strategy)?.hint}
        >
          {STRATEGY_LABELS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          className="h-6 px-2 flex items-center gap-1 text-[11px] rounded bg-violet-500 hover:bg-violet-600 text-white transition-colors disabled:opacity-50 shrink-0"
          disabled={extracting}
          onClick={handleExtract}
        >
          {extracting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {extracting ? '抽取中' : 'AI 抽取'}
        </button>
      </div>

      {/* 抽取结果 */}
      {extractedEntities.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 bg-zinc-100 dark:bg-zinc-800">
            <span className="text-[10px] text-zinc-500">
              抽取结果 ({checkedSet.size}/{extractedEntities.length})
            </span>
            <button
              className="text-[10px] px-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={() => {
                const newCheckable = extractedEntities.filter(
                  (e) => !existingLabelSet.has(e.name),
                );
                setCheckedSet(new Set(newCheckable.map((e) => e.name)));
              }}
            >
              全选新节点
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {extractedEntities.map((entity) => (
              <EntityItem
                key={entity.name}
                entity={entity}
                checked={checkedSet.has(entity.name)}
                alreadyExists={existingLabelSet.has(entity.name)}
                onToggle={toggleEntity}
              />
            ))}
          </div>
          <div className="px-2 py-1 border-t border-zinc-200 dark:border-zinc-700">
            <button
              className="w-full h-6 text-[11px] rounded bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
              disabled={checkedSet.size === 0}
              onClick={handleAddToGraph}
            >
              添加选中节点到图谱
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
