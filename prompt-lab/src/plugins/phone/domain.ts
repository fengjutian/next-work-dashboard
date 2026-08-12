import type { PhoneConversationSummary, PhoneMessage, PhoneMessageStatus } from './types';

const STATUS_ORDER: Record<PhoneMessageStatus, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 1 };

export function advanceMessageStatus(message: PhoneMessage, status: PhoneMessageStatus): PhoneMessage {
  if (status === 'failed') return STATUS_ORDER[message.status] <= STATUS_ORDER.sent ? { ...message, status } : message;
  if (message.status === 'failed' || STATUS_ORDER[status] > STATUS_ORDER[message.status]) return { ...message, status };
  return message;
}

export function mergeMessages(current: PhoneMessage[], incoming: PhoneMessage[]): PhoneMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = messages.get(message.id);
    messages.set(message.id, existing ? advanceMessageStatus({ ...existing, ...message, status: existing.status }, message.status) : message);
  }
  return [...messages.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function validChatText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('消息不能为空');
  if (text.length > 20_000) throw new Error('消息超过 20,000 字符，请作为文件发送');
  return text;
}

export function summarizeConversations(messages: PhoneMessage[], localDeviceId: string): PhoneConversationSummary[] {
  const peerIds = [...new Set(messages.map((message) => message.peerId))];
  return peerIds.map((peerId) => {
    const peerMessages = messages.filter((message) => message.peerId === peerId).sort((a, b) => b.createdAt - a.createdAt);
    return { peerId, lastMessage: peerMessages[0], unreadCount: peerMessages.filter((message) => message.recipientId === localDeviceId && message.status !== 'read').length };
  }).sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
}
