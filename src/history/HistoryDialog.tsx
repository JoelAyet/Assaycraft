import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronsUpDown, FileClock, RotateCcw } from 'lucide-react';
import { Dialog, confirmDialog, openDialog } from '../ui/overlay';
import { toast, useNotebook } from '../notebook/store';
import { flushWrite, restoreVersion } from '../notebook/actions';
import { diffLines, type DiffLine, type Segment } from './diff';
import { flushHistory, historyPathFor, readHistory } from './store';
import { dayLabel, historyItems, propChanges, timeLabel, type HistoryItem } from './view';
import { LOCALE, clock } from '../lib/dates';

export function openVersionHistory(path: string) {
  openDialog((close) => <HistoryDialog path={path} close={close} />);
}

type Mode = 'changes' | 'current';

const fullDate = (t: number) =>
  new Date(t).toLocaleString(LOCALE, clock({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }));

/** "today at 14:03", "yesterday at 09:10" or the full date. */
function whenLabel(t: number) {
  const day = dayLabel(t);
  return day === 'Today' || day === 'Yesterday' ? `${day.toLowerCase()} at ${timeLabel(t)}` : fullDate(t);
}

const plainLines = (text: string): DiffLine[] => text.split('\n').map((l) => ({ kind: 'eq', segments: [{ type: 'eq', text: l }] }));

function HistoryDialog({ path, close }: { path: string; close: () => void }) {
  const meta = useNotebook((s) => s.docs[path]);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>('changes');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vault = useNotebook.getState().vault;
    if (!meta || !vault) return;
    let alive = true;
    (async () => {
      // What is being typed is the current version; versions on their way to disk belong in the list.
      await flushWrite(path);
      await flushHistory();
      const [text, stat, h] = await Promise.all([vault.readText(path), vault.stat(path), readHistory(vault, historyPathFor(meta))]);
      if (alive) setItems(historyItems({ text, t: stat?.lastModified || Date.now() }, h));
    })().catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const item = items?.[sel];
  const current = items?.[0];
  const older = items?.[sel + 1];
  const vsCurrent = mode === 'current' && !!item && !item.current;

  const view = useMemo(() => {
    if (!item || !current) return null;
    if (vsCurrent) return { lines: diffLines(current.body, item.body, 3), props: propChanges(current.props, item.props) };
    if (!older) return { lines: plainLines(item.body), props: [] };
    return { lines: diffLines(older.body, item.body, 3), props: propChanges(older.props, item.props) };
  }, [item, current, older, vsCurrent]);

  const groups = useMemo(() => {
    const out: { day: string; entries: { item: HistoryItem; index: number }[] }[] = [];
    items?.forEach((it, index) => {
      const day = dayLabel(it.t);
      if (out[out.length - 1]?.day !== day) out.push({ day, entries: [] });
      out[out.length - 1].entries.push({ item: it, index });
    });
    return out;
  }, [items]);

  const pick = (i: number) => {
    if (!items) return;
    const next = Math.max(0, Math.min(items.length - 1, i));
    setSel(next);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  };
  const onListKey = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      pick(sel + step);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      pick(e.key === 'Home' ? 0 : (items?.length ?? 1) - 1);
    }
  };

  const restore = async () => {
    if (!item || item.current || !current || !meta) return;
    const ok = await confirmDialog({
      title: 'Restore this version?',
      message: (
        <>
          <strong>{meta.title}</strong> goes back to how it was on {fullDate(item.t)}. The current version stays in the history, so you can undo this.
        </>
      ),
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const before = current.text;
      await restoreVersion(path, item.text);
      close();
      toast('Version restored', 'success', { label: 'Undo', run: () => void restoreVersion(path, before) });
    } catch (err) {
      setBusy(false);
      toast(`Could not restore: ${(err as Error).message}`, 'error');
    }
  };

  const locked = !!meta?.locked;
  const noVersions = items?.length === 1;

  return (
    <Dialog
      title="Version history"
      icon={<FileClock className="gc-dialog-icon" />}
      onClose={close}
      wide
      className="gc-history-dialog"
      footer={
        <>
          <span className="muted gc-footer-hint">Kept in the notebook: every version from the last day, then hourly, daily and weekly ones.</span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={!item || item.current || locked || busy}
            title={locked ? 'Unlock it first to restore a version' : undefined}
            onClick={() => void restore()}
          >
            <RotateCcw /> Restore this version
          </button>
        </>
      }
    >
      {error ? (
        <p className="gc-history-empty">Could not read the history: {error}</p>
      ) : !items || !item || !view ? (
        <p className="gc-history-empty muted">Loading versions…</p>
      ) : (
        <div className="gc-history">
          <div className="gc-history-list" ref={listRef} role="group" aria-label="Versions" onKeyDown={onListKey}>
            {groups.map((g) => (
              <Fragment key={g.day}>
                <div className="gc-history-day">{g.day}</div>
                {g.entries.map(({ item: it, index }) => (
                  <button
                    key={it.key}
                    data-index={index}
                    className={`gc-history-item ${index === sel ? 'is-selected' : ''}`}
                    aria-current={index === sel ? 'true' : undefined}
                    tabIndex={index === sel ? 0 : -1}
                    onClick={() => setSel(index)}
                  >
                    <span className="gc-history-when">
                      {timeLabel(it.t)}
                      {it.current && <span className="gc-history-tag is-current">Current</span>}
                      {it.label && <span className="gc-history-tag">{it.label}</span>}
                    </span>
                    <span className="gc-history-delta">
                      <Delta item={it} />
                    </span>
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
          <section className="gc-history-view" aria-label="Changes">
            <div className="gc-history-head">
              <div className="gc-history-title">
                <strong>{item.current ? 'Current version' : fullDate(item.t)}</strong>
                <span className="muted">
                  {vsCurrent
                    ? 'Compared with the current version: green is only in this version, red only in the current one.'
                    : item.current && noVersions
                      ? `Saved ${fullDate(item.t)}`
                      : older
                        ? `Changes since the version of ${whenLabel(older.t)}.`
                        : 'The oldest version kept.'}
                </span>
              </div>
              {!noVersions && (
                <div className="gc-segmented gc-segmented-sm" role="group" aria-label="Show">
                  <button className={!vsCurrent ? 'active' : ''} aria-pressed={!vsCurrent} onClick={() => setMode('changes')}>
                    What changed
                  </button>
                  <button className={vsCurrent ? 'active' : ''} aria-pressed={vsCurrent} disabled={item.current} onClick={() => setMode('current')}>
                    Compare with current
                  </button>
                </div>
              )}
            </div>
            {noVersions ? (
              <div className="gc-history-empty">
                <FileClock />
                <p>
                  <strong>No earlier versions yet.</strong>
                  <br />
                  Assaycraft keeps the previous version each time you start editing again after a break (10 minutes or more), and before every
                  restore.
                </p>
              </div>
            ) : (
              <>
                {view.props.length > 0 && (
                  <dl className="gc-history-props">
                    {view.props.map((c) => (
                      <div key={c.key}>
                        <dt>{c.key}</dt>
                        <dd>
                          {c.from && <del>{c.from}</del>}
                          {c.from && c.to && <span aria-hidden="true"> → </span>}
                          {c.to ? <ins>{c.to}</ins> : <span className="muted">(removed)</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <DiffView key={`${item.key}-${vsCurrent}`} lines={view.lines} />
              </>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function Delta({ item }: { item: HistoryItem }) {
  if (item.oldest) return <>Oldest version kept</>;
  const d = item.delta;
  if (!d) return <>No earlier versions</>;
  if (!d.added && !d.removed) return <>{item.propsChanged ? 'Properties changed' : 'Layout changes'}</>;
  return (
    <>
      {d.added > 0 && <span className="is-add">+{d.added}</span>} {d.removed > 0 && <span className="is-del">−{d.removed}</span>}{' '}
      <span>{d.added + d.removed === 1 ? 'word' : 'words'}</span>
    </>
  );
}

const MARK: Record<string, string> = { eq: '', ins: '+', del: '−', mod: '~' };
const SR: Record<string, string> = { ins: 'Added: ', del: 'Removed: ', mod: 'Changed: ' };

function DiffView({ lines }: { lines: DiffLine[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const onlySkip = lines.every((l) => l.kind === 'skip');
  return (
    <div className="gc-diff">
      {onlySkip && <p className="gc-diff-same muted">The text is the same.</p>}
      {lines.map((l, i) => {
        if (l.kind !== 'skip') return <Row key={i} kind={l.kind} segments={l.segments} />;
        if (open.has(i))
          return (
            <Fragment key={i}>
              {l.lines.map((text, j) => (
                <Row key={j} kind="eq" segments={[{ type: 'eq', text }]} />
              ))}
            </Fragment>
          );
        return (
          <button key={i} className="gc-diff-skip" onClick={() => setOpen((s) => new Set(s).add(i))}>
            <ChevronsUpDown /> {l.count} unchanged {l.count === 1 ? 'line' : 'lines'}
          </button>
        );
      })}
    </div>
  );
}

/** A changed word. Changed spacing (e.g. in table cells) is not worth a highlight. */
function word(s: Segment, key: number) {
  const blank = !s.text.trim();
  if (s.type === 'del') return blank ? null : <del key={key}>{s.text}</del>;
  if (s.type === 'ins' && !blank) return <ins key={key}>{s.text}</ins>;
  return s.text;
}

/** Settings Assaycraft keeps for a table or a buffer (<!-- gc:table … -->): shown, but quietly. */
const isSettings = (segments: Segment[]) => /^<!-- gc:/.test(segments[0]?.text ?? '');

function Row({ kind, segments }: { kind: string; segments: Segment[] }) {
  return (
    <div className={`gc-diff-line is-${kind} ${isSettings(segments) ? 'is-settings' : ''}`}>
      <span className="gc-diff-mark" aria-hidden="true">
        {MARK[kind]}
      </span>
      <span className="gc-diff-text">
        {SR[kind] && <span className="sr-only">{SR[kind]}</span>}
        {kind === 'mod' ? segments.map(word) : segments.map((s) => s.text).join('') || '\u200b'}
      </span>
    </div>
  );
}
