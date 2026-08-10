import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.dirname(root);
const packageRoots = [root, workspaceRoot]
  .map((directory) => path.join(directory, 'node_modules', 'node-pty'))
  .filter((directory, index, all) => fs.existsSync(path.join(directory, 'package.json')) && all.indexOf(directory) === index);

if (!packageRoots.length) {
  console.log('node-pty is not installed; skipping native dependency preparation.');
  process.exit(0);
}

const spectreSetting = /'SpectreMitigation': 'Spectre'/g;
let patched = 0;
for (const packageRoot of packageRoots) {
  const configs = [
    { file: path.join(packageRoot, 'binding.gyp'), expected: 1 },
    { file: path.join(packageRoot, 'deps', 'winpty', 'src', 'winpty.gyp'), expected: 2 },
  ];
  for (const config of configs) {
    if (!fs.existsSync(config.file)) throw new Error(`Unsupported node-pty layout; missing ${config.file}.`);
    const source = fs.readFileSync(config.file, 'utf8');
    const matches = source.match(spectreSetting)?.length ?? 0;
    if (matches === 0) {
      if (source.includes("'SpectreMitigation': 'false'")) continue;
      throw new Error(`Unsupported node-pty build configuration: ${config.file}.`);
    }
    if (matches !== config.expected) throw new Error(`Expected ${config.expected} Spectre settings in ${config.file}, found ${matches}.`);
    fs.writeFileSync(config.file, source.replace(spectreSetting, "'SpectreMitigation': 'false'"), 'utf8');
    patched += matches;
  }
}
console.log(patched ? `Disabled ${patched} node-pty Spectre build settings for this installation.` : 'node-pty Spectre settings are already compatible.');
