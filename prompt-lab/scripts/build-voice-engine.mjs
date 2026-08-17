// Build the nwd-voice-engine Rust sidecar and copy the release binary into
// resources/voice-engine/ so electron-forge packages it next to the app.
//
// This mirrors scripts/build-mycast.mjs.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = path.join(root, 'native', 'voice-engine', 'Cargo.toml');

console.log('[build-voice-engine] cargo build --release ...');
const build = spawnSync(
  'cargo',
  ['build', '--release', '--manifest-path', manifest],
  { stdio: 'inherit', shell: false },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const executable = process.platform === 'win32' ? 'nwd-voice-engine.exe' : 'nwd-voice-engine';
const source = path.join(root, 'native', 'voice-engine', 'target', 'release', executable);
if (!fs.existsSync(source)) {
  console.error(`[build-voice-engine] expected binary missing: ${source}`);
  process.exit(1);
}

const destinationDirectory = path.join(root, 'resources', 'voice-engine');
fs.mkdirSync(destinationDirectory, { recursive: true });
const destination = path.join(destinationDirectory, executable);
fs.copyFileSync(source, destination);
console.log(`[build-voice-engine] copied to ${destination}`);
