import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = path.join(root, 'native', 'net-probe', 'Cargo.toml');

console.log('[build-net-probe] cargo build --release ...');
const build = spawnSync('cargo', ['build', '--release', '--manifest-path', manifest], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const executable = process.platform === 'win32' ? 'nwd-net-probe.exe' : 'nwd-net-probe';
const source = path.join(root, 'native', 'net-probe', 'target', 'release', executable);
if (!fs.existsSync(source)) {
  console.error(`[build-net-probe] expected binary missing: ${source}`);
  process.exit(1);
}

const destinationDirectory = path.join(root, 'resources', 'net-probe');
fs.mkdirSync(destinationDirectory, { recursive: true });
const destination = path.join(destinationDirectory, executable);
fs.copyFileSync(source, destination);
console.log(`[build-net-probe] copied to ${destination}`);
