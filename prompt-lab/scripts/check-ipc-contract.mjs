import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

const sourceFiles = filesUnder(path.join(root, 'src'));
const handlers = new Set();
const invocations = new Set();
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) handlers.add(match[1]);
  for (const match of source.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)) invocations.add(match[1]);
}

const missingHandlers = [...invocations].filter((channel) => !handlers.has(channel)).sort();
const unusedHandlers = [...handlers].filter((channel) => !invocations.has(channel)).sort();
if (missingHandlers.length || unusedHandlers.length) {
  if (missingHandlers.length) console.error(`IPC invoked without handler:\n${missingHandlers.map((item) => `  - ${item}`).join('\n')}`);
  if (unusedHandlers.length) console.error(`IPC handler without preload invocation:\n${unusedHandlers.map((item) => `  - ${item}`).join('\n')}`);
  process.exitCode = 1;
} else console.log(`IPC contract OK: ${handlers.size} request/response channels.`);
