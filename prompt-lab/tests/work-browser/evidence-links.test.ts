import { describe, expect, it } from 'vitest';
import { mapClaimsToEvidence } from '@/core/work-browser/research/evidence-links';

describe('research claim evidence links', () => {
  it('links report claims to persisted evidence and propagates disputes', () => {
    const links = mapClaimsToEvidence('A claim [source](https://a.test).', [{ id: 'e1', url: 'https://a.test', status: 'disputed' }]);
    expect(links).toEqual([{ claim: 'A claim [source](https://a.test).', evidenceIds: ['e1'], disputed: true }]);
  });
});
