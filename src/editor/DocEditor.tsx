import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import { useEffect, useMemo, useRef } from 'react';
import { schemaExtensions } from './schema';
import { SlashCommands, SlashMenuHost } from './slash';
import { Toolbar } from './Toolbar';
import { DocContext, type DocContextValue } from './context';
import { AttachmentView, ImageView, IncludeView, RawView } from './views';
import { SheetView } from '../sheet/SheetView';
import { BufferView } from '../buffer/BufferView';
import { PlateView } from '../plate/PlateView';
import { FlowView } from '../flow/FlowView';
import { blockCommands, type InsertHandlers } from './commands';
import { insertFiles } from './upload';
import { parseMarkdown } from '../markdown/parse';
import { serializeMarkdown } from '../markdown/serialize';
import { parseDelimited } from '../sheet/tsv';
import { normalizeSheet } from '../sheet/model';
import { dirname, extname, isRelativeFileLink, resolveLink, splitFragment, stem } from '../lib/path';
import { pickFiles } from '../lib/download';
import { readDoc, registerOpenDoc, saveBody, setLoadedBody, takeQuietReload, touchDoc } from '../notebook/actions';
import { getState, navigate, toast, useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';
import { openCitePicker, openEntryLinkPicker, openSubtemplatePicker } from '../ui/pickers';
import { openProtocolPicker } from '../ui/protocols';
import { openStockPicker, stockLinkTarget } from '../stocks/StockPicker';
import { trackEditorFocus } from './insertion';
import { VariableHighlight } from './variables';
import { ReminderView } from '../reminders/ReminderView';
import { ListIndent } from './keys';
import { BlockSelect } from './blockSelect';
import { DateHeading } from './dateHeading';

const stopAllButDrag = ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop';

function buildExtensions(placeholder: string, commands: () => ReturnType<typeof blockCommands>) {
  return [
    ...schemaExtensions({
      spreadsheet: () => ReactNodeViewRenderer(SheetView, { stopEvent: stopAllButDrag }),
      buffer: () => ReactNodeViewRenderer(BufferView, { stopEvent: stopAllButDrag }),
      plate: () => ReactNodeViewRenderer(PlateView, { stopEvent: stopAllButDrag }),
      flow: () => ReactNodeViewRenderer(FlowView, { stopEvent: stopAllButDrag }),
      attachment: () => ReactNodeViewRenderer(AttachmentView),
      image: () => ReactNodeViewRenderer(ImageView),
      include: () => ReactNodeViewRenderer(IncludeView),
      rawBlock: () => ReactNodeViewRenderer(RawView),
      reminder: () => ReactNodeViewRenderer(ReminderView, { as: 'span' }),
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? `Heading ${node.attrs.level}` : placeholder),
      includeChildren: false,
    }),
    SlashCommands.configure({ commands }),
    VariableHighlight,
    ListIndent,
    BlockSelect,
    DateHeading,
  ];
}

/** Follow a link inside the editor: notebook entries open in Assaycraft, URLs in a new tab. */
function openLink(href: string, folder: string) {
  if (isRelativeFileLink(href)) {
    const [file, fragment] = splitFragment(href);
    const target = resolveLink(folder, file);
    const docs = getState().docs;
    // A stock: its collection's table, with that stock picked out.
    const stock = /(^|\/)Stocks\/[^/]+\.md$/.test(target) || docs[target]?.kind === 'stocks' ? stockLinkTarget(target, fragment, docs) : null;
    if (stock) return navigate({ name: 'stocks', ...stock });
    if (docs[target]) return navigate({ name: 'doc', path: target });
    if (extname(target) === '.md') {
      // Renamed since the link was made? Docs are saved as "<id> <title>.md", so look the id up.
      const id = stem(target).split(' ')[0];
      const byId = id && Object.values(docs).find((d) => d.id === id && d.kind !== 'board');
      if (byId) return navigate({ name: 'doc', path: byId.path });
      return toast('That page could not be found (it may have been deleted).', 'error');
    }
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

export interface DocEditorProps {
  path: string;
  meta: DocMeta;
  initialBody: string;
  readOnly: boolean;
  placeholder?: string;
  compact?: boolean;
  onEditor?: (editor: Editor | null) => void;
}

export function DocEditor({ path, meta, initialBody, readOnly, placeholder, compact, onEditor }: DocEditorProps) {
  const vault = useNotebook((s) => s.vault)!;
  const pathRef = useRef(path);
  pathRef.current = path;
  const folder = dirname(path);
  const ctx = useMemo<DocContextValue>(
    () => ({ vault, path, folder, docId: meta.id || stem(path), kind: meta.kind, readOnly }),
    [vault, path, folder, meta.id, meta.kind, readOnly],
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const editorRef = useRef<Editor | null>(null);
  const inTemplate = meta.kind === 'template' || meta.kind === 'subtemplate';

  const handlers = useMemo<InsertHandlers>(
    () => ({
      attachFiles: (accept) => {
        void pickFiles({ accept }).then((files) => {
          const ed = editorRef.current;
          if (ed && files.length) void insertFiles(ed, files, ctxRef.current);
        });
      },
      insertSubtemplate: () => editorRef.current && openSubtemplatePicker(editorRef.current, ctxRef.current),
      insertProtocol: () => editorRef.current && openProtocolPicker(editorRef.current, ctxRef.current),
      linkEntry: () => editorRef.current && openEntryLinkPicker(editorRef.current, ctxRef.current),
      linkStock: () => editorRef.current && openStockPicker(editorRef.current, ctxRef.current),
      cite: () => editorRef.current && openCitePicker(editorRef.current, ctxRef.current),
    }),
    [],
  );

  const extensions = useMemo(
    () =>
      buildExtensions(
        placeholder ??
          (inTemplate
            ? "Write the template. Use {{Variable}} for values to fill in, '/' for blocks…"
            : meta.kind === 'protocol'
              ? "Write the protocol: purpose, materials, numbered steps… Type '/' for tables and files."
              : meta.kind === 'reference'
                ? 'Your reading notes: key findings, methods worth trying, figures to remember…'
                : "Write, or type '/' for tables, files, sequences, protocols…"),
        () => blockCommands(handlers, { inTemplate }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialContent = useMemo(() => parseMarkdown(initialBody).toJSON(), [initialBody]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: `gc-prose ${compact ? 'is-compact' : ''}`, spellcheck: 'true' },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(editorRef.current, files, ctxRef.current, pos);
        return true;
      },
      handlePaste: (view, event) => {
        const cd = event.clipboardData;
        if (!cd || !view.editable || !editorRef.current) return false;
        const html = cd.getData('text/html');
        const text = cd.getData('text/plain');
        const files = Array.from(cd.files ?? []);
        if (files.length && !/<table/i.test(html)) {
          event.preventDefault();
          void insertFiles(editorRef.current, files, ctxRef.current);
          return true;
        }
        if (!html && text.includes('\t') && text.trim().includes('\n')) {
          const rows = parseDelimited(text);
          if (rows.length > 1 && rows[0].length > 1) {
            editorRef.current
              .chain()
              .focus()
              .insertContent({ type: 'spreadsheet', attrs: { data: normalizeSheet({ rows }) } })
              .run();
            return true;
          }
        }
        return false;
      },
      handleClick: (view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a');
        if (!a || !view.dom.contains(a) || a.closest('[data-node-view-wrapper]')) return false;
        const href = a.getAttribute('href');
        if (!href) return false;
        // Links to a stock or a paper open with a plain click (other links need Ctrl/⌘ while editing, so the text can be edited).
        const stock = isRelativeFileLink(href) && /(^|\/)(Stocks|Literature)\//.test(href);
        if (!view.editable || event.metaKey || event.ctrlKey || stock) {
          event.preventDefault();
          openLink(href, ctxRef.current.folder);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) touchDoc(pathRef.current);
    },
  });
  editorRef.current = editor;

  // The normalized form of what was loaded: saving skips the write while nothing differs from it,
  // so opening a file never rewrites it.
  const loadedBody = useMemo(() => serializeMarkdown(parseMarkdown(initialBody)), [initialBody]);

  useEffect(() => {
    onEditor?.(editor);
    const untrack = editor ? trackEditorFocus(editor) : undefined;
    return () => {
      untrack?.();
      onEditor?.(null);
    };
  }, [editor, onEditor]);

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    return registerOpenDoc(
      path,
      () => serializeMarkdown(editor.state.doc),
      () => {
        void readDoc(pathRef.current).then(({ body }) => {
          if (editor.isDestroyed) return;
          editor.commands.setContent(parseMarkdown(body).toJSON(), { emitUpdate: false });
          setLoadedBody(pathRef.current, serializeMarkdown(editor.state.doc));
          if (!takeQuietReload(pathRef.current)) toast('Reloaded changes made outside Assaycraft');
        });
      },
      loadedBody,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path]);

  // Save immediately when leaving the doc, so no edit waits on a timer after the editor is gone.
  useEffect(
    () => () => {
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed) void saveBody(pathRef.current, serializeMarkdown(ed.state.doc));
    },
    [],
  );

  if (!editor) return null;
  return (
    <DocContext.Provider value={ctx}>
      {!readOnly && (
        <div className={`gc-toolbar-wrap ${compact ? 'is-compact' : ''}`}>
          <Toolbar editor={editor} handlers={handlers} inTemplate={inTemplate} />
        </div>
      )}
      <EditorContent editor={editor} className="gc-editor" />
      <SlashMenuHost />
    </DocContext.Provider>
  );
}
