import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next']);

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(target) : entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}

function anchorFor(heading) {
  return heading.trim().toLocaleLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

const errors = [];
for (const file of markdownFiles(repositoryRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(https?:|mailto:|data:|#)/i.test(rawTarget)) continue;
    const [encodedPath, anchor] = rawTarget.split('#', 2);
    if (!encodedPath) continue;
    let decodedPath;
    try { decodedPath = decodeURIComponent(encodedPath); } catch { errors.push(`${path.relative(repositoryRoot, file)}: invalid URL encoding: ${rawTarget}`); continue; }
    const target = path.resolve(path.dirname(file), decodedPath);
    if (!fs.existsSync(target)) { errors.push(`${path.relative(repositoryRoot, file)}: missing target: ${rawTarget}`); continue; }
    if (anchor && fs.statSync(target).isFile() && target.endsWith('.md')) {
      const headings = new Set([...fs.readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map((item) => anchorFor(item[1])));
      if (!headings.has(anchor.toLocaleLowerCase())) errors.push(`${path.relative(repositoryRoot, file)}: missing anchor: ${rawTarget}`);
    }
  }
}
if (errors.length) {
  console.error(`Markdown link check failed (${errors.length}):\n${errors.map((item) => `  - ${item}`).join('\n')}`);
  process.exitCode = 1;
} else console.log('Markdown links OK.');
