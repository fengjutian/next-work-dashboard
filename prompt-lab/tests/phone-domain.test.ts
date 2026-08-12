import { describe, expect, it } from 'vitest';
import { advanceMessageStatus, mergeMessages, validChatText } from '../src/plugins/phone/domain';
import type { PhoneMessage } from '../src/plugins/phone/types';

function message(id: string, status: PhoneMessage['status'], createdAt = 1): PhoneMessage {
  return { id, peerId: 'peer', senderId: 'a', recipientId: 'b', kind: 'text', text: id, createdAt, status };
}

describe('phone message domain', () => {
  it('does not allow an out-of-order receipt to move status backwards', () => {
    expect(advanceMessageStatus(message('m1', 'read'), 'delivered').status).toBe('read');
  });

  it('deduplicates messages and preserves chronological order', () => {
    const result = mergeMessages([message('m1', 'sent', 2)], [message('m1', 'delivered', 2), message('m2', 'sent', 1)]);
    expect(result.map((item) => item.id)).toEqual(['m2', 'm1']);
    expect(result[1].status).toBe('delivered');
  });

  it('validates and trims chat text', () => {
    expect(validChatText('  hello  ')).toBe('hello');
    expect(() => validChatText('   ')).toThrow('消息不能为空');
    expect(() => validChatText('x'.repeat(20_001))).toThrow('20,000');
  });
});

