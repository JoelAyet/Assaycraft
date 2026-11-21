import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { BookOpen, FlaskConical, NotebookPen, Plus } from 'lucide-react';
import { navigate, setState, toast } from '../notebook/store';
import { useDocsBesidesSaves } from '../notebook/useDocs';
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
export const DocIndex = memo(
  function DocIndex({ editor, meta }: { editor: Editor | null; meta: DocMeta }) {
    return <Index editor={editor} path={meta.path} />;
  },
  (a, b) => a.editor === b.editor && a.meta.path === b.meta.path,
);

/** The same headings, as far as the index shows them (where each one is changes as you type above it). */
const sameOutline = (a: Heading[], b: Heading[]) => a.length === b.length && a.every((h, i) => h.level === b[i].level && h.text === b[i].text);

function Index({ editor, path }: { editor: Editor | null; path: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const shown = useRef<Heading[]>([]);
  // Saving this page (at every pause in typing) changes nothing the index shows.
  const docs = useDocsBesidesSaves(path);
  const recent = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => RECENT_KINDS[d.kind] && d.path !== path)
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 4),
    [docs, path],
  );
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (editor.isDestroyed) return;
        const next = headingsOf(editor);
        // Compared here: even a state update that changes nothing draws the index again.
        if (sameOutline(shown.current, next)) return;
        shown.current = next;
        setHeadings(next);
      }, 250);
    };
    shown.current = headingsOf(editor);
    setHeadings(shown.current);
    editor.on('update', update);
    return () => {
      clearTimeout(t);
      editor.off('update', update);
    };
  }, [editor]);

  const jump = (i: number) => {
    // Where the heading is now: typing above it since the index was drawn has moved it.
    const h = editor && headingsOf(editor)[i];
    if (!editor || !h) return;
    const dom = editor.view.nodeDOM(h.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(h.pos + 1))));
  };

  const top = Math.min(...headings.map((h) => h.level));
  return (
    <nav className="gc-doc-index" aria-label="Index of this page">
      {/* One tick per heading, as a hint of what is there. */}
      <div className="gc-doc-index-ticks" aria-hidden="true">
        {headings.slice(0, 24).map((h, i) => (
          <span key={i} className={`gc-doc-index-tick lvl-${h.level - top}`} />
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
            {headings.map((h, i) => (
              <button key={i} className={`gc-doc-index-item lvl-${Math.min(2, h.level - top)}`} onClick={() => jump(i)}>
                <span className="gc-doc-index-text">{h.text}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}
