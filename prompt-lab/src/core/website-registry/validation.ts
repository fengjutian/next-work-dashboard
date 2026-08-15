import type { WebsiteRecordInput } from './types';

export function normalizeWebsiteUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('请输入网站地址');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error('网站地址格式无效'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 HTTP 或 HTTPS 网站');
  if (parsed.username || parsed.password) throw new Error('网站地址不能包含用户名或密码');
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = '';
  if (parsed.pathname === '/') parsed.pathname = '';
  return parsed.toString().replace(/\/$/, '');
}

export function sanitizeWebsiteInput(input: WebsiteRecordInput): WebsiteRecordInput & { normalizedUrl: string } {
  const normalizedUrl = normalizeWebsiteUrl(input.url);
  const name = input.name.trim();
  if (!name) throw new Error('请输入网站名称');
  return {
    name: name.slice(0, 160),
    url: normalizedUrl,
    normalizedUrl,
    description: (input.description || '').trim().slice(0, 2000),
    categoryId: input.categoryId || null,
    tags: [...new Set((input.tags || []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 30),
    notes: (input.notes || '').trim().slice(0, 10000),
    faviconUrl: input.faviconUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(normalizedUrl).hostname)}&sz=64`,
    favorite: !!input.favorite,
    archived: !!input.archived,
  };
}

export function parseWebsiteCsv(text: string): WebsiteRecordInput[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const rows = lines.map(parseCsvLine);
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const nameIndex = header.indexOf('name');
  const urlIndex = header.indexOf('url');
  if (nameIndex < 0 || urlIndex < 0) throw new Error('CSV 必须包含 name 和 url 列');
  const index = (key: string) => header.indexOf(key);
  return rows.slice(1).map((row) => ({
    name: row[nameIndex] || '', url: row[urlIndex] || '',
    description: row[index('description')] || '', notes: row[index('notes')] || '',
    tags: (row[index('tags')] || '').split('|').map((tag) => tag.trim()).filter(Boolean),
    favorite: /^(1|true|yes)$/i.test(row[index('favorite')] || ''),
  }));
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}
