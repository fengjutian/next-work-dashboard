import { describe, expect, it } from 'vitest';
import { detectRenameRename, parseUnmergedIndex } from '../src/main/git-rename-conflict';

describe('rename/rename conflict grouping', () => {
  it('links the base, ours and theirs paths using index stages', () => {
    const entries = parseUnmergedIndex('100644 aaa 1\told.ts\n100644 bbb 2\tours.ts\n100644 ccc 3\ttheirs.ts');
    expect(detectRenameRename([{ status: 'DD', path: 'old.ts' }, { status: 'AU', path: 'ours.ts' }, { status: 'UA', path: 'theirs.ts' }], entries, 'old.ts')).toEqual({ type: 'rename/rename', basePath: 'old.ts', oursPath: 'ours.ts', theirsPath: 'theirs.ts' });
  });
  it('does not mislabel an ordinary both-deleted conflict', () => expect(detectRenameRename([{ status: 'DD', path: 'old.ts' }], [], 'old.ts')).toBeUndefined());
});
