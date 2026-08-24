/**
 * Security Audit 插件 — 常量与契约
 *
 * Channel 命名：security-audit:<domain>:<action>
 * 与 main/security-audit/ipc.ts + preload/security-audit.ts 一一对应。
 * scripts/check-ipc-contract.mjs 会自动校验。
 */

export const PLUGIN_ID = 'security-audit';
export const PLUGIN_NAME = 'Security Audit';
export const COMMAND_EVENT = `${PLUGIN_ID}:command` as const;

export type CommandEventDetail =
  | { command: 'run-scan' }
  | { command: 'open-settings' }
  | { command: 'show-finding'; findingId: string };

/** settings 键（声明式 settings[] 渲染用，存到 localStorage plugin-platform-state-v1） */
export const SETTINGS_KEYS = {
  aiBaseUrl: 'securityAudit.ai.baseUrl',
  aiApiKey: 'securityAudit.ai.apiKey',
  aiModel: 'securityAudit.ai.model',
  sandboxMode: 'securityAudit.sandboxMode', // v1 仅占位: 'local' | 'vercel' | 'docker'
} as const;

export type SandboxMode = 'local' | 'vercel' | 'docker';

/** Finding 严重度（与 deepsec P0/P1/P2 对齐） */
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export interface FindingLocation {
  file: string;
  line: number;
  column?: number;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  location: FindingLocation;
  recommendation: string;
  ruleId?: string;
  detectedAt: number;
  fingerprint?: string;
  scannerId?: string;
  category?: 'sast' | 'sca' | 'secret' | 'iac' | 'config';
  confidence?: 'low' | 'medium' | 'high';
  status?: 'open' | 'confirmed' | 'false-positive' | 'accepted' | 'fixed';
  evidence?: Array<{ kind: string; excerpt: string }>;
  trace?: import('../../core/security-audit').FindingTraceStep[];
  suppressed?: { reason: string; at: number };
  aiReview?: { verdict: string; rationale: string; reviewedAt: number };
}

/** 扫描阶段 */
export type ScanPhase = 'idle' | 'scanning' | 'triaging' | 'completed' | 'failed' | 'cancelled';

export interface ScanProgress {
  phase: ScanPhase;
  /** 0-100 */
  percent: number;
  message: string;
  findingsCount?: number;
}
