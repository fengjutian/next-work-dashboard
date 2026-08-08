import { describe, expect, it } from 'vitest';
import { parseGitLog } from '../src/main/git/history';

describe('parseGitLog', () => {
  it('parses topology, refs and verified signature metadata', () => {
    const output = 'abcdef\x1fabc1234\x1fparent1 parent2\x1fHEAD -> main, tag: v1\x1fAda\x1fada@example.com\x1f2026-08-01T10:00:00+08:00\x1fG\x1fAda Key\x1fmerge subject\x1e';
    expect(parseGitLog(output)).toEqual([expect.objectContaining({
      parents: ['parent1', 'parent2'], refs: ['HEAD -> main', 'tag: v1'], signatureStatus: 'G', signer: 'Ada Key', subject: 'merge subject',
    })]);
  });

  it('preserves separators in commit subjects and defaults missing signatures', () => {
    const output = 'a\x1fb\x1f\x1f\x1fA\x1fa@b.c\x1fdate\x1f\x1f\x1fsubject\x1fdetail\x1e';
    expect(parseGitLog(output)[0]).toMatchObject({ parents: [], refs: [], signatureStatus: 'N', subject: 'subject\x1fdetail' });
  });
});
