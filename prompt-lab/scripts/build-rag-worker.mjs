import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = path.join(root, 'native', 'rag-worker', 'Cargo.toml');
const build = spawnSync('cargo', ['build', '--release', '--manifest-path', manifest], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

const executable = process.platform === 'win32' ? 'nwd-rag-worker.exe' : 'nwd-rag-worker';
const source = path.join(root, 'native', 'rag-worker', 'target', 'release', executable);
const destinationDirectory = path.join(root, 'resources', 'rag-worker');
fs.mkdirSync(destinationDirectory, { recursive: true });
fs.copyFileSync(source, path.join(destinationDirectory, executable));

