import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Compass } from 'lucide-react';
import { getState as getNotebook, navigate, setState as setNotebook, useNotebook } from '../notebook/store';
import { saveConfig } from '../notebook/actions';
import { EXAMPLE_ENTRY_ID } from '../notebook/seed';
import { PHONE, useMediaQuery } from '../lib/useMedia';
import { openNewEntryDialog } from './NewEntryDialog';
import { syncSupported, useSync } from '../sync/manager';

/**
 * A short guided tour of a new notebook: it asks for your name, then each step points at one part of
 * the app (and at the flow and buffer of the example entry) and says what it is for. It starts once,
 * when a notebook is created in this browser; it can be skipped, and taken again from Settings → About,
 * the notebook menu or search.
 */
const DONE_KEY = 'assaycraft:tourDone';
const useTour = create<{ step: number | null; steps: Step[] }>(() => ({ step: null, steps: [] }));

export function startTour() {
  // Steps on the example entry are left out once it has been deleted.
  const example = !!exampleEntry();
  useTour.setState({ step: 0, steps: STEPS.filter((s) => (!s.onExample || example) && (!s.when || s.when())) });
}

/** The first time a notebook is created in this browser. */
export function maybeStartTour() {
  try {
    if (localStorage.getItem(DONE_KEY)) return;
  } catch {
    /* storage unavailable: show it */
  }
  startTour();
}

function endTour() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* ignore */
  }
  useTour.setState({ step: null });
  setNotebook({ navOpen: false });
}

/** Forward or back a step; past the last one, the tour ends. */
function go(d: number) {
  const { step, steps } = useTour.getState();
  const next = (step ?? 0) + d;
  if (next < 0) return;
  if (next >= steps.length) endTour();
  else useTour.setState({ step: next });
}

const exampleEntry = () => Object.values(getNotebook().docs).find((d) => d.id === EXAMPLE_ENTRY_ID && d.kind === 'entry');

/** Sidebar items by their labels. */
const navItems =
  (...labels: string[]) =>
  () =>
    [...document.querySelectorAll<HTMLElement>('.gc-nav-item')].filter((e) => labels.some((l) => e.textContent?.trim().startsWith(l)));
const section = (title: string) => () =>
  [...document.querySelectorAll<HTMLElement>('.gc-section')].find((e) => e.querySelector('.gc-section-head')?.textContent?.includes(title)) ?? null;
const one = (selector: string) => () => document.querySelector<HTMLElement>(selector);

interface Step {
  title: string;
  body: (where: string) => ReactNode;
  /** What to highlight: an element, or several next to each other. */
  target?: () => HTMLElement | HTMLElement[] | null;
  /** In the sidebar, which phones show as a drawer. */
  sidebar?: boolean;
  /** Shown on the example entry, which the step opens. */
  onExample?: boolean;
  /** Left out when this says no. */
  when?: () => boolean;
}

const mod = () => (/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl');
/** A phone or tablet: no keyboard shortcuts to mention. */
const touch = () => window.matchMedia('(pointer: coarse)').matches;
/** This notebook is a phone's copy of one on a computer. */
const computersCopy = () => useSync.getState().role === 'phone';

const STEPS: Step[] = [
  {
    title: 'Welcome to your notebook',
    body: (where) => <>A short tour of where things are. Everything you write is saved as Markdown files {where}.</>,
  },
  {
    title: 'Start an experiment',
    target: one('.gc-new-btn'),
    sidebar: true,
    body: () => (
      <>
        Pick a template (blank, molecular cloning, cell culture…) and fill in its blanks. Each entry gets an ID such as <code>EXP-0001</code> and
        lives in a project folder.
      </>
    ),
  },
  {
    title: 'Your lab’s library',
    target: navItems('Protocols', 'Stocks', 'Literature'),
    sidebar: true,
    body: () => (
      <>
        <strong>Protocols</strong>: your methods, with versions. <strong>Stocks</strong>: primers, plasmids, glycerol stocks, with Tm and GC %.{' '}
        <strong>Literature</strong>: papers, added by DOI or PubMed ID and cited from your entries.
      </>
    ),
  },
  {
    title: 'Templates',
    target: navItems('Templates'),
    sidebar: true,
    body: () => (
      <>
        A template is a ready-made entry for an experiment you repeat. Blanks written in <code>{'{{double brackets}}'}</code> are asked for when you
        create an entry from it, and filled in. Sub-templates are shared blocks (PCR, gel…) that templates are built from.
      </>
    ),
  },
  {
    title: 'Notes',
    target: navItems('Notes'),
    sidebar: true,
    body: () => <>Meeting notes, ideas and brainstorming. A note is written like an entry, but has no ID, project or status: it just stays here.</>,
  },
  {
    title: 'Boards and calendar',
    target: section('Boards'),
    sidebar: true,
    body: () => (
      <>
        <em>Experiments</em> shows every entry by status. Add boards to track samples through stages, or for lab tasks with due dates. The{' '}
        <em>Calendar</em> shows them all on their dates.
      </>
    ),
  },
  {
    title: 'A flow of experiments',
    target: one('.gc-flow'),
    onExample: true,
    body: () => (
      <>
        This example entry plans a knockout as a <strong>flow</strong>. Click <em>Start</em> on a step and it becomes its own entry; its status and
        result then show here.
      </>
    ),
  },
  {
    title: 'The buffer calculator',
    target: one('.gc-buffer'),
    onExample: true,
    body: () => (
      <>
        Give each stock and the final concentration you want: it works out what to add, and how much powder to weigh. Change the final volume and
        every amount follows.
      </>
    ),
  },
  {
    title: 'Type / for more',
    target: one('.gc-toolbar [aria-label="Insert…"]'),
    body: () => (
      <>
        In any entry or note, type <kbd>/</kbd> (or use <strong>+</strong> in the toolbar) to add a flow, a buffer, a 96- or 384-well plate layout,
        tables with formulas, checklists, protocols, stocks, files and plasmid maps, or to cite a paper.
        <span className="gc-tour-slash" aria-hidden="true">
          {['Flow', 'Buffer', 'Plate layout', 'Table', 'Checklist', 'Protocol', 'Stock', 'Cite a paper'].map((b) => (
            <span key={b}>{b}</span>
          ))}
        </span>
      </>
    ),
  },
  {
    title: 'Find anything',
    target: one('.gc-search-btn'),
    sidebar: true,
    body: () => (
      <>
        {touch() ? (
          <strong>Search</strong>
        ) : (
          <>
            <kbd>{mod()}</kbd> <kbd>K</kbd>
          </>
        )}{' '}
        finds entries, papers, protocols, templates and single stocks, and runs commands such as “New note”.
      </>
    ),
  },
  {
    title: 'Your phone at the bench',
    target: one('.gc-notebook-btn'),
    sidebar: true,
    // A phone with a notebook of its own has no phone to connect.
    when: () => syncSupported() && (computersCopy() || !touch()),
    body: () =>
      computersCopy() ? (
        <>
          This notebook is a copy of the one on your computer: while Assaycraft is open on both, what you write on either shows up on the other.{' '}
          <strong>Computer connection</strong>, in this menu, shows how the sync is going.
        </>
      ) : (
        <>
          Choose <strong>Connect a phone</strong> in this menu and scan the code with your phone. It gets a copy of the notebook, and while Assaycraft
          is open on both, what you write on either shows up on the other. Nothing is stored online.
        </>
      ),
  },
  {
    title: 'Saved as you type',
    target: one('.gc-sidebar-foot'),
    sidebar: true,
    body: (where) => (
      <>
        Every change is written {where} within a second. The <strong>⋯</strong> menu of any page has <em>Version history</em>, to see and bring back
        earlier versions.
      </>
    ),
  },
  {
    title: 'You’re ready',
    target: one('.gc-notebook-btn'),
    sidebar: true,
    body: () => (
      <>
        Settings, .zip export and switching notebooks are in this menu.{' '}
        {exampleEntry() ? 'Start your first experiment, or try things out in the example entry first.' : 'Start your first experiment.'}
      </>
    ),
  },
];

/** The smallest box around the elements. */
function boxOf(els: HTMLElement[]): { x: number; y: number; w: number; h: number } | null {
  const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  const w = Math.max(...rects.map((r) => r.right)) - x;
  const h = Math.max(...rects.map((r) => r.bottom)) - y;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

const PAD = 6;

export function TourHost() {
  const step = useTour((s) => s.step);
  const steps = useTour((s) => s.steps);
  const phone = useMediaQuery(PHONE);
  const vault = useNotebook((s) => s.vault);
  const author = useNotebook((s) => s.config.author);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [name, setName] = useState(author);
  const primary = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const s = step === null || !vault ? null : steps[step];
  const first = step === 0;

  // The name asked for on the first step signs new entries (as in Settings).
  useEffect(() => {
    if (first) setName(getNotebook().config.author);
  }, [first]);
  const keepName = () => {
    const n = name.trim();
    if (first && n !== getNotebook().config.author) void saveConfig({ author: n });
  };
  const keepNameRef = useRef(keepName);
  keepNameRef.current = keepName;

  // Follow the target as the drawer slides in, the page scrolls or the window changes.
  useEffect(() => {
    if (!s) return;
    if (phone) setNotebook({ navOpen: !!s.sidebar });
    if (s.onExample) {
      const doc = exampleEntry();
      const route = getNotebook().route;
      if (doc && !(route.name === 'doc' && route.path === doc.path)) navigate({ name: 'doc', path: doc.path });
    }
    let frame = 0;
    let last = '';
    let scrolled = false;
    const measure = () => {
      const found = s.target?.();
      const els = !found ? [] : Array.isArray(found) ? found : [found];
      // A block in the page is scrolled to, once: into view, and on a computer with room for the card
      // above or below it (a tall block on a laptop goes just under the toolbar, the card beneath it).
      if (!scrolled && els[0] && !s.sidebar) {
        scrolled = true;
        const r = els[0].getBoundingClientRect();
        const room = (card.current?.offsetHeight ?? 220) + 28;
        const inView = r.top >= 60 && r.bottom <= window.innerHeight - 20;
        const cardFits = r.top - 12 >= room || window.innerHeight - r.bottom >= room;
        if (!inView || (!phone && !cardFits)) {
          els[0].style.scrollMarginTop = phone ? '' : '110px';
          els[0].scrollIntoView({ block: 'start' });
          els[0].style.scrollMarginTop = '';
        }
      }
      const next = boxOf(els);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setRect(next);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [s, phone]);

  useEffect(() => {
    if (step === null) return;
    if (step === 0 && !getNotebook().config.author) nameInput.current?.focus();
    else primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === 'Escape') {
        keepNameRef.current();
        endTour();
      } else if (e.key === 'ArrowRight' && !typing) go(1);
      else if (e.key === 'ArrowLeft' && !typing) go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (!s || step === null || !vault) return null;
  const last = step === steps.length - 1;
  const where = vault.kind === 'browser' ? 'in this browser' : 'in your notebook folder';

  // The card goes beside its target (below it on a phone, or above when the target is low), else in the middle.
  let pos: CSSProperties;
  if (!rect) pos = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  else if (phone)
    pos = rect.y > window.innerHeight / 2 ? { left: 12, right: 12, top: 'max(12px, env(safe-area-inset-top))' } : { left: 12, right: 12, bottom: 12 };
  else {
    const h = card.current?.offsetHeight ?? 200;
    const w = card.current?.offsetWidth ?? 360;
    const clampY = (y: number) => Math.max(12, Math.min(window.innerHeight - h - 12, y));
    const clampX = (x: number) => Math.max(12, Math.min(window.innerWidth - w - 12, x));
    if (rect.x + rect.w + 18 + w <= window.innerWidth - 12) pos = { left: rect.x + rect.w + 18, top: clampY(rect.y + rect.h / 2 - h / 2) };
    // A wide block in the page: the card goes below it, or above, or over its lower corner.
    else if (rect.y + rect.h + 14 + h <= window.innerHeight - 12) pos = { left: clampX(rect.x + rect.w - w), top: rect.y + rect.h + 14 };
    else if (rect.y - 14 - h >= 12) pos = { left: clampX(rect.x + rect.w - w), top: rect.y - 14 - h };
    else pos = { left: clampX(rect.x + rect.w - w - 16), top: clampY(rect.y + rect.h - h - 16) };
  }

  return createPortal(
    <div className="gc-tour" data-step={step}>
      {rect ? (
        <div className="gc-tour-spot" style={{ left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 }} />
      ) : (
        <div className="gc-tour-shade" />
      )}
      <div
        ref={card}
        className={`gc-tour-card ${rect ? '' : 'is-center'}`}
        style={pos}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-tour-title"
      >
        <div className="gc-tour-head">
          {(step === 0 || last) && <Compass className="gc-tour-icon" />}
          <span className="gc-tour-count">
            {step + 1} of {steps.length}
          </span>
        </div>
        <h2 id="gc-tour-title">{s.title}</h2>
        <p>{s.body(where)}</p>
        {first && (
          <form
            className="gc-tour-name"
            onSubmit={(e) => {
              e.preventDefault();
              keepName();
              go(1);
            }}
          >
            <label htmlFor="gc-tour-name">What’s your name?</label>
            <input
              id="gc-tour-name"
              ref={nameInput}
              className="input"
              value={name}
              autoComplete="name"
              placeholder="e.g. Ada Lovelace"
              onChange={(e) => setName(e.target.value)}
            />
            <span className="field-hint">It signs your entries as their author. You can change it in Settings.</span>
          </form>
        )}
        <div className="gc-tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'active' : i < step ? 'seen' : ''} />
          ))}
        </div>
        <div className="gc-tour-actions">
          {last ? (
            <button className="btn btn-sm" onClick={endTour}>
              Explore on my own
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                keepName();
                endTour();
              }}
            >
              Skip tour
            </button>
          )}
          <span className="spacer" />
          {step > 0 && !last && (
            <button className="btn btn-sm" onClick={() => go(-1)}>
              Back
            </button>
          )}
          <button
            ref={primary}
            className="btn btn-primary btn-sm"
            onClick={() => {
              keepName();
              if (!last) return go(1);
              endTour();
              openNewEntryDialog({});
            }}
          >
            {step === 0 ? 'Show me around' : last ? 'New entry' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
