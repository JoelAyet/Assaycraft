import { useEffect, useState } from 'react';
import { ArrowRight, ClipboardPaste, FileArchive, FolderOpen, Globe, HardDrive, Laptop, ScanLine, ShieldCheck, Trash2, X } from 'lucide-react';
import { Logo } from './Sidebar';
import { confirmDialog, promptDialog } from './overlay';
import { createBrowserVault, forgetNotebook, listKnownNotebooks, pickFolderVault, reopenNotebook, type KnownNotebook } from '../fs/registry';
import { supportsFolderAccess } from '../fs/handleVault';
import { IdbVault } from '../fs/idbVault';
import { openFolderCopyNotebook, openNotebook, openZipNotebook } from '../notebook/actions';
import { LAYOUT } from '../notebook/model';
import { toast, useNotebook } from '../notebook/store';
import { formatRelative } from '../lib/dates';
import { ABOUT } from '../lib/about';
import { pickFiles } from '../lib/download';
import { maybeStartTour } from './Tour';
import { openConnectComputer } from './ConnectComputer';
import { syncSupported } from '../sync/manager';
import { LabCycle } from './LabCycle';

export function Welcome() {
  const [known, setKnown] = useState<KnownNotebook[] | null>(null);
  const [seed, setSeed] = useState(true);
  const loading = useNotebook((s) => s.loading);
  const canFolder = supportsFolderAccess();
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // On a phone or tablet, the notebook usually lives on a computer: offer only that, the rest on request.
  const [onItsOwn, setOnItsOwn] = useState(false);
  const connectOnly = touch && syncSupported() && !onItsOwn;

  const refresh = () =>
    void listKnownNotebooks()
      .then(setKnown)
      .catch(() => setKnown([]));
  useEffect(refresh, []);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const e = err as Error | null;
      if (e?.name === 'AbortError') return;
      toast(e?.message || String(err), 'error');
    }
  };

  const openFolder = () =>
    run(async () => {
      const vault = await pickFolderVault();
      const known = [LAYOUT.config, ...LAYOUT.legacyConfigs];
      if (!(await Promise.all(known.map((p) => vault.exists(p)))).some(Boolean)) {
        const existing = (await vault.list('')).filter((e) => !e.name.startsWith('.'));
        if (existing.length) {
          const ok = await confirmDialog({
            title: `Create a notebook in “${vault.name}”?`,
            message: (
              <>
                This folder already contains {existing.length} item{existing.length > 1 ? 's' : ''}. Assaycraft will add <code>{LAYOUT.config}</code>{' '}
                and the folders <code>Projects/</code>, <code>Templates/</code> and <code>Boards/</code>. Existing files are left untouched.
              </>
            ),
            confirmLabel: 'Create notebook here',
          });
          if (!ok) return;
        }
      }
      if (await openNotebook(vault, { seed })) maybeStartTour();
    });

  const openBrowser = () =>
    run(async () => {
      const name = await promptDialog({
        title: 'New notebook in this browser',
        label: 'Name',
        defaultValue: 'Lab notebook',
        confirmLabel: 'Create notebook',
      });
      if (!name) return;
      const vault = await createBrowserVault(name);
      if (await openNotebook(vault, { seed })) maybeStartTour();
    });

  const openZip = () =>
    run(async () => {
      const [file] = await pickFiles({ accept: '.zip,application/zip', multiple: false });
      if (!file) return;
      const n = await openZipNotebook(file, createBrowserVault);
      toast(`Opened “${file.name}” (${n} files) as a notebook in this browser.`, 'success');
    });

  const openFolderCopy = () =>
    run(async () => {
      const files = await pickFiles({ folder: true });
      if (!files.length) return;
      const n = await openFolderCopyNotebook(files, createBrowserVault);
      toast(`Copied the notebook (${n} files) into this browser. To update the folder, export a .zip and unpack it there.`, 'success');
    });

  const reopen = (nb: KnownNotebook) =>
    run(async () => {
      const vault = await reopenNotebook(nb, true);
      if (!vault) {
        toast('Access to the folder was not granted.', 'error');
        return;
      }
      await openNotebook(vault);
    });

  const remove = (nb: KnownNotebook) =>
    run(async () => {
      if (nb.kind === 'browser') {
        const ok = await confirmDialog({
          title: 'Delete this browser notebook?',
          message: `“${nb.name}” and all its entries will be permanently deleted from this browser. Export it as a .zip first if you want to keep it.`,
          confirmLabel: 'Delete permanently',
          danger: true,
        });
        if (!ok) return;
        await IdbVault.destroy(nb.id);
      }
      await forgetNotebook(nb.id);
      refresh();
    });

  const connectCard = syncSupported() && (
    <div className={`gc-option gc-option-connect${connectOnly ? ' is-recommended' : ''}`}>
      <Laptop className="gc-option-icon" />
      <h3>Connect to a computer</h3>
      <p>
        Use a notebook that is open on {touch ? 'your' : 'another'} computer: there, choose <em>Connect a phone</em> in the notebook menu and scan the
        code it shows. This device keeps a copy, in sync while both are open.
      </p>
      <div className="gc-option-actions">
        <button className={`btn btn-lg${connectOnly ? ' btn-primary' : ''}`} disabled={loading} onClick={() => openConnectComputer()}>
          <ScanLine /> Scan the code
        </button>
        <button className="btn btn-ghost btn-lg" disabled={loading} onClick={() => openConnectComputer({ paste: true })}>
          <ClipboardPaste /> Paste the link…
        </button>
      </div>
    </div>
  );

  return (
    <div className="gc-welcome">
      <div className="gc-welcome-inner">
        <header className="gc-welcome-nav">
          <Logo size={34} />
          <h1 className="gc-wordmark">Assaycraft</h1>
          <span className="gc-welcome-tag">Electronic lab notebook</span>
        </header>

        <section className="gc-welcome-hero">
          <div>
            <h2 className="gc-welcome-title">
              The lab notebook
              <br />
              that stays <span className="gc-title-tag">yours</span>
            </h2>
            <p className="gc-lede">
              {touch
                ? // On a phone the files are not in a folder there: it works on a copy, or on its own.
                  'Experiments, protocols, templates and boards are plain Markdown files, kept on your computer. On your phone, work on a copy that stays in sync, offline too.'
                : 'Experiments, protocols, templates and boards are saved as plain Markdown files in a folder on your computer. It runs in your browser and works offline.'}
            </p>
          </div>
          <LabCycle />
        </section>

        {known && known.length > 0 && (
          <section className="gc-welcome-recent">
            <h2>Recent notebooks</h2>
            {known.map((nb) => (
              <div key={nb.id} className="gc-recent-row">
                <button className="gc-recent-open" disabled={loading} onClick={() => void reopen(nb)}>
                  {nb.kind === 'folder' ? <HardDrive /> : nb.link ? <Laptop /> : <Globe />}
                  <span className="gc-recent-name">{nb.name}</span>
                  <span className="muted gc-recent-kind">
                    {nb.kind === 'folder' ? 'Folder on this computer' : nb.link ? `In sync with ${nb.link.computer}` : 'Browser storage'}
                  </span>
                  <span className="muted gc-recent-when">{formatRelative(nb.lastOpened)}</span>
                  <ArrowRight className="gc-recent-arrow" />
                </button>
                <button className="icon-btn" title={nb.kind === 'browser' ? 'Delete notebook' : 'Remove from list'} onClick={() => void remove(nb)}>
                  {nb.kind === 'browser' ? <Trash2 /> : <X />}
                </button>
              </div>
            ))}
          </section>
        )}

        <section className={`gc-welcome-options${connectOnly ? ' is-connect-only' : ''}`}>
          {/* On phones and tablets (no folders) connecting to a computer is the likeliest start: it comes first. */}
          {touch && connectCard}
          {!connectOnly && (
            <div className={`gc-option ${canFolder ? 'is-recommended' : 'is-disabled'}`}>
              <FolderOpen className="gc-option-icon" />
              <h3>Open a notebook folder {canFolder && <span className="pill pill-sq tone-green">Recommended</span>}</h3>
              <p>
                Choose a folder on your computer (empty for a new notebook). Entries, templates and boards are saved there as Markdown files;
                attachments and SnapGene files sit next to them.
              </p>
              {canFolder ? (
                <button className="btn btn-primary btn-lg" disabled={loading} onClick={() => void openFolder()}>
                  <FolderOpen /> Choose folder…
                </button>
              ) : touch ? (
                <p className="gc-option-note">
                  Phones and tablets cannot open folders: use browser storage, or connect to the computer that has the notebook. A .zip exported there
                  (notebook menu → <em>Export notebook</em>) opens here too.
                </p>
              ) : (
                <>
                  <p className="gc-option-note">
                    This browser can read a folder but not save into it (that needs Chrome, Edge, Brave or Arc). Opening one copies its notebook into
                    this browser; export a .zip to take your changes back.
                  </p>
                  <button className="btn btn-lg" disabled={loading} onClick={() => void openFolderCopy()}>
                    <FolderOpen /> Open folder…
                  </button>
                </>
              )}
            </div>
          )}
          {!connectOnly && (
            <div className="gc-option">
              <Globe className="gc-option-icon" />
              <h3>Use browser storage</h3>
              <p>
                Keeps the notebook inside this browser: works anywhere, no folder needed. Export everything as a .zip of Markdown files at any time.
              </p>
              <div className="gc-option-actions">
                <button className="btn btn-lg" disabled={loading} onClick={() => void openBrowser()}>
                  <Globe /> Create browser notebook
                </button>
                <button className="btn btn-ghost btn-lg" disabled={loading} onClick={() => void openZip()} title="Open a notebook exported as a .zip">
                  <FileArchive /> Open a .zip…
                </button>
              </div>
            </div>
          )}
          {!touch && connectCard}
        </section>

        {connectOnly ? (
          <button className="btn btn-ghost gc-welcome-alone" onClick={() => setOnItsOwn(true)}>
            No computer? Use this device on its own
          </button>
        ) : (
          <label className="checkbox gc-welcome-seed">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
            Start new notebooks with example templates (Q5 PCR, Gibson, gel, transformation, miniprep, cloning…) and a task board
          </label>
        )}

        <footer className="gc-welcome-foot">
          <ShieldCheck /> Your data stays on your devices: no account, no cloud storage, no tracking.
          <span className="gc-welcome-credit">
            {ABOUT.name} · created by <strong>{ABOUT.author}</strong>
          </span>
        </footer>
      </div>
    </div>
  );
}
