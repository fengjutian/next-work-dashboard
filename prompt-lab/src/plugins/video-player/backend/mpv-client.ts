/**
 * mpv JSON IPC 客户端
 *
 * 通过 mpv 的 --input-ipc-server 选项暴露的 Unix socket (Linux/macOS) 或
 * Named Pipe (Windows) 与 mpv 通信。mpv 0.36+ 支持 request_id 字段，请求和
 * 响应可一一对应；本客户端依赖此特性做并发请求。
 *
 * 协议参考：https://mpv.io/manual/stable/#json-ipc
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';

export interface MpvEvent {
  event: string;
  id?: number;
  name?: string;
  data?: unknown;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MpvClientOptions {
  path: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT = 5_000;
const DEFAULT_CONNECT_TIMEOUT = 8_000;

export class MpvClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private requestSequence = 0;
  private pending = new Map<number, PendingRequest>();
  private connected = false;
  private closed = false;

  constructor(private readonly options: MpvClientOptions) {
    super();
  }

  /** 连接到 mpv 暴露的 socket / pipe */
  async connect(): Promise<void> {
    if (this.connected) return;
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(this.options.path);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`mpv IPC connect timeout: ${this.options.path}`));
      }, timeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        this.connected = true;
        this.setupHandlers();
        resolve();
      });

      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private setupHandlers(): void {
    if (!this.socket) return;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.trim().length > 0) this.dispatchLine(line);
        newlineIndex = this.buffer.indexOf('\n');
      }
    });
    this.socket.on('close', () => {
      this.connected = false;
      this.socket = null;
      this.rejectAll(new Error('mpv IPC closed'));
      this.emit('close');
    });
    this.socket.on('error', (err) => {
      this.rejectAll(err);
      this.emit('error', err);
    });
  }

  private dispatchLine(line: string): void {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // mpv 偶尔会写非 JSON 日志到 stdout，忽略
      return;
    }
    if (typeof parsed.request_id === 'number') {
      const request = this.pending.get(parsed.request_id);
      if (request) {
        this.pending.delete(parsed.request_id);
        clearTimeout(request.timer);
        if (parsed.error === 'success') {
          request.resolve(parsed.data);
        } else {
          request.reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'mpv error'));
        }
      }
      return;
    }
    if (typeof parsed.event === 'string') {
      this.emit('event', parsed as unknown as MpvEvent);
    }
  }

  private rejectAll(err: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(err);
    }
    this.pending.clear();
  }

  /** 发送任意 mpv 命令（如 ["set_property", "pause", true]），返回响应 data */
  async command<T = unknown>(args: unknown[], timeoutMs?: number): Promise<T> {
    if (!this.connected || !this.socket) {
      throw new Error('mpv IPC not connected');
    }
    const id = ++this.requestSequence;
    const effectiveTimeout = timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mpv command timeout: ${JSON.stringify(args)}`));
      }, effectiveTimeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      const payload = JSON.stringify({ command: args, request_id: id }) + '\n';
      this.socket!.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** 订阅属性变化（id 是客户端自定义的，property-change 事件会带回） */
  async observeProperty(observerId: number, name: string): Promise<void> {
    await this.command(['observe_property', observerId, name]);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.rejectAll(new Error('mpv client closed'));
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.removeAllListeners();
  }
}
