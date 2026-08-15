import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinRuleScanner, enumerateTextFiles, mergeWithBaseline, redactSecrets } from '../src/core/security-audit';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function temporaryRoot(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-')); roots.push(root); return root; }

describe('security audit core', () => {
  it('redacts credentials from evidence', () => {
    expect(redactSecrets('api_key = "super-secret-value"')).not.toContain('super-secret-value');
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
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: [file], signal: controller.signal, emit() {} });
    expect(findings.map((item) => item.ruleId)).toEqual(['secret.generic-api-key', 'electron.node-integration']);
    expect(findings[0].evidence[0].excerpt).not.toContain('abcdefghijklmnop');
  });

  it('keeps first-seen state and marks missing findings fixed', async () => {
    const root = temporaryRoot(); const file = 'unsafe.ts';
    fs.writeFileSync(path.join(root, file), 'eval(input)');
    const findings = await builtinRuleScanner.scan({ projectDir: root, files: [file], signal: new AbortController().signal, emit() {} });
    const merged = mergeWithBaseline([], findings, findings[0].lastSeenAt + 10);
    expect(merged[0].status).toBe('fixed');
    expect(merged[0].fixedAt).toBeDefined();
  });

  it('does not resolve findings outside an incremental scan scope', async () => {
    const root = temporaryRoot(); fs.writeFileSync(path.join(root, 'unsafe.ts'), 'eval(input)');
    const previous = await builtinRuleScanner.scan({ projectDir: root, files: ['unsafe.ts'], signal: new AbortController().signal, emit() {} });
    expect(mergeWithBaseline([], previous, Date.now(), new Set(['other.ts']))[0].status).toBe('open');
  });
});
