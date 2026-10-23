import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { dismissToast, getState, navigate, setState, toast, useNotebook, type Accent, type PageFont, type Theme } from './notebook/store';
import { flushAllWrites, hasPendingWrites, openNotebook, rescan } from './notebook/actions';
import { listKnownNotebooks, reopenNotebook } from './fs/registry';
import { Sidebar } from './ui/Sidebar';
import { Welcome } from './ui/Welcome';
import { HomePage } from './ui/HomePage';
import { DocPage } from './ui/DocPage';
import { FolderPage } from './ui/FolderPage';
import { BoardPage } from './ui/BoardPage';
import { CalendarPage } from './ui/CalendarPage';
import { TemplatesPage } from './ui/TemplatesPage';
import { ProtocolsPage } from './ui/protocols';
import { NotesPage } from './ui/NotesPage';
import { StocksPage } from './stocks/StocksPage';
import { LiteraturePage } from './literature/LiteraturePage';
import { TrashPage } from './ui/TrashPage';
import { SettingsPage } from './ui/SettingsPage';
import { PhonePage } from './ui/PhonePage';
import { openConnectComputer } from './ui/ConnectComputer';
import { parsePairCode } from './sync/manager';
import { CardPeek } from './ui/CardPeek';
import { CommandPalette } from './ui/CommandPalette';
import { ContextMenuHost, DialogHost } from './ui/overlay';
import { TourHost } from './ui/Tour';
import { TooltipHost } from './ui/Tooltip';
import { openNewEntryDialog } from './ui/NewEntryDialog';

function useAppearance(theme: Theme, accent: Accent, pageFont: PageFont) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#212121' : '#ffffff');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.font = pageFont;
  }, [accent, pageFont]);
}

function Toasts() {
  const toasts = useNotebook((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert /> : t.kind === 'success' ? <CircleCheck /> : <Info />}
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          {(!t.action || t.sticky) && (
            <button className="toast-action" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Page() {
  const route = useNotebook((s) => s.route);
  const stocksDoc = useNotebook((s) => route.name === 'doc' && s.docs[route.path]?.kind === 'stocks');
  switch (route.name) {
    case 'doc':
      // A stock collection opens as its table.
      return stocksDoc ? <StocksPage path={route.path} /> : <DocPage path={route.path} />;
    case 'folder':
      return <FolderPage path={route.path} />;
    case 'board':
      return <BoardPage path={route.path} />;
    case 'calendar':
      return <CalendarPage />;
    case 'templates':
      return <TemplatesPage />;
    case 'protocols':
      return <ProtocolsPage />;
    case 'notes':
      return <NotesPage />;
    case 'literature':
      return <LiteraturePage />;
    case 'trash':
      return <TrashPage />;
    case 'stocks':
      return <StocksPage path={route.path} id={route.id} />;
    case 'settings':
      return <SettingsPage />;
    case 'phone':
      return <PhonePage />;
    default:
      return <HomePage />;
  }
}

function Shell() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && getState().navOpen) {
        setState({ navOpen: false });
      } else if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setState({ paletteOpen: !getState().paletteOpen });
      } else if (mod && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openNewEntryDialog({});
      }
    };
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      void rescan();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAllWrites();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingWrites()) {
        void flushAllWrites();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
  const route = useNotebook((s) => s.route);
  const navOpen = useNotebook((s) => s.navOpen);
  return (
    <div className={`gc-app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar />
      {navOpen && <div className="gc-nav-backdrop" onClick={() => setState({ navOpen: false })} aria-hidden="true" />}
      <main className="gc-main" key={route.name === 'doc' ? 'doc' : route.name}>
        <Page />
      </main>
      <CardPeek />
      <CommandPalette />
    </div>
  );
}

/** Reopen the last notebook automatically when no permission prompt is needed. */
async function autoOpen() {
  try {
    const [last] = await listKnownNotebooks();
    if (!last) return;
    const vault = await reopenNotebook(last, false);
    if (vault) await openNotebook(vault);
  } catch (err) {
    console.warn('Auto-open failed', err);
  }
}

let autoOpened = false;

/**
 * A pairing link (#/pair/<code>), opened by scanning the computer's QR code with the camera app:
 * take the code out of the address (it is a key) and connect to that computer.
 */
function takePairLink(): string | null {
  if (!location.hash.startsWith('#/pair/')) return null;
  const secret = parsePairCode(location.href);
  history.replaceState(null, '', '#/');
  return secret;
}

export function App() {
  const vault = useNotebook((s) => s.vault);
  const theme = useNotebook((s) => s.theme);
  const accent = useNotebook((s) => s.accent);
  const pageFont = useNotebook((s) => s.pageFont);
  useAppearance(theme, accent, pageFont);
  useEffect(() => {
    if (autoOpened) return;
    autoOpened = true;
    const secret = takePairLink();
    if (secret) {
      openConnectComputer({ secret });
      return;
    }
    void autoOpen().then(() => {
      if (!getState().vault && location.hash.length > 2) navigate({ name: 'home' }, { replace: true });
    });
  }, []);
  useEffect(() => {
    const onHash = () => {
      const secret = takePairLink();
      if (secret) openConnectComputer({ secret });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onError = (e: PromiseRejectionEvent) => {
      const msg = (e.reason as Error)?.message;
      if (msg && !/abort/i.test(msg)) toast(msg, 'error');
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, []);
  return (
    <>
      {vault ? <Shell /> : <Welcome />}
      <DialogHost />
      <TourHost />
      <TooltipHost />
      <ContextMenuHost />
      <Toasts />
    </>
  );
}
