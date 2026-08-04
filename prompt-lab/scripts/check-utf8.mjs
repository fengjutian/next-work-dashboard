import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.vite', '.tmp-node-v22.23.1']);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.jsonc', '.md', '.css', '.html', '.yml', '.yaml']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const mojibake = [
  /\uFFFD/u,
  new RegExp(String.fromCodePoint(0x951f, 0x65a4, 0x62f7), 'u'),
  /[\u00c2\u00c3][\u0080-\u00bf]/u,
];
const errors = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { visit(target); continue; }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLocaleLowerCase())) continue;
    const relative = path.relative(repositoryRoot, target);
    try {
      const text = decoder.decode(fs.readFileSync(target));
      if (mojibake.some((pattern) => pattern.test(text))) errors.push(`${relative}: common mojibake marker detected`);
    } catch { errors.push(`${relative}: not valid UTF-8`); }
  }
}
visit(repositoryRoot);
if (errors.length) {
  console.error(`UTF-8 check failed (${errors.length}):\n${errors.map((item) => `  - ${item}`).join('\n')}`);
  process.exitCode = 1;
} else console.log('UTF-8 and mojibake checks OK.');
