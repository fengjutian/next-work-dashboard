import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

// GitHub release downloads are frequently unavailable on some networks. Keep the
// mirror overridable for CI/corporate environments, but provide a reliable default
// for Electron archives and the headers used while rebuilding native modules.
const electronMirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_MIRROR = electronMirror;
process.env.npm_config_electron_mirror ||= electronMirror;
process.env.npm_config_disturl ||= electronMirror;

const projectRoot = process.cwd();
const diskScannerResource = path.join(projectRoot, 'resources', 'disk-scanner');
const ragWorkerResource = path.join(projectRoot, 'resources', 'rag-worker');
const videoPlayerResource = path.join(projectRoot, 'resources', 'video-player');
const mycastResource = path.join(projectRoot, 'resources', 'mycast');
const netProbeResource = path.join(projectRoot, 'resources', 'net-probe');
const voiceEngineResource = path.join(projectRoot, 'resources', 'voice-engine');
const ffmpegResource = path.join(projectRoot, 'resources', 'ffmpeg');
const iconsResource = path.join(projectRoot, 'resources', 'icons');
const windowsIcon = path.join(iconsResource, 'next-work-dashboard-app-icon-v2-colorful.ico');

function resolveInstalledPackage(name: string, fromDirectory: string): string | null {
  const segments = name.split('/');
  let cursor = fromDirectory;
  while (cursor.startsWith(projectRoot)) {
    const candidate = path.join(cursor, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function copyProductionDependencyTree(name: string, buildPath: string, fromDirectory = projectRoot, copied = new Set<string>(), includeOptional = true): void {
  const source = resolveInstalledPackage(name, fromDirectory);
  if (!source || copied.has(source)) return;
  copied.add(source);

  const relativePath = path.relative(projectRoot, source);
  const destination = path.join(buildPath, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    // Dependencies are copied deliberately below. Copying a package's nested
    // node_modules wholesale bypasses platform/optional filtering and was the
    // reason Linux/macOS ONNX payloads entered the Windows application.
    filter: (sourcePath) => {
      const nestedPath = path.relative(source, sourcePath);
      return nestedPath === '' || !nestedPath.split(path.sep).includes('node_modules');
    },
  });

  const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencies = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...(includeOptional ? Object.keys(packageJson.optionalDependencies ?? {}) : []),
  ]);
  dependencies.forEach((dependency) => copyProductionDependencyTree(dependency, buildPath, source, copied, includeOptional));
}

function lancedbNativePackage(): string {
  if (process.platform === 'win32') return `@lancedb/lancedb-win32-${process.arch}-msvc`;
  if (process.platform === 'darwin') return `@lancedb/lancedb-darwin-${process.arch}`;
  return `@lancedb/lancedb-linux-${process.arch}-gnu`;
}

function removePath(target: string): void {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function keepOnlyFiles(directory: string, names: Set<string>): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    if (!names.has(entry)) removePath(path.join(directory, entry));
  }
}

/**
 * electron-rebuild needs the native package sources earlier in packaging, but
 * the shipped application only needs JavaScript plus the rebuilt binaries.
 * Trim compiler output, symbols, sources and foreign-architecture prebuilds
 * after Forge has pruned/rebuilt the application.
 */
function pruneNativeBuildArtifacts(buildPath: string): void {
  const nodeModules = path.join(buildPath, 'node_modules');
  const nodePty = path.join(nodeModules, 'node-pty');
  if (fs.existsSync(nodePty)) {
    for (const entry of ['deps', 'node-addon-api', 'prebuilds', 'scripts', 'src', 'third_party', 'typings']) {
      removePath(path.join(nodePty, entry));
    }
    const release = path.join(nodePty, 'build', 'Release');
    keepOnlyFiles(release, new Set([
      'conpty.node',
      'conpty_console_list.node',
      'pty.node',
      'winpty-agent.exe',
      'winpty.dll',
      // Unix rebuilds produce the helper next to pty.node.
      'spawn-helper',
    ]));
    if (fs.existsSync(path.join(nodePty, 'build'))) {
      for (const entry of fs.readdirSync(path.join(nodePty, 'build'))) {
        if (entry !== 'Release') removePath(path.join(nodePty, 'build', entry));
      }
    }
  }

  const betterSqlite = path.join(nodeModules, 'better-sqlite3');
  if (fs.existsSync(betterSqlite)) {
    for (const entry of ['deps', 'src']) removePath(path.join(betterSqlite, entry));
    const release = path.join(betterSqlite, 'build', 'Release');
    keepOnlyFiles(release, new Set(['better_sqlite3.node']));
    if (fs.existsSync(path.join(betterSqlite, 'build'))) {
      for (const entry of fs.readdirSync(path.join(betterSqlite, 'build'))) {
        if (entry !== 'Release') removePath(path.join(betterSqlite, 'build', entry));
      }
    }
  }
}

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const copied = new Set<string>();
      copyProductionDependencyTree('node-pty', buildPath, projectRoot, copied);
      // The package declares every platform binary plus optional ML stacks.
      // This app uses only the core database API, so package the host binary and
      // peer Arrow runtime without copying ONNX, Sharp, macOS and Linux payloads.
      if (process.env.NWD_BUNDLE_VECTOR_RUNTIME === '1') {
        copyProductionDependencyTree('@lancedb/lancedb', buildPath, projectRoot, copied, false);
        copyProductionDependencyTree(lancedbNativePackage(), buildPath, projectRoot, copied, false);
        copyProductionDependencyTree('apache-arrow', buildPath, projectRoot, copied, false);
      }
      copyProductionDependencyTree('better-sqlite3', buildPath, projectRoot, copied);
      copyProductionDependencyTree('ws', buildPath, projectRoot, copied);
    },
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      pruneNativeBuildArtifacts(buildPath);
    },
  },
  packagerConfig: {
    ...(process.platform === 'win32' && fs.existsSync(windowsIcon) ? { icon: windowsIcon } : {}),
    extraResource: [
      ...(fs.existsSync(iconsResource) ? [iconsResource] : []),
      ...(fs.existsSync(path.join(projectRoot, 'resources', 'plugin-marketplace-public.pem')) ? [path.join(projectRoot, 'resources', 'plugin-marketplace-public.pem')] : []),
      ...(process.env.NWD_BUNDLE_OFFICECLI === '1' && fs.existsSync(path.join(projectRoot, 'resources', 'officecli')) ? [path.join(projectRoot, 'resources', 'officecli')] : []),
      ...(fs.existsSync(diskScannerResource) ? [diskScannerResource] : []),
      ...(fs.existsSync(ragWorkerResource) ? [ragWorkerResource] : []),
      ...(process.env.NWD_BUNDLE_VIDEO_PLAYER === '1' && fs.existsSync(videoPlayerResource) ? [videoPlayerResource] : []),
      ...(fs.existsSync(mycastResource) ? [mycastResource] : []),
      ...(process.env.NWD_BUNDLE_NET_PROBE === '1' && fs.existsSync(netProbeResource) ? [netProbeResource] : []),
      ...(process.env.NWD_BUNDLE_VOICE_ENGINE === '1' && fs.existsSync(voiceEngineResource) ? [voiceEngineResource] : []),
      ...(process.env.NWD_BUNDLE_FFMPEG === '1' && fs.existsSync(ffmpegResource) && fs.readdirSync(ffmpegResource, { recursive: true }).some((entry) => /ffmpeg(?:\.exe)?$/i.test(String(entry))) ? [ffmpegResource] : []),
    ],
    asar: {
      // The work-browser webview cleaner runs inside an <webview> whose
      // preload attribute can't read files from inside app.asar. Keep the
      // bundle accessible at the resolved path used by `cleaner.ts`.
      unpack: '**/{*.node,winpty-agent.exe,winpty.dll,webview-cleaner-preload.js,webview-preload.js}',
    },
    download: {
      mirrorOptions: {
        mirror: electronMirror,
      },
    },
  },
  rebuildConfig: {
    onlyModules: ['node-pty', 'better-sqlite3', ...(process.env.NWD_BUNDLE_VECTOR_RUNTIME === '1' ? ['@lancedb/lancedb'] : [])],
  },
  makers: [
    new MakerSquirrel({
      setupIcon: windowsIcon,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/security-audit-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/webview-preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/webview-cleaner-preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
