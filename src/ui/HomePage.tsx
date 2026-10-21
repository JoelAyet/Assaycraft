import { useMemo, type CSSProperties } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckSquare,
  FilePlus2,
  FileUp,
  FlaskConical,
  LayoutTemplate,
  ListTodo,
  Plus,
  Puzzle,
  Search,
} from 'lucide-react';
import { NavToggle } from './nav';
import { Logo } from './Sidebar';
import { ActivityGraph } from './ActivityGraph';
import { ABOUT } from '../lib/about';
import { BUILTIN_EXPERIMENTS_BOARD, navigate, setState, useNotebook } from '../notebook/store';
import { backlinksOf, boardCards, docSpan, isTask, LAYOUT, type DocMeta } from '../notebook/model';
import { createCard } from '../notebook/actions';
import { excerpt } from '../notebook/text';
import { openNewEntryDialog } from './NewEntryDialog';
import { openNewProtocolDialog, pickAndImportPdfs } from './protocols';
import { StatusPill, statusOf } from './status';
import { dirname, join } from '../lib/path';
import { formatRelative, localDate, longDate } from '../lib/dates';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function Figure({ value, label, tone, note, onClick }: { value: number; label: string; tone?: string; note?: string; onClick: () => void }) {
  return (
    <button className="gc-figure" onClick={onClick}>
      <span className="gc-figure-value">{value}</span>
      <span className="gc-figure-label">
        {tone ? <span className={`gc-status-dot tone-${tone}`} /> : <CheckSquare />}
        {label}
        {note && <span className="gc-overdue"> · {note}</span>}
      </span>
    </button>
  );
}

export function HomePage() {
  const docs = useNotebook((s) => s.docs);
  const config = useNotebook((s) => s.config);
  const all = useMemo(() => Object.values(docs), [docs]);
  const entries = useMemo(() => all.filter((d) => d.kind === 'entry'), [all]);
  const templates = useMemo(() => all.filter((d) => d.kind === 'template').sort((a, b) => a.title.localeCompare(b.title)), [all]);
  const subtemplates = all.filter((d) => d.kind === 'subtemplate').length;
  // Home's tasks come from task boards; boards that track things (constructs, samples…) stay on their own pages.
  const boards = all.filter((d) => d.kind === 'board' && boardCards(d) === 'tasks');
  const protocols = useMemo(() => all.filter((d) => d.kind === 'protocol'), [all]);
  const protocolUse = useMemo(() => new Map(protocols.map((p) => [p.path, backlinksOf(p, all).length])), [protocols, all]);
  const topProtocols = [...protocols]
    .sort((a, b) => (protocolUse.get(b.path) ?? 0) - (protocolUse.get(a.path) ?? 0) || (b.modified ?? '').localeCompare(a.modified ?? ''))
    .slice(0, 6);
  const cards = all.filter((d) => isTask(d, docs));
  const today = localDate();
  const weekEnd = localDate(new Date(Date.now() + 6 * 86400000));

  const isDoneCard = (c: DocMeta) => {
    const cols = docs[join(dirname(c.path), LAYOUT.boardFile)]?.columns ?? [];
    return !!cols.length && cols[cols.length - 1].id === c.status;
  };
  const openCards = cards.filter((c) => !isDoneCard(c));
  const overdue = openCards.filter((c) => c.due && c.due < today);

  const recent = [...entries].sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? '')).slice(0, 4);
  const upcoming = all
    .filter((d) => (d.kind === 'entry' || (isTask(d, docs) && !isDoneCard(d))) && docSpan(d))
    .map((d) => ({ d, span: docSpan(d)! }))
    .filter(({ span }) => span.end >= today && span.start <= weekEnd)
    .sort((a, b) => a.span.start.localeCompare(b.span.start))
    .slice(0, 8);

  const count = (status: string) => entries.filter((e) => e.status === status).length;
  const monthStart = today.slice(0, 7);
  const completedThisMonth = entries.filter((e) => e.status === 'completed' && (e.modified ?? '').startsWith(monthStart)).length;
  const inProgress = count('in-progress');
  const lede = entries.length
    ? `${plural(inProgress, 'experiment')} in progress and ${plural(openCards.length, 'open task')}${overdue.length ? `, ${overdue.length} overdue` : ''}.`
    : 'A fresh notebook. Start with an entry, or set up the protocols and templates you use most.';
  const toBoard = () => navigate({ name: 'board', path: BUILTIN_EXPERIMENTS_BOARD });

  return (
    <div className="gc-page gc-home">
      <div className="gc-topbar gc-mobile-only">
        <NavToggle />
        <span className="gc-topbar-title">Home</span>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Search" onClick={() => setState({ paletteOpen: true })}>
          <Search />
        </button>
      </div>
      <div className="gc-home-inner">
        <header className="gc-home-hero">
          <div>
            <div className="gc-eyebrow">{longDate()}</div>
            <h1 className="gc-home-title">{greeting(config.author)}</h1>
            <p className="gc-lede">{lede}</p>
            <div className="gc-home-actions">
              <button className="btn btn-primary" onClick={() => openNewEntryDialog({})}>
                <FilePlus2 /> New entry
              </button>
              {boards[0] && (
                <button className="btn" onClick={() => void createCard(dirname(boards[0].path), { open: true })}>
                  <ListTodo /> New task
                </button>
              )}
            </div>
          </div>
          <ActivityGraph />
        </header>

        <section className="gc-figures" aria-label="At a glance">
          <Figure value={inProgress} label="In progress" tone="blue" onClick={toBoard} />
          <Figure value={count('planned')} label="Planned" tone="gray" onClick={toBoard} />
          <Figure value={completedThisMonth} label="Done this month" tone="green" onClick={toBoard} />
          <Figure
            value={openCards.length}
            label="Open tasks"
            note={overdue.length ? `${overdue.length} overdue` : undefined}
            onClick={() => boards[0] && navigate({ name: 'board', path: dirname(boards[0].path) })}
          />
        </section>

        <section className="gc-home-section">
          <header className="gc-section-title">
            <h2>Jump back in</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'folder', path: LAYOUT.projects })}>
              All entries <ArrowRight />
            </button>
          </header>
          {recent.length === 0 ? (
            <div className="empty-state gc-home-empty">
              <FlaskConical />
              <h3>No entries yet</h3>
              <p>Create your first entry, blank or from a template.</p>
              <button className="btn btn-primary" onClick={() => openNewEntryDialog({})}>
                <FilePlus2 /> New entry
              </button>
            </div>
          ) : (
            <div className="gc-recent-cards">
              {recent.map((d) => {
                const st = statusOf(config.entryStatuses, d.status);
                return (
                  <button
                    key={d.path}
                    className="gc-recent-card"
                    style={{ '--card-tone': `var(--c-${st?.color ?? 'gray'})` } as CSSProperties}
                    onClick={() => navigate({ name: 'doc', path: d.path })}
                  >
                    <span className="gc-recent-card-band">
                      <span className="gc-recent-card-icon">
                        <FlaskConical />
                      </span>
                    </span>
                    <span className="gc-recent-card-body">
                      <span className="gc-recent-card-title">{d.title}</span>
                      {d.text && <span className="gc-recent-card-excerpt">{excerpt(d.text, 96)}</span>}
                      <span className="gc-recent-card-foot">
                        <span className="id-chip">{d.id}</span>
                        <StatusPill status={st} />
                        <span className="gc-recent-card-when">{formatRelative(d.modified)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
              {recent.length < 4 && (
                <button className="gc-recent-card is-new" onClick={() => openNewEntryDialog({})}>
                  <Plus /> New entry
                </button>
              )}
            </div>
          )}
        </section>

        <div className="gc-home-grid">
          <section className="gc-panel">
            <header className="gc-panel-head">
              <h2>Next 7 days</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'calendar' })}>
                Calendar <ArrowRight />
              </button>
            </header>
            {upcoming.length === 0 && overdue.length === 0 ? (
              <div className="empty-state">
                <CalendarDays />
                <p>Nothing scheduled this week.</p>
              </div>
            ) : (
              <ul className="gc-list">
                {overdue.map((d) => (
                  <li key={'o' + d.path}>
                    <button className="gc-list-row" onClick={() => setState({ peek: d.path })}>
                      <CheckSquare className="gc-list-icon" />
                      <span className="gc-list-title">{d.title}</span>
                      <span className="pill pill-sq tone-red">overdue</span>
                    </button>
                  </li>
                ))}
                {upcoming.map(({ d, span }) => (
                  <li key={d.path}>
                    <button
                      className="gc-list-row"
                      onClick={() => (d.kind === 'card' ? setState({ peek: d.path }) : navigate({ name: 'doc', path: d.path }))}
                    >
                      {d.kind === 'card' ? <CheckSquare className="gc-list-icon" /> : <FlaskConical className="gc-list-icon" />}
                      <span className="gc-list-title">{d.title}</span>
                      <span className="gc-list-when">
                        {span.start <= today
                          ? 'Today'
                          : new Date(span.start + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gc-panel">
            <header className="gc-panel-head">
              <h2>Protocols</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'protocols' })}>
                {plural(protocols.length, 'protocol')} <ArrowRight />
              </button>
            </header>
            {protocols.length === 0 ? (
              <div className="empty-state">
                <BookOpen />
                <p>Write your lab’s methods once and link them from every entry that uses them.</p>
                <div className="gc-empty-actions">
                  <button className="btn" onClick={() => openNewProtocolDialog()}>
                    <Plus /> New protocol
                  </button>
                  <button className="btn btn-ghost" onClick={() => void pickAndImportPdfs()}>
                    <FileUp /> Import PDF
                  </button>
                </div>
              </div>
            ) : (
              <ul className="gc-list">
                {topProtocols.map((d) => {
                  const used = protocolUse.get(d.path) ?? 0;
                  return (
                    <li key={d.path}>
                      <button className="gc-list-row" onClick={() => navigate({ name: 'doc', path: d.path })}>
                        <span className="id-chip">{d.id}</span>
                        <span className="gc-list-title">{d.title}</span>
                        {d.version && <span className="gc-list-sub mono">v{d.version}</span>}
                        <span className="gc-list-when">{used ? `linked ${used}×` : 'not linked yet'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="gc-home-section">
          <header className="gc-section-title">
            <h2>Start from a template</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'templates' })}>
              {plural(templates.length, 'template')} · {plural(subtemplates, 'sub-template')} <ArrowRight />
            </button>
          </header>
          <div className="gc-template-cards">
            {templates.slice(0, 6).map((t) => (
              <button key={t.path} className="gc-template-card" onClick={() => openNewEntryDialog({ templatePath: t.path })}>
                <LayoutTemplate className="gc-template-card-icon" />
                <strong>{t.title}</strong>
                {t.description && <small>{t.description}</small>}
                {(t.includes?.length ?? 0) > 0 && (
                  <span className="gc-template-uses">
                    <Puzzle /> {plural(t.includes!.length, 'sub-template')}
                  </span>
                )}
              </button>
            ))}
            <button className="gc-template-card is-new" onClick={() => navigate({ name: 'templates' })}>
              <Plus className="gc-template-card-icon" />
              <strong>Manage templates</strong>
              <small>Create templates and reusable sub-templates for the work you repeat.</small>
            </button>
          </div>
        </section>

        <footer className="gc-home-foot">
          <Logo size={18} />
          <span>
            {ABOUT.name} · created by <strong>{ABOUT.author}</strong>
          </span>
        </footer>
      </div>
    </div>
  );
}
