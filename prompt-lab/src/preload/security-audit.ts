/**
 * Security Audit — Preload 桥接
 *
 * 暴露到 window.electronAPI.securityAudit
 * 与 main/security-audit/ipc.ts 一一对应；channel 名必须同步。
 * scripts/check-ipc-contract.mjs 会校验。
 */
import { ipcRenderer } from 'electron';

export const securityAuditBridge = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('security-audit:settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('security-audit:settings:set', key, value),
  },
  scan: {
    start: (input: { projectDir: string; mode?: 'full' | 'incremental'; baselineRef?: string; scanners?: string[]; aiReview?: boolean }) => ipcRenderer.invoke('security-audit:scan:start', input),
    cancel: (jobId: string) => ipcRenderer.invoke('security-audit:scan:cancel', jobId),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
      ipcRenderer.on('security-audit:event:progress', listener);
      return () => ipcRenderer.removeListener('security-audit:event:progress', listener);
    },
  },
  findings: {
    list: (projectDir: string) => ipcRenderer.invoke('security-audit:findings:list', projectDir),
  },
  scans: { list: (projectDir: string) => ipcRenderer.invoke('security-audit:scans:list', projectDir) },
};
