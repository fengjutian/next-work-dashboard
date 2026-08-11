export type ProbeKind = 'icmp' | 'tcp' | 'dns' | 'http' | 'traceroute' | 'lan_scan';

export interface ProbeTargetInput {
  id?: string;
  target: string;
  probe?: ProbeKind;
  intervalMs?: number;
  timeoutMs?: number;
  options?: Record<string, unknown>;
  enabled?: boolean;
}

const PROBE_KINDS = new Set<ProbeKind>(['icmp', 'tcp', 'dns', 'http', 'traceroute', 'lan_scan']);

function boundedInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

export function validateTargetInput(input: ProbeTargetInput): ProbeTargetInput {
  if (!input || typeof input !== 'object') throw new Error('target input is required');
  const target = typeof input.target === 'string' ? input.target.trim() : '';
  if (!target || target.length > 2048 || containsControlCharacters(target)) {
    throw new Error('target must be 1 to 2048 printable characters');
  }
  const probe = input.probe ?? 'icmp';
  if (!PROBE_KINDS.has(probe)) throw new Error('unsupported probe kind');
  const intervalMs = boundedInteger(input.intervalMs ?? 5000, 'intervalMs', 500, 86_400_000);
  const timeoutMs = boundedInteger(input.timeoutMs ?? 3000, 'timeoutMs', 100, 120_000);
  const options = input.options && typeof input.options === 'object' && !Array.isArray(input.options) ? { ...input.options } : {};

  if (probe === 'tcp' && options.port != null) options.port = boundedInteger(options.port, 'port', 1, 65_535);
  if (probe === 'traceroute' && options.max_hops != null) options.max_hops = boundedInteger(options.max_hops, 'max_hops', 1, 64);
  if (probe === 'http' && options.url != null) {
    let url: URL;
    try { url = new URL(String(options.url)); } catch { throw new Error('HTTP probe URL is invalid'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('HTTP probe URL must use http or https');
    options.url = url.toString();
  }

  if (input.id != null && (typeof input.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.id))) {
    throw new Error('target id contains unsupported characters');
  }
  return { ...input, target, probe, intervalMs, timeoutMs, options };
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function validateLanScanOptions(opts: unknown): { subnet?: string; maxHosts: number; perPortTimeoutMs: number } {
  const value = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts as Record<string, unknown> : {};
  const maxHosts = boundedInteger(value.maxHosts ?? 254, 'maxHosts', 1, 1024);
  const perPortTimeoutMs = boundedInteger(value.perPortTimeoutMs ?? 300, 'perPortTimeoutMs', 50, 5000);
  if (value.subnet == null || value.subnet === '') return { maxHosts, perPortTimeoutMs };
  if (typeof value.subnet !== 'string') throw new Error('subnet must be a private IPv4 CIDR');
  const match = value.subnet.trim().match(/^([^/]+)\/(\d{1,2})$/);
  if (!match || !isPrivateIpv4(match[1]) || Number(match[2]) < 8 || Number(match[2]) > 32) {
    throw new Error('subnet must be a private IPv4 CIDR with prefix /8 to /32');
  }
  return { subnet: `${match[1]}/${Number(match[2])}`, maxHosts, perPortTimeoutMs };
}
