import type { GraphData, GraphHealthReport, ImpactAnalysis } from '@/plugins/knowledge-graph/graph-types';

export type GraphExportFormat = 'json' | 'markdown' | 'svg' | 'pdf';
export function graphToMarkdown(graph: GraphData, health?: GraphHealthReport, impact?: ImpactAnalysis): string {
  const lines = ['# 知识图谱报告', '', `- 节点：${graph.nodes.length}`, `- 关系：${graph.edges.length}`];
  if (health) lines.push(`- 健康度：${health.score} / ${health.grade}`, `- 发现：${health.findings.length}`);
  if (impact) lines.push(`- 影响中心：${impact.centerId}`, `- 直接影响：${impact.direct.length}`, `- 间接影响：${impact.transitive.length}`, `- 风险分：${impact.score}`);
  lines.push('', '## 节点', '', ...graph.nodes.map((node) => `- ${node.label}${node.category ? `（${node.category}）` : ''}`), '', '## 关系', '', ...graph.edges.map((edge) => `- ${edge.source} → ${edge.target}${edge.label ? `：${edge.label}` : ''}${edge.status ? ` [${edge.status}]` : ''}`));
  return `${lines.join('\n')}\n`;
}
export function graphToSvg(graph: GraphData): string {
  const width = 1200; const height = Math.max(600, Math.ceil(graph.nodes.length / 8) * 100 + 100); const positions = new Map(graph.nodes.map((node, i) => [node.id, { x: 90 + (i % 8) * 145, y: 80 + Math.floor(i / 8) * 100 }]));
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
  const edges = graph.edges.map((edge) => { const a = positions.get(edge.source); const b = positions.get(edge.target); return a && b ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#94a3b8" stroke-width="1.5"/>` : ''; }).join('');
  const nodes = graph.nodes.map((node) => { const p = positions.get(node.id)!; return `<g><circle cx="${p.x}" cy="${p.y}" r="25" fill="#7c3aed"/><text x="${p.x}" y="${p.y + 40}" text-anchor="middle" font-size="11" fill="#111827">${escape(node.label.slice(0, 24))}</text></g>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${edges}${nodes}</svg>`;
}
export function exportGraphContent(format: Exclude<GraphExportFormat, 'pdf'>, graph: GraphData, health?: GraphHealthReport, impact?: ImpactAnalysis): { mime: string; extension: string; content: string } {
  if (format === 'json') return { mime: 'application/json', extension: 'json', content: JSON.stringify({ version: 2, exportedAt: Date.now(), graph, health, impact }, null, 2) };
  if (format === 'svg') return { mime: 'image/svg+xml', extension: 'svg', content: graphToSvg(graph) };
  return { mime: 'text/markdown', extension: 'md', content: graphToMarkdown(graph, health, impact) };
}
