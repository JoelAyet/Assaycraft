/**
 * The assaycraftlab.com Worker. It serves the app's files as before, and adds one thing: a relay at
 * /connect/<room> that lets a computer and a phone reach each other (Connect a phone).
 *
 * The relay only passes messages between the two devices of a pairing. They are encrypted with a key
 * that only those devices have (it is in the QR code), so the relay cannot read them, and it stores
 * nothing. The devices use it to set up a direct connection, and when no direct connection is
 * possible (a phone on 5G and a computer behind a firewall, say) to send the notebook's changes.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<PairingRoom>;
}

type Role = 'computer' | 'phone';

/** A room is named after a hash of the pairing's secret: 32 hex digits. */
const ROOM = /^\/connect\/([0-9a-f]{32})$/;
/** Messages are file pieces of at most 64 KB plus a little framing. */
const MAX_MESSAGE = 256 * 1024;

const other = (role: Role): Role => (role === 'computer' ? 'phone' : 'computer');
const isRole = (s: string | null): s is Role => s === 'computer' || s === 'phone';
const peerMessage = (present: boolean) => JSON.stringify({ relay: 'peer', present });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const room = ROOM.exec(new URL(request.url).pathname)?.[1];
    if (!room) return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * One pairing: at most one computer and one phone connected. A newer connection of the same device
 * replaces the older one (a phone that lost its network reconnects before the old socket times out).
 * Uses WebSocket hibernation, so an idle room costs nothing while both devices wait for each other.
 */
export class PairingRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get('as');
    if (!isRole(role)) return new Response('Say which device this is: ?as=computer or ?as=phone', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    for (const old of this.ctx.getWebSockets(role)) old.close(4000, 'Replaced by a newer connection');
    this.ctx.acceptWebSocket(server, [role]);
    const peers = this.ctx.getWebSockets(other(role));
    server.send(peerMessage(peers.length > 0));
    for (const ws of peers) ws.send(peerMessage(true));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE) {
      ws.close(1009, 'Message too big');
      return;
    }
    const role = this.ctx.getTags(ws)[0] as Role;
    for (const peer of this.ctx.getWebSockets(other(role))) peer.send(message);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.left(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }

  override webSocketError(ws: WebSocket) {
    this.left(ws);
  }

  /** Tell the other device, unless this one is still connected through a newer socket. */
  private left(ws: WebSocket) {
    const role = this.ctx.getTags(ws)[0] as Role;
    if (this.ctx.getWebSockets(role).some((s) => s !== ws && s.readyState === WebSocket.OPEN)) return;
    for (const peer of this.ctx.getWebSockets(other(role))) {
      try {
        peer.send(peerMessage(false));
      } catch {
        /* closing */
      }
    }
  }
}
