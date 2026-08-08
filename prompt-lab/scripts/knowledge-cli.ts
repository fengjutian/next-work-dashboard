import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { analyzeKnowledgeUpdateImpact, evaluateKnowledgeHealth, type KnowledgeSourceChange } from '../src/core/knowledge';
import { scanKnowledgeWorkspaceValidated } from '../src/main/knowledge-workspace';
import { authorizeWorkspace } from '../src/main/workspace/path';

interface CliOptions {
  root: string;
  format: 'text' | 'github' | 'json';
  minScore: number;
  failOnErrors: boolean;
  from?: string;
  to: string;
  base?: string;
}

function option(args: string[], name: string): string | undefined {
  const exact = args.indexOf(`--${name}`);
  if (exact >= 0) return args[exact + 1];
  return args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function options(args: string[]): CliOptions {
  const minScore = Number(option(args, 'min-score') ?? 70);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) throw new Error('INVALID_MIN_SCORE');
  const format = option(args, 'format') ?? 'text';
  if (!['text', 'github', 'json'].includes(format)) throw new Error('INVALID_FORMAT');
  return {
    root: path.resolve(option(args, 'root') ?? '..'),
    format: format as CliOptions['format'],
    minScore,
    failOnErrors: !args.includes('--no-fail-on-errors'),
    from: option(args, 'from'),
    to: option(args, 'to') ?? 'HEAD',
    base: option(args, 'base') ?? process.env.GITHUB_BASE_REF,
  };
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
}

function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}~^+-]*$/.test(ref) || ref.includes('..')) throw new Error(`INVALID_GIT_REF:${ref}`);
  return ref;
}

export function parseNameStatus(output: string): KnowledgeSourceChange[] {
  const fields = output.split('\0').filter(Boolean);
  const changes: KnowledgeSourceChange[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const firstPath = fields[index++];
    if (!status || !firstPath) break;
    if (/^[RC]/.test(status)) {
      const nextPath = fields[index++];
      changes.push({ status, path: firstPath });
      if (nextPath) changes.push({ status, path: nextPath });
    } else changes.push({ status, path: firstPath });
  }
  return changes;
}

export function parsePorcelain(output: string): KnowledgeSourceChange[] {
  const records = output.split('\0').filter(Boolean);
  const changes: KnowledgeSourceChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    changes.push({ status, path: record.slice(3).replace(/\\/g, '/') });
    if (/[RC]/.test(status) && records[index + 1]) changes.push({ status, path: records[++index].replace(/\\/g, '/') });
  }
  return changes;
}

function changedFiles(root: string, opts: CliOptions, baseline?: string): { changes: KnowledgeSourceChange[]; range: string } {
  if (opts.base) {
    const base = validateRef(opts.base.includes('/') ? opts.base : `origin/${opts.base}`);
    const range = `${base}...${validateRef(opts.to)}`;
    return { changes: parseNameStatus(git(root, ['diff', '--name-status', '-z', range, '--'])), range };
  }
  const from = opts.from ?? baseline;
  if (from) {
    const range = `${validateRef(from)}..${validateRef(opts.to)}`;
    const committed = parseNameStatus(git(root, ['diff', '--name-status', '-z', range, '--']));
    const working = parsePorcelain(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const byPath = new Map(committed.map((change) => [change.path.replace(/\\/g, '/').toLocaleLowerCase(), change]));
    working.forEach((change) => byPath.set(change.path.replace(/\\/g, '/').toLocaleLowerCase(), change));
    return { changes: [...byPath.values()], range: working.length ? `${range}+working-tree` : range };
  }
  return { changes: parsePorcelain(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])), range: 'working-tree' };
}

function annotation(level: 'error' | 'warning', file: string | undefined, line: number | undefined, message: string): string {
  const escape = (value: string) => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const properties = [file ? `file=${escape(file)}` : '', line ? `line=${line}` : ''].filter(Boolean).join(',');
  return `::${level}${properties ? ` ${properties}` : ''}::${escape(message)}`;
}

async function check(opts: CliOptions): Promise<number> {
  authorizeWorkspace(opts.root);
  const workspace = await scanKnowledgeWorkspaceValidated(opts.root);
  const health = evaluateKnowledgeHealth(workspace, workspace.diagnostics);
  if (opts.format === 'json') console.log(JSON.stringify({ health, diagnostics: workspace.diagnostics }, null, 2));
  else {
    console.log(`Knowledge health: ${health.score}/100 (${health.grade}); threshold: ${opts.minScore}`);
    for (const diagnostic of workspace.diagnostics) {
      if (opts.format === 'github') console.log(annotation(diagnostic.severity, diagnostic.path, diagnostic.line, `[${diagnostic.code}] ${diagnostic.message}`));
      else console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.path ?? '-'}${diagnostic.line ? `:${diagnostic.line}` : ''} [${diagnostic.code}] ${diagnostic.message}`);
    }
    for (const metric of health.metrics.filter((item) => item.count)) console.log(`- ${metric.label}: ${metric.count} (-${metric.penalty})`);
  }
  return health.score < opts.minScore || (opts.failOnErrors && workspace.diagnostics.some((item) => item.severity === 'error')) ? 1 : 0;
}

async function impact(opts: CliOptions): Promise<number> {
  authorizeWorkspace(opts.root);
  const workspace = await scanKnowledgeWorkspaceValidated(opts.root);
  const { changes, range } = changedFiles(opts.root, opts, workspace.state?.lastVerifiedCommit);
  const impacts = analyzeKnowledgeUpdateImpact(workspace.documents, changes);
  const output = { range, changedFiles: changes, impacts };
  if (opts.format === 'json') console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`Knowledge impact: ${impacts.length} document(s); range: ${range}; changed files: ${changes.length}`);
    for (const item of impacts) {
      const message = `${item.documentTitle}: ${item.changedSources.map((source) => source.path).join(', ')}`;
      if (opts.format === 'github') console.log(annotation('warning', item.documentPath, undefined, message));
      else console.log(`- ${item.documentPath}: ${item.changedSources.map((source) => `${source.status} ${source.path}`).join(', ')}`);
    }
  }
  return 0;
}

export async function runKnowledgeCli(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  if (command !== 'check' && command !== 'impact') throw new Error('Usage: knowledge-cli <check|impact> [--root path] [--format text|github|json]');
  const opts = options(argv.slice(1));
  return command === 'check' ? check(opts) : impact(opts);
}
