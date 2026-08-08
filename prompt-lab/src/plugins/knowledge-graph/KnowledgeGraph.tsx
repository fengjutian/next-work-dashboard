import React, { useEffect, useState, useCallback } from 'react';
import { FolderOpen, Plus, Search } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile } from '@/types/electron';
import type { ExtractedRelation, ExtractionDocument, GraphNode, GraphData } from './graph-types';
import { GraphCanvas } from './GraphCanvas';
import { FileSelector } from './FileSelector';
import { NodePanel } from './NodePanel';
import { ExtractControls } from './ExtractControls';
import { CodeExtractControls } from './CodeExtractControls';
import { getKnowledgeTemplateVariables, instantiateKnowledgeTemplate, type KnowledgeChangeProposal, type KnowledgeDiagnostic, type KnowledgeIndex, type KnowledgeTemplate, type KnowledgeWorkspaceState } from '@/core/knowledge';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { requestEditorNavigation } from '@/services/editor-navigation';
import { KnowledgeFolderTree } from './KnowledgeFolderTree';
import { findDuplicateEntities, mergeEntities, stableEntityId } from '@/core/knowledge-graph/entity-normalization';
import { attachDocumentHashes, deactivateMissingDocuments, reconcileDocuments } from '@/core/knowledge-graph/lifecycle';
import { hybridGraphSearch, type HybridSearchResult } from '@/core/knowledge-graph/hybrid-search';
import { createOpenAIProvider } from '@/core/llm';

type KnowledgeWorkspaceView = KnowledgeIndex & {
  templates: KnowledgeTemplate[];
  diagnostics: KnowledgeDiagnostic[];
  skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
  instructions?: string;
  state?: KnowledgeWorkspaceState;
};
type KnowledgeSearchMatch = { uri: string; path: string; title: string; score: number; snippets: Array<{ line: number; text: string }> };

// ── 常量 ──

const DEFAULT_NODES = [
  'React', 'TypeScript', 'Electron', 'Zustand',
  'Vite', 'Tailwind', 'SQLite', 'Drizzle',
];
const GRAPH_STORAGE_KEY = 'prompt-lab:knowledge-graph:v1';
const LEGACY_CODE_GRAPH_LIMIT = 100;

// ── 默认节点工厂 ──
const makeDefaultNodes = (): GraphNode[] =>
  DEFAULT_NODES.map((name) => ({
    id: name,
    label: name,
    degree: 0,
    source: 'manual' as const,
  }));

function loadPersistedGraph(): { nodes: GraphNode[]; graphData: GraphData | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(GRAPH_STORAGE_KEY) ?? 'null') as Partial<GraphData> | null;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { nodes: makeDefaultNodes(), graphData: null };
    }
    let nodes = parsed.nodes.filter((node): node is GraphNode =>
      Boolean(node && typeof node.id === 'string' && typeof node.label === 'string' && ['manual', 'extracted', 'code'].includes(node.source)),
    );
    let nodeIds = new Set(nodes.map((node) => node.id));
    let edges = parsed.edges.filter((edge) =>
      Boolean(edge && typeof edge.source === 'string' && typeof edge.target === 'string' && nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    );
    // 早期版本没有代码节点上限。自动迁移旧大图，避免应用启动后立即渲染上千节点。
    if (nodes.length > 500 && nodes.some((node) => node.source === 'code')) {
      nodes = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, LEGACY_CODE_GRAPH_LIMIT);
      nodeIds = new Set(nodes.map((node) => node.id));
      edges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
      const degree = new Map<string, number>();
      edges.forEach((edge) => {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      });
      nodes = nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
    }
    return { nodes: nodes.length > 0 ? nodes : makeDefaultNodes(), graphData: nodes.length > 0 ? { nodes, edges } : null };
  } catch {
    return { nodes: makeDefaultNodes(), graphData: null };
  }
}

// ── 主组件 ──

export const KnowledgeGraph: React.FC = () => {
  const { toast } = useToast();
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const conversationSavedAt = useStore((s) => s.conversationSavedAt);
  const memoryConfig = useStore((s) => s.memoryConfig);
  const aiApi = useStore((s) => s.aiApi);

  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [nodeInput, setNodeInput] = useState('');
  const [nodes, setNodes] = useState<GraphNode[]>(() => loadPersistedGraph().nodes);
  const [graphData, setGraphData] = useState<GraphData | null>(() => loadPersistedGraph().graphData);
  const [generating, setGenerating] = useState(false);
  const [knowledgeWorkspace, setKnowledgeWorkspace] = useState<string | null>(null);
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeWorkspaceView | null>(null);
  const [knowledgeFolderPaths, setKnowledgeFolderPaths] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('note');
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [selectedKnowledgeUri, setSelectedKnowledgeUri] = useState<string | null>(null);
  const [selectedKnowledgeContent, setSelectedKnowledgeContent] = useState('');
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeTypeFilter, setKnowledgeTypeFilter] = useState('');
  const [knowledgeTagFilter, setKnowledgeTagFilter] = useState('');
  const [knowledgeMatches, setKnowledgeMatches] = useState<KnowledgeSearchMatch[]>([]);
  const [knowledgeProposals, setKnowledgeProposals] = useState<KnowledgeChangeProposal[]>(activeKnowledgeWorkspace.changeProposals);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [mergeUndo, setMergeUndo] = useState<GraphData | null>(null);
  const [hybridQuery, setHybridQuery] = useState('');
  const [hybridResult, setHybridResult] = useState<HybridSearchResult | null>(null);
  const [graphAnswer, setGraphAnswer] = useState('');
  const [graphAsking, setGraphAsking] = useState(false);

  // 人工/AI 图谱自动保存；知识工作区扫描结果是临时视图，不覆盖持久数据。
  useEffect(() => {
    if (graphData?.nodes.some((node) => node.source === 'wiki-link')) return;
    localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify({
      nodes,
      edges: graphData?.edges ?? [],
    }));
  }, [nodes, graphData]);

  // ── 加载对话文件列表 ──

  const loadFiles = useCallback(async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api?.listConversations) return;
      const list = await api.listConversations();
      setFiles(list);
      setGraphData((current) => current ? deactivateMissingDocuments(current, list.map((file: ConversationFile) => file.path)) : current);
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

  const toggleAllFiles = useCallback(() => {
    if (selectedPaths.size === files.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(files.map((f) => f.path)));
    }
  }, [files, selectedPaths]);

  // ── 节点管理 ──

  const addNode = useCallback(() => {
    const label = nodeInput.trim();
    if (!label) return;
    if (nodes.some((n) => n.label === label)) { toast('节点已存在', 'error'); return; }
    setNodes((prev) => [...prev, { id: label, label, degree: 0, source: 'manual' }]);
    setNodeInput('');
  }, [nodeInput, nodes, toast]);

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const resetDefaultNodes = useCallback(() => {
    setNodes(makeDefaultNodes());
  }, []);

  const applyCodeGraph = useCallback((graph: GraphData) => {
    setNodes(graph.nodes);
    setGraphData(graph);
    setKnowledgeIndex(null);
  }, []);

  // ── 获取选中文件内容（供 AI 抽取使用） ──
  const getSelectedContents = useCallback(async (): Promise<ExtractionDocument[]> => {
    const selected = files.filter((f) => selectedPaths.has(f.path));
    const api = (window as any).electronAPI;
    if (!api?.readConversation) return [];
    const results: ExtractionDocument[] = [];
    for (const file of selected) {
      const result = await api.readConversation(file.path);
      if (result.success && result.content) {
        results.push({ name: file.title || file.fileName, content: result.content, sourcePath: file.path });
      }
    }
    return results;
  }, [files, selectedPaths]);

  // ── 添加 AI 抽取的节点 ──
  const addExtractedGraph = useCallback((newNodes: GraphNode[], relations: ExtractedRelation[], documents: ExtractionDocument[]) => {
    setNodes((prev) => {
      const existingLabels = new Set(prev.map((n) => n.label));
      const toAdd = newNodes.filter((n) => !existingLabels.has(n.label)).map((node) => ({ ...node, id: stableEntityId(node.category, node.label), canonicalName: node.label, aliases: node.aliases ?? [] }));
      const merged = [...prev, ...toAdd];
      const labelIds = new Map(merged.map((node) => [node.label, node.id]));
      const relationEdges = relations.map((relation) => ({
        source: labelIds.get(relation.source) ?? relation.source,
        target: labelIds.get(relation.target) ?? relation.target,
        weight: 1,
        kind: 'inferred' as const,
        label: relation.label,
        status: 'accepted' as const,
        confidence: relation.confidence,
        evidence: relation.evidence,
        extractionModel: relation.extractionModel,
        extractedAt: relation.extractedAt,
      }));
      const degree = new Map(merged.map((node) => [node.id, 0]));
      relationEdges.forEach((edge) => {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      });
      const graphNodes = merged.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
      setGraphData((current) => {
        const reconciled = reconcileDocuments({ nodes: graphNodes, edges: current?.edges ?? [], documents: current?.documents }, documents).graph;
        return attachDocumentHashes({ ...reconciled, edges: [...reconciled.edges, ...relationEdges] });
      });
      return graphNodes;
    });
  }, []);

  const duplicateSuggestions = findDuplicateEntities(graphData?.nodes ?? nodes);
  const mergeFirstDuplicate = useCallback(() => {
    const suggestion = duplicateSuggestions[0];
    if (!suggestion || !graphData) return;
    setMergeUndo(graphData);
    const merged = mergeEntities(graphData, suggestion.canonicalId, suggestion.duplicateId);
    setGraphData(merged); setNodes(merged.nodes);
    toast('已合并重复实体，可撤销', 'success');
  }, [duplicateSuggestions, graphData, toast]);

  const checkDocumentChanges = useCallback(async () => {
    if (!graphData) return;
    const documents = await getSelectedContents();
    const result = reconcileDocuments(graphData, documents);
    setGraphData(attachDocumentHashes(result.graph));
    toast(result.changedPaths.length ? `检测到 ${result.changedPaths.length} 个变化文件，相关事实已标记失效` : '所选文档没有变化', result.changedPaths.length ? 'success' : 'info');
  }, [getSelectedContents, graphData, toast]);

  const runHybridSearch = useCallback(async () => {
    const query = hybridQuery.trim();
    if (!query || !graphData) return;
    const documents = await getSelectedContents();
    const semanticScores = new Map<string, number>();
    if (memoryConfig.embeddingBaseUrl && memoryConfig.embeddingApiKey && memoryConfig.embeddingModel && documents.length) {
      try {
        const response = await window.electronAPI.createEmbeddings({ baseUrl: memoryConfig.embeddingBaseUrl, apiKey: memoryConfig.embeddingApiKey, model: memoryConfig.embeddingModel, inputs: [query, ...documents.map((document) => document.content.slice(0, 6000))] });
        const vectors = response.embeddings;
        const queryVector = vectors?.[0];
        if (response.success && queryVector) documents.forEach((document, index) => {
          const vector = vectors?.[index + 1];
          if (!vector || vector.length !== queryVector.length) return;
          let dot = 0; let left = 0; let right = 0;
          for (let cursor = 0; cursor < vector.length; cursor += 1) { dot += queryVector[cursor] * vector[cursor]; left += queryVector[cursor] ** 2; right += vector[cursor] ** 2; }
          semanticScores.set(document.sourcePath ?? document.name, left && right ? dot / Math.sqrt(left * right) : 0);
        });
      } catch (error) { console.warn('[KnowledgeGraph] semantic retrieval unavailable; using lexical fallback.', error); }
    }
    setHybridResult(hybridGraphSearch(query, graphData, documents, 2, semanticScores));
  }, [getSelectedContents, graphData, hybridQuery, memoryConfig]);

  const askGraph = useCallback(async () => {
    if (!hybridResult || !hybridQuery.trim() || !aiApi.apiKey || graphAsking) return;
    setGraphAsking(true); setGraphAnswer('');
    try {
      const provider = createOpenAIProvider(aiApi);
      let answer = '';
      for await (const part of provider.chat([
        { role: 'system', content: '你是严谨的知识图谱问答助手。只能依据给定实体、关系和证据回答；证据不足时明确说明。引用图证据用 [G数字]，引用文档片段用 [D数字]。' },
        { role: 'user', content: hybridResult.context },
      ], { model: aiApi.model, temperature: .2 })) { answer += part.delta; setGraphAnswer(answer); }
    } catch (error) { setGraphAnswer(error instanceof Error ? `问答失败：${error.message}` : '问答失败'); }
    finally { setGraphAsking(false); }
  }, [aiApi, graphAsking, hybridQuery, hybridResult]);

  const updateRelationStatus = useCallback((edgeIndex: number, status: 'accepted' | 'rejected') => {
    setGraphData((current) => current ? {
      ...current,
      edges: current.edges.map((edge, index) => index === edgeIndex ? { ...edge, status } : edge),
    } : current);
  }, []);

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
        const present = nodes.filter((n) => lowerContent.includes(n.label.toLowerCase()));
        for (let i = 0; i < present.length; i++) {
          for (let j = i + 1; j < present.length; j++) {
            const [a, b] = present[i].label < present[j].label
              ? [present[i].label, present[j].label]
              : [present[j].label, present[i].label];
            const key = `${a}||${b}`;
            edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
          }
        }
      }

      // 计算节点度数
      const degreeMap = new Map<string, number>();
      nodes.forEach((n) => degreeMap.set(n.id, 0));
      edgeMap.forEach((w, key) => {
        const [s, t] = key.split('||');
        degreeMap.set(s, (degreeMap.get(s) ?? 0) + w);
        degreeMap.set(t, (degreeMap.get(t) ?? 0) + w);
      });

      const graphNodes: GraphNode[] = nodes.map((n) => ({
        ...n,
        degree: degreeMap.get(n.id) ?? 0,
      }));

      const graphEdges = [...edgeMap.entries()].map(([key, weight]) => {
        const [source, target] = key.split('||');
        return { source, target, weight };
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

  const applyKnowledgeIndex = useCallback((index: KnowledgeWorkspaceView) => {
      const degree = new Map(index.documents.map((document) => [document.uri, 0]));
      const edges = index.links.flatMap((link) => {
        if (link.status !== 'resolved' || !link.targetUri) return [];
        degree.set(link.sourceUri, (degree.get(link.sourceUri) ?? 0) + 1);
        degree.set(link.targetUri, (degree.get(link.targetUri) ?? 0) + 1);
        return [{
          source: link.sourceUri, target: link.targetUri, weight: 1,
          kind: 'wiki-link' as const,
          sourcePath: index.documents.find((document) => document.uri === link.sourceUri)?.path,
        }];
      });
      setGraphData({
        nodes: index.documents.map((document) => ({
          id: document.uri, label: document.title, degree: degree.get(document.uri) ?? 0,
          source: 'wiki-link' as const, category: document.type,
        })),
        edges,
      });
      setKnowledgeIndex(index);
      return edges.length;
  }, []);

  const loadKnowledgeFolders = useCallback(async (rootPath: string) => {
    const folders: string[] = [];
    const visit = async (relativePath = ''): Promise<void> => {
      const result = await window.electronAPI.workspace.listDirectory(rootPath, relativePath);
      if (!result.success) return;
      for (const entry of result.data ?? []) {
        if (entry.type !== 'directory' || entry.name === '.knowledge') continue;
        const normalizedPath = entry.path.replace(/\\/g, '/');
        folders.push(normalizedPath);
        await visit(entry.path);
      }
    };
    await visit();
    setKnowledgeFolderPaths(folders);
  }, []);

  const scanKnowledgeWorkspace = useCallback(async (rootPath: string) => {
      const result = await window.electronAPI.knowledge.scanWorkspace(rootPath);
      if (!result.success || !result.data) throw new Error(result.error ?? 'SCAN_FAILED');
      const index = result.data as KnowledgeWorkspaceView;
      const edgeCount = applyKnowledgeIndex(index);
      activeKnowledgeWorkspace.setActive(rootPath, index);
      await loadKnowledgeFolders(rootPath);
      const unresolved = index.links.filter((link) => link.status !== 'resolved').length;
      toast(`已索引 ${index.documents.length} 篇知识文档、${edgeCount} 条显式链接；${unresolved} 条待解析`, 'success');
  }, [applyKnowledgeIndex, loadKnowledgeFolders, toast]);

  const captureKnowledgeBaseline = useCallback(async () => {
    if (!knowledgeWorkspace) return;
    setGenerating(true);
    try {
      const result = await window.electronAPI.knowledge.captureState(knowledgeWorkspace);
      if (!result.success || !result.data) throw new Error(result.error ?? 'CAPTURE_STATE_FAILED');
      await scanKnowledgeWorkspace(knowledgeWorkspace);
      toast(`已建立 ${Object.keys(result.data.documents).length} 篇文档的来源基线`, 'success');
    } catch (error) {
      toast(`建立知识来源基线失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [knowledgeWorkspace, scanKnowledgeWorkspace, toast]);

  const createKnowledgeFolder = useCallback(async () => {
    if (!knowledgeWorkspace) return;
    const path = newFolderName.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!path || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      toast('请输入有效的目录名称', 'error');
      return;
    }
    setGenerating(true);
    try {
      const result = await window.electronAPI.workspace.createDirectory(knowledgeWorkspace, path);
      if (!result.success) throw new Error(result.error ?? 'CREATE_DIRECTORY_FAILED');
      setNewFolderName('');
      setShowNewFolder(false);
      await loadKnowledgeFolders(knowledgeWorkspace);
      toast(`已创建主题目录：${path}`, 'success');
    } catch (error) {
      toast(`创建目录失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [knowledgeWorkspace, loadKnowledgeFolders, newFolderName, toast]);

  const openKnowledgeWorkspace = useCallback(async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (!folder) return;
    setGenerating(true);
    try {
      await scanKnowledgeWorkspace(folder.path);
      setKnowledgeWorkspace(folder.path);
    } catch (error) {
      toast(`知识工作区扫描失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [scanKnowledgeWorkspace, toast]);

  const selectedTemplate = knowledgeIndex?.templates.find((template) => template.id === selectedTemplateId) ?? knowledgeIndex?.templates[0];
  const selectedTemplateVariables = selectedTemplate ? getKnowledgeTemplateVariables(selectedTemplate) : [];

  useEffect(() => {
    if (!selectedTemplate) return;
    setTemplateValues(Object.fromEntries(getKnowledgeTemplateVariables(selectedTemplate).map((variable) => [variable.name, variable.defaultValue])));
  }, [selectedTemplate]);

  const createFromTemplate = useCallback(async () => {
    if (!knowledgeWorkspace || !selectedTemplate) return;
    setGenerating(true);
    try {
      const result = await window.electronAPI.knowledge.createFromTemplate(
        knowledgeWorkspace, selectedTemplate.id, templateValues,
      );
      if (!result.success || !result.data) throw new Error(result.error ?? 'CREATE_FAILED');
      toast(`已创建 ${result.data.path}`, 'success');
      setTemplateValues(Object.fromEntries(getKnowledgeTemplateVariables(selectedTemplate).map((variable) => [variable.name, variable.defaultValue])));
      await scanKnowledgeWorkspace(knowledgeWorkspace);
    } catch (error) {
      toast(`模板创建失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [knowledgeWorkspace, scanKnowledgeWorkspace, selectedTemplate, templateValues, toast]);

  const selectKnowledgeDocument = useCallback((uri: string) => {
    setSelectedKnowledgeUri(uri);
  }, []);

  useEffect(() => {
    const document = knowledgeIndex?.documents.find((item) => item.uri === selectedKnowledgeUri);
    if (!knowledgeWorkspace || !document) { setSelectedKnowledgeContent(''); return; }
    void window.electronAPI.knowledge.readDocument(knowledgeWorkspace, document.path).then((result) => {
      setSelectedKnowledgeContent(result.success ? result.data?.content ?? '' : '');
    });
  }, [knowledgeIndex, knowledgeWorkspace, selectedKnowledgeUri]);

  const searchKnowledge = useCallback(async () => {
    if (!knowledgeWorkspace || !knowledgeQuery.trim()) { setKnowledgeMatches([]); return; }
    const result = await window.electronAPI.knowledge.searchWorkspace(knowledgeWorkspace, knowledgeQuery.trim(), 20, {
      types: knowledgeTypeFilter ? [knowledgeTypeFilter as import('@/core/knowledge').KnowledgeDocumentType] : undefined,
      tags: knowledgeTagFilter.trim() ? knowledgeTagFilter.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
    });
    if (!result.success) { toast(`知识搜索失败：${result.error ?? 'SEARCH_FAILED'}`, 'error'); return; }
    setKnowledgeMatches(result.data ?? []);
  }, [knowledgeQuery, knowledgeTagFilter, knowledgeTypeFilter, knowledgeWorkspace, toast]);

  const selectedKnowledgeDocument = knowledgeIndex?.documents.find((item) => item.uri === selectedKnowledgeUri);
  const selectedBacklinks = selectedKnowledgeUri ? knowledgeIndex?.backlinks[selectedKnowledgeUri] ?? [] : [];
  const selectedOutgoing = selectedKnowledgeUri ? knowledgeIndex?.links.filter((link) => link.sourceUri === selectedKnowledgeUri) ?? [] : [];
  let templatePreviewPath = '';
  if (selectedTemplate) {
    try { templatePreviewPath = instantiateKnowledgeTemplate(selectedTemplate, templateValues).path; } catch { templatePreviewPath = ''; }
  }

  useEffect(() => activeKnowledgeWorkspace.subscribe(setKnowledgeProposals), []);

  const selectedProposal = knowledgeProposals.find((proposal) => proposal.id === selectedProposalId);

  const acceptKnowledgeProposal = useCallback(async (id: string) => {
    try {
      await activeKnowledgeWorkspace.acceptProposal(id);
      toast('知识变更已通过审查并写入', 'success');
      if (knowledgeWorkspace) await scanKnowledgeWorkspace(knowledgeWorkspace);
    } catch (error) {
      toast(`应用知识变更失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }, [knowledgeWorkspace, scanKnowledgeWorkspace, toast]);

  const openInEditor = useCallback((path: string, line = 1) => {
    if (!knowledgeWorkspace) return;
    requestEditorNavigation({ rootPath: knowledgeWorkspace, path, line, column: 1 });
    setActiveActivity('code-editor');
  }, [knowledgeWorkspace, setActiveActivity]);

  // ── 渲染 ──

  return (
    <div className="flex h-full">
      {/* 左侧配置面板 */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col bg-background">
        <div className="border-b p-3">
          <button
            className="w-full h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={generating}
            onClick={() => void openKnowledgeWorkspace()}
          >
            打开 Markdown 知识工作区
          </button>
          {knowledgeWorkspace && <p className="mt-2 truncate text-xs text-muted-foreground" title={knowledgeWorkspace}>{knowledgeWorkspace}</p>}
          {knowledgeIndex && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-1">
                <input
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void searchKnowledge(); }}
                  placeholder="搜索知识工作区"
                />
                <button className="rounded border px-2 text-xs hover:bg-accent" onClick={() => void searchKnowledge()}>搜索</button>
              </div>
              <div className="flex gap-1">
                <select className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-xs" value={knowledgeTypeFilter} onChange={(event) => setKnowledgeTypeFilter(event.target.value)}>
                  <option value="">全部类型</option>
                  {['conversation', 'note', 'spec', 'prompt', 'code', 'document'].map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <input className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs" value={knowledgeTagFilter} onChange={(event) => setKnowledgeTagFilter(event.target.value)} placeholder="标签,标签" />
              </div>
              {knowledgeMatches.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-auto rounded border p-1">
                  {knowledgeMatches.map((match) => (
                    <button key={match.uri} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent" title={match.path} onClick={() => selectKnowledgeDocument(match.uri)}>
                      {match.title}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <p className="text-xs font-medium">主题文件夹</p>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{knowledgeIndex.documents.length} 篇</span>
                    <button
                      type="button"
                      className="flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium hover:bg-accent"
                      title="新建主题目录"
                      aria-label="新建主题目录"
                      onClick={() => setShowNewFolder((visible) => !visible)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建目录
                    </button>
                  </div>
                </div>
                {showNewFolder && (
                  <div className="mb-1.5 flex gap-1">
                    <div className="relative min-w-0 flex-1">
                      <FolderOpen className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        autoFocus
                        className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void createKnowledgeFolder();
                          if (event.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                        }}
                        placeholder="目录名称，如：产品"
                      />
                    </div>
                    <button type="button" className="h-8 rounded bg-primary px-2 text-xs text-primary-foreground disabled:opacity-50" disabled={!newFolderName.trim() || generating} onClick={() => void createKnowledgeFolder()}>添加</button>
                  </div>
                )}
                <KnowledgeFolderTree
                  documents={knowledgeIndex.documents}
                  folderPaths={knowledgeFolderPaths}
                  selectedUri={selectedKnowledgeUri}
                  onSelectDocument={selectKnowledgeDocument}
                />
              </div>
              <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={selectedTemplate?.id ?? ''} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {knowledgeIndex.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              {selectedTemplateVariables.map((variable) => (
                <label key={variable.name} className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">{variable.label}{variable.required ? ' *' : ''}</span>
                  <input
                    className="h-8 w-full rounded-md border bg-background px-2"
                    value={templateValues[variable.name] ?? ''}
                    onChange={(event) => setTemplateValues((values) => ({ ...values, [variable.name]: event.target.value }))}
                    placeholder={variable.description ?? variable.name}
                  />
                </label>
              ))}
              <button
                className="h-8 w-full rounded-md border text-xs hover:bg-accent disabled:opacity-50"
                disabled={generating || selectedTemplateVariables.some((variable) => variable.required && !templateValues[variable.name]?.trim())}
                onClick={() => void createFromTemplate()}
              >
                从模板创建
              </button>
              {templatePreviewPath && <p className="truncate text-xs text-muted-foreground" title={templatePreviewPath}>将创建：{templatePreviewPath}</p>}
              <div className="rounded bg-muted p-2 text-xs text-muted-foreground">
                <p>孤立文档 {knowledgeIndex.orphanUris.length}</p>
                <p>未解析链接 {knowledgeIndex.links.filter((link) => link.status === 'unresolved').length}</p>
                <p>歧义链接 {knowledgeIndex.links.filter((link) => link.status === 'ambiguous').length}</p>
                <p>规则问题 {knowledgeIndex.diagnostics.length}</p>
              </div>
              <button
                className="h-8 w-full rounded-md border text-xs hover:bg-accent disabled:opacity-50"
                disabled={generating}
                onClick={() => void captureKnowledgeBaseline()}
              >
                建立知识来源基线
              </button>
              {(knowledgeIndex.links.some((link) => link.status !== 'resolved') || knowledgeIndex.diagnostics.length > 0) && (
                <div className="max-h-40 space-y-1 overflow-auto rounded border p-1">
                  {knowledgeIndex.links.filter((link) => link.status !== 'resolved').slice(0, 20).map((link, index) => (
                    <button key={`${link.sourceUri}:${link.line}:${index}`} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent" title={`${link.target} · ${link.status}`} onClick={() => selectKnowledgeDocument(link.sourceUri)}>
                      {link.status === 'unresolved' ? '缺失' : '歧义'}：{link.target} · L{link.line}
                    </button>
                  ))}
                  {knowledgeIndex.diagnostics.slice(0, 20).map((diagnostic, index) => {
                    const document = knowledgeIndex.documents.find((item) => item.path === diagnostic.path);
                    return (
                      <button key={`${diagnostic.code}:${diagnostic.path}:${index}`} disabled={!document} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:opacity-60" title={diagnostic.message} onClick={() => document && selectKnowledgeDocument(document.uri)}>
                        {diagnostic.severity === 'error' ? '错误' : '警告'}：{diagnostic.message}
                      </button>
                    );
                  })}
                </div>
              )}
              {knowledgeProposals.length > 0 && (
                <div className="space-y-1 rounded border p-1">
                  <p className="px-2 py-1 text-xs font-medium">Agent 待审查变更</p>
                  {knowledgeProposals.slice().reverse().slice(0, 10).map((proposal) => (
                    <button key={proposal.id} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent" title={proposal.instruction} onClick={() => setSelectedProposalId(proposal.id)}>
                      {proposal.status} · {proposal.mutations.length} 文件 · {proposal.instruction}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <FileSelector
          files={files}
          selectedPaths={selectedPaths}
          onToggle={toggleFile}
          onToggleAll={toggleAllFiles}
          onRefresh={loadFiles}
        />

        <section className="space-y-2 border-t p-3 text-xs">
          <div className="flex items-center justify-between"><span className="font-medium">知识治理</span><span className="text-[10px] text-muted-foreground">重复 {duplicateSuggestions.length}</span></div>
          <div className="grid grid-cols-2 gap-1">
            <button className="h-7 rounded border disabled:opacity-50" disabled={!duplicateSuggestions.length || !graphData} onClick={mergeFirstDuplicate}>合并首个重复项</button>
            <button className="h-7 rounded border disabled:opacity-50" disabled={!mergeUndo} onClick={() => { if (!mergeUndo) return; setGraphData(mergeUndo); setNodes(mergeUndo.nodes); setMergeUndo(null); }}>撤销合并</button>
            <button className="col-span-2 h-7 rounded border disabled:opacity-50" disabled={!graphData || selectedPaths.size === 0} onClick={() => void checkDocumentChanges()}>检查所选文档更新</button>
          </div>
          {duplicateSuggestions[0] && <p className="truncate text-[10px] text-muted-foreground" title={`${duplicateSuggestions[0].canonicalId} ← ${duplicateSuggestions[0].duplicateId}`}>建议：{nodes.find((node) => node.id === duplicateSuggestions[0].canonicalId)?.label} ← {nodes.find((node) => node.id === duplicateSuggestions[0].duplicateId)?.label}</p>}
          <div className="flex gap-1"><input className="h-7 min-w-0 flex-1 rounded border bg-background px-2" value={hybridQuery} onChange={(event) => setHybridQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runHybridSearch(); }} placeholder="全文 + 实体 + 图遍历" /><button className="h-7 rounded bg-primary px-2 text-primary-foreground disabled:opacity-50" disabled={!hybridQuery.trim() || !graphData} onClick={() => void runHybridSearch()}>检索</button></div>
          {hybridResult && <div className="space-y-1 rounded border p-2"><p>命中 {hybridResult.nodes.length} 个实体、{hybridResult.edges.length} 条关系、{hybridResult.documents.length} 篇文档</p><div className="max-h-24 overflow-auto text-[10px] text-muted-foreground">{hybridResult.nodes.map((node) => <span key={node.id} className="mr-2 inline-block">{node.label}</span>)}{hybridResult.documents.map((document) => <p key={document.sourcePath ?? document.name} className="truncate">{document.name} · {Math.round(document.score * 100)}%</p>)}</div><div className="grid grid-cols-2 gap-1"><button className="h-6 rounded border" onClick={() => void navigator.clipboard.writeText(hybridResult.context).then(() => toast('检索上下文已复制', 'success'))}>复制上下文</button><button className="h-6 rounded bg-primary text-primary-foreground disabled:opacity-50" disabled={!aiApi.apiKey || graphAsking} onClick={() => void askGraph()}>{graphAsking ? '回答中…' : '基于证据回答'}</button></div>{graphAnswer && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{graphAnswer}</pre>}</div>}
        </section>

        <NodePanel
          nodes={nodes}
          nodeInput={nodeInput}
          onNodeInputChange={setNodeInput}
          onAddNode={addNode}
          onRemoveNode={removeNode}
          onResetDefault={resetDefaultNodes}
        >
          <CodeExtractControls onExtract={applyCodeGraph} />
          <ExtractControls
            existingLabels={nodes.map((n) => n.label)}
            getSelectedContents={getSelectedContents}
            onAddExtractedGraph={addExtractedGraph}
          />
        </NodePanel>

        <div className="px-3 pb-3">
          <button
            className="w-full h-8 flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            disabled={generating || nodes.length < 2 || selectedPaths.size === 0}
            onClick={generateGraph}
          >
            <Search className="h-4 w-4" />
            {generating ? '生成中…' : '生成图谱'}
          </button>
        </div>
      </div>

      {/* 右侧图谱区 */}
      <div className="flex-1 flex flex-col bg-card overflow-hidden relative">
        <GraphCanvas graphData={graphData} onNodeSelect={knowledgeIndex ? selectKnowledgeDocument : undefined} onEdgeStatusChange={updateRelationStatus} />
        {selectedKnowledgeDocument && (
          <aside className="absolute bottom-3 right-14 top-3 z-20 flex w-80 flex-col overflow-hidden rounded-lg border bg-background/95 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between border-b p-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{selectedKnowledgeDocument.title}</h3>
                <p className="truncate text-xs text-muted-foreground" title={selectedKnowledgeDocument.path}>{selectedKnowledgeDocument.path}</p>
                <button className="mt-1 rounded border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => openInEditor(selectedKnowledgeDocument.path)}>在编辑器打开</button>
              </div>
              <button className="ml-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setSelectedKnowledgeUri(null)}>×</button>
            </div>
            <div className="flex-1 space-y-4 overflow-auto p-3 text-xs">
              <section>
                <h4 className="mb-1 font-medium">反向链接（{selectedBacklinks.length}）</h4>
                {selectedBacklinks.length === 0 ? <p className="text-muted-foreground">暂无文档引用此页</p> : selectedBacklinks.map((link, index) => {
                  const source = knowledgeIndex?.documents.find((document) => document.uri === link.sourceUri);
                  return <button key={`${link.sourceUri}:${link.line}:${index}`} className="block w-full rounded px-2 py-1 text-left hover:bg-accent" onClick={() => source && openInEditor(source.path, link.line)}>{source?.title ?? link.sourceUri} · L{link.line}</button>;
                })}
              </section>
              <section>
                <h4 className="mb-1 font-medium">正向链接（{selectedOutgoing.length}）</h4>
                {selectedOutgoing.length === 0 ? <p className="text-muted-foreground">此页没有 Wiki Link</p> : selectedOutgoing.map((link, index) => (
                  <button key={`${link.target}:${link.line}:${index}`} className={`block w-full rounded px-2 py-1 text-left hover:bg-accent ${link.targetUri ? '' : 'text-destructive'}`} onClick={() => openInEditor(selectedKnowledgeDocument.path, link.line)}>
                    {link.target} · {link.status} · L{link.line}
                  </button>
                ))}
              </section>
              <section>
                <h4 className="mb-1 font-medium">内容预览</h4>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{selectedKnowledgeContent.slice(0, 6000)}</pre>
              </section>
            </div>
          </aside>
        )}
        {selectedProposal && (
          <aside className="absolute bottom-3 left-3 right-14 top-3 z-30 flex flex-col overflow-hidden rounded-lg border bg-background/95 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between border-b p-3">
              <div>
                <h3 className="text-sm font-semibold">Agent 知识变更审查</h3>
                <p className="text-xs text-muted-foreground">{selectedProposal.instruction}</p>
              </div>
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setSelectedProposalId(null)}>×</button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-3">
              {selectedProposal.mutations.map((mutation, index) => {
                const before = mutation.kind === 'create' ? '' : mutation.before;
                const after = mutation.kind === 'delete' ? '' : mutation.kind === 'rename' ? mutation.content ?? mutation.before : mutation.content;
                return (
                  <section key={`${mutation.kind}:${mutation.path}:${index}`} className="overflow-hidden rounded border">
                    <header className="border-b bg-muted px-3 py-2 text-xs font-medium">
                      {mutation.kind} · {mutation.path}{mutation.kind === 'rename' ? ` → ${mutation.targetPath}` : ''}
                    </header>
                    <div className="grid grid-cols-2 divide-x">
                      <div><p className="border-b px-2 py-1 text-[11px] text-muted-foreground">修改前</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 text-[11px]">{before || '∅'}</pre></div>
                      <div><p className="border-b px-2 py-1 text-[11px] text-muted-foreground">修改后</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 text-[11px]">{after || '∅'}</pre></div>
                    </div>
                  </section>
                );
              })}
            </div>
            <footer className="flex justify-end gap-2 border-t p-3">
              <button className="h-8 rounded border px-3 text-xs hover:bg-accent" disabled={selectedProposal.status === 'accepted' || selectedProposal.status === 'rejected'} onClick={() => activeKnowledgeWorkspace.rejectProposal(selectedProposal.id)}>拒绝</button>
              <button className="h-8 rounded bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50" disabled={selectedProposal.status !== 'ready-for-review' && selectedProposal.status !== 'partially-accepted'} onClick={() => void acceptKnowledgeProposal(selectedProposal.id)}>接受全部并写入</button>
            </footer>
          </aside>
        )}
      </div>
    </div>
  );
};
