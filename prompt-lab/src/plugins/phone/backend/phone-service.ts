import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { PhoneEvent, PhoneMessage, PhonePeer, PhoneSignal, PhoneState } from '../types';
import { summarizeConversations, validChatText } from '../domain';
import { derivePeerKey, isFreshTimestamp, signEnvelope, verifyEnvelope } from '../security';

const DISCOVERY_PORT = 39177;
const PROTOCOL_VERSION = 1;
const PEER_TTL_MS = 12_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;

interface Store { deviceId: string; deviceName: string; secret: string; trusted: Record<string, { fingerprint: string; name: string }>; messages: PhoneMessage[] }
interface WireEnvelope { version: 1; id: string; type: string; fromDeviceId: string; fromName: string; fingerprint: string; sentAt: number; payload: Record<string, unknown>; auth?: string }

let store: Store;
let storePath = '';
let downloadDirectory = '';
let server: http.Server | undefined;
let wsServer: WebSocketServer | undefined;
let udp: dgram.Socket | undefined;
let discoveryTimer: NodeJS.Timeout | undefined;
let pruneTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let port = 0;
let started = false;
const peers = new Map<string, PhonePeer>();
const sockets = new Map<string, WebSocket>();
const pairingRequests = new Map<string, string>();
const receivedFiles = new Map<string, string>();
const fileControllers = new Map<string, AbortController>();
const recentEnvelopeIds = new Map<string, number>();

function uuid(): string { return crypto.randomUUID(); }
function fingerprint(secret: string): string { return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24); }
function storageDir(): string { return path.join(app.getPath('userData'), 'phone'); }
function save(): void { fs.mkdirSync(path.dirname(storePath), { recursive: true }); fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8'); }
function load(): void {
  const directory = storageDir(); storePath = path.join(directory, 'phone.json'); downloadDirectory = path.join(directory, 'downloads');
  fs.mkdirSync(downloadDirectory, { recursive: true });
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as Store; } catch { store = { deviceId: uuid(), deviceName: os.hostname(), secret: crypto.randomBytes(32).toString('hex'), trusted: {}, messages: [] }; save(); }
}
function emit(event: PhoneEvent): void { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('phone:event', event); }
function state(): PhoneState { return { ready: started, deviceId: store.deviceId, deviceName: store.deviceName, fingerprint: fingerprint(store.secret), port, peers: [...peers.values()].sort((a, b) => Number(b.trusted) - Number(a.trusted) || a.name.localeCompare(b.name)) }; }
function peerAuth(peerId: string): string | undefined { const trusted = store.trusted[peerId]; return trusted ? derivePeerKey(fingerprint(store.secret), trusted.fingerprint) : undefined; }
function envelope(type: string, payload: Record<string, unknown>, peerId?: string): WireEnvelope { const frame: WireEnvelope = { version: 1, id: uuid(), type, fromDeviceId: store.deviceId, fromName: store.deviceName, fingerprint: fingerprint(store.secret), sentAt: Date.now(), payload }; const key = peerId ? peerAuth(peerId) : undefined; if (key) frame.auth = signEnvelope(frame, key); return frame; }
function persistMessage(message: PhoneMessage): void { const index = store.messages.findIndex((item) => item.id === message.id); if (index >= 0) store.messages[index] = message; else store.messages.push(message); save(); }
function updateMessageStatus(id: string, status: PhoneMessage['status']): void { const message = store.messages.find((item) => item.id === id); if (!message) return; message.status = status; save(); emit({ type: 'message.status', messageId: id, peerId: message.peerId, status: status === 'read' ? 'read' : 'delivered' }); }
function flushQueuedMessages(peerId: string): void { for (const message of store.messages.filter((item) => item.peerId === peerId && item.senderId === store.deviceId && (item.status === 'queued' || item.status === 'failed') && item.kind === 'text')) { message.status = 'sending'; if (sendWire(peerId, 'chat.text', { message })) message.status = 'sent'; } save(); }
function safeFileName(value: string): string { const printable = [...value].filter((character) => character.charCodeAt(0) >= 32).join(''); const name = path.basename(printable).replace(/[<>:"/\\|?*]/g, '_').trim(); return name || 'file'; }
function uniqueDownloadPath(name: string): string { const safe = safeFileName(name); const ext = path.extname(safe); const base = path.basename(safe, ext); let result = path.join(downloadDirectory, safe); for (let i = 1; fs.existsSync(result); i += 1) result = path.join(downloadDirectory, `${base} (${i})${ext}`); return result; }

function connect(peer: PhonePeer): WebSocket {
  const current = sockets.get(peer.id); if (current?.readyState === WebSocket.OPEN || current?.readyState === WebSocket.CONNECTING) return current;
  const socket = new WebSocket(`ws://${peer.host}:${peer.port}/phone`); bindSocket(socket, peer.id); return socket;
}
function bindSocket(socket: WebSocket, expectedPeerId?: string): void {
  let peerId = expectedPeerId;
  socket.on('open', () => { socket.send(JSON.stringify(envelope('peer.hello', {}, expectedPeerId))); if (expectedPeerId) flushQueuedMessages(expectedPeerId); });
  socket.on('message', (raw) => { void handleWire(socket, String(raw), peerId).then((id) => { if (id) peerId = id; }); });
  socket.on('close', () => { if (peerId && sockets.get(peerId) === socket) sockets.delete(peerId); });
  socket.on('error', (): void => undefined);
  if (expectedPeerId) sockets.set(expectedPeerId, socket);
}
async function handleWire(socket: WebSocket, raw: string, expectedPeerId?: string): Promise<string | undefined> {
  let frame: WireEnvelope; try { frame = JSON.parse(raw) as WireEnvelope; } catch { return expectedPeerId; }
  if (frame.version !== PROTOCOL_VERSION || frame.fromDeviceId === store.deviceId) return expectedPeerId;
  const known = peers.get(frame.fromDeviceId); const trusted = store.trusted[frame.fromDeviceId];
  const peer: PhonePeer = { id: frame.fromDeviceId, name: frame.fromName, host: known?.host ?? '', port: known?.port ?? 0, fingerprint: frame.fingerprint, trusted: Boolean(trusted && trusted.fingerprint === frame.fingerprint), status: 'online', lastSeenAt: Date.now() };
  peers.set(peer.id, peer); sockets.set(peer.id, socket); emit({ type: 'peer.updated', peer });
  if (frame.type === 'peer.hello') { if (peer.trusted) flushQueuedMessages(peer.id); return peer.id; }
  if (frame.type === 'pair.request') { const requestId = String(frame.payload.requestId ?? frame.id); pairingRequests.set(requestId, peer.id); emit({ type: 'pair.request', requestId, peer }); return peer.id; }
  if (frame.type === 'pair.result') {
    const accepted = Boolean(frame.payload.accepted); if (accepted) { store.trusted[peer.id] = { fingerprint: peer.fingerprint, name: peer.name }; peer.trusted = true; save(); }
    emit({ type: 'pair.result', requestId: String(frame.payload.requestId), accepted, peer }); return peer.id;
  }
  if (!peer.trusted) return peer.id;
  const key = peerAuth(peer.id); if (!key || !verifyEnvelope(frame, key) || !isFreshTimestamp(frame.sentAt) || recentEnvelopeIds.has(frame.id)) return peer.id;
  recentEnvelopeIds.set(frame.id, Date.now());
  if (frame.type === 'peer.ping') { socket.send(JSON.stringify(envelope('peer.pong', {}, peer.id))); return peer.id; }
  if (frame.type === 'peer.pong') return peer.id;
  if (frame.type === 'chat.text' || frame.type === 'chat.file') {
    const message = frame.payload.message as unknown as PhoneMessage; if (!message?.id || message.recipientId !== store.deviceId) return peer.id;
    if (message.kind === 'file' && message.file) message.file.localPath = receivedFiles.get(message.file.id);
    message.peerId = peer.id; message.status = 'delivered'; persistMessage(message); emit({ type: 'message', message });
    socket.send(JSON.stringify(envelope('chat.delivered', { messageId: message.id }, peer.id))); return peer.id;
  }
  if (frame.type === 'chat.delivered' || frame.type === 'chat.read') { updateMessageStatus(String(frame.payload.messageId), frame.type === 'chat.read' ? 'read' : 'delivered'); return peer.id; }
  const signalTypes = new Set(['call.invite','call.ringing','call.accept','call.reject','call.cancel','call.busy','call.hangup','webrtc.offer','webrtc.answer','webrtc.ice']);
  if (signalTypes.has(frame.type)) emit({ type: frame.type, peerId: peer.id, ...frame.payload } as PhoneEvent);
  return peer.id;
}
function sendWire(peerId: string, type: string, payload: Record<string, unknown>): boolean { const peer = peers.get(peerId); if (!peer) return false; const socket = connect(peer); const transmit = () => socket.send(JSON.stringify(envelope(type, payload, peerId))); if (socket.readyState === WebSocket.OPEN) transmit(); else socket.once('open', transmit); return true; }

async function handleUpload(request: http.IncomingMessage, response: http.ServerResponse, peerId: string, fileId: string, name: string, expectedSha: string): Promise<void> {
  const trusted = store.trusted[peerId]; if (!trusted || request.headers.authorization !== `Bearer ${peerAuth(peerId)}`) { response.writeHead(401).end(); return; }
  const size = Number(request.headers['content-length'] ?? 0); if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) { response.writeHead(413).end(); return; }
  const target = uniqueDownloadPath(name); const temp = `${target}.${fileId}.part`; const hash = crypto.createHash('sha256'); let received = 0;
  const output = fs.createWriteStream(temp, { flags: 'wx' });
  request.on('data', (chunk: Buffer) => { received += chunk.length; hash.update(chunk); emit({ type: 'file.progress', peerId, fileId, name, transferred: received, total: size, direction: 'receive', status: 'transferring' }); }); request.pipe(output);
  output.on('finish', () => { const actual = hash.digest('hex'); if (expectedSha && actual !== expectedSha) { fs.rmSync(temp, { force: true }); emit({ type: 'file.progress', peerId, fileId, name, transferred: received, total: size, direction: 'receive', status: 'failed' }); response.writeHead(422).end(); return; } fs.renameSync(temp, target); receivedFiles.set(fileId, target); emit({ type: 'file.progress', peerId, fileId, name, transferred: received, total: size, direction: 'receive', status: 'completed' }); response.writeHead(201, { 'content-type': 'application/json' }); response.end(JSON.stringify({ path: target, size: received, sha256: actual })); });
  output.on('error', () => { fs.rmSync(temp, { force: true }); emit({ type: 'file.progress', peerId, fileId, name, transferred: received, total: size, direction: 'receive', status: 'failed' }); if (!response.headersSent) response.writeHead(500).end(); });
}

export async function startPhoneService(): Promise<PhoneState> {
  if (started) return state(); load();
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'PUT' && url.pathname.startsWith('/phone/files/')) { void handleUpload(request, response, String(url.searchParams.get('peerId')), decodeURIComponent(url.pathname.split('/').pop() ?? uuid()), String(url.searchParams.get('name') ?? 'file'), String(url.searchParams.get('sha256') ?? '')); return; }
    response.writeHead(404).end();
  });
  wsServer = new WebSocketServer({ noServer: true }); wsServer.on('connection', (socket) => bindSocket(socket));
  server.on('upgrade', (request, socket, head) => { if (request.url === '/phone') wsServer?.handleUpgrade(request, socket, head, (ws) => wsServer?.emit('connection', ws, request)); else socket.destroy(); });
  await new Promise<void>((resolve, reject) => { server?.once('error', reject); server?.listen(0, '0.0.0.0', () => resolve()); }); port = (server.address() as { port: number }).port;
  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true }); udp.on('message', (buffer, info) => { try { const data = JSON.parse(buffer.toString()) as { v: number; id: string; name: string; port: number; fingerprint: string }; if (data.id === store.deviceId) return; const trusted = store.trusted[data.id]; const peer: PhonePeer = { id: data.id, name: data.name, host: info.address, port: data.port, fingerprint: data.fingerprint, trusted: Boolean(trusted && trusted.fingerprint === data.fingerprint), status: data.v === PROTOCOL_VERSION ? 'online' : 'incompatible', lastSeenAt: Date.now() }; peers.set(peer.id, peer); emit({ type: 'peer.updated', peer }); if (peer.trusted && peer.status === 'online' && store.deviceId.localeCompare(peer.id) < 0) connect(peer); } catch { /* ignore unrelated UDP */ } });
  await new Promise<void>((resolve, reject) => { udp?.once('error', reject); udp?.bind(DISCOVERY_PORT, () => { udp?.setBroadcast(true); resolve(); }); });
  const announce = () => { const data = Buffer.from(JSON.stringify({ v: PROTOCOL_VERSION, id: store.deviceId, name: store.deviceName, port, fingerprint: fingerprint(store.secret) })); udp?.send(data, DISCOVERY_PORT, '255.255.255.255'); };
  announce(); discoveryTimer = setInterval(announce, 3000); heartbeatTimer = setInterval(() => { for (const [peerId, socket] of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope('peer.ping', {}, peerId))); }, 5000); pruneTimer = setInterval(() => { const now = Date.now(); for (const [id, seenAt] of recentEnvelopeIds) if (now - seenAt > 120_000) recentEnvelopeIds.delete(id); for (const [id, peer] of peers) if (now - peer.lastSeenAt > PEER_TTL_MS && peer.status !== 'offline') { const next = { ...peer, status: 'offline' as const }; peers.set(id, next); emit({ type: 'peer.updated', peer: next }); } }, 3000);
  started = true; emit({ type: 'state', state: state() }); return state();
}
export async function stopPhoneService(): Promise<void> { if (!started) return; if (discoveryTimer) clearInterval(discoveryTimer); if (heartbeatTimer) clearInterval(heartbeatTimer); if (pruneTimer) clearInterval(pruneTimer); discoveryTimer = undefined; heartbeatTimer = undefined; pruneTimer = undefined; for (const socket of sockets.values()) socket.close(); sockets.clear(); udp?.close(); udp = undefined; wsServer?.close(); wsServer = undefined; await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()); server = undefined; port = 0; started = false; peers.clear(); recentEnvelopeIds.clear(); emit({ type: 'state', state: state() }); }

async function sendText(peerId: string, value: string): Promise<PhoneMessage> { const text = validChatText(value); const message: PhoneMessage = { id: uuid(), peerId, senderId: store.deviceId, recipientId: peerId, kind: 'text', text, createdAt: Date.now(), status: 'sending' }; persistMessage(message); const sent = sendWire(peerId, 'chat.text', { message }); message.status = sent ? 'sent' : 'queued'; persistMessage(message); return message; }
async function sendFile(peerId: string, source: string, existing?: PhoneMessage): Promise<PhoneMessage> { const peer = peers.get(peerId); if (!peer?.trusted || peer.status !== 'online') throw new Error('对方不在线或尚未配对'); const stats = fs.statSync(source); const name = path.basename(source); if (stats.size > MAX_FILE_BYTES) throw new Error(`${name} 超过 10 GB`); const fileId = existing?.file?.id ?? uuid(); const message: PhoneMessage = existing ?? { id: uuid(), peerId, senderId: store.deviceId, recipientId: peerId, kind: 'file', file: { id: fileId, name, size: stats.size, localPath: source }, createdAt: Date.now(), status: 'sending' }; message.status = 'sending'; persistMessage(message); const sha256 = await new Promise<string>((resolve, reject) => { const hash = crypto.createHash('sha256'); fs.createReadStream(source).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject); }); if (message.file) message.file.sha256 = sha256; const controller = new AbortController(); fileControllers.set(fileId, controller); const auth = peerAuth(peerId); const uploadUrl = `http://${peer.host}:${peer.port}/phone/files/${fileId}?peerId=${encodeURIComponent(store.deviceId)}&name=${encodeURIComponent(name)}&sha256=${sha256}`; let transferred = 0; const body = fs.createReadStream(source); body.on('data', (chunk: Buffer) => { transferred += chunk.length; emit({ type: 'file.progress', peerId, fileId, name, transferred, total: stats.size, direction: 'send', status: 'transferring' }); }); try { const upload = await fetch(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${auth}`, 'content-length': String(stats.size) }, body: body as unknown as BodyInit, duplex: 'half', signal: controller.signal } as RequestInit & { duplex: string }); if (!upload.ok) throw new Error(`文件发送失败 (${upload.status})`); message.status = 'sent'; persistMessage(message); sendWire(peerId, 'chat.file', { message }); emit({ type: 'file.progress', peerId, fileId, name, transferred: stats.size, total: stats.size, direction: 'send', status: 'completed' }); return message; } catch (error) { message.status = 'failed'; persistMessage(message); emit({ type: 'message', message }); emit({ type: 'file.progress', peerId, fileId, name, transferred, total: stats.size, direction: 'send', status: 'failed' }); throw error; } finally { fileControllers.delete(fileId); } }
async function sendFiles(peerId: string): Promise<PhoneMessage[]> { const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }); if (result.canceled) return []; const messages: PhoneMessage[] = [];
  for (const source of result.filePaths) messages.push(await sendFile(peerId, source));
  return messages;
}

export function setupPhoneIPC(): void {
  if (!store) load();
  ipcMain.handle('phone:start', () => startPhoneService());
  ipcMain.handle('phone:stop', () => stopPhoneService());
  ipcMain.handle('phone:state', () => state());
  ipcMain.handle('phone:list-messages', (_event, peerId: string) => store.messages.filter((item) => item.peerId === peerId));
  ipcMain.handle('phone:list-conversations', () => summarizeConversations(store.messages, store.deviceId));
  ipcMain.handle('phone:pair', (_event, peerId: string) => { const requestId = uuid(); if (!sendWire(peerId, 'pair.request', { requestId })) throw new Error('设备不可达'); return { requestId }; });
  ipcMain.handle('phone:respond-pairing', (_event, requestId: string, peerId: string, accepted: boolean) => { const peer = peers.get(peerId); if (!peer || pairingRequests.get(requestId) !== peerId) return false; if (accepted) { store.trusted[peerId] = { fingerprint: peer.fingerprint, name: peer.name }; peer.trusted = true; save(); } pairingRequests.delete(requestId); return sendWire(peerId, 'pair.result', { requestId, accepted }); });
  ipcMain.handle('phone:remove-peer', (_event, peerId: string) => { delete store.trusted[peerId]; sockets.get(peerId)?.close(); sockets.delete(peerId); const peer = peers.get(peerId); if (peer) { peer.trusted = false; emit({ type: 'peer.updated', peer }); } save(); return true; });
  ipcMain.handle('phone:send-text', (_event, peerId: string, text: string) => sendText(peerId, text));
  ipcMain.handle('phone:send-files', (_event, peerId: string) => sendFiles(peerId));
  ipcMain.handle('phone:retry-file', (_event, messageId: string) => { const message = store.messages.find((item) => item.id === messageId && item.kind === 'file'); const source = message?.file?.localPath; if (!message || !source || !fs.existsSync(source)) throw new Error('原文件不存在，无法重试'); return sendFile(message.peerId, source, message); });
  ipcMain.handle('phone:cancel-file', (_event, fileId: string) => { const controller = fileControllers.get(fileId); controller?.abort(); return Boolean(controller); });
  ipcMain.handle('phone:mark-read', (_event, peerId: string, ids: string[]) => { for (const id of ids) { const message = store.messages.find((item) => item.id === id && item.peerId === peerId && item.recipientId === store.deviceId); if (message) message.status = 'read'; sendWire(peerId, 'chat.read', { messageId: id }); } save(); return true; });
  ipcMain.handle('phone:send-signal', (_event, peerId: string, signal: PhoneSignal) => sendWire(peerId, signal.type, { ...signal, type: undefined, peerId: undefined }));
  ipcMain.handle('phone:open-file', async (_event, messageId: string) => { const file = store.messages.find((item) => item.id === messageId)?.file?.localPath; if (!file || !fs.existsSync(file)) return false; return (await shell.openPath(file)) === ''; });
}
