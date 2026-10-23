/**
 * The phone relay of worker/index.ts, for `npm run dev`, `npm run preview` and the tests: the same
 * rooms and messages, kept in memory by the Vite server instead of a Cloudflare Durable Object.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

type Role = 'computer' | 'phone';
const ROOM = /^\/connect\/([0-9a-f]{32})$/;
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

  return {
    name: 'assaycraft:dev-relay',
    configureServer(server) {
      server.httpServer?.on('upgrade', onUpgrade);
    },
    configurePreviewServer(server) {
      server.httpServer.on('upgrade', onUpgrade);
    },
  };
}
