import { describe, expect, it } from 'vitest';
import { derivePeerKey, isFreshTimestamp, signEnvelope, verifyEnvelope } from '../src/plugins/phone/security';

const frame = { id: 'message-1', type: 'chat.text', fromDeviceId: 'device-a', sentAt: 1000, payload: { text: 'hello' } };

describe('phone envelope security', () => {
  it('derives the same key on both peers', () => {
    expect(derivePeerKey('aaa', 'bbb')).toBe(derivePeerKey('bbb', 'aaa'));
  });

  it('binds authentication to the complete envelope', () => {
    const key = derivePeerKey('aaa', 'bbb');
    const auth = signEnvelope(frame, key);
    expect(verifyEnvelope({ ...frame, auth }, key)).toBe(true);
    expect(verifyEnvelope({ ...frame, payload: { text: 'changed' }, auth }, key)).toBe(false);
    expect(verifyEnvelope({ ...frame, type: 'call.invite', auth }, key)).toBe(false);
  });

  it('rejects missing or malformed authentication safely', () => {
    const key = derivePeerKey('aaa', 'bbb');
    expect(verifyEnvelope(frame, key)).toBe(false);
    expect(verifyEnvelope({ ...frame, auth: 'invalid' }, key)).toBe(false);
  });

  it('enforces the replay time window', () => {
    expect(isFreshTimestamp(1_000, 120_000, 120_000)).toBe(true);
    expect(isFreshTimestamp(1_000, 122_001, 120_000)).toBe(false);
    expect(isFreshTimestamp(Number.NaN, 1_000)).toBe(false);
  });
});
