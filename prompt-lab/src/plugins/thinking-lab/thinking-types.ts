export type ThinkingFrameworkId =
  | 'first-principles' | 'red-team' | 'inversion' | 'systems' | 'bayesian'
  | 'occam' | 'decision-tree' | 'value-investing' | 'military-strategy'
  | 'naval' | 'multi-agent' | 'metacognition' | 'psychological-game';

export interface ThinkingFramework {
  id: ThinkingFrameworkId;
  name: string;
  summary: string;
  suitableFor: string[];
  prompt: string;
  temperature: number;
}

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'failed';
export type AnalysisMode = 'quick' | 'standard' | 'deep';

export interface FrameworkResult {
  frameworkId: ThinkingFrameworkId;
  status: AnalysisStatus;
  content: string;
  critique?: string;
  error?: string;
}

export interface ThinkingRun {
  id: string;
  question: string;
  context: string;
  mode: AnalysisMode;
  frameworkIds: ThinkingFrameworkId[];
  results: FrameworkResult[];
  critique: string;
  synthesis: string;
  model: string;
  createdAt: number;
}

export interface AiContext {
  apiKey: string;
  baseUrl: string;
  model: string;
}
