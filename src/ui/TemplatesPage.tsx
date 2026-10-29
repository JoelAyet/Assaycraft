import { useMemo, useState } from 'react';
import { Blocks, FilePlus2, HelpCircle, LayoutTemplate, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { navigate, useNotebook } from '../notebook/store';
import { trashDoc } from '../notebook/actions';
import type { DocMeta } from '../notebook/model';
import { openNewEntryDialog } from './NewEntryDialog';
import { MenuButton, confirmDialog, type MenuItemSpec } from './overlay';
import { TemplatesHowTo, openNewTemplateDialog, type Kind } from './templateHelp';
import { TagPill } from './status';
import { formatRelative } from '../lib/dates';
import { NewButton, PageHead, PhoneBar, ViewBar, ViewTabs } from './PageHeader';

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
        {t.kind === 'template' ? <LayoutTemplate className="gc-tpl-icon" /> : <Blocks className="gc-tpl-icon is-sub" />}
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
            <Blocks /> {uses.length} sub-template{uses.length > 1 ? 's' : ''}
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

const HELP_KEY = 'assaycraft:templatesHelp';
const TAB_KEY = 'assaycraft:templatesTab';
const remembered = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

export function TemplatesPage() {
  const docs = useNotebook((s) => s.docs);
  const all = useMemo(() => Object.values(docs), [docs]);
  const templates = all.filter((d) => d.kind === 'template').sort((a, b) => a.title.localeCompare(b.title));
  const subs = all.filter((d) => d.kind === 'subtemplate').sort((a, b) => a.title.localeCompare(b.title));
  const usedBy = (t: DocMeta) => all.filter((d) => (d.kind === 'template' || d.kind === 'subtemplate') && t.id && d.includes?.includes(t.id));
  const [tab, setTab] = useState<Kind>(() => (remembered(TAB_KEY, 'template') === 'subtemplate' ? 'subtemplate' : 'template'));
  // The guide shows until it is closed once.
  const [help, setHelp] = useState(() => remembered(HELP_KEY, 'open') === 'open');
  const toggleHelp = (open: boolean) => {
    setHelp(open);
    remember(HELP_KEY, open ? 'open' : 'closed');
  };
  const shown = tab === 'template' ? templates : subs;
  return (
    <div className="gc-page gc-templates-page">
      <PhoneBar />
      <div className="gc-page-inner">
        <PageHead title="Templates" lede="Ready-made entries for the experiments you repeat, and sub-templates: the blocks they share." />
        <ViewBar
          tools={
            <>
              <button className={`btn btn-sm btn-ghost ${help ? 'active' : ''}`} aria-pressed={help} onClick={() => toggleHelp(!help)}>
                <HelpCircle /> How it works
              </button>
              <NewButton what={tab === 'template' ? 'template' : 'sub-template'} onClick={() => openNewTemplateDialog(tab)} />
            </>
          }
        >
          <ViewTabs
            label="Kind"
            value={tab}
            onChange={(t) => {
              setTab(t);
              remember(TAB_KEY, t);
            }}
            tabs={[
              { id: 'template', label: 'Entry templates', icon: <LayoutTemplate /> },
              { id: 'subtemplate', label: 'Sub-templates', icon: <Blocks /> },
            ]}
          />
        </ViewBar>
        {help && <TemplatesHowTo onClose={() => toggleHelp(false)} />}
        {shown.length ? (
          <div className="gc-tpl-grid">
            {shown.map((t) => (
              <TemplateCard key={t.path} t={t} usedBy={tab === 'subtemplate' ? usedBy(t) : []} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {tab === 'template' ? <LayoutTemplate /> : <Blocks />}
            <h3>{tab === 'template' ? 'No templates yet' : 'No sub-templates yet'}</h3>
          </div>
        )}
      </div>
    </div>
  );
}
