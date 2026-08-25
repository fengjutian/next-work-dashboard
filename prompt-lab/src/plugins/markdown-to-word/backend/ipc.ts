import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_DOCX_SIZE = 50 * 1024 * 1024;

export function registerMarkdownToWordIpc(): void {
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
