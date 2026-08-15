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
import { ipcMain } from 'electron';

let initialized = false;

/**
 * SQLite-style setting store（plugin-local），复用 better-sqlite3 持久化。
 * v1 用一个极简的 in-memory + JSON 文件实现，Phase 3 切换到 Drizzle。
 */
interface Settings {
  [key: string]: string;
}

const SETTINGS_FILE = 'security-audit-settings.json';

function loadSettings(): Settings {
  // v1 stub：返回空对象，等 Phase 3 切到 Drizzle
  return {};
}

function saveSettings(_settings: Settings): void {
  // v1 stub
}

let settingsCache: Settings = loadSettings();

export function setupSecurityAuditIPC(): void {
  if (initialized) return;
  initialized = true;

  // ── Settings: AI 配置（baseUrl / apiKey / model）+ sandboxMode 占位 ──

  ipcMain.handle('security-audit:settings:get', (_e, key: string) => {
    return settingsCache[key] ?? null;
  });

  ipcMain.handle('security-audit:settings:set', (_e, key: string, value: string) => {
    settingsCache = { ...settingsCache, [key]: value };
    saveSettings(settingsCache);
    return { ok: true };
  });

  // ── Scan: v1 stub（返回 mock 数据，Phase 2 替换为 spawn deepsec） ──

  ipcMain.handle('security-audit:scan:start', async (_e, input: { projectDir: string }) => {
    // 简化版：直接返回成功。Phase 2 会在这里 spawn deepsec 子进程。
    return { ok: true, jobId: `job-${Date.now()}`, projectDir: input.projectDir };
  });

  ipcMain.handle('security-audit:scan:cancel', (_e, _jobId: string) => {
    // v1 没有正在跑的 job，留 stub
    return { ok: true };
  });

  // ── Findings: v1 stub（Phase 3 接入 SQLite） ──

  ipcMain.handle('security-audit:findings:list', (_e, _projectDir: string) => {
    return [];
  });
}
