import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const baseUrl = args.get('--base-url')?.replace(/\/$/, '');
const output = path.resolve(projectRoot, args.get('--output') || '_artifacts/plugins/catalog.json');
const keyPath = args.get('--signing-key');
const keyId = args.get('--key-id') || 'official-v1';
if (!baseUrl || !/^https:\/\//.test(baseUrl)) throw new Error('Usage: npm run plugin:catalog -- --base-url https://cdn.example.com/plugins [--signing-key key.pem]');

const artifactRoot = path.join(projectRoot, '_artifacts', 'plugins');
const metadataFiles = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (/^artifact(?:\.[a-z0-9-]+)?\.json$/i.test(entry.name)) metadataFiles.push(target);
  }
}
await collect(artifactRoot);

const plugins = new Map();
for (const file of metadataFiles.sort()) {
  const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
  const manifestPath = path.join(projectRoot, 'src', 'plugins', artifact.id, 'plugin.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  let plugin = plugins.get(artifact.id);
  if (!plugin) {
    plugin = { id: artifact.id, name: manifest.name, description: manifest.description, versions: [] };
    plugins.set(artifact.id, plugin);
  }
  let release = plugin.versions.find((item) => item.version === artifact.version);
  if (!release) {
    release = { version: artifact.version, channel: manifest.channel || 'stable', engines: manifest.engines, artifacts: {} };
    plugin.versions.push(release);
  }
  release.artifacts[artifact.platform] = {
    url: `${baseUrl}/${artifact.id}/${artifact.version}/${artifact.file}`,
    sha256: artifact.sha256,
    size: artifact.size,
  };
}

const catalog = { schemaVersion: 1, plugins: [...plugins.values()].sort((left, right) => left.id.localeCompare(right.id)) };
for (const plugin of catalog.plugins) plugin.versions.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
if (keyPath) {
  const privateKey = await fs.readFile(path.resolve(keyPath), 'utf8');
  const value = crypto.sign(null, Buffer.from(JSON.stringify(catalog)), privateKey).toString('base64');
  catalog.signature = { keyId, value };
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
process.stdout.write(`Catalog written: ${output} (${catalog.plugins.length} plugins)\n`);
