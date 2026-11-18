/**
 * Connect a phone: runs the connections of the open notebook.
 *
 * On the computer, a notebook remembers its paired phones; while it is open, it waits for each of
 * them on the relay and syncs with whichever connects. On a phone, a notebook copied from a computer
 * remembers that computer, and connects to it whenever the notebook is open.
 */
import { create } from 'zustand';
import { createBrowserVault, getKnownNotebook, listKnownNotebooks, updateKnownNotebook, type ComputerLink, type Pairing } from '../fs/registry';
import { IdbVault } from '../fs/idbVault';
import { getState } from '../notebook/store';
import { Connection, type Hello, type LinkState, type Role, type Session } from './connection';
import { isSecret, newSecret, rekeyPair, rekeySecret } from './crypto';
import { deviceId, deviceName, shortDevice } from './device';
import { HashCache, SyncEngine, type Progress } from './engine';
import { baseFiles, baseRecord, deleteRecord, loadRecord, saveRecord } from './store';
import { SyncableVault } from './vault';

export interface PeerStatus {
  /** The other device: "iPhone · Safari". */
  device: string;
  link: LinkState;
  path?: 'direct' | 'relay';
  progress?: Progress;
  lastSync?: number;
  /** Files too big to copy, left where they are. */
  skipped?: number;
}

export interface SyncState {
  /** This device's part for the open notebook; null when it is connected to nothing. */
  role: Role | null;
  /** By pairing id (on the computer), or 'computer' (on a phone). */
  peers: Record<string, PeerStatus>;
  /** The code shown on Connect a phone, until a phone uses it. */
  pending: { secret: string; url: string; link: LinkState } | null;
  /** The code shown was not used in time, and no longer works. */
  expired?: boolean;
}

export const useSync = create<SyncState>(() => ({ role: null, peers: {}, pending: null }));

/** A code shown on Connect a phone works this long. */
export const PAIR_CODE_LIFETIME = 10 * 60_000;

/** What the app does for sync (set by notebook/actions, which this module must not import). */
export interface SyncHooks {
  isBusy(path: string): boolean;
  /**
   * Keep the version of `path` about to be replaced: `compare` when the two devices meet (always),
   * `live` as the other device saves (once per editing session), `resolve` when the other's is the
   * later of two edits (always, and kept for good).
   */
  beforeOverwrite(path: string, when: 'compare' | 'live' | 'resolve'): Promise<void>;
  /** Keep the other device's version of `path`, which lost to a later edit here, in its history. */
  keepVersion(path: string, bytes: Uint8Array, label: string): Promise<void>;
  /** Both devices had changed `path`: the latest edit was kept, here or from `from`. */
  resolved(path: string, kept: 'here' | 'there', from: string): void;
  /** This version of `path` (a fingerprint) is in its version history on this device. */
  hadVersion(path: string, h: string): Promise<boolean>;
  applied(paths: string[]): void;
  conflict(path: string, copy: string, from: string): void;
  notice(message: string, kind?: 'info' | 'error'): void;
}
let hooks: SyncHooks | null = null;
export function setSyncHooks(h: SyncHooks) {
  hooks = h;
}

/** Needs the site's relay and the browser's encryption: https (or localhost while developing). */
export function syncSupported(): boolean {
  if (typeof WebSocket === 'undefined' || !globalThis.crypto?.subtle) return false;
  return location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

/** The address in the QR code: opening it on the phone (or scanning it in Assaycraft) connects. */
export const pairUrl = (secret: string) => `${location.origin}/#/pair/${secret}`;

/** The secret in a scanned or pasted code, or null if it is not one. */
export function parsePairCode(text: string): string | null {
  const t = text.trim();
  const m = /#\/pair\/([A-Za-z0-9_-]{22})(?:$|[?&/])/.exec(t + '/');
  const secret = m?.[1] ?? t;
  return isSecret(secret) ? secret : null;
}

const isQuotaError = (err: unknown) => err instanceof Error && (err.name === 'QuotaExceededError' || /quota/i.test(err.message));

/** Off only for tests of the relay path: localStorage 'assaycraft:direct' = 'off'. */
function directAllowed() {
  try {
    return localStorage.getItem('assaycraft:direct') !== 'off';
  } catch {
    return true;
  }
}

interface Run {
  /** Pairing id, 'computer' on a phone, or '' for the computer's code not used yet. */
  id: string;
  role: Role;
  conn: Connection;
  engine?: SyncEngine;
  device?: string;
  /** The computer's notebook (its hello names it). */
  vault?: SyncableVault;
  /** What a session is for (syncing, or on the computer, pairing first). */
  onSession: (s: Session) => void;
  /** The pairing uses a secret of the two devices' own, no longer the QR code's. */
  keyed?: boolean;
  /** Saves a change to the pairing's record: the computer's Pairing, or the phone's ComputerLink. */
  persist?: (patch: KeyPatch) => Promise<void>;
  /** While switching to a secret of their own: the connection with it, until the two meet there. */
  next?: { conn: Connection; secret: string };
  /** The computer's half of an exchange it started. */
  rekey?: { priv: CryptoKey; id: string };
}

type KeyPatch = { secret?: string; next?: string | null; keyed?: boolean };

function patched<T extends { secret: string; next?: string; keyed?: boolean }>(rec: T, p: KeyPatch): T {
  const out: T = { ...rec, ...(p.secret ? { secret: p.secret } : {}), ...(p.keyed ? { keyed: true } : {}) };
  if (p.next === null) delete out.next;
  else if (p.next) out.next = p.next;
  return out;
}

let current: { vault: SyncableVault; runs: Map<string, Run>; hashes: HashCache } | null = null;
let pendingRun: Run | null = null;
/** A phone's first connection, handed to the notebook once it opens. */
let handover: { vaultId: string; run: Run; hashes: HashCache } | null = null;
let hashTimer: ReturnType<typeof setTimeout> | undefined;

function setPeer(id: string, patch: Partial<PeerStatus>) {
  if (!id) {
    const p = useSync.getState().pending;
    if (p && patch.link) useSync.setState({ pending: { ...p, link: patch.link } });
    return;
  }
  useSync.setState((s) => ({ peers: { ...s.peers, [id]: { ...(s.peers[id] ?? { device: '', link: 'connecting' }), ...patch } } }));
}

function saveHashes() {
  clearTimeout(hashTimer);
  if (current) void saveRecord('hashes', current.vault.id, current.hashes.toJSON()).catch(() => undefined);
}

function saveHashesSoon() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(saveHashes, 5000);
}

// A phone or tablet may discard a page that was put away without warning: the fingerprints of the
// files are kept before that, or the next connection reads every file again to make them.
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hashTimer !== undefined) saveHashes();
  });
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => hashTimer !== undefined && saveHashes());

/** Progress, at most every PROGRESS_EVERY ms (one update per file made a phone redraw thousands of times). */
const PROGRESS_EVERY = 150;
function progressReporter(report: (p: Progress) => void) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: Progress | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    if (latest) report(latest);
  };
  return (p: Progress) => {
    latest = p;
    // A new phase (comparing, copying, live) shows at once; counts in between, now and then.
    if (p.phase !== 'copying' || p.done === 0 || p.done >= p.total) return flush();
    if (Date.now() - last >= PROGRESS_EVERY) flush();
    else timer ??= setTimeout(flush, PROGRESS_EVERY);
  };
}

function hello(role: Role, vault?: SyncableVault): Hello {
  const notebook = vault && { id: vault.id, name: getState().config?.name || vault.name };
  return { role, device: deviceName(), deviceId: deviceId(), notebook };
}

async function rememberLastSync(id: string, when: number) {
  const v = current?.vault;
  if (!v) return;
  await updateKnownNotebook(v.id, (nb) =>
    id === 'computer' && nb.link
      ? { ...nb, link: { ...nb.link, lastSync: when } }
      : { ...nb, pairings: nb.pairings?.map((p) => (p.id === id ? { ...p, lastSync: when } : p)) },
  ).catch(() => undefined);
}

/** Start syncing over a new session; on the computer, each phone has its own base. */
function runEngine(run: Run, vault: SyncableVault, session: Session, hashes: HashCache, base?: string, onFatal?: (err: Error) => void) {
  run.engine?.stop();
  run.device = session.peer.device;
  const engine = new SyncEngine({
    role: base ? 'leader' : 'follower',
    vault,
    link: session.link,
    peerLabel: shortDevice(session.peer.device),
    hashes,
    base: base
      ? {
          load: async () => baseFiles(await loadRecord('base', base)),
          save: (files) => saveRecord('base', base, baseRecord(files)),
        }
      : undefined,
    isBusy: (path) => hooks?.isBusy(path) ?? false,
    beforeOverwrite: (path, when) => hooks?.beforeOverwrite(path, when) ?? Promise.resolve(),
    hadVersion: (path, h) => hooks?.hadVersion(path, h) ?? Promise.resolve(false),
    keepVersion: (path, bytes, label) => hooks?.keepVersion(path, bytes, label) ?? Promise.resolve(),
    onResolved: (path, kept) => hooks?.resolved(path, kept, shortDevice(session.peer.device)),
    onApplied: (paths) => {
      hooks?.applied(paths);
      // On a computer with several phones, what one phone sent goes to the others.
      for (const other of current?.runs.values() ?? []) if (other !== run) for (const p of paths) other.engine?.changed(p);
      saveHashesSoon();
    },
    onProgress: progressReporter((progress) => {
      if (run.engine !== engine) return;
      setPeer(run.id, { progress });
      if (progress.phase === 'live') {
        const now = Date.now();
        setPeer(run.id, { lastSync: now });
        void rememberLastSync(run.id, now);
        saveHashes();
      }
    }),
    onSkipped: (paths) => setPeer(run.id, { skipped: paths.length }),
    onConflict: (path, copy) => hooks?.conflict(path, copy, shortDevice(session.peer.device)),
    onError: (err) => {
      // Out of space: each new session would fail the same way, over and over. Stop and say so.
      if (isQuotaError(err)) {
        run.conn.stop();
        setPeer(run.id, { link: 'offline', progress: undefined });
        const message =
          'This device has no room left for the notebook in this browser, so syncing stopped. Free some space (or remove large attachments on the computer), then try again.';
        // Copying it for the first time: that ends here, with this (the copy so far stays, and a new try goes on from it).
        if (onFatal) onFatal(new Error(message));
        else hooks?.notice(message, 'error');
        return;
      }
      console.warn('Sync stopped; it starts again on the next connection.', err);
    },
  });
  run.engine = engine;
  engine.start();
  session.link.onClose(() => {
    if (run.engine !== engine) return;
    if (engine.isLive) {
      const now = Date.now();
      setPeer(run.id, { lastSync: now, progress: undefined });
      void rememberLastSync(run.id, now);
    } else setPeer(run.id, { progress: undefined });
  });
  return engine;
}

/** A connection of the run, with `secret`. Only the run's current one speaks for it in the status. */
function makeConn(run: Run, secret: string): Connection {
  const conn: Connection = new Connection({
    secret,
    role: run.role,
    hello: () => hello(run.role, run.role === 'computer' ? run.vault : undefined),
    direct: directAllowed(),
    onState: (link) => {
      if (run.conn === conn) setPeer(run.id, { link, ...(link === 'connected' ? {} : { path: undefined }) });
    },
    onPath: (path) => {
      if (run.conn === conn) setPeer(run.id, { path });
    },
    onSession: (s) => {
      // The two met with their new secret: it is the pairing's from now on.
      if (run.next?.conn === conn) commitKey(run);
      if (run.conn !== conn) return s.link.close();
      setPeer(run.id, { device: s.peer.device });
      run.onSession(s);
      if (run.role === 'computer' && run.id && !run.keyed) void offerKey(run);
    },
    onControl: (msg) => void onControl(run, conn, msg).catch((err) => console.warn('Could not agree on a new key', err)),
  });
  return conn;
}

function newRun(fields: Omit<Run, 'conn'>, secret: string, next?: string): Run {
  const run = fields as Run;
  run.conn = makeConn(run, secret);
  if (next) startNext(run, next);
  return run;
}

function stopRun(run: Run) {
  run.engine?.stop();
  run.conn.stop();
  run.next?.conn.stop();
  run.next = undefined;
}

/** On the computer: start agreeing on a secret of the two devices' own (see rekeyPair). */
async function offerKey(run: Run) {
  if (run.rekey) return;
  if (run.next) {
    // An earlier try the phone did not finish: start again.
    run.next.conn.stop();
    run.next = undefined;
    await run.persist?.({ next: null });
  }
  const pair = await rekeyPair();
  const id = newSecret().slice(0, 16);
  run.rekey = { priv: pair.priv, id };
  await run.conn.control({ t: 'rekey', pub: pair.pub, id }).catch(() => (run.rekey = undefined));
}

async function onControl(run: Run, conn: Connection, msg: { t: string; [k: string]: unknown }) {
  if (msg.t === 'unpaired') {
    // Only for a pairing of the open notebook (a phone's first copy, not opened yet, has nothing to undo).
    if ((conn === run.conn || conn === run.next?.conn) && current?.runs.get(run.id) === run)
      await (run.role === 'computer' ? forgetPairing(run.id, false) : unlinkFromComputer(false));
    return;
  }
  if (typeof msg.pub !== 'string' || typeof msg.id !== 'string' || conn !== run.conn) return;
  if (msg.t === 'rekey' && run.role === 'phone') {
    const pair = await rekeyPair();
    const secret = await rekeySecret(pair.priv, msg.pub, msg.id);
    await run.persist?.({ next: secret });
    await conn.control({ t: 'rekeyed', pub: pair.pub, id: msg.id });
    startNext(run, secret);
  } else if (msg.t === 'rekeyed' && run.role === 'computer' && run.rekey?.id === msg.id) {
    const secret = await rekeySecret(run.rekey.priv, msg.pub, msg.id);
    run.rekey = undefined;
    await run.persist?.({ next: secret });
    startNext(run, secret);
  }
}

/** Also wait for the other device with the new secret (the old one stays until they meet there). */
function startNext(run: Run, secret: string) {
  run.next?.conn.stop();
  const conn = makeConn(run, secret);
  run.next = { conn, secret };
  void conn.start();
}

function commitKey(run: Run) {
  const next = run.next;
  if (!next) return;
  const old = run.conn;
  run.conn = next.conn;
  run.next = undefined;
  run.keyed = true;
  run.rekey = undefined;
  old.stop();
  void run.persist?.({ secret: next.secret, next: null, keyed: true }).catch((err) => console.warn('Could not save the new key', err));
}

/** Saves a change to a computer's pairing record. */
const pairingPersist = (vaultId: string, run: Run) => (p: KeyPatch) =>
  updateKnownNotebook(vaultId, (nb) => ({ ...nb, pairings: nb.pairings?.map((x) => (x.id === run.id ? patched(x, p) : x)) }));

/** Saves a change to a phone's link to its computer. */
const linkPersist = (vaultId: () => Promise<string>) => async (p: KeyPatch) => {
  const id = await vaultId();
  await updateKnownNotebook(id, (nb) => (nb.link ? { ...nb, link: patched(nb.link, p) } : nb));
};

// ───────────── the open notebook ─────────────

let starting: Promise<void> = Promise.resolve();

/** Called when a notebook opens: connect to its phones, or to its computer. */
export function startSync(vault: SyncableVault): Promise<void> {
  starting = starting.catch(() => undefined).then(() => begin(vault));
  return starting;
}

async function begin(vault: SyncableVault) {
  if (current?.vault === vault) return;
  if (handover?.vaultId === vault.id) {
    const status = useSync.getState().peers.computer;
    stopSync();
    current = { vault, runs: new Map([['computer', handover.run]]), hashes: handover.hashes };
    handover = null;
    useSync.setState({ role: 'phone', peers: status ? { computer: status } : {} });
    return;
  }
  stopSync();
  if (!syncSupported()) return;
  const nb = await getKnownNotebook(vault.id).catch(() => undefined);
  const saved = await loadRecord<Record<string, { s: number; m: number; h: string }>>('hashes', vault.id).catch(() => undefined);
  const hashes = new HashCache(saved);
  current = { vault, runs: new Map(), hashes };
  if (nb?.link) {
    const link = nb.link;
    useSync.setState({ role: 'phone', peers: { computer: { device: link.computer, link: 'connecting', lastSync: link.lastSync } } });
    const run: Run = newRun(
      {
        id: 'computer',
        role: 'phone',
        keyed: link.keyed,
        persist: linkPersist(async () => vault.id),
        onSession: (s) => {
          if (s.peer.notebook?.id !== link.notebook) return s.link.close();
          runEngine(run, vault, s, hashes);
        },
      },
      link.secret,
      link.next,
    );
    current.runs.set('computer', run);
    await run.conn.start();
  } else if (nb?.pairings?.length) {
    useSync.setState({
      role: 'computer',
      peers: Object.fromEntries(nb.pairings.map((p) => [p.id, { device: p.device, link: 'connecting' as LinkState, lastSync: p.lastSync }])),
    });
    for (const p of nb.pairings) await startPairing(vault, p, hashes);
  }
}

async function startPairing(vault: SyncableVault, p: Pairing, hashes: HashCache) {
  const run: Run = newRun(
    { id: p.id, role: 'computer', vault, keyed: p.keyed, onSession: (s) => runEngine(run, vault, s, hashes, p.id) },
    p.secret,
    p.next,
  );
  run.persist = pairingPersist(vault.id, run);
  current?.runs.set(p.id, run);
  await run.conn.start();
}

/** Called when the notebook closes. */
export function stopSync() {
  cancelPendingPairing();
  if (current) {
    void saveRecord('hashes', current.vault.id, current.hashes.toJSON()).catch(() => undefined);
    for (const run of current.runs.values()) stopRun(run);
  }
  current = null;
  useSync.setState({ role: null, peers: {}, pending: null });
}

// ───────────── on the computer ─────────────

/**
 * Make a code for a new phone (Connect a phone shows it as a QR code) and wait for a phone to use
 * it. The phone that does becomes a paired phone of this notebook.
 */
export async function newPairing(): Promise<string> {
  cancelPendingPairing();
  await starting;
  const cur = current;
  if (!cur) throw new Error('Open a notebook first');
  const secret = newSecret();
  useSync.setState({ pending: { secret, url: pairUrl(secret), link: 'connecting' }, expired: false });
  const run: Run = newRun(
    {
      id: '',
      role: 'computer',
      vault: cur.vault,
      onSession: (s) => {
        if (run.id) return void runEngine(run, cur.vault, s, cur.hashes, run.id);
        clearTimeout(pendingExpiry);
        void (async () => {
          // A phone used the code: it is paired from now on (replacing an earlier pairing of the same phone).
          const pairing: Pairing = { id: newSecret().slice(0, 12), secret, device: s.peer.device, deviceId: s.peer.deviceId, paired: Date.now() };
          const nb = await getKnownNotebook(cur.vault.id);
          for (const old of nb?.pairings ?? []) if (old.deviceId === pairing.deviceId) await forgetPairing(old.id, false);
          await updateKnownNotebook(cur.vault.id, (k) => ({ ...k, pairings: [...(k.pairings ?? []), pairing] }));
          run.id = pairing.id;
          pendingRun = null;
          cur.runs.set(pairing.id, run);
          useSync.setState((st) => ({
            role: 'computer',
            pending: null,
            peers: { ...st.peers, [pairing.id]: { device: pairing.device, link: 'connected' } },
          }));
          runEngine(run, cur.vault, s, cur.hashes, pairing.id);
          // From now on, a secret of their own: the code shown no longer opens anything.
          void offerKey(run);
        })();
      },
    },
    secret,
  );
  run.persist = pairingPersist(cur.vault.id, run);
  pendingRun = run;
  // A code not used in time stops working.
  clearTimeout(pendingExpiry);
  pendingExpiry = setTimeout(() => {
    if (pendingRun !== run || run.id) return;
    cancelPendingPairing();
    useSync.setState({ expired: true });
  }, PAIR_CODE_LIFETIME);
  await run.conn.start();
  return secret;
}

let pendingExpiry: ReturnType<typeof setTimeout> | undefined;

/** Leaving Connect a phone: the code shown there stops working (unless a phone used it). */
export function cancelPendingPairing() {
  clearTimeout(pendingExpiry);
  if (pendingRun && !pendingRun.id) stopRun(pendingRun);
  pendingRun = null;
  useSync.setState({ pending: null });
}

/** Disconnect a phone from this notebook. Its copy stays on the phone, as a notebook of its own. */
export async function forgetPairing(id: string, tellPhone = true) {
  const run = current?.runs.get(id);
  if (run) {
    if (tellPhone) await run.conn.control({ t: 'unpaired' }).catch(() => undefined);
    stopRun(run);
    current?.runs.delete(id);
  }
  const device = useSync.getState().peers[id]?.device;
  if (current) await updateKnownNotebook(current.vault.id, (nb) => ({ ...nb, pairings: nb.pairings?.filter((p) => p.id !== id) }));
  await deleteRecord('base', id).catch(() => undefined);
  useSync.setState((s) => {
    const peers = { ...s.peers };
    delete peers[id];
    return { peers, role: Object.keys(peers).length ? s.role : null };
  });
  if (!tellPhone && device) hooks?.notice(`${shortDevice(device)} disconnected from this notebook.`);
}

// ───────────── on a phone ─────────────

export interface LinkProgress {
  link: LinkState;
  computer?: string;
  notebook?: string;
  progress?: Progress;
}

/**
 * Use a computer's notebook on this device: connect with the code from its QR, copy the notebook
 * into this browser, then open it (with `open`). Scanning again a code for a notebook this device
 * already has a copy of updates that copy.
 */
export function linkToComputer(secret: string, onStatus: (s: LinkProgress) => void, open: (vault: SyncableVault) => Promise<void>) {
  let status: LinkProgress = { link: 'connecting' };
  const report = (patch: Partial<LinkProgress>) => onStatus((status = { ...status, ...patch }));
  /** Made once, even if the connection drops and a new session starts while it is being made. */
  let making: Promise<SyncableVault> | undefined;
  let opened = false;
  let settle!: { resolve: () => void; reject: (err: unknown) => void };
  const done = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  const hashes = new HashCache();
  /** The first copy cannot go on: it ends with this (once). */
  let failed = false;
  const fail = (err: unknown) => {
    if (failed || opened) return;
    failed = true;
    stop();
    settle.reject(err);
  };
  const run: Run = newRun(
    {
      id: 'computer',
      role: 'phone',
      persist: linkPersist(async () => {
        if (!making) throw new Error('Nothing copied yet');
        return (await making).id;
      }),
      onSession: (s) =>
        void (async () => {
          const nb = s.peer.notebook;
          if (!nb) throw new Error('The computer has no notebook open.');
          report({ computer: s.peer.device, notebook: nb.name });
          making ??= (async () => {
            const existing = (await listKnownNotebooks()).find((k) => k.link?.notebook === nb.id);
            const raw = existing ? await IdbVault.open(existing.id, existing.name) : await createBrowserVault(nb.name);
            const link: ComputerLink = { secret, computer: s.peer.device, notebook: nb.id, paired: Date.now() };
            await updateKnownNotebook(raw.id, (k) => ({ ...k, link }));
            return new SyncableVault(raw);
          })();
          const v = await making;
          const engine = runEngine(run, v, s, hashes, undefined, opened ? undefined : (err) => fail(err));
          const off = useSync.subscribe((st) => {
            const progress = st.peers.computer?.progress;
            if (progress) report({ progress });
          });
          // Synced, or this session ended first (a new one picks up from there).
          const ended = new Promise<boolean>((resolve) => s.link.onClose(() => resolve(false)));
          const synced = await Promise.race([engine.synced.then(() => true), ended]).finally(off);
          if (!synced || opened) return;
          opened = true;
          offLink();
          // The notebook takes over this connection when it opens (see startSync).
          handover = { vaultId: v.id, run, hashes };
          useSync.setState((st) => ({ role: 'phone', peers: { computer: { ...st.peers.computer, device: s.peer.device } } }));
          await open(v);
          settle.resolve();
        })().catch(fail),
    },
    secret,
  );
  const stop = () => {
    offLink();
    stopRun(run);
  };
  // The dialog shows how the connection is going.
  const offLink = useSync.subscribe((st) => {
    const link = st.peers.computer?.link;
    if (link && link !== status.link) report({ link });
  });
  useSync.setState({ peers: { computer: { device: '', link: 'connecting' } } });
  run.conn.start().catch((err) => settle.reject(err));
  return {
    done,
    cancel() {
      if (opened) return;
      stop();
      useSync.setState({ peers: {} });
    },
  };
}

/** Stop syncing this phone's copy with the computer. The copy stays, as an ordinary browser notebook. */
export async function unlinkFromComputer(tellComputer = true) {
  const run = current?.runs.get('computer');
  if (run) {
    if (tellComputer) await run.conn.control({ t: 'unpaired' }).catch(() => undefined);
    stopRun(run);
    current?.runs.delete('computer');
  }
  if (current) await updateKnownNotebook(current.vault.id, (nb) => ({ ...nb, link: undefined }));
  useSync.setState({ role: null, peers: {} });
  if (!tellComputer) hooks?.notice('The computer disconnected this device. The notebook stays here, stored in this browser.');
}
