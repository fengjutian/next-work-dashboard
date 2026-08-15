import type { AnalysisEdge, AnalysisNode, CodeVisualizerSnapshotDiff, DatabaseRelation, DatabaseTable, RepositoryAnalysis } from './types';

export function enrichRepositoryArchitecture(result: RepositoryAnalysis): RepositoryAnalysis {
  const tableMap = new Map<string, DatabaseTable>();
  const nodeMap = new Map<string, AnalysisNode>();
  const edgeMap = new Map<string, AnalysisEdge>();
  for (const endpoint of result.endpoints) {
    for (const table of endpoint.databaseTables ?? []) if (!tableMap.has(table.name) || table.fields.length > (tableMap.get(table.name)?.fields.length ?? 0)) tableMap.set(table.name, table);
    for (const node of endpoint.nodes) nodeMap.set(node.id, node);
    for (const edge of endpoint.edges) edgeMap.set(`${edge.source}:${edge.kind}:${edge.target}`, edge);
  }
  const relations: DatabaseRelation[] = [];
  for (const table of tableMap.values()) for (const field of table.fields) if (field.foreignKey) {
    const [targetTable, targetField = 'id'] = field.foreignKey.split('.');
    relations.push({ sourceTable: table.name, sourceField: field.name, targetTable, targetField, kind: field.type.includes('ManyToMany') ? 'many-to-many' : field.type.includes('OneToOne') ? 'one-to-one' : 'many-to-one' });
  }
  result.databaseTables = [...tableMap.values()];
  result.databaseRelations = relations;
  result.globalGraph = { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  return result;
}

export function diffRepositorySnapshots(from: RepositoryAnalysis, to: RepositoryAnalysis, fromId = '', toId = ''): CodeVisualizerSnapshotDiff {
  const endpointKey = (method: string, path: string) => `${method} ${path}`;
  const fromEndpoints = new Map(from.endpoints.map((endpoint) => [endpointKey(endpoint.method, endpoint.normalizedPath), endpoint]));
  const toEndpoints = new Map(to.endpoints.map((endpoint) => [endpointKey(endpoint.method, endpoint.normalizedPath), endpoint]));
  const addedEndpoints = [...toEndpoints.keys()].filter((key) => !fromEndpoints.has(key));
  const removedEndpoints = [...fromEndpoints.keys()].filter((key) => !toEndpoints.has(key));
  const changedContracts = [...toEndpoints.keys()].filter((key) => fromEndpoints.has(key) && JSON.stringify(fromEndpoints.get(key)?.contract) !== JSON.stringify(toEndpoints.get(key)?.contract));
  const fromTables = new Map((from.databaseTables ?? []).map((table) => [table.name, table]));
  const toTables = new Map((to.databaseTables ?? []).map((table) => [table.name, table]));
  const addedTables = [...toTables.keys()].filter((key) => !fromTables.has(key));
  const removedTables = [...fromTables.keys()].filter((key) => !toTables.has(key));
  const fieldSet = (tables: Map<string, DatabaseTable>) => new Set([...tables.values()].flatMap((table) => table.fields.map((field) => `${table.name}.${field.name}:${field.type}`)));
  const fromFields = fieldSet(fromTables); const toFields = fieldSet(toTables);
  return { fromId, toId, addedEndpoints, removedEndpoints, changedContracts, addedTables, removedTables, addedFields: [...toFields].filter((field) => !fromFields.has(field)), removedFields: [...fromFields].filter((field) => !toFields.has(field)), diagnosticDelta: (to.diagnostics?.length ?? 0) - (from.diagnostics?.length ?? 0) };
}
