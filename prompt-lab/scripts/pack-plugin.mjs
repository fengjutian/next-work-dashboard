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

async function addDirectory(directory, archivePrefix, skipNestedNodeModules = false) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (skipNestedNodeModules && entry.isDirectory() && entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    const relative = `${archivePrefix}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
    if (entry.isDirectory()) await addDirectory(absolute, relative, skipNestedNodeModules);
    else if (entry.isFile()) zip.file(relative, await fs.readFile(absolute), { date: archiveDate });
  }
}

const copiedDependencies = new Set();
async function addProductionDependency(name) {
  if (copiedDependencies.has(name)) return;
  copiedDependencies.add(name);
  const source = path.join(projectRoot, 'node_modules', ...name.split('/'));
  let packageJson;
  try { packageJson = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Required plugin dependency is missing: ${name}`);
    throw error;
  }
  await addDirectory(source, `node_modules/${name}`, true);
  for (const dependency of Object.keys(packageJson.dependencies ?? {}).sort()) await addProductionDependency(dependency);
}

const packageDependencies = (manifest.packageDependencies ?? []).filter((dependency) => (
  (!dependency.platforms?.length || dependency.platforms.includes(process.platform))
  && (!dependency.architectures?.length || dependency.architectures.includes(process.arch))
));
if (manifest.packageDependencies?.length && packageDependencies.length === 0) {
  throw new Error(`Plugin ${pluginId} has no dependencies for ${process.platform}-${process.arch}`);
}
for (const dependency of packageDependencies) await addProductionDependency(dependency.name);

const declaredResources = manifest.packageResources?.length
  ? manifest.packageResources
  : manifest.packageDependencies?.length
    ? []
    : [{ from: `resources/${pluginId}`, to: 'resources' }];
const packageResources = declaredResources.filter((resource) => (
  (!resource.platforms?.length || resource.platforms.includes(process.platform))
  && (!resource.architectures?.length || resource.architectures.includes(process.arch))
));
if (manifest.packageResources?.length && packageResources.length === 0) {
  throw new Error(`Plugin ${pluginId} has no resources for ${process.platform}-${process.arch}`);
}
for (const resource of packageResources) {
  const source = path.resolve(projectRoot, resource.from);
  if (source !== projectRoot && !source.startsWith(`${projectRoot}${path.sep}`)) throw new Error(`Resource escapes project: ${resource.from}`);
  let stat;
  try { stat = await fs.stat(source); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Required plugin resource is missing: ${resource.from}`);
    throw error;
  }
  if (stat.isDirectory()) await addDirectory(source, resource.to || 'resources');
  else if (stat.isFile()) zip.file(resource.to || `resources/${path.basename(source)}`, await fs.readFile(source), { date: archiveDate });
  else throw new Error(`Plugin resource is not a file or directory: ${resource.from}`);
}

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
// Keep one metadata file per target so building another OS/architecture does
// not erase artifacts already prepared for the same plugin version.
await fs.writeFile(path.join(outputDirectory, `artifact.${process.platform}-${process.arch}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
