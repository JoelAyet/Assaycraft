import { useMemo } from 'react';
import { FilePlus2, LayoutTemplate, MoreHorizontal, Pencil, Plus, Puzzle, Trash2 } from 'lucide-react';
import { navigate, useNotebook } from '../notebook/store';
import { trashDoc } from '../notebook/actions';
import type { DocMeta } from '../notebook/model';
import { openNewEntryDialog } from './NewEntryDialog';
import { MenuButton, confirmDialog, type MenuItemSpec } from './overlay';
import { TemplatesHowTo, openNewTemplateDialog } from './templateHelp';
import { TagPill } from './status';
import { formatRelative } from '../lib/dates';
import { NavToggle } from './nav';

function TemplateCard({ t, usedBy }: { t: DocMeta; usedBy: DocMeta[] }) {
  const docs = useNotebook((s) => s.docs);
  const uses = (t.includes ?? []).map((id) => Object.values(docs).find((d) => d.id === id)?.title).filter(Boolean) as string[];
  const menu: MenuItemSpec[] = [
    { label: 'Edit', icon: <Pencil />, onSelect: () => navigate({ name: 'doc', path: t.path }) },
    ...(t.kind === 'template'
      ? [{ label: 'New entry from template', icon: <FilePlus2 />, onSelect: () => openNewEntryDialog({ templatePath: t.path }) }]
      : []),
    'sep',
    {
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        void confirmDialog({
          title: 'Delete template?',
          message: usedBy.length
            ? `“${t.title}” is used by ${usedBy.map((u) => u.title).join(', ')}. Those templates will show a missing sub-template.`
            : `“${t.title}” will be moved to the trash, where you can restore it.`,
          confirmLabel: 'Move to trash',
          danger: true,
        }).then((ok) => {
          if (ok) void trashDoc(t.path);
        }),
    },
  ];
  return (
    <div className={`gc-tpl-card ${t.kind === 'template' ? 'has-use' : ''}`} onClick={() => navigate({ name: 'doc', path: t.path })}>
      <div className="gc-tpl-card-head">
        {t.kind === 'template' ? <LayoutTemplate className="gc-tpl-icon" /> : <Puzzle className="gc-tpl-icon is-sub" />}
        <h3>{t.title}</h3>
        <span onClick={(e) => e.stopPropagation()}>
          <MenuButton items={menu} className="icon-btn icon-btn-sm" title="Template options">
            <MoreHorizontal />
          </MenuButton>
        </span>
      </div>
      {t.description && <p className="gc-tpl-desc">{t.description}</p>}
      <div className="gc-tpl-meta">
        {t.tags.map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        {uses.length > 0 && (
          <span className="gc-tpl-uses" title={uses.join(', ')}>
            <Puzzle /> {uses.length} sub-template{uses.length > 1 ? 's' : ''}
          </span>
        )}
        {t.kind === 'subtemplate' && <span className="gc-tpl-uses">{usedBy.length ? `used by ${usedBy.length}` : 'not used yet'}</span>}
        <span className="muted gc-tpl-when">edited {formatRelative(t.modified)}</span>
      </div>
      {t.kind === 'template' && (
        <button
          className="btn btn-sm gc-tpl-use"
          onClick={(e) => {
            e.stopPropagation();
            openNewEntryDialog({ templatePath: t.path });
          }}
        >
          <FilePlus2 /> Use
        </button>
      )}
    </div>
  );
}

export function TemplatesPage() {
  const docs = useNotebook((s) => s.docs);
  const all = useMemo(() => Object.values(docs), [docs]);
  const templates = all.filter((d) => d.kind === 'template').sort((a, b) => a.title.localeCompare(b.title));
  const subs = all.filter((d) => d.kind === 'subtemplate').sort((a, b) => a.title.localeCompare(b.title));
  const usedBy = (t: DocMeta) => all.filter((d) => (d.kind === 'template' || d.kind === 'subtemplate') && t.id && d.includes?.includes(t.id));
  const create = (kind: 'template' | 'subtemplate') => openNewTemplateDialog(kind);
  return (
    <div className="gc-page gc-templates-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <LayoutTemplate />
        </span>
        <span className="gc-topbar-title">Templates</span>
        <span className="spacer" />
        <button className="btn btn-sm" aria-label="New sub-template" onClick={() => create('subtemplate')}>
          <Puzzle /> <span className="gc-btn-label">New sub-template</span>
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => create('template')}>
          <Plus /> New template
        </button>
      </div>
      <div className="gc-templates-inner">
        <header className="gc-page-head">
          <h1 className="gc-page-title">Templates</h1>
          <p className="gc-lede">Ready-made entries for the experiments you repeat, so each new one starts filled in.</p>
        </header>
        <TemplatesHowTo />
        <h2 className="gc-h2">
          Entry templates <span className="muted">{templates.length}</span>
        </h2>
        <div className="gc-tpl-grid">
          {templates.map((t) => (
            <TemplateCard key={t.path} t={t} usedBy={[]} />
          ))}
          <button className="gc-tpl-card is-new" onClick={() => create('template')}>
            <Plus /> New template
          </button>
        </div>
        <h2 className="gc-h2">
          Sub-templates <span className="muted">{subs.length}</span>
        </h2>
        <div className="gc-tpl-grid">
          {subs.map((t) => (
            <TemplateCard key={t.path} t={t} usedBy={usedBy(t)} />
          ))}
          <button className="gc-tpl-card is-new" onClick={() => create('subtemplate')}>
            <Plus /> New sub-template
          </button>
        </div>
      </div>
    </div>
  );
}
