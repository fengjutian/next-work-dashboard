import crypto from 'node:crypto';

export interface SignableEnvelope { id: string; type: string; fromDeviceId: string; sentAt: number; payload: Record<string, unknown> }

export function derivePeerKey(localFingerprint: string, remoteFingerprint: string): string {
  return crypto.createHash('sha256').update([localFingerprint, remoteFingerprint].sort().join(':')).digest('hex');
}
export function canonicalEnvelope(frame: SignableEnvelope): string { return JSON.stringify({ id: frame.id, type: frame.type, fromDeviceId: frame.fromDeviceId, sentAt: frame.sentAt, payload: frame.payload }); }
export function signEnvelope(frame: SignableEnvelope, key: string): string { return crypto.createHmac('sha256', key).update(canonicalEnvelope(frame)).digest('hex'); }
export function verifyEnvelope(frame: SignableEnvelope & { auth?: string }, key: string): boolean { if (!frame.auth) return false; const expected = Buffer.from(signEnvelope(frame, key), 'hex'); const actual = Buffer.from(frame.auth, 'hex'); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); }
export function isFreshTimestamp(sentAt: number, now = Date.now(), windowMs = 120_000): boolean { return Number.isFinite(sentAt) && Math.abs(now - sentAt) <= windowMs; }
