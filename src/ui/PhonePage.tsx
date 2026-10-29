import { useEffect, useState } from 'react';
import { Check, Copy, Laptop, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { useNotebook, toast } from '../notebook/store';
import { formatRelative } from '../lib/dates';
import { PageHead, PhoneBar } from './PageHeader';
import { confirmDialog } from './overlay';
import { cancelPendingPairing, forgetPairing, newPairing, syncSupported, unlinkFromComputer, useSync, type PeerStatus } from '../sync/manager';
import { QrCode } from '../sync/qr';

/** How a connected device is doing, in a few words. */
export function peerStatus(p: PeerStatus, other: 'phone' | 'computer'): { text: string; tone: 'live' | 'busy' | 'idle' } {
  if (p.link === 'connected') {
    const pr = p.progress;
    if (pr && pr.phase === 'comparing') return { text: 'Comparing notebooks…', tone: 'busy' };
    if (pr && pr.phase === 'copying') return { text: `Syncing: ${pr.done} of ${pr.total}`, tone: 'busy' };
    return { text: p.path === 'direct' ? 'Connected directly' : 'Connected through the relay', tone: 'live' };
  }
  if (p.link === 'offline') return { text: 'No internet connection; trying again', tone: 'idle' };
  return { text: other === 'computer' ? 'Waiting for the computer' : 'Not connected', tone: 'idle' };
}

function lastSync(p: PeerStatus) {
  if (!p.lastSync) return 'Not synced yet';
  return `${p.link === 'connected' ? 'In sync' : 'Last synced'} ${formatRelative(p.lastSync)}`;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm"
      data-url={url}
      onClick={() =>
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

/** On the computer: the code a phone scans, and the phones already connected. */
function ComputerView({ notebook }: { notebook: string }) {
  const pending = useSync((s) => s.pending);
  const peers = useSync((s) => s.peers);
  const [showCode, setShowCode] = useState(true);
  const [error, setError] = useState('');
  const [justPaired, setJustPaired] = useState<string | null>(null);

  useEffect(() => {
    if (!showCode) return;
    setError('');
    const before = new Set(Object.keys(useSync.getState().peers));
    void newPairing().catch((err) => setError((err as Error).message));
    // When a phone uses the code, show it among the connected phones instead of a new code.
    const off = useSync.subscribe((s) => {
      const added = Object.keys(s.peers).find((id) => !before.has(id));
      if (added && !s.pending) {
        setJustPaired(s.peers[added].device);
        setShowCode(false);
      }
    });
    return () => {
      off();
      cancelPendingPairing();
    };
  }, [showCode]);

  const disconnect = async (id: string, p: PeerStatus) => {
    const ok = await confirmDialog({
      title: `Disconnect ${p.device || 'this phone'}?`,
      message: 'It stops syncing with this notebook. Its copy stays on the phone, as a notebook stored in its browser.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (ok) await forgetPairing(id);
  };

  const list = Object.entries(peers);
  return (
    <>
      <section className="gc-settings-section">
        <h2>{showCode ? 'Scan this code with your phone' : 'Phone connected'}</h2>
        {showCode ? (
          <div className="gc-pair">
            <div className="gc-pair-code">
              {pending ? (
                <QrCode text={pending.url} label="QR code to connect a phone to this notebook" />
              ) : (
                <div className="gc-qr gc-qr-empty" aria-hidden="true" />
              )}
              <div className="gc-pair-wait" role="status">
                {error ||
                  (pending?.link === 'offline'
                    ? 'No connection to the relay. Check the internet connection.'
                    : pending?.link === 'connected'
                      ? 'A phone is connecting…'
                      : 'Waiting for a phone…')}
              </div>
              {pending && <CopyLink url={pending.url} />}
            </div>
            <ol className="gc-pair-steps">
              <li>
                On your phone, open <strong>{location.host}</strong>.
              </li>
              <li>
                Choose <strong>Connect to a computer</strong> and scan this code. (The phone’s camera app works too: it opens the link.)
              </li>
              <li>
                The phone gets a copy of “{notebook}”. From then on, changes go both ways while Assaycraft is open on both, and the phone reconnects
                by itself.
              </li>
            </ol>
          </div>
        ) : (
          <div className="gc-storage-card">
            <Check />
            <div>
              <strong>{justPaired || 'The phone'} is connected to this notebook.</strong>
              <p className="muted">It keeps its own copy. Leave this notebook open here to keep the two in sync.</p>
              <button className="btn btn-sm gc-pair-again" onClick={() => setShowCode(true)}>
                <Smartphone /> Connect another phone
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="gc-settings-section">
        <h2>Connected phones</h2>
        {list.length === 0 ? (
          <p className="muted">No phone yet.</p>
        ) : (
          <ul className="gc-peers">
            {list.map(([id, p]) => {
              const st = peerStatus(p, 'phone');
              return (
                <li key={id} className="gc-peer">
                  <Smartphone className="gc-peer-icon" />
                  <div className="gc-peer-main">
                    <strong>{p.device || 'Phone'}</strong>
                    <span className="gc-peer-status">
                      <span className={`gc-sync-dot is-${st.tone}`} aria-hidden="true" />
                      {st.text} · {lastSync(p)}
                    </span>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => void disconnect(id, p)}>
                    <Unlink /> Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <HowItWorks />
    </>
  );
}

/** On a phone: which computer this notebook comes from, and how the connection is. */
function PhoneView({ notebook }: { notebook: string }) {
  const p = useSync((s) => s.peers.computer);
  const disconnect = async () => {
    const ok = await confirmDialog({
      title: 'Disconnect from the computer?',
      message: `This copy of “${notebook}” stops syncing. It stays on this device, as a notebook stored in this browser; to sync again, scan a new code from the computer.`,
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    await unlinkFromComputer();
    toast('Disconnected. The notebook stays on this device.', 'success');
  };
  if (!p) return null;
  const st = peerStatus(p, 'computer');
  return (
    <>
      <section className="gc-settings-section">
        <h2>Computer</h2>
        <div className="gc-storage-card">
          <Laptop />
          <div>
            <strong>
              A copy of “{notebook}” from {p.device || 'your computer'}
            </strong>
            <p className="gc-peer-status">
              <span className={`gc-sync-dot is-${st.tone}`} aria-hidden="true" />
              {st.text} · {lastSync(p)}
            </p>
            {st.tone === 'idle' && <p className="muted">Open “{notebook}” in Assaycraft on the computer: the two connect and sync by themselves.</p>}
          </div>
        </div>
        <div className="gc-row-buttons">
          {st.tone === 'idle' && (
            <button className="btn" onClick={() => window.dispatchEvent(new Event('online'))}>
              <RefreshCw /> Try to connect now
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void disconnect()}>
            <Unlink /> Disconnect from the computer
          </button>
        </div>
      </section>
      <HowItWorks />
    </>
  );
}

function HowItWorks() {
  return (
    <section className="gc-settings-section">
      <h2>How it works</h2>
      <ul className="gc-pair-notes">
        <li>Each device keeps the notebook. Nothing is stored online, and the phone works without a connection at the bench.</li>
        <li>Changes sync while Assaycraft is open on both devices, within a second or two. When they reconnect, they catch up.</li>
        <li>
          The devices connect directly when their networks allow it. When they do not (a phone on mobile data, a computer behind a firewall), they go
          through Assaycraft’s relay, end-to-end encrypted with a key only your devices have: the relay cannot read your notebook.
        </li>
        <li>If a page was changed on both devices before they caught up, both versions are kept, the other as a copy “(from …)”.</li>
        <li>Files over 50 MB stay on the device they were added on.</li>
      </ul>
    </section>
  );
}

export function PhonePage() {
  const vault = useNotebook((s) => s.vault);
  const config = useNotebook((s) => s.config);
  const role = useSync((s) => s.role);
  if (!vault) return null;
  const notebook = config.name || vault.name;
  const phone = role === 'phone';
  return (
    <div className="gc-page gc-settings-page">
      <PhoneBar />
      <div className="gc-page-inner gc-settings-inner">
        <PageHead
          title={phone ? 'Computer connection' : 'Connect a phone'}
          lede={
            phone
              ? 'This notebook is kept in sync with the computer it came from.'
              : 'Use this notebook on your phone at the bench. The phone keeps its own copy, and what you write on either device shows up on the other.'
          }
        />
        {!syncSupported() ? (
          <p className="gc-option-note">Connecting devices needs the website (assaycraftlab.com), not the single-file version.</p>
        ) : phone ? (
          <PhoneView notebook={notebook} />
        ) : (
          <ComputerView notebook={notebook} />
        )}
      </div>
    </div>
  );
}
