/**
 * MyCast shared types for the renderer side.
 */
export interface MyCastState {
  ready: boolean;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  httpPort: number | null;
  wsPort: number | null;
  bindAddr: string | null;
  lanAddr: string | null;
  lanAddrs: string[] | null;
  mdnsEnabled: boolean | null;
  version: string | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
}

export type SessionKind = 'screen' | 'file' | 'discovery';

export interface SessionInfo {
  session_id: string;
  phone_device_id: string;
  phone_device_name: string;
  kind: SessionKind;
  created_at_ms: number;
}

export interface TransferInfo {
  id: string;
  name: string;
  size: number;
  received_bytes: number;
  sha256: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  path: string;
  started_at_ms: number;
  finished_at_ms: number | null;
  error: string | null;
}

export type MyCastEvent =
  | { type: 'ready'; deviceId: string; deviceName: string; platform: string; httpPort: number; wsPort: number; mdnsEnabled: boolean; version: string; bindAddr: string; lanAddr: string; lanAddrs: string[] }
  | { type: 'phone.hello'; deviceId: string; deviceName: string; platform: string }
  | { type: 'phone.pair'; deviceId: string; deviceName: string; platform: string; tokenPrefix: string }
  | { type: 'session.created'; sessionId: string; phoneDeviceId: string; kind: SessionKind }
  | { type: 'webrtc.offer'; sessionId: string; phoneDeviceId: string; sdp: string }
  | { type: 'webrtc.answer'; sessionId: string; phoneDeviceId: string; sdp: string }
  | { type: 'webrtc.ice'; sessionId: string; phoneDeviceId: string; candidate: unknown }
  | { type: 'stream.start'; sessionId: string; phoneDeviceId: string }
  | { type: 'stream.stop'; sessionId: string; phoneDeviceId: string }
  | { type: 'error'; message: string };

export interface MyCastApi {
  start: () => Promise<MyCastState>;
  state: () => Promise<MyCastState>;
  systemInfo: () => Promise<{ hostname: string; platform: string; arch: string; cpus: number }>;
  issuePairing: () => Promise<{ pairCode: string; expiresInMs: number }>;
  listSessions: () => Promise<SessionInfo[]>;
  listTransfers: () => Promise<TransferInfo[]>;
  openTransfer: (transferId: string) => Promise<{ success: boolean; error?: string }>;
  sendToPhone: (deviceId: string, frame: Record<string, unknown>) => Promise<boolean>;
  endSession: (sessionId: string) => Promise<boolean>;
  cancelTransfer: (uploadId: string) => Promise<boolean>;
  onEvent: (handler: (event: MyCastEvent) => void) => () => void;
}
