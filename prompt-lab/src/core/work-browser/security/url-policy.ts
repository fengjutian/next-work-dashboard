import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export function assertSafeRemoteUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('INVALID_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('UNSUPPORTED_URL_PROTOCOL');
  if (url.username || url.password) throw new Error('URL_CREDENTIALS_NOT_ALLOWED');

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || isPrivateAddress(host)) {
    throw new Error('PRIVATE_NETWORK_URL_BLOCKED');
  }
  return url;
}

export async function assertPublicRemoteUrl(rawUrl: string): Promise<URL> {
  const url = assertSafeRemoteUrl(rawUrl);
  if (isIP(url.hostname)) return url;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('URL_HOST_LOOKUP_FAILED');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('PRIVATE_NETWORK_URL_BLOCKED');
  }
  return url;
}

export function isSafeWebNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'about:';
  } catch {
    return false;
  }
}

function isPrivateAddress(host: string): boolean {
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || a >= 224;
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff');
  }
  return false;
}
