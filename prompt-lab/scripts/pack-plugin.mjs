import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const projectRoot = path.resolve(import.meta.dirname, '..');
const pluginId = process.argv[2];
if (!pluginId || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{1,63}$/u.test(pluginId)) {
  throw new Error('Usage: npm run plugin:pack -- <plugin-id>');
}

const sourceRoot = path.join(projectRoot, 'src', 'plugins', pluginId);
const archiveDate = new Date('1980-01-01T00:00:00.000Z');
const manifestPath = path.join(sourceRoot, 'plugin.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.id !== pluginId || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error('plugin.json id/version is invalid');
}

const zip = new JSZip();
zip.file('plugin.json', `${JSON.stringify(manifest, null, 2)}\n`, { date: archiveDate });

const resourceRoot = path.join(projectRoot, 'resources', pluginId);
async function addDirectory(directory, archivePrefix) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = `${archivePrefix}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
    if (entry.isDirectory()) await addDirectory(absolute, relative);
    else if (entry.isFile()) zip.file(relative, await fs.readFile(absolute), { date: archiveDate });
  }
}

try { await addDirectory(resourceRoot, 'resources'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const outputDirectory = path.join(projectRoot, '_artifacts', 'plugins', pluginId, manifest.version);
await fs.mkdir(outputDirectory, { recursive: true });
const artifactName = `${pluginId}-${manifest.version}-${process.platform}-${process.arch}.zip`;
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
const artifactPath = path.join(outputDirectory, artifactName);
await fs.writeFile(artifactPath, bytes);
const metadata = {
  id: pluginId,
  version: manifest.version,
  platform: `${process.platform}-${process.arch}`,
  file: artifactName,
  size: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
};
await fs.writeFile(path.join(outputDirectory, 'artifact.json'), `${JSON.stringify(metadata, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
