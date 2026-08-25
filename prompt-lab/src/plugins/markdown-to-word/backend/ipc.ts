import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_DOCX_SIZE = 50 * 1024 * 1024;
const MAX_ASSET_SIZE = 15 * 1024 * 1024;

export function registerMarkdownToWordIpc(): void {
  ipcMain.handle('markdown-to-word:plantuml', async (_event, source: string, server: string) => {
    try {
      if (!source || source.length > 500_000 || !/^https?:\/\//i.test(server)) return null;
      const endpoint = new URL(`${server.replace(/\/+$/, '')}/png`);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: source, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return null;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_ASSET_SIZE) return null;
      return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png' };
    } catch { return null; }
  });
  ipcMain.handle('markdown-to-word:asset', async (_event, source: string, markdownPath?: string) => {
    try {
      if (!source || source.length > 4096) return null;
      let data: Buffer;
      let mimeType = '';
      if (/^https?:\/\//i.test(source)) {
        const url = new URL(source);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') return null;
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > MAX_ASSET_SIZE) return null;
        mimeType = response.headers.get('content-type')?.split(';')[0] || '';
        data = Buffer.from(await response.arrayBuffer());
      } else {
        if (!markdownPath) return null;
        const base = path.dirname(path.resolve(markdownPath));
        const decoded = decodeURIComponent(source.replace(/^file:\/\//i, '').split(/[?#]/)[0]);
        const target = path.resolve(base, decoded);
        const relative = path.relative(base, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
        const stat = await fs.promises.stat(target);
        if (!stat.isFile() || stat.size > MAX_ASSET_SIZE) return null;
        data = await fs.promises.readFile(target);
        const extension = path.extname(target).toLowerCase();
        mimeType = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : '';
      }
      if (!['image/png', 'image/jpeg', 'image/gif'].includes(mimeType) || data.length > MAX_ASSET_SIZE) return null;
      return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), mimeType };
    } catch { return null; }
  });
  ipcMain.handle('markdown-to-word:save', async (event, data: ArrayBuffer, defaultName?: string) => {
    try {
      if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > MAX_DOCX_SIZE) return { success: false, error: 'INVALID_DOCX_DATA' };
      const printableName = Array.from(defaultName || 'document', (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
      const safeName = `${printableName.replace(/[<>:"/\\|?*]/g, '_').replace(/\.docx$/i, '') || 'document'}.docx`;
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options = { title: '导出 Word 文档', defaultPath: safeName, filters: [{ name: 'Word 文档', extensions: ['docx'] }] };
      const selection = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      if (selection.canceled || !selection.filePath) return { success: false, error: 'CANCELLED' };
      const filePath = path.extname(selection.filePath).toLowerCase() === '.docx' ? selection.filePath : `${selection.filePath}.docx`;
      await fs.promises.writeFile(filePath, Buffer.from(data));
      return { success: true, filePath };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}
