declare module 'ws' {
  import type { EventEmitter } from 'node:events';
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    readonly readyState: number;
    constructor(url: string);
    send(data: string): void;
    close(): void;
    on(event: 'open' | 'close' | 'error', listener: (...args: unknown[]) => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
    once(event: 'open', listener: () => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean });
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket) => void): void;
    close(): void;
  }
}
