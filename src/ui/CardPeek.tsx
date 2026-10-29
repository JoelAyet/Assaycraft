import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Maximize2, MoreHorizontal, X } from 'lucide-react';
import { navigate, setState, useNotebook } from '../notebook/store';
import { readDoc } from '../notebook/actions';
import { DocEditor } from '../editor/DocEditor';
import { useMarqueeSelect } from '../editor/blockSelect';
import { Breadcrumbs, DocHeader, docMenu } from './DocPage';
import { MenuButton } from './overlay';

function PeekPanel({ path }: { path: string }) {
  const meta = useNotebook((s) => s.docs[path]);
  const [body, setBody] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useMarqueeSelect(meta?.locked ? null : editor, scrollEl);
  const close = () => setState({ peek: null });

  useEffect(() => {
    let cancelled = false;
    void readDoc(path).then(({ body: b }) => !cancelled && setBody(b));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.dialog-backdrop, .popover')) return;
      const t = e.target as HTMLElement;
      if (t.closest('.gc-sheet')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!meta) return null;
  return (
    <div
      className="gc-peek-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside className="gc-peek" role="dialog" aria-label={meta.title}>
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
          <button className="icon-btn" title="Close (Esc)" onClick={close}>
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
    </div>
  );
}

export function CardPeek() {
  const peek = useNotebook((s) => s.peek);
  const key = useNotebook((s) => (s.peek ? (s.docKeys[s.peek] ?? s.peek) : null));
  if (!peek || !key) return null;
  return <PeekPanel key={key} path={peek} />;
}
