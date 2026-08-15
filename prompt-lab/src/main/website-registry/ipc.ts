import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import { getMainWindow } from '../globals';
import type { WebsiteRecordFilters, WebsiteRecordInput } from '../../core/website-registry/types';
import { normalizeWebsiteUrl, parseWebsiteCsv, sanitizeWebsiteInput } from '../../core/website-registry/validation';
import { getWebsiteRegistryDatabase } from './database';
import { WebsiteRegistryStore } from './store';

let initialized = false;
export function setupWebsiteRegistryIPC(): void {
  if (initialized) return; initialized = true;
  const store = new WebsiteRegistryStore(getWebsiteRegistryDatabase());
  ipcMain.handle('website-registry:record:list', (_event, filters?: WebsiteRecordFilters) => store.list(filters));
  ipcMain.handle('website-registry:record:create', (_event, input: WebsiteRecordInput) => store.create(input));
  ipcMain.handle('website-registry:record:update', (_event, id: string, patch: Partial<WebsiteRecordInput>) => store.update(id, patch));
  ipcMain.handle('website-registry:record:delete', (_event, id: string) => store.remove(id));
  ipcMain.handle('website-registry:record:open', async (_event, id: string) => { const record = store.get(id); if (!record) throw new Error('网站记录不存在'); await shell.openExternal(normalizeWebsiteUrl(record.url)); return store.markOpened(id); });
  ipcMain.handle('website-registry:category:list', () => store.listCategories());
  ipcMain.handle('website-registry:category:create', (_event, name: string, color?: string) => store.createCategory(name, color));
  ipcMain.handle('website-registry:category:update', (_event, id: string, patch: any) => store.updateCategory(id, patch));
  ipcMain.handle('website-registry:category:delete', (_event, id: string) => store.removeCategory(id));
  ipcMain.handle('website-registry:export', async () => {
    const win = getMainWindow(); const result = await dialog.showSaveDialog(win!, { defaultPath: 'website-registry.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, JSON.stringify({ version: 1, exportedAt: Date.now(), categories: store.listCategories(), records: store.list({}) }, null, 2), 'utf8'); return true;
  });
  ipcMain.handle('website-registry:import', async () => {
    const win = getMainWindow(); const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: '网站资料', extensions: ['json', 'csv'] }] });
    if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0, invalid: 0 };
    const file = result.filePaths[0]; const text = await fs.readFile(file, 'utf8');
    const parsed = file.toLowerCase().endsWith('.csv') ? parseWebsiteCsv(text) : ((JSON.parse(text).records || JSON.parse(text)) as WebsiteRecordInput[]);
    let imported = 0; let skipped = 0; let invalid = 0;
    for (const input of parsed) { try { sanitizeWebsiteInput(input); store.create(input); imported += 1; } catch (error) { if (String(error).includes('已经存在')) skipped += 1; else invalid += 1; } }
    return { imported, skipped, invalid };
  });
}
