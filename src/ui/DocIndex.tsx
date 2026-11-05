import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { BookOpen, FlaskConical, NotebookPen, Plus } from 'lucide-react';
import { navigate, setState, toast, useNotebook } from '../notebook/store';
import { createNote } from '../notebook/actions';
import type { DocKind, DocMeta } from '../notebook/model';

/** The pages listed as recent beside an entry, with their icons. */
const RECENT_KINDS: Partial<Record<DocKind, typeof FlaskConical>> = { entry: FlaskConical, note: NotebookPen, protocol: BookOpen };

/** A new note, docked beside the page you are on (in Notes, like any other). */
export async function newNoteBeside() {
  try {
    const path = await createNote({ open: false });
    setState({ peek: path, peekSplit: path });
  } catch (err) {
    toast(`Could not make a note: ${(err as Error).message}`, 'error');
  }
}

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
 * On a computer, hovering the right edge of a page shows its index: a new note beside it, recent
 * experiments, notes and protocols to jump to, then the page's headings and days.
 */
export function DocIndex({ editor, meta }: { editor: Editor | null; meta: DocMeta }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const docs = useNotebook((s) => s.docs);
  const recent = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => RECENT_KINDS[d.kind] && d.path !== meta.path)
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
        <button
          className="gc-doc-index-item gc-doc-index-new"
          title="A new note in Notes, open beside this page"
          onClick={() => void newNoteBeside()}
        >
          <Plus aria-hidden="true" />
          <span className="gc-doc-index-text">New note</span>
        </button>
        {recent.length > 0 && (
          <>
            <div className="gc-doc-index-label">Recent</div>
            {recent.map((d) => {
              const Icon = RECENT_KINDS[d.kind]!;
              return (
                <button key={d.path} className="gc-doc-index-item is-recent" onClick={() => navigate({ name: 'doc', path: d.path })}>
                  <Icon className="gc-doc-index-icon" aria-hidden="true" />
                  {d.id && <span className="gc-doc-index-id">{d.id}</span>}
                  <span className="gc-doc-index-text">{d.title}</span>
                </button>
              );
            })}
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
