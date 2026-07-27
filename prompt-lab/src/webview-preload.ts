// webview preload — runs inside <webview> pages BEFORE any page script
// Overrides browser fingerprint APIs to prevent anti-bot detection
// (e.g. DeepSeek "使用环境异常" warning)

console.log('[next-work-dashboard] webview preload loaded');

// ── Standard Chrome 134 (Electron 35) UA on Windows ──
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

// ── Override navigator.userAgent ──
Object.defineProperty(navigator, 'userAgent', {
  get: () => CHROME_UA,
  configurable: true,
});

// ── Override navigator.userAgentData (if present) ──
if ('userAgentData' in navigator) {
  try {
    (navigator as any).userAgentData = {
      brands: [
        { brand: 'Chromium', version: '134' },
        { brand: 'Google Chrome', version: '134' },
        { brand: 'Not=A?Brand', version: '99' },
      ],
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: (_hints: string[]) =>
        Promise.resolve({
          platform: 'Windows',
          platformVersion: '10.0.0',
          architecture: 'x86',
          model: '',
          uaFullVersion: '134.0.6998.165',
          fullVersionList: [
            { brand: 'Chromium', version: '134.0.6998.165' },
            { brand: 'Google Chrome', version: '134.0.6998.165' },
            { brand: 'Not=A?Brand', version: '99.0.0.0' },
          ],
        }),
    };
  } catch { /* ignore */ }
}

// ── Remove webdriver flag ──
if ('webdriver' in navigator) {
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch { /* ignore */ }
}

// ── Override navigator.plugins (empty in Electron → suspicious) ──
const fakePlugins = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
] as unknown as PluginArray;

try {
  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true,
  });
} catch { /* ignore */ }

// ── Override navigator.languages ──
try {
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    configurable: true,
  });
} catch { /* ignore */ }

// ── Override navigator.platform ──
try {
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
    configurable: true,
  });
} catch { /* ignore */ }

// ── Override navigator.hardwareConcurrency ──
try {
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true,
  });
} catch { /* ignore */ }

// ── Override navigator.deviceMemory ──
try {
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true,
  });
} catch { /* ignore */ }

// ── Ensure window.chrome looks real ──
if (typeof (window as any).chrome !== 'object') {
  (window as any).chrome = {
    runtime: {},
    loadTimes: () => {},
    csi: () => {},
    app: {},
  };
}

// ── Override screen dimensions to look normal ──
try {
  Object.defineProperty(screen, 'colorDepth', {
    get: () => 24,
    configurable: true,
  });
  Object.defineProperty(screen, 'pixelDepth', {
    get: () => 24,
    configurable: true,
  });
} catch { /* ignore */ }
