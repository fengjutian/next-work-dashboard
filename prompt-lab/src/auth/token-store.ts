/**
 * Token Storage Module — 安全的凭据存储
 *
 * 使用 Electron 内置的 safeStorage API 进行加密：
 * - macOS:  Keychain
 * - Windows: DPAPI (Data Protection API)
 * - Linux:   libsecret (gnome-keyring / kwallet)
 *
 * 加密后的数据写入 userData 目录下的独立文件，
 * 与主数据文件分离，降低批量泄露风险。
 *
 * 安全原则：
 * 1. Token 只在主进程持有，渲染进程通过 IPC 按需获取
 * 2. 使用完毕后渲染进程应立即丢弃（设为 null）
 * 3. 加密密钥由 OS 管理，与当前用户账户绑定
 * 4. 不记录到任何日志中
 */

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// ── 存储路径 ──

const AUTH_FILE = path.join(app.getPath('userData'), '.auth-tokens.enc');

// ── 数据结构 ──

interface TokenEntry {
  /** 服务标识，如 'deepseek' / 'chatgpt' */
  service: string;
  /** base64 编码的加密 token */
  encryptedToken: string;
  /** 保存时间戳 */
  savedAt: number;
  /** 可选备注 */
  label?: string;
}

interface AuthStore {
  version: 1;
  tokens: TokenEntry[];
}

// ── 内部读写 ──

function readStore(): AuthStore {
  try {
    if (!fs.existsSync(AUTH_FILE)) return { version: 1, tokens: [] };
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.version === 1 && Array.isArray(parsed.tokens)) {
      return parsed;
    }
  } catch {
    // 文件损坏时静默重置
  }
  return { version: 1, tokens: [] };
}

function writeStore(store: AuthStore): void {
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store), 'utf-8');
  // 限制文件权限（仅当前用户可读写）
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch { /* best-effort */ }
}

// ── 公开 API ──

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * 保存 token（自动加密）
 * @param service 服务名，如 'github' / 'openai'
 * @param token 明文 token
 * @param label 可选备注
 */
export function saveToken(service: string, token: string, label?: string): boolean {
  if (!token || token.length === 0) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  try {
    const encrypted = safeStorage.encryptString(token);
    const store = readStore();

    // 移除同服务的旧条目（upsert）
    const idx = store.tokens.findIndex((t) => t.service === service);
    const entry: TokenEntry = {
      service,
      encryptedToken: encrypted.toString('base64'),
      savedAt: Date.now(),
      label,
    };

    if (idx >= 0) {
      store.tokens[idx] = entry;
    } else {
      store.tokens.push(entry);
    }

    writeStore(store);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取并解密 token
 * @returns 明文 token，不存在或解密失败返回 null
 */
export function getToken(service: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    const store = readStore();
    const entry = store.tokens.find((t) => t.service === service);
    if (!entry) return null;

    const buf = Buffer.from(entry.encryptedToken, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

/**
 * 删除指定服务的 token
 */
export function deleteToken(service: string): boolean {
  try {
    const store = readStore();
    store.tokens = store.tokens.filter((t) => t.service !== service);
    writeStore(store);
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出已保存的服务（不返回 token 内容）
 */
export function listServices(): Array<{ service: string; savedAt: number; label?: string }> {
  try {
    const store = readStore();
    return store.tokens.map((t) => ({
      service: t.service,
      savedAt: t.savedAt,
      label: t.label,
    }));
  } catch {
    return [];
  }
}

/**
 * 删除所有 token
 */
export function clearAll(): boolean {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    return true;
  } catch {
    return false;
  }
}
