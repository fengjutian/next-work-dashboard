/**
 * Security Audit — main 端 IPC
 *
 * Channel 命名：security-audit:<domain>:<action>
 *
 * 规则：所有 channel 必须在 preload/security-audit.ts 中 ipcRenderer.invoke 对应。
 * scripts/check-ipc-contract.mjs 会自动校验。
 *
 * v1 范围：mock 数据 + settings 三件套（baseUrl/apiKey/model + sandboxMode 占位）。
 * 真实 deepsec CLI 调用在 Phase 2 接入。
 */
import { dialog, ipcMain } from 'electron';
import { authorizeWorkspace, resolveWorkspacePath } from '../workspace/path';
import type { ScanRequest } from '../../core/security-audit';
import fs from 'node:fs';
import path from 'node:path';
import { cancelScan, createSarif, getSetting, listFindings, listScanners, listScans, setSetting, startScan } from './service';

let initialized = false;

/**
 * SQLite-style setting store（plugin-local），复用 better-sqlite3 持久化。
 * v1 用一个极简的 in-memory + JSON 文件实现，Phase 3 切换到 Drizzle。
 */
export function setupSecurityAuditIPC(): void {
  if (initialized) return;
  initialized = true;

  ipcMain.handle('security-audit:project:select', async () => {
    const selected = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择安全扫描项目' });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true };
    authorizeWorkspace(selected.filePaths[0]);
    return { ok: true, projectDir: resolveWorkspacePath(selected.filePaths[0]) };
  });

  // ── Settings: AI 配置（baseUrl / apiKey / model）+ sandboxMode 占位 ──

  ipcMain.handle('security-audit:settings:get', (_e, key: string) => {
    const value = getSetting(key);
    return key.endsWith('apiKey') && value ? '••••••••' : value;
  });

  ipcMain.handle('security-audit:settings:set', (_e, key: string, value: string) => {
    setSetting(key, value);
    return { ok: true };
  });

  // ── Scan: v1 stub（返回 mock 数据，Phase 2 替换为 spawn deepsec） ──

  ipcMain.handle('security-audit:scan:start', async (event, input: ScanRequest) => {
    let projectDir = input.projectDir?.trim();
    if (!projectDir) {
      const selected = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择安全扫描项目' });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true };
      projectDir = selected.filePaths[0];
      authorizeWorkspace(projectDir);
    }
    const safeRoot = resolveWorkspacePath(projectDir);
    const result = await startScan({ ...input, projectDir: safeRoot }, event.sender);
    return { ok: true, ...result };
  });

  ipcMain.handle('security-audit:scan:cancel', (_e, jobId: string) => {
    return { ok: cancelScan(jobId) };
  });

  // ── Findings: v1 stub（Phase 3 接入 SQLite） ──

  ipcMain.handle('security-audit:findings:list', (_e, projectDir: string) => {
    return listFindings(resolveWorkspacePath(projectDir));
  });

  ipcMain.handle('security-audit:scans:list', (_e, projectDir: string) => listScans(resolveWorkspacePath(projectDir)));

  ipcMain.handle('security-audit:scanners:list', () => listScanners());

  ipcMain.handle('security-audit:report:export-sarif', async (_e, projectDir: string) => {
    const safeRoot = resolveWorkspacePath(projectDir);
    const selected = await dialog.showSaveDialog({ title: '导出 SARIF 安全报告', defaultPath: `${path.basename(safeRoot)}-security-audit.sarif`, filters: [{ name: 'SARIF', extensions: ['sarif', 'json'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(selected.filePath, createSarif(safeRoot), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, filePath: selected.filePath };
  });
}
