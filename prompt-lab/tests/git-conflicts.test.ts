import { describe, expect, it } from 'vitest';
import { classifyConflictStatus } from '../src/main/git-conflicts';

describe('classifyConflictStatus', () => {
  it.each([
    ['AA', 'add/add'], ['DU', 'delete/modify'], ['UD', 'modify/delete'],
    ['DD', 'both deleted'], ['UU', 'both modified'], ['AU', 'unmerged'],
  ])('classifies %s', (status, expected) => expect(classifyConflictStatus(status)).toBe(expected));
  it('ignores non-conflict states', () => expect(classifyConflictStatus(' M')).toBeUndefined());
});
