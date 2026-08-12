export type PhonePeerStatus = 'online' | 'offline' | 'pending' | 'incompatible';
export type PhoneMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
export type PhoneCallKind = 'audio' | 'video';

export interface PhonePeer {
  id: string;
  name: string;
  host: string;
  port: number;
  fingerprint: string;
  trusted: boolean;
  status: PhonePeerStatus;
  lastSeenAt: number;
}

export interface PhoneMessage {
  id: string;
  peerId: string;
  senderId: string;
  recipientId: string;
  kind: 'text' | 'file' | 'call';
  text?: string;
  file?: { id: string; name: string; size: number; sha256?: string; localPath?: string; url?: string };
  call?: { id: string; kind: PhoneCallKind; outcome?: string; durationMs?: number };
  createdAt: number;
  status: PhoneMessageStatus;
}

export interface PhoneState {
  ready: boolean;
  deviceId: string;
  deviceName: string;
  fingerprint: string;
  port: number;
  peers: PhonePeer[];
  error?: string;
}

export type PhoneSignal =
  | { type: 'pair.request'; requestId: string; peer: PhonePeer }
  | { type: 'pair.result'; requestId: string; accepted: boolean; peer: PhonePeer }
  | { type: 'message'; message: PhoneMessage }
  | { type: 'message.status'; messageId: string; peerId: string; status: 'delivered' | 'read' }
  | { type: 'call.invite'; callId: string; peerId: string; kind: PhoneCallKind }
  | { type: 'call.ringing' | 'call.accept' | 'call.reject' | 'call.cancel' | 'call.busy' | 'call.hangup'; callId: string; peerId: string }
  | { type: 'webrtc.offer' | 'webrtc.answer'; callId: string; peerId: string; sdp: string }
  | { type: 'webrtc.ice'; callId: string; peerId: string; candidate: RTCIceCandidateInit };

export type PhoneEvent =
  | { type: 'state'; state: PhoneState }
  | { type: 'peer.updated'; peer: PhonePeer }
  | { type: 'pair.request'; requestId: string; peer: PhonePeer }
  | { type: 'pair.result'; requestId: string; accepted: boolean; peer: PhonePeer }
  | { type: 'message'; message: PhoneMessage }
  | { type: 'message.status'; messageId: string; peerId: string; status: 'delivered' | 'read' }
  | { type: 'file.progress'; peerId: string; fileId: string; name: string; transferred: number; total: number; direction: 'send' | 'receive'; status: 'transferring' | 'completed' | 'failed' }
  | Exclude<PhoneSignal, { type: 'pair.request' | 'pair.result' | 'message' | 'message.status' }>;

export interface PhoneApi {
  start(): Promise<PhoneState>;
  stop(): Promise<void>;
  state(): Promise<PhoneState>;
  listMessages(peerId: string): Promise<PhoneMessage[]>;
  pair(peerId: string): Promise<{ requestId: string }>;
  respondPairing(requestId: string, peerId: string, accepted: boolean): Promise<boolean>;
  removePeer(peerId: string): Promise<boolean>;
  sendText(peerId: string, text: string): Promise<PhoneMessage>;
  selectAndSendFiles(peerId: string): Promise<PhoneMessage[]>;
  markRead(peerId: string, messageIds: string[]): Promise<boolean>;
  sendSignal(peerId: string, signal: PhoneSignal): Promise<boolean>;
  openFile(messageId: string): Promise<boolean>;
  onEvent(handler: (event: PhoneEvent) => void): () => void;
}
