import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeTypeScriptProject, applyInlineSuppressions, assessScanCoverage, buildScanCoverage, builtinRuleScanner, classifySecret, enumerateTextFiles, findingsToSarif, mergeWithBaseline, parseDependencyLock, parseNpmLock, redactSecrets, scanGitHistoryAggregated } from '../src/core/security-audit';
import { redactScannerOutput, resolveTrustedScannerExecutable, runScannerProcess } from '../src/main/security-audit/external-process';
import { parseBanditOutput, parseGitleaksOutput, parseOsvOutput, parseSemgrepOutput, parseTrivyOutput, readLimitedJsonReport } from '../src/main/security-audit/external-scanners';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function temporaryRoot(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-')); roots.push(root); return root; }
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'security-audit', `${name}.json`), 'utf8')) as Record<string, unknown>;
const fixtureContext = { projectDir: 'D:/fixture-project', files: [], signal: new AbortController().signal, networkPolicy: 'deny' as const, emit: () => undefined };

describe('security audit core', () => {
  it('redacts credentials from evidence', () => {
    expect(redactSecrets('api_key = "super-secret-value"')).not.toContain('super-secret-value');
    expect(redactSecrets('key = AKIAABCDEFGHIJKLMNOP')).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(redactScannerOutput('token=github_pat_abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
  });

  it('rejects commands outside the scanner allowlist and NUL arguments', async () => {
    await expect(runScannerProcess('powershell' as 'semgrep', [], process.cwd(), new AbortController().signal)).rejects.toThrow('SCANNER_NOT_ALLOWED');
    await expect(runScannerProcess('semgrep', ['bad\0arg'], process.cwd(), new AbortController().signal)).rejects.toThrow('INVALID_SCANNER_ARGUMENT');
  });

  it('rejects a scanner executable resolved from inside the project', () => {
    const root = temporaryRoot();
    const executable = path.join(root, process.platform === 'win32' ? 'semgrep.exe' : 'semgrep');
    fs.writeFileSync(executable, 'fixture');
    if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
    expect(() => resolveTrustedScannerExecutable('semgrep', root, root)).toThrow('SCANNER_EXECUTABLE_NOT_FOUND');
  });

  it('parses official scanner JSON field contracts', () => {
    expect(parseSemgrepOutput(fixture('semgrep'), fixtureContext)[0]).toMatchObject({ scannerId: 'semgrep', ruleId: 'javascript.lang.security.audit.eval-detected', location: { line: 3 } });
    expect(parseGitleaksOutput(fixture('gitleaks'), fixtureContext)[0]).toMatchObject({ scannerId: 'gitleaks', ruleId: 'generic-api-key', category: 'secret' });
    expect(parseOsvOutput(fixture('osv'), fixtureContext)[0]).toMatchObject({ scannerId: 'osv-scanner', cve: 'CVE-2021-23337', category: 'sca' });
    expect(parseTrivyOutput(fixture('trivy'), fixtureContext).map((item) => item.category)).toEqual(['sca', 'iac', 'secret']);
  });

  it('rejects oversized or untrusted scanner report paths', () => {
    const root = temporaryRoot(); const report = path.join(root, 'report.json'); fs.writeFileSync(report, '{}');
    expect(() => readLimitedJsonReport(report)).toThrow('SCANNER_REPORT_UNTRUSTED_PATH');
    const oversized = path.join(os.tmpdir(), `nwd-oversized-${Date.now()}.json`);
    const descriptor = fs.openSync(oversized, 'w');
    try { fs.ftruncateSync(descriptor, 20 * 1024 * 1024 + 1); } finally { fs.closeSync(descriptor); }
    try { expect(() => readLimitedJsonReport(oversized)).toThrow('SCANNER_REPORT_LIMIT'); } finally { fs.rmSync(oversized, { force: true }); }
  });

  it('ignores dependencies and symbolic links while enumerating', () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {}'); fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'eval(x)');
    expect(enumerateTextFiles(root)).toEqual(['src/index.ts']);
  });

  it('finds deterministic secret and Electron configuration issues', async () => {
    const root = temporaryRoot();
    const file = 'main.ts';
    fs.writeFileSync(path.join(root, file), 'const api_key = "abcdefghijklmnop";\nnew BrowserWindow({ webPreferences: { nodeIntegration: true } });');
    const controller = new AbortController();
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: [file], signal: controller.signal, networkPolicy: 'deny', emit: () => undefined });
    expect(findings.map((item) => item.ruleId)).toEqual(['secret.generic-api-key', 'electron.node-integration']);
    expect(findings[0].evidence[0].excerpt).not.toContain('abcdefghijklmnop');
  });

  it('evaluates the effective USER in the final Docker build stage', async () => {
    const root = temporaryRoot();
    const scan = async (content: string) => {
      fs.writeFileSync(path.join(root, 'Dockerfile'), content);
      return builtinRuleScanner.scan({ projectDir: root, files: ['Dockerfile'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    };
    expect((await scan('FROM node:22\nUSER node\n')).map((item) => item.ruleId)).not.toContain('iac.docker-root');
    expect((await scan('FROM node:22\nUSER root\n')).map((item) => item.ruleId)).toContain('iac.docker-root');
    expect((await scan('FROM node:22 AS base\nUSER node\nFROM base AS runtime\n')).map((item) => item.ruleId)).not.toContain('iac.docker-root');
    expect((await scan('FROM node:22 AS build\nUSER node\nFROM alpine AS runtime\n')).map((item) => item.ruleId)).toContain('iac.docker-root');
  });

  it('keeps first-seen state and marks missing findings fixed', async () => {
    const root = temporaryRoot(); const file = 'unsafe.ts';
    fs.writeFileSync(path.join(root, file), 'eval(input)');
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: [file], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    const merged = mergeWithBaseline([], findings, findings[0].lastSeenAt + 10);
    expect(merged[0].status).toBe('fixed');
    expect(merged[0].fixedAt).toBeDefined();
  });

  it('does not resolve findings outside an incremental scan scope', async () => {
    const root = temporaryRoot(); fs.writeFileSync(path.join(root, 'unsafe.ts'), 'eval(input)');
    const previous = await builtinRuleScanner.scan({ projectDir: root, files: ['unsafe.ts'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(mergeWithBaseline([], previous, Date.now(), new Set(['other.ts']))[0].status).toBe('open');
  });

  it('exports active findings as SARIF with stable fingerprints', async () => {
    const root = temporaryRoot(); fs.writeFileSync(path.join(root, 'unsafe.ts'), 'eval(input)');
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: ['unsafe.ts'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    const sarif = findingsToSarif(findings, root) as { version: string; runs: Array<{ results: Array<{ partialFingerprints: { primaryLocationLineHash: string } }> }> };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0].partialFingerprints.primaryLocationLineHash).toBe(findings[0].fingerprint);
  });

  it('tracks taint through variables and cross-file function calls', () => {
    const root = temporaryRoot(); fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'shell.ts'), "import { exec } from 'node:child_process'; export function run(value: string) { exec(value); }");
    fs.writeFileSync(path.join(root, 'src', 'wrapper.ts'), "import { run } from './shell'; export function dispatch(value: string) { run(value); }");
    fs.writeFileSync(path.join(root, 'src', 'route.ts'), "import { dispatch } from './wrapper'; function identity(value: string) { return value; } export function route(req: any) { const command = req.query.command; const returned = identity(command); dispatch(returned); }");
    const result = analyzeTypeScriptProject({ projectDir: root, files: ['src/shell.ts', 'src/wrapper.ts', 'src/route.ts'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    const finding = result.findings.find((item) => item.ruleId === 'taint.command-injection');
    expect(finding?.confidence).toBe('high');
    expect(finding?.trace?.map((step) => step.kind)).toEqual(['source', 'propagation', 'propagation', 'call', 'call', 'sink']);
  });

  it('detects Express authorization gaps and framework coverage', () => {
    const root = temporaryRoot(); const file = 'routes.ts';
    fs.writeFileSync(path.join(root, file), "import express from 'express'; const app = express(); app.get('/users/:id', async (req) => db.user.findById(req.params.id));");
    const context = { projectDir: root, files: [file], signal: new AbortController().signal, networkPolicy: 'deny' as const, emit: () => undefined };
    const result = analyzeTypeScriptProject(context);
    expect(result.findings.map((item) => item.ruleId)).toContain('framework.express-idor');
    expect(buildScanCoverage(root, [file], 'full').frameworks).toContain('Express');
  });

  it('parses npm lockfiles and honors inline rule suppressions', async () => {
    expect(parseNpmLock(JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0', integrity: 'sha512-ok' } } }))).toEqual([{ name: 'a', version: '1.0.0', integrity: 'sha512-ok', source: 'package-lock.json' }]);
    const root = temporaryRoot(); const file = 'unsafe.ts'; fs.writeFileSync(path.join(root, file), '// security-audit-ignore sast.eval accepted test fixture\neval(input)');
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: [file], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    const suppressed = applyInlineSuppressions(root, findings);
    expect(suppressed[0]).toMatchObject({ status: 'false-positive', suppressed: { reason: 'accepted test fixture' } });
  });

  it('isolates function taint scopes and recognizes sanitizers', () => {
    const root = temporaryRoot(); const file = 'scope.ts';
    fs.writeFileSync(path.join(root, file), "import { exec } from 'node:child_process'; function first(req: any) { const value = req.query.x; return value; } function second() { const value = 'fixed'; exec(value); } function safe(req: any) { const value = path.basename(req.query.file); fs.readFile(value, () => {}); }");
    const result = analyzeTypeScriptProject({ projectDir: root, files: [file], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(result.findings).toEqual([]);
  });

  it('parses Cargo, Yarn, pnpm and Python locked versions', () => {
    expect(parseDependencyLock('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.0"\n')).toContainEqual({ name: 'serde', version: '1.0.0', source: 'Cargo.lock' });
    expect(parseDependencyLock('yarn.lock', 'left-pad@^1.0.0:\n  version "1.3.0"\n')).toContainEqual({ name: 'left-pad', version: '1.3.0', source: 'yarn.lock' });
    expect(parseDependencyLock('pnpm-lock.yaml', 'packages:\n  /lodash/4.17.21:\n')).toContainEqual({ name: 'lodash', version: '4.17.21', source: 'pnpm-lock.yaml' });
    expect(parseDependencyLock('requirements.txt', 'django==5.0.1\n')).toContainEqual({ name: 'django', version: '5.0.1', source: 'requirements.txt' });
  });

  it('detects weak crypto and unpinned JWT verification through AST rules', () => {
    const root = temporaryRoot(); const file = 'auth.ts'; fs.writeFileSync(path.join(root, file), "crypto.createHash('md5'); jwt.verify(token, key);");
    const result = analyzeTypeScriptProject({ projectDir: root, files: [file], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(result.findings.map((item) => item.ruleId)).toEqual(expect.arrayContaining(['crypto.weak-hash', 'auth.jwt-algorithm-not-pinned']));
  });

  it('filters placeholder and test secrets while dynamically grading real candidates', async () => {
    expect(classifySecret('api_key', 'your-api-key', 'src/config.ts')).toBeNull();
    expect(classifySecret('api_key', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'tests/config.ts')).toBeNull();
    expect(classifySecret('api_key', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'src/config.ts')).toMatchObject({ kind: 'github', severity: 'P1', confidence: 'high' });
    const root = temporaryRoot(); fs.mkdirSync(path.join(root, 'tests')); fs.writeFileSync(path.join(root, 'config.ts'), 'const api_key = "your-api-key";'); fs.writeFileSync(path.join(root, 'tests', 'fixture.ts'), 'const api_key = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";');
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: ['config.ts', 'tests/fixture.ts'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(findings.filter((item) => item.category === 'secret')).toEqual([]);
    fs.writeFileSync(path.join(root, 'real.py'), 'SECRET_KEY: str = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";');
    const real = await builtinRuleScanner.scan({ projectDir: root, files: ['real.py'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(real[0]).toMatchObject({ severity: 'P1', confidence: 'high', secretDetails: { currentExists: true, historyExists: false } });
  });

  it('aggregates the same Git secret across commits and locations', async () => {
    const root = temporaryRoot(); const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    execFileSync('git', ['init'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'security-audit@example.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'Security Audit Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'config.py'), `api_key = "${secret}"\n`); execFileSync('git', ['add', 'config.py'], { cwd: root }); execFileSync('git', ['commit', '-m', 'first'], { cwd: root });
    fs.writeFileSync(path.join(root, 'settings.py'), `access_token = "${secret}"\n`); execFileSync('git', ['add', 'settings.py'], { cwd: root }); execFileSync('git', ['commit', '-m', 'second'], { cwd: root });
    const findings = await scanGitHistoryAggregated({ projectDir: root, files: ['config.py', 'settings.py'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({ severity: 'P1', secretDetails: { currentExists: true, historyExists: true, occurrences: 2 } });
    const cached = await scanGitHistoryAggregated({ projectDir: root, files: ['config.py', 'settings.py'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    expect(cached[0].secretDetails?.occurrences).toBe(2);
  });

  it('parses Bandit AST findings and reports partial language coverage', () => {
    expect(parseBanditOutput({ results: [{ test_id: 'B602', test_name: 'subprocess_popen_with_shell_equals_true', issue_severity: 'HIGH', issue_text: 'shell=True', filename: 'app.py', line_number: 8, code: 'subprocess.Popen(cmd, shell=True)' }] }, fixtureContext)[0]).toMatchObject({ scannerId: 'bandit', ruleId: 'B602', severity: 'P1' });
    const coverage = { ...buildScanCoverage(temporaryRoot(), [], 'full'), languages: { Python: 10, TypeScript: 2 }, discoveredFiles: 12, scannedFiles: 12 };
    expect(assessScanCoverage(coverage, [{ scannerId: 'semantic-analysis', name: 'TS', status: 'succeeded', startedAt: 0, completedAt: 1, durationMs: 1, findingsCount: 0 }])).toMatchObject({ capability: 'partial', unanalyzedLanguages: ['Python'] });
  });
});
