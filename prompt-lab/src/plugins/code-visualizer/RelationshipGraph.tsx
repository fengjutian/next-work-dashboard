import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { AnalysisEdge, AnalysisNode, ApiEndpoint } from '../../core/code-visualizer';

const COLORS: Record<AnalysisNode['kind'], string> = {
  frontend: '#8b5cf6', endpoint: '#2563eb', controller: '#0891b2', service: '#059669', repository: '#d97706', model: '#db2777', database: '#dc2626',
};

export function RelationshipGraph({ endpoint, graph, onOpenSource, onSelectNode }: { endpoint?: ApiEndpoint; graph?: { nodes: AnalysisNode[]; edges: AnalysisEdge[] }; onOpenSource: (node: AnalysisNode) => void; onSelectNode?: (node: AnalysisNode) => void }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const data = graph ?? endpoint;
  useEffect(() => {
    if (!containerRef.current || !data) return undefined;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((node) => ({ data: { id: node.id, label: node.label, kind: node.kind, node } })),
        ...data.edges.map((edge, index) => ({ data: { id: `edge:${index}`, source: edge.source, target: edge.target, label: edge.kind, confidence: edge.confidence, evidence: edge.evidence } })),
      ],
      style: [
        { selector: 'node', style: { 'background-color': (element: cytoscape.NodeSingular) => COLORS[element.data('kind') as AnalysisNode['kind']], label: 'data(label)', color: '#f8fafc', 'font-size': 11, 'text-wrap': 'ellipsis', 'text-max-width': 130, 'text-valign': 'center', width: 170, height: 44, shape: 'round-rectangle', 'border-width': 2, 'border-color': '#ffffff', 'border-opacity': 0.18 } as unknown as cytoscape.Css.Node },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-opacity': 0.9 } as unknown as cytoscape.Css.Node },
        { selector: 'edge', style: { width: 1.5, 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 9, color: '#64748b', 'text-background-color': '#ffffff', 'text-background-opacity': 0.85, 'text-background-padding': 2, 'line-style': 'solid' } as unknown as cytoscape.Css.Edge },
        { selector: 'edge[confidence = "inferred"]', style: { 'line-style': 'dashed', opacity: 0.72 } as unknown as cytoscape.Css.Edge },
      ],
      layout: { name: 'breadthfirst', directed: true, padding: 32, spacingFactor: 1.2 },
      minZoom: 0.25,
      maxZoom: 2.5,
    });
    cy.on('tap', 'node', (event) => {
      const node = event.target.data('node') as AnalysisNode;
      onSelectNode?.(node);
      if (node.location) onOpenSource(node);
    });
    return () => cy.destroy();
  }, [data, onOpenSource, onSelectNode]);
  return <div className="relative h-[520px] overflow-hidden rounded-xl border bg-card shadow-sm"><div ref={containerRef} className="h-full w-full"/><div className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-background/90 px-3 py-2 text-[11px] text-muted-foreground shadow-sm">实线：精确关系 · 虚线：推断关系 · 点击节点查看源码</div></div>;
}
