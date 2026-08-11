import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = path.join(root, 'native', 'mycast', 'Cargo.toml');
// Keep build output outside native/mycast/target. During development the
// running Electron app may still have that binary open on Windows, which
// prevents Cargo from replacing it on the next `npm start`.
const targetDirectory = path.join(root, '.cache', 'native-build', 'mycast');

console.log('[build-mycast] cargo build --release ...');
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const build = spawnSync(cargo, ['build', '--release', '--manifest-path', manifest, '--target-dir', targetDirectory], {
  stdio: 'inherit',
  shell: false,
});
if (build.error) {
  console.error(`[build-mycast] failed to launch Cargo: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const executable = process.platform === 'win32' ? 'nwd-mycast.exe' : 'nwd-mycast';
const source = path.join(targetDirectory, 'release', executable);
if (!fs.existsSync(source)) {
  console.error(`[build-mycast] expected binary missing: ${source}`);
  process.exit(1);
}

const destinationDirectory = path.join(root, 'resources', 'mycast');
fs.mkdirSync(destinationDirectory, { recursive: true });
const destination = path.join(destinationDirectory, executable);
fs.copyFileSync(source, destination);
console.log(`[build-mycast] copied to ${destination}`);
