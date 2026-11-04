import net, { type Socket } from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type PageIdentity = { documentId: string; url: string; title: string };
export type PageSnapshot = PageIdentity & { text: string; truncated: boolean; trust: string };
type Grant = PageIdentity & { expiresAt: number };
type Connection = { id: string; name: string; socket: Socket; grant?: Grant };
export type ReadReceipt = { timestamp: string; connectionId: string; client: string; action: 'page.snapshot'; status: 'succeeded' | 'denied' | 'failed'; documentId?: string; url?: string; characters?: number; sha256?: string };

type ProposalHooks = {
  propose(value: unknown, owner: { id: string; name: string }): Promise<unknown>;
  status(id: string): unknown;
  cancel(id: string): void;
};
export class LocalBridge {
  readonly directory = mkdtempSync(path.join(tmpdir(), 'grid-mcp-'));
  readonly connectionFile: string;
  private readonly token = randomBytes(32).toString('hex');
  private readonly endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\grid-${randomUUID()}` : path.join(this.directory, 'browser.sock');
  private readonly connections = new Map<string, Connection>();
  private readonly sockets = new Set<Socket>();
  private server = net.createServer(socket => this.accept(socket));
  private receipts: ReadReceipt[] = [];

  constructor(private currentPage: () => PageIdentity | undefined, private snapshot: (page: PageIdentity) => Promise<PageSnapshot>, private changed: () => void, connectionFile?: string, private proposals?: ProposalHooks) {
    this.connectionFile = connectionFile || path.join(this.directory, 'connection.json');
  }

  async start(): Promise<void> {
    chmodSync(this.directory, 0o700);
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.endpoint, () => { this.server.off('error', reject); resolve(); });
    });
    if (process.platform !== 'win32') chmodSync(this.endpoint, 0o600);
    mkdirSync(path.dirname(this.connectionFile), { recursive: true, mode: 0o700 });
    writeFileSync(this.connectionFile, JSON.stringify({ version: 1, endpoint: this.endpoint, token: this.token }), { mode: 0o600 });
  }

  state() {
    return {
      page: this.currentPage(),
      connections: [...this.connections.values()].map(c => ({ id: c.id, name: c.name, authorized: this.valid(c), expiresAt: c.grant?.expiresAt })),
      receiptCount: this.receipts.length
    };
  }

  grant(id: string): void {
    const connection = this.connections.get(id);
    const page = this.currentPage();
    if (!connection || !page) throw new Error('请先打开稳定的真实网页，再授权读取');
    connection.grant = { ...page, expiresAt: Date.now() + 10 * 60 * 1000 };
    this.changed();
  }

  authorized(id: string): boolean {
    const c = this.connections.get(id);
    return Boolean(c && this.valid(c));
  }

  revoke(id?: string): void {
    for (const c of this.connections.values()) if (!id || c.id === id) { c.grant = undefined; this.proposals?.cancel(c.id); }
    this.changed();
  }

  exportReceipts(): string {
    return JSON.stringify({ version: 1, scope: 'Grid M0 read-only receipts; no page bodies or input values', receipts: this.receipts }, null, 2);
  }

  close(): void {
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    try { if (JSON.parse(readFileSync(this.connectionFile, 'utf8')).token === this.token) rmSync(this.connectionFile); } catch { /* Already removed. */ }
    rmSync(this.directory, { recursive: true, force: true });
  }

  private valid(c: Connection): boolean {
    const current = this.currentPage();
    return Boolean(c.grant && current && c.grant.documentId === current.documentId && c.grant.url === current.url && c.grant.expiresAt > Date.now());
  }

  private record(receipt: ReadReceipt): void {
    this.receipts.push(receipt);
    if (this.receipts.length > 500) this.receipts.shift();
    this.changed();
  }

  private accept(socket: Socket): void {
    if (this.sockets.size >= 8) { socket.destroy(); return; }
    this.sockets.add(socket);
    let connection: Connection | undefined;
    let buffer = '';
    let busy = false;
    const handshakeTimer = setTimeout(() => { if (!connection) socket.destroy(); }, 10000);
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      this.sockets.delete(socket);
      if (connection) { this.connections.delete(connection.id); this.proposals?.cancel(connection.id); }
      this.changed();
    });
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536) { socket.destroy(); return; }
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (busy) { socket.destroy(); return; }
        busy = true;
        void (async () => {
          let request: { id?: unknown; method?: unknown; token?: unknown; name?: unknown; value?: unknown } = {};
          try {
            request = JSON.parse(line);
            if (!Number.isSafeInteger(request.id)) throw new Error('Invalid request');
            let result: unknown;
            if (!connection) {
              if (request.method !== 'hello' || typeof request.token !== 'string' || request.token.length !== this.token.length || !timingSafeEqual(Buffer.from(request.token), Buffer.from(this.token))) throw new Error('Local bridge authentication failed');
              connection = { id: randomUUID(), name: String(request.name || 'Unknown MCP client').replace(/[\x00-\x1f]/g, '').slice(0, 80), socket };
              this.connections.set(connection.id, connection);
              clearTimeout(handshakeTimer);
              this.changed();
              result = { connectionId: connection.id, authorized: false };
            } else if (request.method === 'status') {
              result = { connectionId: connection.id, authorized: this.valid(connection), scope: 'read current document only; approve in Grid' };
             } else if (request.method === 'form.propose') {
              if (!this.proposals || !this.valid(connection)) throw new Error('Authorize the current document in Grid before proposing a fill');
              const grant = connection.grant;
              result = await this.proposals.propose(request.value, { id: connection.id, name: connection.name });
              if (socket.destroyed || connection.grant !== grant || !this.valid(connection)) { this.proposals.cancel(connection.id); throw new Error('Authorization changed during proposal'); }
            } else if (request.method === 'form.status') {
              if (!this.proposals) throw new Error('Form proposals unavailable');
              result = this.proposals.status(connection.id);
            } else if (request.method === 'snapshot') {
              const receipt: ReadReceipt = { timestamp: new Date().toISOString(), connectionId: connection.id, client: connection.name, action: 'page.snapshot', status: 'denied' };
              if (!this.valid(connection)) { this.record(receipt); throw new Error('Read not authorized. Approve the current document in Grid.'); }
              const grant = connection.grant!;
              try {
                const snapshot = await this.snapshot(grant);
                if (socket.destroyed || connection.grant !== grant || !this.valid(connection)) throw new Error('Authorization changed during read');
                result = snapshot;
                this.record({ ...receipt, status: 'succeeded', documentId: grant.documentId, url: grant.url, characters: snapshot.text.length, sha256: createHash('sha256').update(snapshot.text).digest('hex') });
              } catch (error) {
                this.record({ ...receipt, status: 'failed' });
                throw error;
              }
            } else throw new Error('Unsupported read-only method');
            socket.write(JSON.stringify({ id: request.id, result }) + '\n');
          } catch (error) {
            socket.write(JSON.stringify({ id: request?.id, error: error instanceof Error ? error.message : 'Bridge request failed' }) + '\n');
            if (!connection) socket.end();
          } finally { busy = false; }
        })();
      }
    });
  }
}

export class BridgeClient {
  private socket?: Socket;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();

  async connect(connectionFile: string, name: string): Promise<void> {
    const descriptor = JSON.parse(readFileSync(connectionFile, 'utf8'));
    if (descriptor.version !== 1 || typeof descriptor.endpoint !== 'string' || typeof descriptor.token !== 'string') throw new Error('Unsupported Grid connection file');
    const socket = this.socket = net.createConnection(descriptor.endpoint);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 262144) { socket.destroy(); return; }
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const reply = JSON.parse(line);
          const pending = this.pending.get(reply.id);
          if (!pending) continue;
          this.pending.delete(reply.id); clearTimeout(pending.timer);
          if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply.result);
        } catch { socket.destroy(); }
      }
    });
    const closed = () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Grid connection closed')); }
      this.pending.clear();
    };
    socket.on('error', closed); socket.on('close', closed);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    await this.call('hello', { token: descriptor.token, name });
  }

  call(method: string, data: object = {}): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('Grid is not connected'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Grid read timed out')); this.close(); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(JSON.stringify({ id, method, ...data }) + '\n');
    });
  }

  close(): void { this.socket?.destroy(); }
}
