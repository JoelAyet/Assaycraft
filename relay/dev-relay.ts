/**
 * The phone relay of worker/index.ts, for `npm run dev`, `npm run preview` and the tests: the same
 * rooms and messages, kept in memory by the Vite server instead of a Cloudflare Durable Object. Also
 * the Worker's private calendar links (/cal/<id>.ics) and its calendar pass-through (/ical?url=…).
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

type Role = 'computer' | 'phone';
const ROOM = /^\/connect\/([0-9a-f]{32})$/;
const FEED = /^\/cal\/([A-Za-z0-9_-]{22})\.ics$/;
const MAX_MESSAGE = 256 * 1024;
const other = (role: Role): Role => (role === 'computer' ? 'phone' : 'computer');
const peerMessage = (present: boolean) => JSON.stringify({ relay: 'peer', present });

export function devRelay(): Plugin {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const rooms = new Map<string, Map<Role, WebSocket>>();

  const join = (room: string, role: Role, ws: WebSocket) => {
    const members = rooms.get(room) ?? new Map<Role, WebSocket>();
    rooms.set(room, members);
    members.get(role)?.close(4000, 'Replaced by a newer connection');
    members.set(role, ws);
    const peer = () => members.get(other(role));
    ws.send(peerMessage(!!peer()));
    peer()?.send(peerMessage(true));
    ws.on('message', (data, isBinary) => {
      if (!isBinary && data.toString() === 'ping') return ws.send('pong');
      peer()?.send(data, { binary: isBinary });
    });
    ws.on('close', () => {
      if (members.get(role) !== ws) return;
      members.delete(role);
      peer()?.send(peerMessage(false));
      if (!members.size) rooms.delete(room);
    });
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const room = ROOM.exec(url.pathname)?.[1];
    if (!room) return; // Vite's own WebSocket (hot reload)
    const role = url.searchParams.get('as');
    if (role !== 'computer' && role !== 'phone') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => join(room, role, ws));
  };

  const feeds = new Map<string, { owner: string; ics: string }>();
  const reply = (res: ServerResponse, status: number, body = '', type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((done, fail) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
      req.on('error', fail);
    });

  const calendars = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const feed = FEED.exec(url.pathname)?.[1];
    if (feed) {
      const have = feeds.get(feed);
      if (req.method === 'GET' || req.method === 'HEAD')
        return have ? reply(res, 200, req.method === 'GET' ? have.ics : '', 'text/calendar; charset=utf-8') : reply(res, 404, 'No calendar here.');
      const key = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!key) return reply(res, 401, 'A key is needed to change this calendar.');
      const owner = createHash('sha256').update(key).digest('hex');
      if (have && have.owner !== owner) return reply(res, 403, 'Wrong key for this calendar.');
      if (req.method === 'DELETE') {
        feeds.delete(feed);
        return reply(res, 204);
      }
      if (req.method !== 'PUT') return reply(res, 405, 'Method not allowed');
      const ics = await readBody(req);
      if (!ics.startsWith('BEGIN:VCALENDAR')) return reply(res, 422, 'That is not a calendar (iCal) file.');
      feeds.set(feed, { owner, ics });
      return reply(res, 204);
    }
    if (url.pathname === '/ical') {
      const target = url.searchParams.get('url') ?? '';
      if (!/^https?:\/\//i.test(target)) return reply(res, 400, 'Calendar addresses start with https:// (or webcal://).');
      try {
        const r = await fetch(target, { signal: AbortSignal.timeout(15000) });
        const body = await r.text();
        if (!r.ok) return reply(res, 502, `The calendar’s server said ${r.status}.`);
        if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(body.slice(0, 512))) return reply(res, 422, 'That address does not give a calendar (iCal) file.');
        return reply(res, 200, body, 'text/calendar; charset=utf-8');
      } catch {
        return reply(res, 504, 'The calendar’s server did not answer.');
      }
    }
    next();
  };

  return {
    name: 'assaycraft:dev-relay',
    configureServer(server) {
      server.httpServer?.on('upgrade', onUpgrade);
      server.middlewares.use((req, res, next) => void calendars(req, res, next));
    },
    configurePreviewServer(server) {
      server.httpServer.on('upgrade', onUpgrade);
      server.middlewares.use((req, res, next) => void calendars(req, res, next));
    },
  };
}
