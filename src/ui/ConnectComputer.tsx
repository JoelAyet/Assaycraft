import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Laptop, ScanLine } from 'lucide-react';
import { openNotebook } from '../notebook/actions';
import { toast } from '../notebook/store';
import { linkToComputer, parsePairCode, syncSupported, type LinkProgress } from '../sync/manager';
import { QrScanner } from '../sync/qr';
import { Dialog, openDialog } from './overlay';

/** Welcome → Connect to a computer, or a pairing link opened on this device. */
export function openConnectComputer(opts: { secret?: string; paste?: boolean } = {}) {
  openDialog((close) => <ConnectComputer close={close} initial={opts.secret} paste={opts.paste} />);
}

function statusText(s: LinkProgress): string {
  if (s.link === 'offline') return 'No internet connection. Trying again…';
  if (s.link === 'connecting') return 'Connecting…';
  if (s.link === 'waiting')
    return 'Waiting for the computer. On it, keep the Connect a phone page open (or the notebook, if this device was connected before).';
  const p = s.progress;
  if (!p || p.phase === 'comparing') return `Connected to ${s.computer ?? 'the computer'}. Comparing notebooks…`;
  return `Copying “${s.notebook ?? 'the notebook'}”: ${p.done} of ${p.total}`;
}

function ConnectComputer({ close, initial, paste }: { close: () => void; initial?: string; paste?: boolean }) {
  const [secret, setSecret] = useState<string | null>(initial ?? null);
  const [mode, setMode] = useState<'scan' | 'paste'>(paste ? 'paste' : 'scan');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState<LinkProgress>({ link: 'connecting' });
  const handle = useRef<ReturnType<typeof linkToComputer> | null>(null);
  // The dialog host makes a new `close` at each render; the connection must not restart for that.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!secret) return;
    setProblem('');
    const h = linkToComputer(secret, setStatus, async (vault) => {
      await openNotebook(vault, { seed: false });
      closeRef.current();
      toast(`“${vault.name}” is on this device and stays in sync with the computer while both are open.`, 'success');
    });
    handle.current = h;
    h.done.catch((err) => setProblem((err as Error).message || String(err)));
    return () => h.cancel();
  }, [secret]);

  const onCode = useCallback((value: string) => {
    const s = parsePairCode(value);
    if (s) setSecret(s);
    else setProblem('That QR code is not from Assaycraft. Scan the one on the computer’s Connect a phone page.');
    return !!s;
  }, []);
  const onCameraError = useCallback((message: string) => {
    setProblem(message);
    setMode('paste');
  }, []);

  const submit = () => {
    const s = parsePairCode(text);
    if (s) setSecret(s);
    else setProblem('That is not a link from the Connect a phone page. Copy it there with “Copy link”.');
  };

  const cancel = () => {
    handle.current?.cancel();
    close();
  };

  const p = status.progress;
  return (
    <Dialog title="Connect to a computer" icon={<Laptop />} onClose={cancel} className="gc-connect-dialog">
      {!syncSupported() ? (
        <p className="gc-option-note">Connecting devices needs the website (assaycraftlab.com), opened over https.</p>
      ) : secret ? (
        <div className="gc-connect-status" role="status">
          <p>{problem || statusText(status)}</p>
          {p && p.phase === 'copying' && p.total > 0 && (
            <progress className="gc-connect-progress" max={p.total} value={p.done} aria-label="Copying the notebook" />
          )}
          {problem && (
            <button className="btn" onClick={() => setSecret(null)}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="muted gc-connect-lede">
            On the computer, open the notebook in Assaycraft and choose <strong>Connect a phone</strong> in the notebook menu. Then scan the code it
            shows.
          </p>
          {mode === 'scan' ? (
            <>
              <QrScanner onCode={onCode} onError={onCameraError} />
              {problem && <p className="gc-option-note">{problem}</p>}
              <button className="btn btn-ghost btn-sm" onClick={() => setMode('paste')}>
                <ClipboardPaste /> Paste the link instead
              </button>
            </>
          ) : (
            <form
              className="gc-connect-paste"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label className="field-label" htmlFor="gc-pair-link">
                Link from the computer
              </label>
              <input
                id="gc-pair-link"
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`${location.origin}/#/pair/…`}
                autoComplete="off"
              />
              {problem && <p className="gc-option-note">{problem}</p>}
              <div className="gc-row-buttons">
                <button type="submit" className="btn btn-primary">
                  Connect
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setMode('scan')}>
                  <ScanLine /> Scan instead
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}
