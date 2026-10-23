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
import { isSecret, newSecret } from './crypto';
import { deviceId, deviceName, shortDevice } from './device';
import { HashCache, SyncEngine, type Progress } from './engine';
import { deleteRecord, loadRecord, saveRecord } from './store';
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
}

export const useSync = create<SyncState>(() => ({ role: null, peers: {}, pending: null }));

/** What the app does for sync (set by notebook/actions, which this module must not import). */
export interface SyncHooks {
  isBusy(path: string): boolean;
  beforeOverwrite(path: string): Promise<void>;
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
  conn: Connection;
  engine?: SyncEngine;
  device?: string;
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

function saveHashesSoon() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (current) void saveRecord('hashes', current.vault.id, current.hashes.toJSON()).catch(() => undefined);
  }, 5000);
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
function runEngine(run: Run, vault: SyncableVault, session: Session, hashes: HashCache, base?: string) {
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
          load: async () => (await loadRecord<Record<string, string>>('base', base)) ?? {},
          save: (files) => saveRecord('base', base, files),
        }
      : undefined,
    isBusy: (path) => hooks?.isBusy(path) ?? false,
    beforeOverwrite: (path) => hooks?.beforeOverwrite(path) ?? Promise.resolve(),
    onApplied: (paths) => {
      hooks?.applied(paths);
      // On a computer with several phones, what one phone sent goes to the others.
      for (const other of current?.runs.values() ?? []) if (other !== run) for (const p of paths) other.engine?.changed(p);
      saveHashesSoon();
    },
    onProgress: (progress) => {
      setPeer(run.id, { progress });
      if (progress.phase === 'live') {
        const now = Date.now();
        setPeer(run.id, { lastSync: now });
        void rememberLastSync(run.id, now);
        saveHashesSoon();
      }
    },
    onSkipped: (paths) => setPeer(run.id, { skipped: paths.length }),
    onConflict: (path, copy) => hooks?.conflict(path, copy, shortDevice(session.peer.device)),
    onError: (err) => console.warn('Sync stopped; it starts again on the next connection.', err),
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

function connect(run: Omit<Run, 'conn'>, secret: string, role: Role, opts: { vault?: SyncableVault; onSession: (s: Session) => void }) {
  const r = run as Run;
  r.conn = new Connection({
    secret,
    role,
    hello: () => hello(role, role === 'computer' ? opts.vault : undefined),
    direct: directAllowed(),
    onState: (link) => setPeer(r.id, { link, ...(link === 'connected' ? {} : { path: undefined }) }),
    onPath: (path) => setPeer(r.id, { path }),
    onSession: (s) => {
      setPeer(r.id, { device: s.peer.device });
      opts.onSession(s);
    },
    onControl: (msg) => {
      if (msg.t === 'unpaired') void (role === 'computer' ? forgetPairing(r.id, false) : unlinkFromComputer(false));
    },
  });
  return r;
}

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
    const run = connect({ id: 'computer' }, link.secret, 'phone', {
      onSession: (s) => {
        if (s.peer.notebook?.id !== link.notebook) return s.link.close();
        runEngine(run, vault, s, hashes);
      },
    });
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
  const run = connect({ id: p.id }, p.secret, 'computer', { vault, onSession: (s) => runEngine(run, vault, s, hashes, p.id) });
  current?.runs.set(p.id, run);
  await run.conn.start();
}

/** Called when the notebook closes. */
export function stopSync() {
  cancelPendingPairing();
  if (current) {
    void saveRecord('hashes', current.vault.id, current.hashes.toJSON()).catch(() => undefined);
    for (const run of current.runs.values()) {
      run.engine?.stop();
      run.conn.stop();
    }
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
  useSync.setState({ pending: { secret, url: pairUrl(secret), link: 'connecting' } });
  const run = connect({ id: '' }, secret, 'computer', {
    vault: cur.vault,
    onSession: (s) => {
      if (run.id) return void runEngine(run, cur.vault, s, cur.hashes, run.id);
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
      })();
    },
  });
  pendingRun = run;
  await run.conn.start();
  return secret;
}

/** Leaving Connect a phone: the code shown there stops working (unless a phone used it). */
export function cancelPendingPairing() {
  if (pendingRun && !pendingRun.id) pendingRun.conn.stop();
  pendingRun = null;
  useSync.setState({ pending: null });
}

/** Disconnect a phone from this notebook. Its copy stays on the phone, as a notebook of its own. */
export async function forgetPairing(id: string, tellPhone = true) {
  const run = current?.runs.get(id);
  if (run) {
    if (tellPhone) await run.conn.control({ t: 'unpaired' }).catch(() => undefined);
    run.engine?.stop();
    run.conn.stop();
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
  let vault: SyncableVault | undefined;
  let opened = false;
  let settle!: { resolve: () => void; reject: (err: unknown) => void };
  const done = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  const hashes = new HashCache();
  const run = { id: 'computer' } as Run;
  const stop = () => {
    run.engine?.stop();
    run.conn.stop();
  };
  run.conn = new Connection({
    secret,
    role: 'phone',
    hello: () => hello('phone'),
    direct: directAllowed(),
    onState: (link) => {
      report({ link });
      setPeer('computer', { link, ...(link === 'connected' ? {} : { path: undefined }) });
    },
    onPath: (path) => setPeer('computer', { path }),
    onControl: (msg) => {
      if (msg.t === 'unpaired' && opened) void unlinkFromComputer(false);
    },
    onSession: (s) =>
      void (async () => {
        const nb = s.peer.notebook;
        if (!nb) throw new Error('The computer has no notebook open.');
        report({ computer: s.peer.device, notebook: nb.name });
        if (!vault) {
          const existing = (await listKnownNotebooks()).find((k) => k.link?.notebook === nb.id);
          const raw = existing ? await IdbVault.open(existing.id, existing.name) : await createBrowserVault(nb.name);
          const link: ComputerLink = { secret, computer: s.peer.device, notebook: nb.id, paired: Date.now() };
          await updateKnownNotebook(raw.id, (k) => ({ ...k, link }));
          vault = new SyncableVault(raw);
        }
        const engine = runEngine(run, vault, s, hashes);
        const off = useSync.subscribe((st) => {
          const progress = st.peers.computer?.progress;
          if (progress) report({ progress });
        });
        await engine.synced.finally(off);
        if (opened) return;
        opened = true;
        // The notebook takes over this connection when it opens (see startSync).
        handover = { vaultId: vault.id, run, hashes };
        useSync.setState((st) => ({ role: 'phone', peers: { computer: { ...st.peers.computer, device: s.peer.device } } }));
        await open(vault);
        settle.resolve();
      })().catch((err) => {
        stop();
        settle.reject(err);
      }),
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
    run.engine?.stop();
    run.conn.stop();
    current?.runs.delete('computer');
  }
  if (current) await updateKnownNotebook(current.vault.id, (nb) => ({ ...nb, link: undefined }));
  useSync.setState({ role: null, peers: {} });
  if (!tellComputer) hooks?.notice('The computer disconnected this device. The notebook stays here, stored in this browser.');
}
