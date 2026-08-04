import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const winptyGyp = path.join(root, 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp');

if (!fs.existsSync(winptyGyp)) {
  console.log('node-pty is not installed; skipping native dependency preparation.');
  process.exit(0);
}

const source = fs.readFileSync(winptyGyp, 'utf8');
const spectreSetting = /'SpectreMitigation': 'Spectre'/g;
const matches = source.match(spectreSetting)?.length ?? 0;

if (matches === 0) {
  if (source.includes("'SpectreMitigation': 'false'")) {
    console.log('node-pty winpty Spectre setting is already compatible.');
    process.exit(0);
  }
  throw new Error('Unsupported node-pty winpty.gyp layout; refusing to patch an unknown dependency version.');
}

if (matches !== 2) throw new Error(`Expected 2 winpty Spectre settings, found ${matches}.`);
fs.writeFileSync(winptyGyp, source.replace(spectreSetting, "'SpectreMitigation': 'false'"), 'utf8');
console.log('Prepared node-pty winpty build for Visual Studio installations without Spectre libraries.');
