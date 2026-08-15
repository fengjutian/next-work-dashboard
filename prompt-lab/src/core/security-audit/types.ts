export type SecuritySeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type FindingCategory = 'sast' | 'sca' | 'secret' | 'iac' | 'config';
export type FindingConfidence = 'low' | 'medium' | 'high';
export type FindingStatus = 'open' | 'confirmed' | 'false-positive' | 'accepted' | 'fixed';

export interface FindingLocation { file: string; line: number; column?: number }
export interface FindingEvidence { kind: 'code' | 'tool' | 'dependency'; excerpt: string; location?: FindingLocation }

export interface SecurityFinding {
  id: string;
  fingerprint: string;
  scannerId: string;
  ruleId: string;
  category: FindingCategory;
  severity: SecuritySeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  title: string;
  description: string;
  location: FindingLocation;
  evidence: FindingEvidence[];
  recommendation: string;
  cwe?: string;
  cve?: string;
  cvss?: number;
  aiReview?: { verdict: 'confirmed' | 'likely' | 'uncertain' | 'false-positive'; rationale: string; reviewedAt: number };
  firstSeenAt: number;
  lastSeenAt: number;
  fixedAt?: number;
}

export type ScanMode = 'full' | 'incremental';
export type ScannerNetworkPolicy = 'deny' | 'allow';
export interface ScannerRunResult {
  scannerId: string;
  name: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  findingsCount: number;
  version?: string;
  exitCode?: number;
  reason?: string;
}
export interface ScannerStatus {
  id: string;
  name: string;
  installed: boolean;
  ready: boolean;
  builtIn: boolean;
  version?: string;
  reason?: string;
  checkedAt: number;
  requiresNetwork?: boolean;
}
export interface ScanRequest {
  projectDir: string;
  mode?: ScanMode;
  baselineRef?: string;
  networkPolicy?: ScannerNetworkPolicy;
  scanners?: string[];
  aiReview?: boolean;
  /** Runtime-only application AI config. It is never persisted by Security Audit. */
  aiConfig?: { baseUrl: string; apiKey: string; model: string };
}
export interface ScanProgress { jobId: string; projectDir?: string; phase: 'scanning' | 'triaging' | 'completed' | 'failed' | 'cancelled'; percent: number; message: string; findingsCount?: number }
export interface ScanContext { projectDir: string; files: string[]; signal: AbortSignal; networkPolicy: ScannerNetworkPolicy; emit(progress: Omit<ScanProgress, 'jobId'>): void }
export interface SecurityScanner {
  readonly id: string;
  readonly name: string;
  detect(context: ScanContext): Promise<boolean>;
  scan(context: ScanContext): Promise<SecurityFinding[]>;
  version?: string;
  lastExitCode?: number;
  skipReason?: string;
}

export interface ScanRecord {
  id: string;
  projectDir: string;
  mode: ScanMode;
  baselineRef?: string;
  networkPolicy?: ScannerNetworkPolicy;
  startedAt: number;
  completedAt?: number;
  status: ScanProgress['phase'];
  findings: SecurityFinding[];
  scannerRuns: ScannerRunResult[];
}
