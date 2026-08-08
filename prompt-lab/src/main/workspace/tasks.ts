export interface WorkspaceTaskDefinition {
  name: string;
  command: string;
  detail: string;
  dependsOn: string[];
  dependsOrder: 'sequence' | 'parallel';
  isBackground: boolean;
  problemMatcher?: string;
  env?: Record<string, string>;
  presentation?: { reveal?: string; panel?: string; focus?: boolean };
}

interface RawTask { label?: string; type?: string; command?: string; args?: Array<string | number>; dependsOn?: string | string[]; dependsOrder?: 'sequence' | 'parallel'; isBackground?: boolean; problemMatcher?: string | string[]; options?: { env?: Record<string, string> }; presentation?: WorkspaceTaskDefinition['presentation'] }

export function parseWorkspaceTasks(config: { tasks?: RawTask[] }): WorkspaceTaskDefinition[] {
  return (config.tasks ?? []).flatMap((task) => {
    if (!task.label || !task.command) return [];
    const quote = (value: string | number) => /\s|["']/.test(String(value)) ? JSON.stringify(String(value)) : String(value);
    return [{
      name: task.label,
      command: [task.command, ...(task.args ?? []).map(quote)].join(' '),
      detail: task.type ?? 'shell',
      dependsOn: task.dependsOn ? (Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn]) : [],
      dependsOrder: task.dependsOrder ?? 'parallel',
      isBackground: Boolean(task.isBackground),
      problemMatcher: Array.isArray(task.problemMatcher) ? task.problemMatcher[0] : task.problemMatcher,
      env: task.options?.env,
      presentation: task.presentation,
    }];
  });
}

export function resolveTaskOrder(tasks: WorkspaceTaskDefinition[], target: string): WorkspaceTaskDefinition[] {
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: WorkspaceTaskDefinition[] = [];
  const visit = (name: string) => {
    if (visiting.has(name)) throw new Error(`TASK_DEPENDENCY_CYCLE:${name}`);
    if (visited.has(name)) return;
    const task = byName.get(name);
    if (!task) throw new Error(`TASK_DEPENDENCY_NOT_FOUND:${name}`);
    visiting.add(name);
    task.dependsOn.forEach(visit);
    visiting.delete(name);
    visited.add(name);
    ordered.push(task);
  };
  visit(target);
  return ordered;
}

export function parseProblemLine(line: string, matcher?: string): { path: string; line: number; column: number; severity: 'error' | 'warning'; message: string } | undefined {
  const patterns: Record<string, RegExp> = {
    '$tsc': /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+\w+:\s*(.*)$/i,
    '$eslint-stylish': /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.*)$/i,
    '$gcc': /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning):\s*(.*)$/i,
  };
  const match = (patterns[matcher ?? ''] ?? /^(.*?)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*-?\s*(error|warning)?\s*(.*)$/i).exec(line);
  if (!match) return undefined;
  if (matcher && patterns[matcher]) return { path: match[1], line: Number(match[2]), column: Number(match[3]), severity: /warning/i.test(match[4]) ? 'warning' : 'error', message: match[5] };
  return { path: match[1], line: Number(match[2] ?? match[4]), column: Number(match[3] ?? match[5]), severity: /warning/i.test(match[6] ?? '') ? 'warning' : 'error', message: match[7] };
}
