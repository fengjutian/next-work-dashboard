import { describe, expect, it } from 'vitest';
import { parseGitBranches } from '../src/main/git-overview';

describe('Git 分支概览解析', () => {
  it('区分本地和远程分支并解析 tracking 状态', () => {
    const output = [
      'refs/heads/main\tmain\t*\torigin/main\tahead 2, behind 1',
      'refs/heads/feature\tfeature\t\t\t',
      'refs/remotes/origin/main\torigin/main\t\t\t',
      'refs/remotes/origin/HEAD\torigin/HEAD\t\t\t',
    ].join('\n');
    expect(parseGitBranches(output)).toEqual([
      { name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 2, behind: 1 },
      { name: 'feature', current: false, remote: false, upstream: undefined, ahead: 0, behind: 0 },
      { name: 'origin/main', current: false, remote: true, upstream: undefined, ahead: 0, behind: 0 },
    ]);
  });
});
