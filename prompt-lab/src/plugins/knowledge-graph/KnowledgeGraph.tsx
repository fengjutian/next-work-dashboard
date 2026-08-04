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
import { getKnowledgeTemplateVariables, instantiateKnowledgeTemplate, type KnowledgeChangeProposal, type KnowledgeDiagnostic, type KnowledgeIndex, type KnowledgeTemplate } from '@/core/knowledge';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import { requestEditorNavigation } from '@/services/editor-navigation';

type KnowledgeWorkspaceView = KnowledgeIndex & {
  templates: KnowledgeTemplate[];
  diagnostics: KnowledgeDiagnostic[];
  skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
};
type KnowledgeSearchMatch = { uri: string; path: string; title: string; score: number; snippets: Array<{ line: number; text: string }> };

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
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const conversationSavedAt = useStore((s) => s.conversationSavedAt);

  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [nodeInput, setNodeInput] = useState('');
  const [nodes, setNodes] = useState<GraphNode[]>(makeDefaultNodes);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [knowledgeWorkspace, setKnowledgeWorkspace] = useState<string | null>(null);
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeWorkspaceView | null>(null);
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
      activeKnowledgeWorkspace.setActive(rootPath, index);
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
        <GraphCanvas graphData={graphData} onNodeSelect={knowledgeIndex ? selectKnowledgeDocument : undefined} />
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
