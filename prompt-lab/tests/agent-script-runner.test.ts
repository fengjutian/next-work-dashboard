import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAgentProcessEnv, loadPackageScripts, validateAgentScriptName } from '../src/main/agent/script-runner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('Agent package script policy', () => {
  it('only exposes package.json scripts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-script-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, dependencies: { unsafe: 'ignored' } }));
    expect(loadPackageScripts(root)).toEqual({ lint: 'eslint .' });
    expect(validateAgentScriptName('lint', loadPackageScripts(root))).toBe('lint');
    expect(() => validateAgentScriptName('powershell -c whoami', loadPackageScripts(root))).toThrow('INVALID_AGENT_SCRIPT');
  });

  it('does not pass secrets into the child process', () => {
    const env = buildAgentProcessEnv({ PATH: 'bin', API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', TEMP: 'tmp' });
    expect(env.PATH).toBe('bin');
    expect(env.TEMP).toBe('tmp');
    expect(env.API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.CI).toBe('true');
  });
});
