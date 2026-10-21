/** Phones: the sidebar is a drawer, opened from the ☰ button at the start of each page's top bar. */
import { Menu } from 'lucide-react';
import { setState, useNotebook } from '../notebook/store';

export function NavToggle() {
  const open = useNotebook((s) => s.navOpen);
  return (
    <button className="icon-btn gc-nav-toggle" aria-label="Open the menu" aria-expanded={open} onClick={() => setState({ navOpen: true })}>
      <Menu />
    </button>
  );
}
