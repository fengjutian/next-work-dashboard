import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeTypeScriptProject, applyInlineSuppressions, buildScanCoverage, builtinRuleScanner, enumerateTextFiles, findingsToSarif, mergeWithBaseline, parseNpmLock, redactSecrets } from '../src/core/security-audit';
import { redactScannerOutput, resolveTrustedScannerExecutable, runScannerProcess } from '../src/main/security-audit/external-process';
import { parseGitleaksOutput, parseOsvOutput, parseSemgrepOutput, parseTrivyOutput, readLimitedJsonReport } from '../src/main/security-audit/external-scanners';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function temporaryRoot(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-')); roots.push(root); return root; }
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'security-audit', `${name}.json`), 'utf8')) as Record<string, unknown>;
const fixtureContext = { projectDir: 'D:/fixture-project', files: [], signal: new AbortController().signal, networkPolicy: 'deny' as const, emit: () => undefined };

describe('security audit core', () => {
  it('redacts credentials from evidence', () => {
    expect(redactSecrets('api_key = "super-secret-value"')).not.toContain('super-secret-value');
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
    fs.writeFileSync(path.join(root, 'src', 'route.ts'), "import { run } from './shell'; export function route(req: any) { const command = req.query.command; run(command); }");
    const result = analyzeTypeScriptProject({ projectDir: root, files: ['src/shell.ts', 'src/route.ts'], signal: new AbortController().signal, networkPolicy: 'deny', emit: () => undefined });
    const finding = result.findings.find((item) => item.ruleId === 'taint.command-injection');
    expect(finding?.confidence).toBe('high');
    expect(finding?.trace?.map((step) => step.kind)).toEqual(['source', 'propagation', 'call', 'sink']);
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
});
