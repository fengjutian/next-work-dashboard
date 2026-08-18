import type { DatabaseTable, IndexGovernanceReport, LiveDatabaseConnection, QueryPerformanceEntry, RepositoryAnalysis, SchemaComparisonReport } from './types';
import { parseSqlStructure } from './advanced-analysis';

export function compareOrmWithLiveSchema(ormTables: DatabaseTable[], connection: LiveDatabaseConnection): SchemaComparisonReport {
  const orm = new Map(ormTables.map((table) => [table.name.toLowerCase(), table])); const live = new Map(connection.tables.map((table) => [table.name.toLowerCase(), table]));
  const report: SchemaComparisonReport = { missingTables: [], extraTables: [], missingColumns: [], extraColumns: [], typeMismatches: [], nullableMismatches: [] };
  for (const [name, table] of orm) {
    const actual = live.get(name); if (!actual) { report.missingTables.push(table.name); continue; }
    const actualColumns = new Map(actual.columns.map((column) => [column.name.toLowerCase(), column])); const ormColumns = new Map(table.fields.map((field) => [field.name.toLowerCase(), field]));
    for (const [fieldName, field] of ormColumns) { const column = actualColumns.get(fieldName); const id = `${table.name}.${field.name}`; if (!column) report.missingColumns.push(id); else { if (!compatibleType(field.type, column.type)) report.typeMismatches.push({ field: id, ormType: field.type, databaseType: column.type }); if (column.nullable !== undefined && field.nullable !== column.nullable) report.nullableMismatches.push({ field: id, ormNullable: field.nullable, databaseNullable: column.nullable }); } }
    for (const [columnName, column] of actualColumns) if (!ormColumns.has(columnName)) report.extraColumns.push(`${table.name}.${column.name}`);
  }
  for (const [name, table] of live) if (!orm.has(name)) report.extraTables.push(table.name);
  return report;
}

export function analyzeIndexes(result: RepositoryAnalysis, connection: LiveDatabaseConnection): IndexGovernanceReport {
  const findings: IndexGovernanceReport['findings'] = []; let indexes = 0;
  const tableMap = new Map(connection.tables.map((table) => [table.name.toLowerCase(), table]));
  for (const table of connection.tables) {
    const list = table.indexes ?? []; indexes += list.length;
    for (let left = 0; left < list.length; left += 1) for (let right = 0; right < list.length; right += 1) if (left !== right && isPrefix(list[left].columns, list[right].columns)) findings.push({ rule: 'redundant-index', severity: 'info', table: table.name, columns: list[left].columns, message: `${list[left].name} 是 ${list[right].name} 的左前缀，可能冗余` });
  }
  for (const query of result.databaseAnalysis?.queries ?? []) {
    const structure = query.structure ?? parseSqlStructure(query.sql);
    const checkColumn = (raw: string, rule: 'missing-filter-index' | 'missing-join-index'): void => {
      const [alias, field] = raw.includes('.') ? raw.split('.', 2) : ['', raw]; const tableName = structure.aliases?.[alias] ?? (structure.tables.length === 1 ? structure.tables[0] : alias); const table = tableMap.get(tableName.toLowerCase()); if (!table || !field) return;
      if (!(table.indexes ?? []).some((index) => index.columns[0]?.toLowerCase() === field.toLowerCase())) findings.push({ rule, severity: 'warning', table: table.name, columns: [field], message: `${table.name}.${field} 用于${rule === 'missing-filter-index' ? '过滤' : '连接'}，但未发现以该字段开头的索引`, suggestedSql: `CREATE INDEX idx_${safe(table.name)}_${safe(field)} ON \`${table.name}\` (\`${field}\`);` });
    };
    for (const raw of structure.filterColumns ?? []) checkColumn(raw, 'missing-filter-index');
    for (const join of structure.joins) for (const raw of join.condition?.matchAll(/(?:(\w+)\.)?(\w+)\s*=\s*(?:(\w+)\.)?(\w+)/g) ?? []) { checkColumn(`${raw[1] ?? ''}.${raw[2]}`, 'missing-join-index'); checkColumn(`${raw[3] ?? ''}.${raw[4]}`, 'missing-join-index'); }
  }
  const unique = [...new Map(findings.map((finding) => [`${finding.rule}:${finding.table}:${finding.columns.join(',')}:${finding.message}`, finding])).values()];
  return { findings: unique, indexes, suggestions: unique.filter((finding) => finding.suggestedSql).length };
}

export function sqlFingerprint(sql: string): string { return sql.replace(/'(?:''|[^'])*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim().toUpperCase(); }
export function createPerformanceEntry(sql: string, report: { engine: QueryPerformanceEntry['engine']; summary: string; findings: Array<{ rule: string }> }): QueryPerformanceEntry { const fingerprint = sqlFingerprint(sql); return { id: `${Date.now()}:${fingerprint.slice(0, 32)}`, fingerprint, engine: report.engine, recordedAt: Date.now(), summary: report.summary, findingRules: report.findings.map((finding) => finding.rule), sqlPreview: sql.replace(/'(?:''|[^'])*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?').slice(0, 300) }; }

function compatibleType(orm: string, database: string): boolean { const normalize = (value: string) => value.toLowerCase().replace(/\([^)]*\)/g, '').replace(/mapped\[|\]/g, '').replace(/integer/, 'int').replace(/varchar|text|string|str/, 'string').trim(); return normalize(orm) === normalize(database) || normalize(orm).includes(normalize(database)) || normalize(database).includes(normalize(orm)); }
function isPrefix(left: string[], right: string[]): boolean { return left.length <= right.length && left.every((column, index) => column.toLowerCase() === right[index]?.toLowerCase()); }
function safe(value: string): string { return value.replace(/\W+/g, '_').toLowerCase(); }
