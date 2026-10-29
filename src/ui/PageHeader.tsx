/**
 * The head of every page that lists things (protocols, notes, papers, boards, the calendar…), laid out
 * one way everywhere, like Notion: the title, one line on what the page holds, then a bar with the
 * page's views on the left and its tools on the right, ending with the page's own New button.
 */
import type { ReactNode } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { MenuButton, type MenuItemSpec } from './overlay';
import { NavToggle } from './nav';
import { setState } from '../notebook/store';

/** Phones only: the menu button (the sidebar is a drawer there), search, and the page's own actions. */
export function PhoneBar({ children }: { children?: ReactNode }) {
  return (
    <div className="gc-topbar gc-phonebar gc-mobile-only">
      <NavToggle />
      <span className="spacer" />
      <button className="icon-btn" aria-label="Search" onClick={() => setState({ paletteOpen: true })}>
        <Search />
      </button>
      {children}
    </div>
  );
}

export function PageHead({ title, lede, above }: { title: ReactNode; lede?: ReactNode; above?: ReactNode }) {
  return (
    <header className="gc-page-head">
      {above}
      <h1 className="gc-page-title">{title}</h1>
      {lede && <p className="gc-lede">{lede}</p>}
    </header>
  );
}

/** A search box that narrows the page's list as you type. */
export function FilterField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="gc-filter">
      <Search />
      <input value={value} placeholder={placeholder} aria-label={placeholder.replace(/…$/, '')} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Views and filters on the left, tools and New on the right. */
export function ViewBar({ children, tools }: { children?: ReactNode; tools?: ReactNode }) {
  return (
    <div className="gc-viewbar">
      <div className="gc-viewbar-views">{children}</div>
      {tools && <div className="gc-viewbar-tools">{tools}</div>}
    </div>
  );
}

export interface ViewTab<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/** Notion-style view tabs: List, Board, Month… */
export function ViewTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ViewTab<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="gc-viewtabs" role="group" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} className={`gc-viewtab ${value === t.id ? 'active' : ''}`} aria-pressed={value === t.id} onClick={() => onChange(t.id)}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's one New button. It says only "New": on the Protocols page it is a new protocol, and its
 * name for screen readers and its tooltip say so. `more` lists the other things the page can add.
 */
export function NewButton({ what, onClick, more }: { what: string; onClick: () => void; more?: MenuItemSpec[] }) {
  return (
    <span className={`gc-new ${more ? 'has-more' : ''}`}>
      <button className="btn btn-primary btn-sm gc-new-main" aria-label={`New ${what}`} title={`New ${what}`} onClick={onClick}>
        <Plus /> New
      </button>
      {more && (
        <MenuButton className="btn btn-primary btn-sm gc-new-more" title="More to add" items={more}>
          <ChevronDown />
        </MenuButton>
      )}
    </span>
  );
}
