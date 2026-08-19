import fs from 'node:fs/promises';
import path from 'node:path';

export interface DoclingResult { plainText: string; markdown: string; pages: Array<{ page: number; text: string }> }

export async function parseWithDocling(sourcePath: string, baseUrl: string, signal?: AbortSignal): Promise<DoclingResult> {
  const resolved = path.resolve(sourcePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('INVALID_OCR_FILE');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('INVALID_DOCLING_URL');
  const form = new FormData();
  form.append('files', new Blob([await fs.readFile(resolved)]), path.basename(resolved));
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/convert/file`, { method: 'POST', body: form, signal });
  if (!response.ok) throw new Error(`DOCLING_HTTP_${response.status}`);
  return normalizeDoclingResponse(await response.json());
}

export function normalizeDoclingResponse(payload: unknown): DoclingResult {
  const value = payload as Record<string, unknown>;
  const document = (value.document || value.result || value) as Record<string, unknown>;
  const markdown = String(document.md_content || document.markdown || document.text || '');
  const pagesValue = Array.isArray(document.pages) ? document.pages : [];
  const pages = pagesValue.map((page, index) => {
    const record = page as Record<string, unknown>;
    return { page: Number(record.page_no || record.page || index + 1), text: String(record.text || record.content || '') };
  }).filter((page) => page.text.trim());
  const plainText = String(document.text || pages.map((page) => page.text).join('\n\n') || markdown.replace(/[#*_`()><]/g, ' ').replace(/\[/g, ' ').replace(/\]/g, ' ')).trim();
  if (!plainText) throw new Error('DOCLING_EMPTY_RESULT');
  return { plainText, markdown: markdown || plainText, pages };
}
