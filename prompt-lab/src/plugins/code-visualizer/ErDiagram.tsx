import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { DatabaseRelation, DatabaseTable } from '../../core/code-visualizer';

export function ErDiagram({ tables, relations }: { tables: DatabaseTable[]; relations: DatabaseRelation[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const names = new Set(tables.map((table) => table.name));
    const cy = cytoscape({ container: ref.current, elements: [
      ...tables.map((table) => ({ data: { id: table.name, label: [table.name, ...table.fields.slice(0, 12).map((field) => `${field.primaryKey ? 'PK ' : field.foreignKey ? 'FK ' : ''}${field.name}: ${field.type}`), ...(table.fields.length > 12 ? [`… ${table.fields.length - 12} more`] : [])].join('\n') } })),
      ...relations.filter((relation) => names.has(relation.sourceTable) && names.has(relation.targetTable)).map((relation, index) => ({ data: { id: `relation:${index}`, source: relation.sourceTable, target: relation.targetTable, label: `${relation.sourceField} → ${relation.targetField}` } })),
    ], style: [
      { selector: 'node', style: { shape: 'round-rectangle', width: 220, height: 'label', padding: 14, label: 'data(label)', 'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'left', 'font-size': 11, color: '#f8fafc', 'background-color': '#7c3a78', 'border-width': 2, 'border-color': '#a855a2' } as unknown as cytoscape.Css.Node },
      { selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': '#a855a2', 'target-arrow-color': '#a855a2', label: 'data(label)', 'font-size': 9, color: '#6b7280', 'text-background-color': '#fff', 'text-background-opacity': 0.9, 'text-background-padding': 2 } as unknown as cytoscape.Css.Edge },
    ], layout: { name: 'breadthfirst', directed: true, padding: 36, spacingFactor: 1.25 }, minZoom: 0.2, maxZoom: 2.5 });
    return () => cy.destroy();
  }, [relations, tables]);
  return <div ref={ref} className="h-[520px] w-full rounded-xl border bg-card"/>;
}
