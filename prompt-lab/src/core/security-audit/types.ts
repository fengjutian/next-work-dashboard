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
export interface ScanRequest { projectDir: string; mode?: ScanMode; baselineRef?: string; scanners?: string[]; aiReview?: boolean }
export interface ScanProgress { jobId: string; phase: 'scanning' | 'triaging' | 'completed' | 'failed' | 'cancelled'; percent: number; message: string; findingsCount?: number }
export interface ScanContext { projectDir: string; files: string[]; signal: AbortSignal; emit(progress: Omit<ScanProgress, 'jobId'>): void }
export interface SecurityScanner {
  readonly id: string;
  readonly name: string;
  detect(context: ScanContext): Promise<boolean>;
  scan(context: ScanContext): Promise<SecurityFinding[]>;
}

export interface ScanRecord {
  id: string;
  projectDir: string;
  mode: ScanMode;
  baselineRef?: string;
  startedAt: number;
  completedAt?: number;
  status: ScanProgress['phase'];
  findings: SecurityFinding[];
}
