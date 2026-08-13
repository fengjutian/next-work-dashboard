export type MasteryDimension = 'concept' | 'calculation' | 'application' | 'transfer' | 'retention';

export interface KnowledgeNode {
  id: string;
  title: string;
  description: string;
  stage: number;
  difficulty: number;
  estimatedMinutes: number;
  prerequisites: string[];
  skills: string[];
}

export interface Problem {
  id: string;
  knowledgeId: string;
  skillId: string;
  difficulty: number;
  type: MasteryDimension;
  question: string;
  answers: string[];
  solution: string;
  hints: string[];
  misconception?: { id: string; message: string; matches: string[] };
}

export interface SkillState {
  skillId: string;
  mastery: number;
  concept: number;
  calculation: number;
  application: number;
  transfer: number;
  retention: number;
  confidence: number;
  attempts: number;
  correctAttempts: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  nextReviewAt?: string;
}

export interface Attempt {
  id: string;
  problemId: string;
  answer: string;
  correct: boolean;
  score: number;
  hintCount: number;
  difficulty: number;
  misconceptionIds: string[];
  createdAt: string;
}

export interface CalcPathState {
  version: 1;
  diagnosticComplete: boolean;
  skillStates: Record<string, SkillState>;
  attempts: Attempt[];
}
