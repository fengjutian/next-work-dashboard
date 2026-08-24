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

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const copied = new Set<string>();
      copyProductionDependencyTree('node-pty', buildPath, projectRoot, copied);
      // The package declares every platform binary plus optional ML stacks.
      // This app uses only the core database API, so package the host binary and
      // peer Arrow runtime without copying ONNX, Sharp, macOS and Linux payloads.
      copyProductionDependencyTree('@lancedb/lancedb', buildPath, projectRoot, copied, false);
      copyProductionDependencyTree(lancedbNativePackage(), buildPath, projectRoot, copied, false);
      copyProductionDependencyTree('apache-arrow', buildPath, projectRoot, copied, false);
      copyProductionDependencyTree('better-sqlite3', buildPath, projectRoot, copied);
      copyProductionDependencyTree('ws', buildPath, projectRoot, copied);
    },
  },
  packagerConfig: {
    extraResource: [
      ...(fs.existsSync(path.join(projectRoot, 'resources', 'plugin-marketplace-public.pem')) ? [path.join(projectRoot, 'resources', 'plugin-marketplace-public.pem')] : []),
      ...(process.env.NWD_BUNDLE_OFFICECLI === '1' && fs.existsSync(path.join(projectRoot, 'resources', 'officecli')) ? [path.join(projectRoot, 'resources', 'officecli')] : []),
      ...(fs.existsSync(diskScannerResource) ? [diskScannerResource] : []),
      ...(fs.existsSync(ragWorkerResource) ? [ragWorkerResource] : []),
      ...(process.env.NWD_BUNDLE_VIDEO_PLAYER === '1' && fs.existsSync(videoPlayerResource) ? [videoPlayerResource] : []),
      ...(fs.existsSync(mycastResource) ? [mycastResource] : []),
      ...(process.env.NWD_BUNDLE_NET_PROBE === '1' && fs.existsSync(netProbeResource) ? [netProbeResource] : []),
      ...(process.env.NWD_BUNDLE_VOICE_ENGINE === '1' && fs.existsSync(voiceEngineResource) ? [voiceEngineResource] : []),
      ...(fs.existsSync(ffmpegResource) && fs.readdirSync(ffmpegResource, { recursive: true }).some((entry) => /ffmpeg(?:\.exe)?$/i.test(String(entry))) ? [ffmpegResource] : []),
    ],
    asar: {
      // The work-browser webview cleaner runs inside an <webview> whose
      // preload attribute can't read files from inside app.asar. Keep the
      // bundle accessible at the resolved path used by `cleaner.ts`.
      unpack: '**/node_modules/{node-pty,@lancedb,better-sqlite3}/**\n**/.vite/build/webview-cleaner-preload.js\n**/.vite/build/webview-preload.js',
    },
    download: {
      mirrorOptions: {
        mirror: electronMirror,
      },
    },
  },
  rebuildConfig: {
    onlyModules: ['node-pty', '@lancedb/lancedb', 'better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({}),
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
