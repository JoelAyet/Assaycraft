/**
 * The connection between the two devices of a pairing.
 *
 * Both join the pairing's room on the relay and greet each other (encrypted with the pairing key).
 * Once both have answered, a session starts: the sync engine's messages go through the relay at
 * first, while the devices try to open a direct WebRTC channel. If it opens, each device switches
 * to it (in order: a marker on the relay says "from here on, direct"). If it never opens, as happens
 * between a phone on 5G and a computer behind a firewall, the relay carries everything, still
 * encrypted. A lost connection starts a new session; the engine then compares the two again.
 */
import { pairKeys, seal, unseal, type PairKeys } from './crypto';
import type { Link } from './link';

export type Role = 'computer' | 'phone';
export type LinkState = 'connecting' | 'waiting' | 'connected' | 'offline';

export interface Hello {
  role: Role;
  /** "iPhone · Safari" */
  device: string;
  /** Stays the same on a device, so pairing it again replaces the old pairing. */
  deviceId: string;
  /** The computer's open notebook. */
  notebook?: { id: string; name: string };
}

export interface Session {
  peer: Hello;
  link: Link;
  /** How messages travel now. */
  path(): 'direct' | 'relay';
}

export interface ConnectionOptions {
  secret: string;
  role: Role;
  hello: () => Hello;
  /** Try a direct WebRTC channel (default true). */
  direct?: boolean;
  onState?: (state: LinkState) => void;
  onSession?: (session: Session) => void;
  onPath?: (path: 'direct' | 'relay') => void;
  /** Messages outside sessions, such as { t: 'unpaired' }. */
  onControl?: (msg: { t: string; [k: string]: unknown }) => void;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
/** Give up on a direct channel after this long and keep using the relay. */
const DIRECT_TIMEOUT = 20_000;
const HIGH_WATER = 1 << 20;

enum Kind {
  Signal = 1,
  Data = 2,
  /** "Everything I send after this goes through the direct channel." */
  Switch = 3,
}

const randomSession = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The relay's address on this site: wss://assaycraftlab.com/connect/<room>. */
export function relayUrl(room: string, role: Role): string {
  const url = new URL(`connect/${room}`, location.origin + '/');
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('as', role);
  return url.href;
}

/** The two ways to the other device, joined into one ordered link for the engine. */
class DualLink implements Link {
  private listeners: ((d: Uint8Array<ArrayBuffer>) => void)[] = [];
  private closers: (() => void)[] = [];
  private early: Uint8Array<ArrayBuffer>[] = [];
  private directIn = false;
  private directQueue: Uint8Array<ArrayBuffer>[] = [];
  private chain: Promise<void> = Promise.resolve();
  private dc?: RTCDataChannel;
  out: 'relay' | 'direct' = 'relay';
  closed = false;

  constructor(
    private readonly relaySend: (kind: Kind, data?: Uint8Array) => Promise<void>,
    private readonly onPath: (path: 'direct' | 'relay') => void,
  ) {}

  send(data: Uint8Array<ArrayBuffer>): Promise<void> {
    const run = async () => {
      if (this.closed) throw new Error('Connection lost');
      if (this.out === 'direct' && this.dc) {
        const dc = this.dc;
        if (dc.bufferedAmount > HIGH_WATER)
          await new Promise<void>((resolve) => dc.addEventListener('bufferedamountlow', () => resolve(), { once: true }));
        dc.send(data);
      } else await this.relaySend(Kind.Data, data);
    };
    const next = this.chain.then(run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  onMessage(fn: (d: Uint8Array<ArrayBuffer>) => void) {
    this.listeners.push(fn);
    for (const d of this.early.splice(0)) fn(d);
  }
  onClose(fn: () => void) {
    this.closers.push(fn);
  }

  private deliver(d: Uint8Array<ArrayBuffer>) {
    if (this.closed) return;
    if (this.listeners.length) for (const fn of this.listeners) fn(d);
    else this.early.push(d);
  }

  fromRelay(kind: Kind, data: Uint8Array<ArrayBuffer>) {
    if (kind === Kind.Data) this.deliver(data);
    else if (kind === Kind.Switch) {
      this.directIn = true;
      for (const d of this.directQueue.splice(0)) this.deliver(d);
    }
  }

  fromDirect(data: Uint8Array<ArrayBuffer>) {
    if (this.directIn) this.deliver(data);
    else this.directQueue.push(data);
  }

  /** The direct channel is open: send the marker after everything already queued, then use it. */
  useDirect(dc: RTCDataChannel) {
    this.dc = dc;
    dc.bufferedAmountLowThreshold = HIGH_WATER / 4;
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      await this.relaySend(Kind.Switch);
      this.out = 'direct';
      this.onPath('direct');
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closers) fn();
  }
}

export class Connection {
  private keys?: PairKeys;
  private ws?: WebSocket;
  private stopped = false;
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private lastHeard = 0;
  private incoming: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();
  // The greeting (see the comment in `onHello`).
  private mine = randomSession();
  private theirs: string | null = null;
  private told: string | null = null;
  private dual?: DualLink;
  private pc?: RTCPeerConnection;
  private candidates: RTCIceCandidateInit[] = [];
  private state: LinkState = 'connecting';

  constructor(private readonly o: ConnectionOptions) {}

  get linkState() {
    return this.state;
  }

  async start() {
    this.keys = await pairKeys(this.o.secret);
    window.addEventListener('online', this.wake);
    window.addEventListener('offline', this.lost);
    document.addEventListener('visibilitychange', this.wake);
    this.open();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener('online', this.wake);
    window.removeEventListener('offline', this.lost);
    document.removeEventListener('visibilitychange', this.wake);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.endSession();
    this.ws?.close(1000);
    this.ws = undefined;
  }

  /** Send a message outside sessions (needs the other device to be connected to the relay). */
  async control(msg: { t: string; [k: string]: unknown }) {
    await this.sendSignal({ ...msg, control: true });
  }

  private setState(state: LinkState) {
    if (state === this.state) return;
    this.state = state;
    this.o.onState?.(state);
  }

  /**
   * The network is gone (or the relay has been silent too long). A socket can look open for minutes
   * after that, so let it go now: the session ends, and a new connection is made when the network is back.
   */
  private drop(retry: boolean) {
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    clearInterval(this.pingTimer);
    this.endSession();
    if (this.stopped) return;
    this.setState('offline');
    clearTimeout(this.retryTimer);
    if (retry) this.retryTimer = setTimeout(() => this.open(), Math.min(30_000, 1000 * 2 ** this.retry++));
  }

  private lost = () => this.drop(false);

  /** Back on the network, or back on screen: reconnect now rather than at the next retry. */
  private wake = () => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    // A phone that was asleep can keep a socket that looks open but is gone.
    if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastHeard > 40_000) this.drop(false);
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      clearTimeout(this.retryTimer);
      this.retry = 0;
      this.open();
    }
  };

  private open() {
    if (this.stopped || !this.keys) return;
    clearTimeout(this.retryTimer);
    this.setState(this.state === 'offline' ? 'offline' : 'connecting');
    const ws = new WebSocket(relayUrl(this.keys.room, this.o.role));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastHeard = Date.now();
      this.setState('waiting');
      clearInterval(this.pingTimer);
      // The relay answers every ping: silence for over a minute means the connection is gone.
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastHeard > 70_000) this.drop(true);
        else if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25_000);
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      if (typeof e.data === 'string') {
        if (e.data !== 'pong') this.onRelay(JSON.parse(e.data) as { relay: string; present: boolean });
        return;
      }
      const data = new Uint8Array(e.data as ArrayBuffer);
      // Decrypt in order of arrival.
      this.incoming = this.incoming.then(() => this.onFrame(data)).catch((err) => console.warn('Ignored a message that could not be read', err));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.endSession();
      if (this.stopped) return;
      this.setState('offline');
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.open(), wait);
    };
  }

  private onRelay(msg: { relay: string; present: boolean }) {
    if (msg.relay !== 'peer') return;
    if (msg.present) {
      // The relay says so when the other device (re)connects: any session it had is over.
      if (this.dual) this.restartGreeting();
      this.setState('waiting');
      void this.sendHello();
    } else {
      this.endSession();
      this.setState('waiting');
    }
  }

  private async sendFrame(kind: Kind, body: Uint8Array) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.keys) throw new Error('Not connected');
    const plain = new Uint8Array(1 + body.length);
    plain[0] = kind;
    plain.set(body, 1);
    const sealed = await seal(this.keys.key, plain);
    while (ws.bufferedAmount > HIGH_WATER) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Not connected');
      await sleep(20);
    }
    ws.send(sealed);
  }

  /** Frames go out in order: each waits for the one before (encryption is asynchronous). */
  private queueFrame(kind: Kind, body: Uint8Array): Promise<void> {
    const next = this.outgoing.then(() => this.sendFrame(kind, body));
    this.outgoing = next.catch(() => undefined);
    return next;
  }

  private sendSignal(msg: object) {
    return this.queueFrame(Kind.Signal, new TextEncoder().encode(JSON.stringify(msg)));
  }

  private sessionFrame(kind: Kind, data?: Uint8Array) {
    const tag = new TextEncoder().encode(this.mine);
    const body = new Uint8Array(tag.length + (data?.length ?? 0));
    body.set(tag);
    if (data) body.set(data, tag.length);
    return this.queueFrame(kind, body);
  }

  private async onFrame(sealed: Uint8Array<ArrayBuffer>) {
    if (!this.keys) return;
    const plain = await unseal(this.keys.key, sealed);
    const kind = plain[0] as Kind;
    if (kind === Kind.Signal) return this.onSignal(JSON.parse(new TextDecoder().decode(plain.subarray(1))));
    const tag = new TextDecoder().decode(plain.subarray(1, 9));
    if (tag !== this.theirs) return; // from an earlier session
    this.dual?.fromRelay(kind, plain.slice(9));
  }

  private sendHello() {
    this.told = this.theirs;
    return this.sendSignal({ t: 'hello', session: this.mine, known: this.theirs, hello: this.o.hello() });
  }

  private async onSignal(msg: { t: string; [k: string]: unknown }) {
    if (msg.control) return this.o.onControl?.(msg);
    if (msg.t === 'hello') return this.onHello(msg.session as string, msg.known as string | null, msg.hello as Hello);
    if (msg.t !== 'rtc' || msg.to !== this.mine || msg.from !== this.theirs) return;
    await this.onRtc(msg).catch((err) => console.warn('Direct connection failed; using the relay', err));
  }

  /**
   * Each device greets with its session and the other's, if it knows it. A session starts on a
   * device when the other's greeting names it; each answers until the other knows its session.
   * A greeting from a new session of the other device (it reloaded, or lost its network) ends the
   * current session and starts again.
   */
  private async onHello(session: string, known: string | null, hello: Hello) {
    if (hello.role === this.o.role) return;
    if (session !== this.theirs) {
      if (this.dual) {
        this.endSession();
        this.mine = randomSession();
      }
      this.theirs = session;
    }
    if (this.told !== this.theirs) await this.sendHello();
    if (known === this.mine && !this.dual) this.beginSession(hello);
  }

  private beginSession(peer: Hello) {
    const dual = new DualLink(
      (kind, data) => this.sessionFrame(kind, data),
      (path) => this.o.onPath?.(path),
    );
    this.dual = dual;
    dual.onClose(() => {
      if (this.dual !== dual) return;
      // A direct channel that broke: start again (on the relay, if it is still there).
      this.restartGreeting();
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.setState('waiting');
        void this.sendHello();
      }
    });
    this.setState('connected');
    this.o.onPath?.('relay');
    this.o.onSession?.({ peer, link: dual, path: () => dual.out });
    if (this.o.direct !== false && typeof RTCPeerConnection !== 'undefined' && this.o.role === 'computer') void this.offerDirect();
  }

  private restartGreeting() {
    this.endSession();
    this.mine = randomSession();
    this.theirs = null;
    this.told = null;
  }

  private endSession() {
    const dual = this.dual;
    this.dual = undefined;
    this.pc?.close();
    this.pc = undefined;
    this.candidates = [];
    dual?.close();
  }

  // ───────────── direct channel ─────────────

  private rtc(msg: object) {
    return this.sendSignal({ t: 'rtc', from: this.mine, to: this.theirs, ...msg });
  }

  private newPeer(dual: DualLink) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.rtc({ candidate: e.candidate.toJSON() });
    };
    const giveUp = setTimeout(() => {
      if (dual.out !== 'direct') pc.close();
    }, DIRECT_TIMEOUT);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        clearTimeout(giveUp);
        if (dual.out === 'direct') dual.close();
      }
    };
    const channel = (dc: RTCDataChannel) => {
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => dual.fromDirect(new Uint8Array(e.data as ArrayBuffer));
      dc.onopen = () => {
        clearTimeout(giveUp);
        dual.useDirect(dc);
      };
      dc.onclose = () => {
        if (dual.out === 'direct') dual.close();
      };
    };
    return { pc, channel };
  }

  private async offerDirect() {
    const dual = this.dual;
    if (!dual) return;
    try {
      const { pc, channel } = this.newPeer(dual);
      channel(pc.createDataChannel('notebook', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await this.rtc({ description: pc.localDescription!.toJSON() });
    } catch (err) {
      console.warn('No direct connection; using the relay', err);
    }
  }

  private async onRtc(msg: { [k: string]: unknown }) {
    const dual = this.dual;
    if (!dual) return;
    const description = msg.description as RTCSessionDescriptionInit | undefined;
    if (description?.type === 'offer') {
      if (this.o.direct === false || typeof RTCPeerConnection === 'undefined') return;
      const { pc, channel } = this.newPeer(dual);
      pc.ondatachannel = (e) => channel(e.channel);
      await pc.setRemoteDescription(description);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.rtc({ description: pc.localDescription!.toJSON() });
      for (const c of this.candidates.splice(0)) await pc.addIceCandidate(c);
    } else if (description?.type === 'answer' && this.pc) {
      await this.pc.setRemoteDescription(description);
      for (const c of this.candidates.splice(0)) await this.pc.addIceCandidate(c);
    } else if (msg.candidate) {
      const c = msg.candidate as RTCIceCandidateInit;
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(c);
      else this.candidates.push(c);
    }
  }
}
