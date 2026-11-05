import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Maximize2, MoreHorizontal, X } from 'lucide-react';
import { navigate, setState, useNotebook } from '../notebook/store';
import { readDoc } from '../notebook/actions';
import { DocEditor } from '../editor/DocEditor';
import { useMarqueeSelect } from '../editor/blockSelect';
import { Breadcrumbs, DocHeader, docMenu } from './DocPage';
import { MenuButton } from './overlay';

/**
 * A doc beside the page: over it (a task, a protocol to read; a click outside closes it), or docked
 * in the right half (a note taken while working on an entry: both stay in use).
 */
function PeekPanel({ path, split }: { path: string; split: boolean }) {
  const meta = useNotebook((s) => s.docs[path]);
  const [body, setBody] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useMarqueeSelect(meta?.locked ? null : editor, scrollEl);
  const close = () => setState({ peek: null, peekSplit: null });

  useEffect(() => {
    let cancelled = false;
    void readDoc(path).then(({ body: b }) => !cancelled && setBody(b));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Docked, Escape is the editors' (closing a menu, leaving a table): the panel has its close button.
    if (split) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.dialog-backdrop, .popover')) return;
      const t = e.target as HTMLElement;
      if (t.closest('.gc-sheet')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [split]);

  if (!meta) return null;
  const panel = (
    <aside className={`gc-peek${split ? ' is-split' : ''}`} role={split ? 'complementary' : 'dialog'} aria-label={meta.title}>
      <div className="gc-peek-top">
        <Breadcrumbs meta={meta} />
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Open as page"
          onClick={() => {
            close();
            navigate({ name: 'doc', path });
          }}
        >
          <Maximize2 />
        </button>
        <MenuButton items={() => docMenu(meta, editor)} title="More actions">
          <MoreHorizontal />
        </MenuButton>
        <button className="icon-btn" title={split ? 'Close the side panel' : 'Close (Esc)'} aria-label="Close the side panel" onClick={close}>
          <X />
        </button>
      </div>
      <div className="gc-peek-scroll" ref={setScrollEl}>
        <div className="gc-doc gc-doc-peek">
          <DocHeader meta={meta} readOnly={!!meta.locked} compact />
          {body !== null && (
            <DocEditor
              path={path}
              meta={meta}
              initialBody={body}
              readOnly={!!meta.locked}
              compact
              onEditor={setEditor}
              placeholder="Add notes, a checklist, files… Type '/' for blocks."
            />
          )}
        </div>
      </div>
    </aside>
  );
  if (split) return panel;
  return (
    <div
      className="gc-peek-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {panel}
    </div>
  );
}

export function CardPeek() {
  const peek = useNotebook((s) => s.peek);
  const split = useNotebook((s) => !!s.peek && s.peek === s.peekSplit);
  const key = useNotebook((s) => (s.peek ? (s.docKeys[s.peek] ?? s.peek) : null));
  if (!peek || !key) return null;
  return <PeekPanel key={`${key}${split ? ':split' : ''}`} path={peek} split={split} />;
}
