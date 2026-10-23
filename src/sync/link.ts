/**
 * A link carries the sync engine's messages between two devices, in order. It is either a direct
 * WebRTC data channel or the relay; the engine does not need to know which.
 */
export interface Link {
  send(data: Uint8Array<ArrayBuffer>): Promise<void>;
  onMessage(fn: (data: Uint8Array<ArrayBuffer>) => void): void;
  onClose(fn: () => void): void;
  close(): void;
}

/** A message: a JSON header, and for file pieces the bytes. */
export interface Message {
  t: string;
  [key: string]: unknown;
}

export function encodeMessage(header: Message, payload?: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + (payload?.length ?? 0));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  if (payload) out.set(payload, 4 + head.length);
  return out;
}

export function decodeMessage(data: Uint8Array<ArrayBuffer>): { header: Message; payload: Uint8Array<ArrayBuffer> } {
  const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + len))) as Message;
  return { header, payload: data.slice(4 + len) };
}

/** Two links joined back to back, for tests. Messages wait until the other side listens. */
export function linkPair(): [Link, Link] {
  type End = { listeners: ((d: Uint8Array<ArrayBuffer>) => void)[]; waiting: Uint8Array<ArrayBuffer>[]; closers: (() => void)[] };
  const a: End = { listeners: [], waiting: [], closers: [] };
  const b: End = { listeners: [], waiting: [], closers: [] };
  let closed = false;
  const link = (me: End, them: End): Link => ({
    async send(data) {
      if (closed) throw new Error('Link closed');
      const copy = data.slice();
      queueMicrotask(() => (them.listeners.length ? them.listeners.forEach((fn) => fn(copy)) : them.waiting.push(copy)));
    },
    onMessage(fn) {
      me.listeners.push(fn);
      for (const d of me.waiting.splice(0)) fn(d);
    },
    onClose: (fn) => void me.closers.push(fn),
    close() {
      if (closed) return;
      closed = true;
      queueMicrotask(() => [...a.closers, ...b.closers].forEach((fn) => fn()));
    },
  });
  return [link(a, b), link(b, a)];
}
