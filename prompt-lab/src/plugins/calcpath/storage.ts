import type { CalcPathState } from './types';
const KEY = 'calcpath.state.v1';
export const createInitialState = (): CalcPathState => ({ version: 1, diagnosticComplete: false, skillStates: {}, attempts: [] });
export function loadState(): CalcPathState { try { return { ...createInitialState(), ...JSON.parse(localStorage.getItem(KEY) ?? '') }; } catch { return createInitialState(); } }
export function saveState(state: CalcPathState) { localStorage.setItem(KEY, JSON.stringify(state)); }
