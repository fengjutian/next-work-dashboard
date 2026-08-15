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
    start: (input: { projectDir: string }) => ipcRenderer.invoke('security-audit:scan:start', input),
    cancel: (jobId: string) => ipcRenderer.invoke('security-audit:scan:cancel', jobId),
  },
  findings: {
    list: (projectDir: string) => ipcRenderer.invoke('security-audit:findings:list', projectDir),
  },
};
