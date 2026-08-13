import { KNOWLEDGE_NODES, PROBLEMS } from './curriculum';
import type { CalcPathState, Problem, SkillState } from './types';

const WEIGHTS = { concept: .25, calculation: .25, application: .2, transfer: .2, retention: .1 } as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const normalize = (value: string) => value.toLowerCase().replace(/[\s·]/g, '').replace(/\*\*/g, '^').replace(/−/g, '-');

export const emptySkillState = (skillId: string): SkillState => ({ skillId, mastery: 0, concept: 0, calculation: 0, application: 0, transfer: 0, retention: 0, confidence: .35, attempts: 0, correctAttempts: 0, consecutiveCorrect: 0, consecutiveWrong: 0 });

export function calculateMastery(state: SkillState): number {
  return Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + state[key as keyof typeof WEIGHTS] * weight, 0);
}

export function evaluateAnswer(problem: Problem, answer: string) {
  const value = normalize(answer);
  const correct = problem.answers.some((candidate) => normalize(candidate) === value);
  const misconception = !correct && problem.misconception?.matches.some((candidate) => normalize(candidate) === value) ? problem.misconception : undefined;
  return { correct, misconception };
}

export function updateSkill(previous: SkillState | undefined, problem: Problem, correct: boolean, hintCount: number): SkillState {
  const state = { ...(previous ?? emptySkillState(problem.skillId)) };
  const current = state[problem.type];
  const gain = Math.max(.04, .18 - hintCount * .04) * (1 - current);
  state[problem.type] = clamp(correct ? current + gain : current - .12 * Math.max(.4, current));
  state.attempts += 1;
  state.correctAttempts += correct ? 1 : 0;
  state.consecutiveCorrect = correct ? state.consecutiveCorrect + 1 : 0;
  state.consecutiveWrong = correct ? 0 : state.consecutiveWrong + 1;
  state.confidence = clamp(state.confidence + (correct ? .06 : -.05));
  state.mastery = calculateMastery(state);
  state.nextReviewAt = new Date(Date.now() + (correct ? Math.max(1, Math.round(state.mastery * 7)) : 1) * 86400000).toISOString();
  return state;
}

export function getNextProblem(state: CalcPathState): Problem {
  const unlocked = KNOWLEDGE_NODES.filter((node) => node.prerequisites.every((id) => {
    const prerequisite = KNOWLEDGE_NODES.find((item) => item.id === id);
    return prerequisite?.skills.every((skill) => (state.skillStates[skill]?.mastery ?? 0) >= .6);
  }));
  return unlocked.flatMap((node) => PROBLEMS.filter((problem) => problem.knowledgeId === node.id)).sort((a, b) => {
    const aState = state.skillStates[a.skillId]; const bState = state.skillStates[b.skillId];
    const aScore = (1 - (aState?.mastery ?? 0)) + ((aState?.nextReviewAt ?? '9') <= new Date().toISOString() ? .3 : 0);
    const bScore = (1 - (bState?.mastery ?? 0)) + ((bState?.nextReviewAt ?? '9') <= new Date().toISOString() ? .3 : 0);
    return bScore - aScore;
  })[0] ?? PROBLEMS[0];
}

export const masteryLabel = (value: number) => value >= .9 ? '已掌握' : value >= .75 ? '熟练' : value >= .6 ? '基本掌握' : value >= .4 ? '初步理解' : '尚未掌握';
