import React, { useCallback, useState } from 'react';
import { Loader2 } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { extractCodeGraph, isSupportedCodePath } from '@/core';
import type { GraphData } from './graph-types';

export const CodeExtractControls: React.FC<{ onExtract: (graph: GraphData) => void }> = ({ onExtract }) => {
  const { toast } = useToast();
  const [extracting, setExtracting] = useState(false);
  const [maxNodes, setMaxNodes] = useState(100);
  const handleExtract = useCallback(async () => {
    const folder = await window.electronAPI.workspace.openFolder();
    if (!folder) return;
    setExtracting(true);
    try {
      const listed = await window.electronAPI.workspace.listFiles(folder.path);
      if (!listed.success) throw new Error(listed.error ?? '无法扫描工作区');
      const paths = (listed.data ?? []).map((file) => file.path).filter(isSupportedCodePath).slice(0, 500);
      const documents = [];
      for (const path of paths) {
        const result = await window.electronAPI.workspace.readTextFile(folder.path, path);
        if (result.success && result.data?.content.length <= 500_000) documents.push({ path, content: result.data.content });
      }
      if (documents.length === 0) throw new Error('所选工作区中没有可抽取的 JavaScript/TypeScript 文件');
      const graph = extractCodeGraph(documents, { maxNodes });
      onExtract(graph);
      toast(`代码图谱：${documents.length} 个文件，${graph.nodes.length} 个节点，${graph.edges.length} 条边`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '代码抽取失败', 'error');
    } finally { setExtracting(false); }
  }, [maxNodes, onExtract, toast]);
  return <div className="flex gap-1">
    <select aria-label="代码图谱最大节点数" className="h-7 w-20 rounded border border-input bg-card px-1 text-[11px]" value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} disabled={extracting}>
      <option value={100}>100 节点</option><option value={250}>250 节点</option><option value={500}>500 节点</option>
    </select>
    <button className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-input text-xs hover:bg-accent disabled:opacity-50" disabled={extracting} onClick={() => void handleExtract()}>
      {extracting && <Loader2 className="h-3 w-3 animate-spin" />}{extracting ? '正在分析代码…' : '从代码工作区抽取'}
    </button>
  </div>;
};
