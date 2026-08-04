import React, { useEffect, useState, useCallback } from 'react';
import { Search } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store';
import type { ConversationFile } from '@/types/electron';
import type { GraphNode, GraphData } from './graph-types';
import { GraphCanvas } from './GraphCanvas';
import { FileSelector } from './FileSelector';
import { NodePanel } from './NodePanel';
import { ExtractControls } from './ExtractControls';
import type { KnowledgeDiagnostic, KnowledgeIndex, KnowledgeTemplate } from '@/core/knowledge';

type KnowledgeWorkspaceView = KnowledgeIndex & {
  templates: KnowledgeTemplate[];
  diagnostics: KnowledgeDiagnostic[];
  skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
};

// ── 常量 ──

const DEFAULT_NODES = [
  'React', 'TypeScript', 'Electron', 'Zustand',
  'Vite', 'Tailwind', 'SQLite', 'Drizzle',
];

// ── 默认节点工厂 ──
const makeDefaultNodes = (): GraphNode[] =>
  DEFAULT_NODES.map((name) => ({
    id: name,
    label: name,
    degree: 0,
    source: 'manual' as const,
  }));

// ── 主组件 ──

export const KnowledgeGraph: React.FC = () => {
  const { toast } = useToast();
  const conversationSavedAt = useStore((s) => s.conversationSavedAt);

  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [nodeInput, setNodeInput] = useState('');
  const [nodes, setNodes] = useState<GraphNode[]>(makeDefaultNodes);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [knowledgeWorkspace, setKnowledgeWorkspace] = useState<string | null>(null);
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeWorkspaceView | null>(null);
  const [templateTitle, setTemplateTitle] = useState('');

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

  // ── 获取选中文件内容（供 AI 抽取使用） ──
  const getSelectedContents = useCallback(async (): Promise<{ name: string; content: string }[]> => {
    const selected = files.filter((f) => selectedPaths.has(f.path));
    const api = (window as any).electronAPI;
    if (!api?.readConversation) return [];
    const results: { name: string; content: string }[] = [];
    for (const file of selected) {
      const result = await api.readConversation(file.path);
      if (result.success && result.content) {
        results.push({ name: file.title || file.fileName, content: result.content });
      }
    }
    return results;
  }, [files, selectedPaths]);

  // ── 添加 AI 抽取的节点 ──
  const addExtractedNodes = useCallback((newNodes: GraphNode[]) => {
    setNodes((prev) => {
      const existingLabels = new Set(prev.map((n) => n.label));
      const toAdd = newNodes.filter((n) => !existingLabels.has(n.label));
      return [...prev, ...toAdd];
    });
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

  const scanKnowledgeWorkspace = useCallback(async (rootPath: string) => {
      const result = await window.electronAPI.knowledge.scanWorkspace(rootPath);
      if (!result.success || !result.data) throw new Error(result.error ?? 'SCAN_FAILED');
      const index = result.data as KnowledgeWorkspaceView;
      const edgeCount = applyKnowledgeIndex(index);
      const unresolved = index.links.filter((link) => link.status !== 'resolved').length;
      toast(`已索引 ${index.documents.length} 篇知识文档、${edgeCount} 条显式链接；${unresolved} 条待解析`, 'success');
  }, [applyKnowledgeIndex, toast]);

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

  const createFromTemplate = useCallback(async (templateId: string) => {
    if (!knowledgeWorkspace || !templateTitle.trim()) return;
    setGenerating(true);
    try {
      const result = await window.electronAPI.knowledge.createFromTemplate(
        knowledgeWorkspace, templateId, { title: templateTitle.trim() },
      );
      if (!result.success || !result.data) throw new Error(result.error ?? 'CREATE_FAILED');
      toast(`已创建 ${result.data.path}`, 'success');
      setTemplateTitle('');
      await scanKnowledgeWorkspace(knowledgeWorkspace);
    } catch (error) {
      toast(`模板创建失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [knowledgeWorkspace, scanKnowledgeWorkspace, templateTitle, toast]);

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
              <input
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                placeholder="新文档标题"
              />
              <div className="flex flex-wrap gap-1">
                {knowledgeIndex.templates.map((template) => (
                  <button
                    key={template.id}
                    className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                    disabled={generating || !templateTitle.trim()}
                    onClick={() => void createFromTemplate(template.id)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
              <div className="rounded bg-muted p-2 text-xs text-muted-foreground">
                <p>孤立文档 {knowledgeIndex.orphanUris.length}</p>
                <p>未解析链接 {knowledgeIndex.links.filter((link) => link.status === 'unresolved').length}</p>
                <p>歧义链接 {knowledgeIndex.links.filter((link) => link.status === 'ambiguous').length}</p>
                <p>规则问题 {knowledgeIndex.diagnostics.length}</p>
              </div>
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

        <NodePanel
          nodes={nodes}
          nodeInput={nodeInput}
          onNodeInputChange={setNodeInput}
          onAddNode={addNode}
          onRemoveNode={removeNode}
          onResetDefault={resetDefaultNodes}
        >
          <ExtractControls
            existingLabels={nodes.map((n) => n.label)}
            getSelectedContents={getSelectedContents}
            onAddExtractedNodes={addExtractedNodes}
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
        <GraphCanvas graphData={graphData} />
      </div>
    </div>
  );
};
