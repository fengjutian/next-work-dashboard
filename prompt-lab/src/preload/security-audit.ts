/**
 * Security Audit — Preload 桥接
 *
 * 暴露到 window.electronAPI.securityAudit
 * 与 main/security-audit/ipc.ts 一一对应；channel 名必须同步。
 * scripts/check-ipc-contract.mjs 会校验。
 */
import { ipcRenderer } from 'electron';
import type { ScanProgress } from '../core/security-audit';

export const securityAuditBridge = {
  project: {
    select: () => ipcRenderer.invoke('security-audit:project:select'),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('security-audit:settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('security-audit:settings:set', key, value),
  },
  scan: {
    start: (input: { projectDir: string; mode?: 'full' | 'incremental'; baselineRef?: string; scanners?: string[]; networkPolicy?: 'deny' | 'allow'; aiReview?: boolean; aiConfig?: { baseUrl: string; apiKey: string; model: string } }) => ipcRenderer.invoke('security-audit:scan:start', input),
    cancel: (jobId: string) => ipcRenderer.invoke('security-audit:scan:cancel', jobId),
    onProgress: (callback: (progress: ScanProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress);
      ipcRenderer.on('security-audit:event:progress', listener);
      return () => { ipcRenderer.removeListener('security-audit:event:progress', listener); };
    },
  },
  findings: {
    list: (projectDir: string) => ipcRenderer.invoke('security-audit:findings:list', projectDir),
    update: (input: { projectDir: string; findingId: string; status: import('../core/security-audit').FindingStatus; reason?: string }) => ipcRenderer.invoke('security-audit:findings:update', input),
  },
  scans: { list: (projectDir: string) => ipcRenderer.invoke('security-audit:scans:list', projectDir) },
  scanners: { list: (input?: { projectDir?: string; networkPolicy?: 'deny' | 'allow'; force?: boolean }) => ipcRenderer.invoke('security-audit:scanners:list', input) },
  report: { exportSarif: (projectDir: string) => ipcRenderer.invoke('security-audit:report:export-sarif', projectDir) },
};
