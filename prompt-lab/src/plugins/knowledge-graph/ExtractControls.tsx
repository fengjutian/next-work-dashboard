import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2 } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import { quickExtract } from '@/core';
import type { ExtractionDocument, ExtractStrategy, ExtractedEntity, ExtractedRelation, GraphNode } from './graph-types';
import { GRAPH_SCHEMAS } from './graph-schemas';

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
    confidencePct >= 80 ? 'text-success' :
    confidencePct >= 50 ? 'text-warning' : 'text-destructive';

  return (
    <label
      className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs rounded transition-colors hover:bg-accent ${
        checked ? 'text-success text-success' : 'text-muted-foreground'
      } ${alreadyExists ? 'opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={alreadyExists}
        onChange={() => onToggle(entity.name)}
        className="h-3 w-3 rounded border-input"
      />
      <span className="flex-1 truncate">{entity.name}</span>
      <span className="text-[10px] text-muted-foreground">{entity.category}</span>
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
  getSelectedContents: () => Promise<ExtractionDocument[]>;
  /** 添加抽取节点回调 */
  onAddExtractedGraph: (nodes: GraphNode[], relations: ExtractedRelation[], documents: ExtractionDocument[]) => void;
}

export const ExtractControls: React.FC<ExtractControlsProps> = ({
  existingLabels,
  getSelectedContents,
  onAddExtractedGraph,
}) => {
  const { toast } = useToast();
  const aiApi = useStore((s) => s.aiApi);

  const [strategy, setStrategy] = useState<ExtractStrategy>('keyword');
  const [schemaId, setSchemaId] = useState('software');
  const [extracting, setExtracting] = useState(false);
  const [extractedEntities, setExtractedEntities] = useState<ExtractedEntity[]>([]);
  const [extractedRelations, setExtractedRelations] = useState<ExtractedRelation[]>([]);
  const [checkedSet, setCheckedSet] = useState<Set<string>>(new Set());
  const [checkedRelations, setCheckedRelations] = useState<Set<string>>(new Set());
  const [sourceDocuments, setSourceDocuments] = useState<ExtractionDocument[]>([]);
  const relationKey = (relation: ExtractedRelation) => `${relation.source}\0${relation.label}\0${relation.target}`;

  // ── 执行抽取 ──
  const handleExtract = useCallback(async () => {
    if (!aiApi.apiKey) { toast('请先在设置中配置 AI API', 'error'); return; }

    setExtracting(true);
    try {
      const docs = await getSelectedContents();
      if (docs.length === 0) { toast('请先选择对话文件', 'error'); return; }

      const schema = strategy === 'concept-relation' ? GRAPH_SCHEMAS.find((item) => item.id === schemaId) : undefined;
      const result = await quickExtract(docs, { strategy, schema }, {
        apiKey: aiApi.apiKey,
        baseUrl: aiApi.baseUrl,
        model: aiApi.model,
      });

      // 过滤掉空的、已存在的
      const valid = result.entities.filter(
        (e) => e.name && e.name.trim().length > 0,
      );

      setExtractedEntities(valid);
      setSourceDocuments(docs);
      setExtractedRelations(result.relations ?? []);
      setCheckedRelations(new Set((result.relations ?? []).map(relationKey)));
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
  }, [aiApi, strategy, schemaId, getSelectedContents, existingLabels, toast]);

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
      aliases: e.aliases,
    }));

    const availableLabels = new Set([...existingLabels, ...selected.map((entity) => entity.name)]);
    const relations = extractedRelations.filter((relation) => checkedRelations.has(relationKey(relation)) &&
      availableLabels.has(relation.source) && availableLabels.has(relation.target) && relation.source !== relation.target,
    );
    onAddExtractedGraph(newNodes, relations, sourceDocuments);
    setExtractedEntities([]);
    setExtractedRelations([]);
    setCheckedSet(new Set());
    setCheckedRelations(new Set());
    setSourceDocuments([]);
    toast(`已添加 ${newNodes.length} 个节点、${relations.length} 条关系`, 'success');
  }, [extractedEntities, extractedRelations, checkedSet, checkedRelations, existingLabels, onAddExtractedGraph, sourceDocuments, toast]);

  const existingLabelSet = new Set(existingLabels);

  return (
    <div className="space-y-2">
      {/* 策略选择 + 抽取按钮 */}
      <div className="flex items-center gap-1">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as ExtractStrategy)}
          className="flex-1 h-6 text-[11px] rounded border border-input bg-card text-foreground outline-none px-1"
          title={STRATEGY_LABELS.find((s) => s.value === strategy)?.hint}
        >
          {STRATEGY_LABELS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          className="h-6 px-2 flex items-center gap-1 text-[11px] rounded bg-primary hover:bg-primary-hover text-primary-foreground transition-colors disabled:opacity-50 shrink-0"
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
      {strategy === 'concept-relation' && <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)} className="h-7 w-full rounded border border-input bg-card px-1 text-[11px]" title="约束实体类型与关系类型">
        {GRAPH_SCHEMAS.map((schema) => <option key={schema.id} value={schema.id}>{schema.name} · {schema.description}</option>)}
      </select>}

      {/* 抽取结果 */}
      {extractedEntities.length > 0 && (
        <div className="border border-border rounded overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 bg-muted">
            <span className="text-[10px] text-muted-foreground">
              抽取结果 ({checkedSet.size}/{extractedEntities.length})
            </span>
            <button
              className="text-[10px] px-1 rounded text-muted-foreground hover:text-foreground"
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
          {extractedRelations.length > 0 && <div className="max-h-24 overflow-y-auto border-t bg-muted/20 px-2 py-1">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">关系预览（{extractedRelations.length}）</p>
            {extractedRelations.map((relation, index) => <label key={`${relation.source}:${relation.target}:${index}`} className="flex gap-1 text-[10px] text-muted-foreground" title={relation.evidence?.map((item) => `${item.documentName}: ${item.quote ?? ''}`).join('\n')}>
              <input type="checkbox" checked={checkedRelations.has(relationKey(relation))} onChange={() => setCheckedRelations((previous) => { const next = new Set(previous); const key = relationKey(relation); next.has(key) ? next.delete(key) : next.add(key); return next; })} />
              <span className="min-w-0 truncate">{relation.source} <span className="text-primary">—{relation.label || '关联'}→</span> {relation.target} · {Math.round((relation.confidence ?? .5) * 100)}%</span>
            </label>)}
          </div>}
          <div className="px-2 py-1 border-t border-border">
            <button
              className="w-full h-6 text-[11px] rounded bg-success hover:bg-success text-white transition-colors disabled:opacity-50"
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
