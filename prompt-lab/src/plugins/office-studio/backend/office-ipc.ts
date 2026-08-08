import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { addOfficeElement, closeOfficeDocument, createOfficeDocument, getOfficeCliStatus, getOfficeElement, getOfficeOutline, queryOfficeElements, removeOfficeElement, renderOfficeHtml, saveOfficeDocument, setOfficeProperties } from './office-service';
import type { OfficeAddRequest, OfficeDocumentKind, OfficeSetRequest } from '../types';

const definitions: Record<OfficeDocumentKind, { extension: string; label: string }> = {
  docx: { extension: 'docx', label: 'Word 文档' },
  xlsx: { extension: 'xlsx', label: 'Excel 工作簿' },
  pptx: { extension: 'pptx', label: 'PowerPoint 演示文稿' },
};

export function registerOfficeIpc(): void {
  ipcMain.handle('office:status', () => getOfficeCliStatus());
  ipcMain.handle('office:outline', (_event, filePath: string) => getOfficeOutline(filePath));
  ipcMain.handle('office:get', (_event, filePath: string, domPath: string, depth?: number) => getOfficeElement(filePath, domPath, depth));
  ipcMain.handle('office:query', (_event, filePath: string, selector: string) => queryOfficeElements(filePath, selector));
  ipcMain.handle('office:set', (_event, request: OfficeSetRequest) => setOfficeProperties(request));
  ipcMain.handle('office:add', (_event, request: OfficeAddRequest) => addOfficeElement(request));
  ipcMain.handle('office:remove', (_event, filePath: string, domPath: string) => removeOfficeElement(filePath, domPath));
  ipcMain.handle('office:save', (_event, filePath: string) => saveOfficeDocument(filePath));
  ipcMain.handle('office:render', (_event, filePath: string) => renderOfficeHtml(filePath));
  ipcMain.handle('office:close', (_event, filePath: string) => closeOfficeDocument(filePath));
  ipcMain.handle('office:create', async (event, kind: OfficeDocumentKind) => {
    const definition = definitions[kind];
    if (!definition) return { success: false, error: 'UNSUPPORTED_OFFICE_FORMAT' };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: `新建${definition.label}`,
      defaultPath: `未命名.${definition.extension}`,
      filters: [{ name: definition.label, extensions: [definition.extension] }],
    };
    const selection = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { success: false, error: 'CANCELLED' };
    const filePath = path.extname(selection.filePath) ? selection.filePath : `${selection.filePath}.${definition.extension}`;
    const result = await createOfficeDocument(filePath);
    return { ...result, filePath: result.success ? filePath : undefined };
  });
}
