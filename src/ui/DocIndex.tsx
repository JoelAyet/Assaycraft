import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { navigate, useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';

interface Heading {
  pos: number;
  level: number;
  text: string;
}

/** The page's headings (day headings from /day among them), for the index. */
function headingsOf(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) out.push({ pos, level: node.attrs.level as number, text: node.textContent.trim() });
    // Headings are not nested in other blocks: no need to look inside.
    return node.type.name === 'doc';
  });
  return out;
}

/**
 * On a computer, hovering the right edge of a page shows its index: recent entries to jump to,
 * then the page's headings and days.
 */
export function DocIndex({ editor, meta }: { editor: Editor | null; meta: DocMeta }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const docs = useNotebook((s) => s.docs);
  const recent = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'entry' && d.path !== meta.path)
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 4),
    [docs, meta.path],
  );
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => !editor.isDestroyed && setHeadings(headingsOf(editor)), 250);
    };
    setHeadings(headingsOf(editor));
    editor.on('update', update);
    return () => {
      clearTimeout(t);
      editor.off('update', update);
    };
  }, [editor]);

  const jump = (h: Heading) => {
    if (!editor) return;
    const dom = editor.view.nodeDOM(h.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(h.pos + 1))));
  };

  if (!headings.length && !recent.length) return null;
  const top = Math.min(...headings.map((h) => h.level));
  return (
    <nav className="gc-doc-index" aria-label="Index of this page">
      {/* One tick per heading, as a hint of what is there. */}
      <div className="gc-doc-index-ticks" aria-hidden="true">
        {headings.slice(0, 24).map((h) => (
          <span key={h.pos} className={`gc-doc-index-tick lvl-${h.level - top}`} />
        ))}
        {!headings.length && <span className="gc-doc-index-tick" />}
      </div>
      <div className="gc-doc-index-panel">
        {recent.length > 0 && (
          <>
            <div className="gc-doc-index-label">Recent entries</div>
            {recent.map((d) => (
              <button key={d.path} className="gc-doc-index-item is-recent" onClick={() => navigate({ name: 'doc', path: d.path })}>
                {d.id && <span className="gc-doc-index-id">{d.id}</span>}
                <span className="gc-doc-index-text">{d.title}</span>
              </button>
            ))}
          </>
        )}
        {headings.length > 0 && (
          <>
            <div className="gc-doc-index-label">In this page</div>
            {headings.map((h) => (
              <button key={h.pos} className={`gc-doc-index-item lvl-${Math.min(2, h.level - top)}`} onClick={() => jump(h)}>
                <span className="gc-doc-index-text">{h.text}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}
