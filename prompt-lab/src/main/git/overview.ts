export interface ParsedGitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export function parseGitBranches(output: string): ParsedGitBranch[] {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [ref, name, head, upstream, track = ''] = line.split('\t');
    if (!ref || !name || ref.endsWith('/HEAD') || name.endsWith('/HEAD')) return [];
    return [{
      name,
      current: head === '*',
      remote: ref.startsWith('refs/remotes/'),
      upstream: upstream || undefined,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    }];
  });
}
