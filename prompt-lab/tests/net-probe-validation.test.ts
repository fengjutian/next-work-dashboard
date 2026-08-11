import { describe, expect, it } from 'vitest';
import { validateLanScanOptions, validateTargetInput } from '../src/plugins/network-observatory/backend/net-probe-validation';

describe('network observatory input validation', () => {
  it('normalizes a safe target and applies defaults', () => {
    expect(validateTargetInput({ target: ' example.com ' })).toMatchObject({
      target: 'example.com', probe: 'icmp', intervalMs: 5000, timeoutMs: 3000,
    });
  });

  it('rejects unsafe protocol options and excessive probe rates', () => {
    expect(() => validateTargetInput({ target: 'example.com', probe: 'tcp', options: { port: 70000 } })).toThrow(/port/);
    expect(() => validateTargetInput({ target: 'example.com', intervalMs: 10 })).toThrow(/intervalMs/);
    expect(() => validateTargetInput({ target: 'example.com', probe: 'http', options: { url: 'file:///secret' } })).toThrow(/http or https/);
  });

  it('limits LAN scans to bounded private IPv4 ranges', () => {
    expect(validateLanScanOptions({ subnet: '192.168.1.0/24' })).toEqual({ subnet: '192.168.1.0/24', maxHosts: 254, perPortTimeoutMs: 300 });
    expect(() => validateLanScanOptions({ subnet: '8.8.8.0/24' })).toThrow(/private IPv4/);
    expect(() => validateLanScanOptions({ subnet: '10.0.0.0/7' })).toThrow(/prefix/);
    expect(() => validateLanScanOptions({ maxHosts: 5000 })).toThrow(/maxHosts/);
  });
});
