/**
 * The assaycraftlab.com Worker. It serves the app's files, and adds three things:
 * - a relay at /connect/<room> that lets a computer and a phone reach each other (Connect a phone);
 * - private calendar links at /cal/<id>.ics, off until turned on in Calendars (below);
 * - /ical?url=…, which fetches another calendar's iCal file for the app and passes it on.
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
  FEEDS: DurableObjectNamespace<CalendarFeed>;
}

type Role = 'computer' | 'phone';

/** A room is named after a hash of the pairing's secret: 32 hex digits. */
const ROOM = /^\/connect\/([0-9a-f]{32})$/;
/** Messages are file pieces of at most 64 KB plus a little framing. */
const MAX_MESSAGE = 256 * 1024;

const other = (role: Role): Role => (role === 'computer' ? 'phone' : 'computer');
const isRole = (s: string | null): s is Role => s === 'computer' || s === 'phone';
const peerMessage = (present: boolean) => JSON.stringify({ relay: 'peer', present });

/** A private calendar link: 128 random bits. */
const FEED = /^\/cal\/([A-Za-z0-9_-]{22})\.ics$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const feed = FEED.exec(url.pathname)?.[1];
    if (feed) return env.FEEDS.get(env.FEEDS.idFromName(feed)).fetch(request);
    if (url.pathname === '/ical') return passCalendar(request);
    const room = ROOM.exec(url.pathname)?.[1];
    if (!room) return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** Largest calendar passed on, and largest private calendar kept. */
const MAX_CALENDAR = 5 * 1024 * 1024;
const MAX_FEED = 2 * 1024 * 1024;

/**
 * Another calendar (the lab's Google Calendar, say) for the app: browsers do not let a page read a
 * file from another site, so the Worker fetches it and passes it on. Nothing is kept. Only iCal
 * files go through, so this is no general proxy.
 */
async function passCalendar(request: Request): Promise<Response> {
  if (request.method !== 'GET') return text('Method not allowed', 405);
  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return text('That is not a web address.', 400);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return text('Calendar addresses start with https:// (or webcal://).', 400);
  let res: Response;
  try {
    res = await fetch(target.href, {
      headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'Assaycraft (assaycraftlab.com) calendar reader' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return text('The calendar’s server did not answer.', 504);
  }
  if (!res.ok || !res.body)
    return text(
      res.status === 404 ? 'There is no calendar at that address (it may have been reset).' : `The calendar’s server said ${res.status}.`,
      502,
    );
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CALENDAR) {
      await reader.cancel();
      return text('That calendar is too large (over 5 MB).', 413);
    }
    chunks.push(value);
  }
  const body = new TextDecoder().decode(concat(chunks, size));
  if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(body.slice(0, 512)))
    return text('That address does not give a calendar (iCal) file. In Google Calendar, use the “Secret address in iCal format”.', 422);
  return new Response(body, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Characters per stored part of a calendar (each part well under the storage's value limit). */
const PART = 30000;

/**
 * One private calendar link. Calendar apps read it (GET); the device that made it, holding its key,
 * replaces it (PUT) or deletes it (DELETE). The first PUT sets the key: only a hash of it is kept.
 */
export class CalendarFeed extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const method = request.method;
    const storage = this.ctx.storage;
    if (method === 'GET' || method === 'HEAD') {
      const parts = await storage.get<number>('parts');
      if (!parts) return text('No calendar here: it was turned off, or never made.', 404);
      const keys = Array.from({ length: parts }, (_, i) => `part${i}`);
      const got = await storage.get<string>(keys);
      return new Response(method === 'HEAD' ? null : keys.map((k) => got.get(k) ?? '').join(''), {
        headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex' },
      });
    }
    if (method !== 'PUT' && method !== 'DELETE')
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, PUT, DELETE' } });
    // The upload is read first, whatever the answer: a request's body cannot be read after it.
    const body = method === 'PUT' ? await request.text() : '';
    const key = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!key) return text('A key is needed to change this calendar.', 401);
    const hash = await sha256(key);
    const owner = await storage.get<string>('owner');
    if (owner && owner !== hash) return text('Wrong key for this calendar.', 403);
    if (method === 'DELETE') {
      await storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    if (body.length > MAX_FEED) return text('The calendar is too large (over 2 MB).', 413);
    if (!body.startsWith('BEGIN:VCALENDAR')) return text('That is not a calendar (iCal) file.', 422);
    const parts = Math.max(1, Math.ceil(body.length / PART));
    const entries: Record<string, unknown> = { owner: hash, parts };
    for (let i = 0; i < parts; i++) entries[`part${i}`] = body.slice(i * PART, (i + 1) * PART);
    const before = (await storage.get<number>('parts')) ?? 0;
    await storage.put(entries);
    if (before > parts) await storage.delete(Array.from({ length: before - parts }, (_, i) => `part${parts + i}`));
    return new Response(null, { status: 204 });
  }
}

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
