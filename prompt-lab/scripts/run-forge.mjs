import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const command = process.argv[2];
const allowedCommands = new Set(['package', 'make', 'publish']);
if (!command || !allowedCommands.has(command)) {
  console.error(`Usage: node scripts/run-forge.mjs <${[...allowedCommands].join('|')}>`);
  process.exit(2);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const forgeCli = path.join(projectRoot, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');
const heapSizeMb = process.env.NWD_FORGE_HEAP_MB || '8192';

console.log(`[forge] ${command} with V8 heap limit ${heapSizeMb} MB`);
const result = spawnSync(
  process.execPath,
  [`--max-old-space-size=${heapSizeMb}`, forgeCli, command],
  { cwd: projectRoot, stdio: 'inherit', shell: false, env: process.env },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
