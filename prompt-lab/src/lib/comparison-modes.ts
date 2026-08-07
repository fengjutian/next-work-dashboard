import { DOMParser } from '@xmldom/xmldom';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

export type CompareMode = 'plain' | 'chinese-word' | 'paragraph' | 'json' | 'yaml' | 'xml' | 'csv' | 'markdown' | 'env';

export interface ChineseComparisonOptions {
  normalizeWidth?: boolean;
  ignorePunctuation?: boolean;
}

export interface JsonComparisonOptions {
  arrayKey?: string;
  onlyChanges?: boolean;
}

export interface JsonTreeChange {
  path: string;
  type: 'add' | 'remove' | 'replace';
  before?: unknown;
  after?: unknown;
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

function punctuationPattern(): RegExp {
  try { return new RegExp('[\\p{P}\\p{S}]', 'gu'); } catch { return /[，。！？；：、“”‘’（）【】《》,.!?;:'"()[\]{}<>]/g; }
}

export function normalizeChineseText(text: string, options: ChineseComparisonOptions = {}): string {
  let value = options.normalizeWidth ? text.normalize('NFKC') : text;
  if (options.ignorePunctuation) value = value.replace(punctuationPattern(), ' ');
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: 'word' }) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (!Segmenter) return value.replace(/\s+/g, ' ').trim();
  const segmenter = new Segmenter('zh-CN', { granularity: 'word' });
  return [...segmenter.segment(value)]
    .map((part) => part.segment.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeParagraphs(text: string): string {
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n+/).map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')).filter(Boolean).join('\n\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function canonicalizeJson(value: unknown, arrayKey?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item, arrayKey));
    if (arrayKey && items.every((item) => isRecord(item) && arrayKey in item)) {
      return [...items].sort((left, right) => String((left as Record<string, unknown>)[arrayKey]).localeCompare(String((right as Record<string, unknown>)[arrayKey]), undefined, { numeric: true }));
    }
    return items;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key], arrayKey)]));
}

export function formatJsonForComparison(text: string, options: JsonComparisonOptions = {}): string {
  return JSON.stringify(canonicalizeJson(JSON.parse(text) as unknown, options.arrayKey), null, 2);
}

export function diffJsonTree(before: unknown, after: unknown, path = ''): JsonTreeChange[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: JsonTreeChange[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= before.length) changes.push({ path: childPath, type: 'add', after: after[index] });
      else if (index >= after.length) changes.push({ path: childPath, type: 'remove', before: before[index] });
      else changes.push(...diffJsonTree(before[index], after[index], childPath));
    }
    return changes;
  }
  if (isRecord(before) && isRecord(after)) {
    const changes: JsonTreeChange[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const childPath = `${path}/${pointerSegment(key)}`;
      if (!(key in before)) changes.push({ path: childPath, type: 'add', after: after[key] });
      else if (!(key in after)) changes.push({ path: childPath, type: 'remove', before: before[key] });
      else changes.push(...diffJsonTree(before[key], after[key], childPath));
    }
    return changes;
  }
  return [{ path: path || '/', type: 'replace', before, after }];
}

export function createJsonPatch(before: unknown, after: unknown): JsonPatchOperation[] {
  return diffJsonTree(before, after).map((change) => change.type === 'remove'
    ? { op: 'remove', path: change.path }
    : { op: change.type, path: change.path, value: change.after });
}

function decodePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error('JSON_PATCH_PATH_INVALID');
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function applyJsonPatch(value: unknown, operations: JsonPatchOperation[]): unknown {
  let root = structuredClone(value);
  for (const operation of operations) {
    const segments = decodePointer(operation.path);
    if (segments.length === 0) {
      if (operation.op === 'remove') root = undefined;
      else root = structuredClone(operation.value);
      continue;
    }
    let parent: unknown = root;
    for (const segment of segments.slice(0, -1)) {
      if (Array.isArray(parent)) parent = parent[Number(segment)];
      else if (isRecord(parent)) parent = parent[segment];
      else throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
    }
    const key = segments[segments.length - 1];
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
      if (operation.op === 'add') parent.splice(index, 0, structuredClone(operation.value));
      else if (operation.op === 'remove') {
        if (index >= parent.length) throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
        parent.splice(index, 1);
      } else {
        if (index >= parent.length) throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
        parent[index] = structuredClone(operation.value);
      }
    } else if (isRecord(parent)) {
      if (operation.op === 'remove') {
        if (!(key in parent)) throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
        delete parent[key];
      } else {
        if (operation.op === 'replace' && !(key in parent)) throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
        parent[key] = structuredClone(operation.value);
      }
    } else throw new Error(`JSON_PATCH_PATH_MISSING:${operation.path}`);
  }
  return root;
}

export function changesOnlyText(changes: JsonTreeChange[], side: 'before' | 'after'): string {
  return changes.filter((change) => side === 'before' ? change.type !== 'add' : change.type !== 'remove').map((change) => {
    const value = side === 'before' ? change.before : change.after;
    return `${change.path}: ${JSON.stringify(value)}`;
  }).join('\n');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (quoted) throw new Error('CSV_QUOTE_UNCLOSED');
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export function formatCsvForComparison(text: string): string {
  const rows = parseCsv(text);
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row, rowIndex) => `${String(rowIndex + 1).padStart(4, '0')} │ ${Array.from({ length: width }, (_, index) => (row[index] ?? '').replace(/\r?\n/g, '↵')).join(' │ ')}`).join('\n');
}

export function formatMarkdownForComparison(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let fence = '';
  const flush = () => {
    if (paragraph.length) output.push(`P │ ${paragraph.join(' ').replace(/\s+/g, ' ').trim()}`);
    paragraph = [];
  };
  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)\s*(.*)$/.exec(line);
    if (fenceMatch) {
      flush();
      if (!fence) { fence = fenceMatch[1][0]; output.push(`CODE ${fenceMatch[2].trim()} │`); }
      else { fence = ''; output.push('END CODE │'); }
      continue;
    }
    if (fence) { output.push(`  ${line}`); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const list = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (heading) { flush(); output.push(`H${heading[1].length} │ ${heading[2].trim()}`); }
    else if (list) { flush(); output.push(`LI │ ${list[1].trim()}`); }
    else if (quote) { flush(); output.push(`QUOTE │ ${quote[1].trim()}`); }
    else if (!line.trim()) flush();
    else paragraph.push(line.trim());
  }
  flush();
  return output.join('\n');
}

const secretKeyPattern = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|PRIVATE_?KEY|CREDENTIAL)(?:_|$)/i;

export function formatEnvForComparison(text: string, redactSecrets = true): string {
  const values = new Map<string, string>();
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`ENV_LINE_INVALID:${rawLine}`);
    values.set(match[1], redactSecrets && secretKeyPattern.test(match[1]) ? '<redacted>' : match[2]);
  }
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
}

export function formatYamlForComparison(text: string, arrayKey?: string): string {
  return dumpYaml(canonicalizeJson(loadYaml(text), arrayKey), { indent: 2, noRefs: true, sortKeys: true, lineWidth: -1 }).trimEnd();
}

function escapeXml(value: string, attribute = false): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attribute ? escaped.replace(/"/g, '&quot;') : escaped;
}

function serializeXmlElement(element: Element, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const attributes = Array.from({ length: element.attributes.length }, (_, index) => element.attributes.item(index))
    .filter((attribute): attribute is Attr => attribute !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => `${attribute.name}="${escapeXml(attribute.value, true)}"`);
  const open = `<${element.tagName}${attributes.length ? ` ${attributes.join(' ')}` : ''}`;
  const childElements: Element[] = [];
  const textParts: string[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) childElements.push(child as Element);
    else if (child?.nodeType === 3 && child.nodeValue?.trim()) textParts.push(child.nodeValue.trim());
  }
  if (childElements.length === 0) {
    const text = textParts.join(' ');
    return [`${indent}${open}>${text ? escapeXml(text) : ''}</${element.tagName}>`];
  }
  return [`${indent}${open}>`, ...textParts.map((text) => `${indent}  ${escapeXml(text)}`), ...childElements.flatMap((child) => serializeXmlElement(child, depth + 1)), `${indent}</${element.tagName}>`];
}

export function formatXmlForComparison(text: string): string {
  const errors: string[] = [];
  const document = new DOMParser({ onError: (level, message) => { if (level === 'error' || level === 'fatalError') errors.push(message); } }).parseFromString(text, 'application/xml');
  if (errors.length || !document.documentElement) throw new Error(`XML_PARSE_ERROR:${errors[0] ?? 'missing root element'}`);
  return serializeXmlElement(document.documentElement as unknown as Element, 0).join('\n');
}
