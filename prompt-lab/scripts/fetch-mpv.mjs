/**
 * fetch-mpv.mjs — 下载并解压 mpv 预编译二进制
 *
 * 支持平台：
 *  - Windows (x64) — 从 shinchiro/mpv-winbuild-cmake 拉最新 7z
 *  - macOS (x64 / arm64) — 提示用户用 `brew install mpv`（脚本不强求）
 *  - Linux (x64) — 提示用户用系统包管理器（apt / dnf / pacman）
 *
 * 用法：
 *   node scripts/fetch-mpv.mjs            # 拉当前平台
 *   node scripts/fetch-mpv.mjs --version  # 指定 mpv 版本
 *   node scripts/fetch-mpv.mjs --dry-run  # 只打印下载信息不下载
 *
 * 产物：
 *   resources/video-player/<platform>/mpv(.exe)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const targetRoot = path.join(projectRoot, 'resources', 'video-player');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const requestedVersion = (() => {
  const arg = process.argv.find((a) => a.startsWith('--version='));
  return arg ? arg.slice('--version='.length) : null;
})();

function info(msg) { console.log(`[fetch-mpv] ${msg}`); }
function warn(msg) { console.warn(`[fetch-mpv] WARN: ${msg}`); }
function fatal(msg) { console.error(`[fetch-mpv] ERROR: ${msg}`); process.exit(1); }

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function platformDir() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function executableName() {
  return process.platform === 'win32' ? 'mpv.exe' : 'mpv';
}

function targetBinaryPath() {
  return path.join(targetRoot, platformDir(), executableName());
}

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https.get(url, { headers: { 'User-Agent': 'next-work-dashboard fetch-mpv' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
          response.resume();
          return request(new URL(response.headers.location, url).toString());
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        }
        resolve(response);
      }).on('error', reject);
    };
    request(url);
  });
}

function downloadTo(url, destination) {
  return new Promise((resolve, reject) => {
    followRedirects(url)
      .then((response) => {
        const total = Number(response.headers['content-length'] || 0);
        let downloaded = 0;
        ensureDir(path.dirname(destination));
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0 && !dryRun) {
            const percent = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r[fetch-mpv] 下载中… ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        file.on('finish', () => {
          file.close();
          if (total > 0) process.stdout.write('\n');
          resolve();
        });
        file.on('error', reject);
      })
      .catch(reject);
  });
}

/** 解析 GitHub release，找到 Windows 7z 资产 */
async function resolveWindowsAsset() {
  const apiUrl = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest';
  info(`查询最新 release：${apiUrl}`);
  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': 'next-work-dashboard fetch-mpv', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub API 返回 ${response.status} ${response.statusText}`);
  }
  const release = await response.json();
  const assets = release.assets || [];
  const target = assets.find((asset) => /mpv-x86_64-.*\.7z$/.test(asset.name) && !/debug/.test(asset.name));
  if (!target) {
    throw new Error('未找到匹配的 mpv-x86_64-*.7z 资产');
  }
  return { version: release.tag_name, url: target.browser_download_url, name: target.name, size: target.size };
}

function find7z() {
  if (process.platform !== 'win32') {
    const candidates = ['7z', '7za', 'p7zip'];
    for (const cmd of candidates) {
      const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
      if (probe.status === 0) return cmd;
    }
    return null;
  }
  // Windows 上优先 7z.exe；如未安装给出提示
  const probe = spawnSync('7z', ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? '7z' : null;
}

async function extractWindowsArchive(archivePath, extractDir) {
  const sevenZip = find7z();
  if (!sevenZip) {
    fatal(
      '未找到 7z 可执行文件。Windows 平台 mpv 预编译包是 .7z 格式。\n' +
      '请通过 scoop（scoop install 7zip）或 choco（choco install 7zip）安装 7-Zip 后重试。\n' +
      '安装完后再次执行：npm run fetch:mpv',
    );
  }
  ensureDir(extractDir);
  info(`解压 ${archivePath} → ${extractDir}`);
  const result = spawnSync(sevenZip, ['x', archivePath, `-o${extractDir}`, '-y', '-bb0', '-bso0'], { stdio: 'inherit' });
  if (result.status !== 0) {
    fatal(`7z 解压失败（exit ${result.status}）`);
  }
}

async function installWindows() {
  const asset = await resolveWindowsAsset();
  info(`将下载：${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
  if (dryRun) return;
  const tmpDir = path.join(projectRoot, 'resources', 'video-player', '.tmp');
  ensureDir(tmpDir);
  const archivePath = path.join(tmpDir, asset.name);
  await downloadTo(asset.url, archivePath);
  const extractDir = path.join(targetRoot, 'win32');
  ensureDir(extractDir);
  await extractWindowsArchive(archivePath, extractDir);
  // 7z 包结构：mpv-x86_64-YYYYMMDD/mpv.exe
  const finalBinary = path.join(extractDir, executableName());
  if (!fs.existsSync(finalBinary)) {
    // 尝试在解压目录里找 mpv.exe
    const found = (() => {
      const stack = [extractDir];
      while (stack.length > 0) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            stack.push(path.join(dir, entry.name));
          } else if (entry.name === 'mpv.exe') {
            return path.join(dir, entry.name);
          }
        }
      }
      return null;
    })();
    if (!found) fatal('解压后未找到 mpv.exe，请检查包内容。');
    fs.copyFileSync(found, finalBinary);
    info(`已复制 mpv.exe → ${finalBinary}`);
  } else {
    info(`mpv.exe 已就位：${finalBinary}`);
  }
  // 清理临时文件
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  // 7z 包内 mpv.exe 通常依赖同目录的 mpv-1.dll，需要一起复制
  const dllName = 'mpv-1.dll';
  const extractRoot = (() => {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    const sub = entries.find((e) => e.isDirectory() && /^mpv-x86_64-/.test(e.name));
    return sub ? path.join(extractDir, sub.name) : extractDir;
  })();
  const dllSource = path.join(extractRoot, dllName);
  if (fs.existsSync(dllSource)) {
    const dllTarget = path.join(extractDir, dllName);
    fs.copyFileSync(dllSource, dllTarget);
    info(`已复制依赖：${dllName}`);
  } else {
    warn(`未在 ${extractRoot} 找到 ${dllName}；如果 mpv 启动报缺 dll 请手动补齐`);
  }
}

function installMacOS() {
  info('macOS 平台：请使用 Homebrew 安装 mpv：');
  info('    brew install mpv');
  info('脚本将探测常见安装路径：');
  const candidates = ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv'];
  for (const p of candidates) {
    if (fs.existsSync(p)) info(`  ✓ 已检测到：${p}`);
  }
}

function installLinux() {
  info('Linux 平台：建议通过系统包管理器安装：');
  info('    Debian / Ubuntu:  sudo apt install mpv');
  info('    Fedora:           sudo dnf install mpv');
  info('    Arch:             sudo pacman -S mpv');
}

async function main() {
  info(`目标平台：${process.platform}`);
  info(`目标路径：${targetBinaryPath()}`);
  if (fs.existsSync(targetBinaryPath())) {
    info('已存在 mpv 二进制，无需重复下载。如需重装请删除该文件。');
    return;
  }
  if (process.platform === 'win32') {
    await installWindows();
  } else if (process.platform === 'darwin') {
    installMacOS();
  } else {
    installLinux();
  }
  if (fs.existsSync(targetBinaryPath())) {
    info('✓ mpv 已就绪');
  } else if (process.platform !== 'win32') {
    info('请按上述命令安装 mpv 后，插件即可使用');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
