import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import {
  Baseline,
  Bold,
  CheckSquare,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
  Paperclip,
  Dna,
  Blocks,
} from 'lucide-react';
import { Popover, usePopover, MenuList, type MenuItemSpec } from '../ui/overlay';
import { blockCommands, insertTable, type InsertHandlers } from './commands';
import { SEQUENCE_EXTENSIONS } from '../bio/detect';
import { tip } from '../ui/Tooltip';
import { isRelativeFileLink, safeDecode } from '../lib/path';
import { HIGHLIGHT_COLORS, TEXT_COLORS, type HighlightColor, type TextSize } from './schema';

const SIZE_LABEL: Record<TextSize | 'normal', string> = { small: 'Small', normal: 'Normal', large: 'Large', huge: 'Huge' };

/** The highlight color last picked: the highlight button uses it, as in Word or Google Docs. */
const HIGHLIGHT_KEY = 'assaycraft:highlight';
function lastHighlight(): HighlightColor {
  try {
    const v = localStorage.getItem(HIGHLIGHT_KEY) as HighlightColor | null;
    return v && (HIGHLIGHT_COLORS as readonly string[]).includes(v) ? v : 'yellow';
  } catch {
    return 'yellow';
  }
}
const setMarkColor = (h: HighlightColor) => ({ color: h === 'yellow' ? null : h });

/**
 * Highlight: the button marks the selected text in the last color picked (or takes the highlight
 * away); the arrow beside it picks another color.
 */
function HighlightButton({ editor }: { editor: Editor }) {
  const p = usePopover<HTMLButtonElement>();
  const [last, setLast] = useState(lastHighlight);
  const cur = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive('highlight') ? ((e.getAttributes('highlight').color as HighlightColor | null) ?? 'yellow') : null),
  });
  const pick = (h: HighlightColor | null) => {
    if (h) {
      setLast(h);
      try {
        localStorage.setItem(HIGHLIGHT_KEY, h);
      } catch {
        /* ignore */
      }
      editor.chain().focus().setMark('highlight', setMarkColor(h)).run();
    } else editor.chain().focus().unsetMark('highlight').run();
  };
  return (
    <span className={`gc-tb-split ${cur ? 'active' : ''}`}>
      <button
        className={`icon-btn gc-ink-btn ${cur ? 'active' : ''}`}
        {...tip('Highlight', `Mark text in ${last === 'gray' ? 'gray' : last}; the arrow picks another color`, 'Mod+Shift+H')}
        aria-pressed={!!cur}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (cur ? editor.chain().focus().unsetMark('highlight').run() : pick(last))}
      >
        <Highlighter />
        <span className="gc-ink-bar gc-hl-bar" data-color={last} />
      </button>
      <button
        ref={p.ref}
        className="icon-btn gc-tb-caret"
        {...tip('Highlight color', 'Pick the highlight color')}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
      >
        <ChevronDown />
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <div className="gc-ink-menu" onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}>
            <div className="gc-ink-label">Highlight</div>
            <div className="gc-ink-row">
              <button
                className={`gc-ink-swatch is-none ${!cur ? 'active' : ''}`}
                aria-label="No highlight"
                title="No highlight"
                onClick={() => {
                  pick(null);
                  p.close();
                }}
              >
                ab
              </button>
              {HIGHLIGHT_COLORS.map((h) => (
                <button
                  key={h}
                  className={`gc-ink-swatch ${cur === h ? 'active' : ''}`}
                  aria-label={`Highlight ${h}`}
                  title={`Highlight ${h}`}
                  onClick={() => {
                    pick(h);
                    p.close();
                  }}
                >
                  <mark data-color={h === 'yellow' ? undefined : h}>ab</mark>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </span>
  );
}

/** Text color and size, for the selected text (or what is typed next). */
function TextStyleButton({ editor }: { editor: Editor }) {
  const p = usePopover<HTMLButtonElement>();
  const cur = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      color: e.isActive('textColor') ? (e.getAttributes('textColor').color as string) : null,
      size: e.isActive('textSize') ? (e.getAttributes('textSize').size as TextSize) : 'normal',
    }),
  });
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => fn(editor.chain().focus()).run();
  return (
    <>
      <button
        ref={p.ref}
        className={`icon-btn gc-ink-btn ${cur.color || cur.size !== 'normal' ? 'active' : ''}`}
        {...tip('Text color and size', 'Color the text, or make it smaller or larger')}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
      >
        <Baseline />
        <span className="gc-ink-bar" data-color={cur.color ?? undefined} />
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <div className="gc-ink-menu" onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}>
            <div className="gc-ink-label">Text color</div>
            <div className="gc-ink-row">
              <button
                className={`gc-ink-swatch is-none ${!cur.color ? 'active' : ''}`}
                aria-label="Default text color"
                title="Default"
                onClick={() => run((c) => c.unsetMark('textColor'))}
              >
                A
              </button>
              {TEXT_COLORS.map((t) => (
                <button
                  key={t}
                  className={`gc-ink-swatch ${cur.color === t ? 'active' : ''}`}
                  aria-label={`Text ${t}`}
                  title={`Text ${t}`}
                  onClick={() => run((c) => c.setMark('textColor', { color: t }))}
                >
                  <span className="gc-ink" data-color={t}>
                    A
                  </span>
                </button>
              ))}
            </div>
            <div className="gc-ink-label">Size</div>
            <div className="gc-segmented gc-ink-sizes" role="group" aria-label="Text size">
              {(['small', 'normal', 'large', 'huge'] as const).map((z) => (
                <button
                  key={z}
                  className={cur.size === z ? 'active' : ''}
                  aria-pressed={cur.size === z}
                  onClick={() => run((c) => (z === 'normal' ? c.unsetMark('textSize') : c.setMark('textSize', { size: z })))}
                >
                  {SIZE_LABEL[z]}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const p = usePopover();
  const [href, setHref] = useState('');
  return (
    <>
      <button
        ref={p.ref}
        className={`icon-btn ${active ? 'active' : ''}`}
        {...tip('Link', 'Link to a web page, an entry or a file')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setHref((editor.getAttributes('link').href as string) ?? '');
          p.toggle();
        }}
      >
        <Link />
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <form
            className="gc-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              const url = href.trim();
              if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else {
                const typed = /^[a-z][a-z0-9+.-]*:|^[./#]|^\w[^:]*\.md$/i.test(url) ? url : `https://${url}`;
                // Links to notebook files are stored decoded; Markdown output encodes them.
                const full = isRelativeFileLink(typed) ? safeDecode(typed) : typed;
                if (editor.state.selection.empty && !active) {
                  editor
                    .chain()
                    .focus()
                    .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: full } }] })
                    .run();
                } else editor.chain().focus().extendMarkRange('link').setLink({ href: full }).run();
              }
              p.close();
            }}
          >
            <input className="input" autoFocus placeholder="Paste a link…" value={href} onChange={(e) => setHref(e.target.value)} />
            <button className="btn btn-primary btn-sm" type="submit">
              {href.trim() ? 'Apply' : 'Remove'}
            </button>
          </form>
        </Popover>
      )}
    </>
  );
}

/** Marks which sides of a scrolling toolbar have more tools (phones), so the edge can fade as a hint. */
function useScrollHint() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      el.dataset.more = left && right ? 'both' : right ? 'right' : left ? 'left' : '';
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/** The Insert menu, in this order: lab blocks first, as the menu scrolls after a dozen items. */
const INSERT_MENU = [
  'table',
  'buffer',
  'plate',
  'flow',
  'stock',
  'protocol',
  'cite',
  'link',
  'file',
  'image',
  'sequence',
  'subtemplate',
  'date',
  'reminder',
  'quote',
  'code',
  'divider',
];

export function Toolbar({ editor, handlers, inTemplate }: { editor: Editor; handlers: InsertHandlers; inTemplate: boolean }) {
  const scrollRef = useScrollHint();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : e.isActive('heading', { level: 4 })
              ? 'h4'
              : e.isActive('codeBlock')
                ? 'code'
                : 'p',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const insert = usePopover();

  const btn = (
    active: boolean,
    [name, desc, keys]: [string, string | undefined, string | undefined],
    icon: React.ReactNode,
    run: () => void,
    optional = false,
  ) => (
    <button
      className={`icon-btn ${active ? 'active' : ''} ${optional ? 'gc-tb-optional' : ''}`}
      {...tip(name, desc, keys)}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  const c = () => editor.chain().focus();

  const commands = blockCommands(handlers, { inTemplate });
  const insertItems: MenuItemSpec[] = INSERT_MENU.map((id) => commands.find((cmd) => cmd.id === id))
    .filter((cmd) => !!cmd)
    .map((cmd) => ({ label: cmd.title, icon: cmd.icon, hint: undefined, onSelect: () => cmd.run(editor) }));

  return (
    <div className="gc-toolbar" role="toolbar" aria-label="Formatting" ref={scrollRef}>
      <select
        className="gc-block-select"
        value={s.block}
        {...tip('Text style', 'Body text, a heading or a code block')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') c().setParagraph().run();
          else if (v === 'code') c().setCodeBlock().run();
          else
            c()
              .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 })
              .run();
        }}
      >
        <option value="p">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="code">Code</option>
      </select>
      <span className="gc-tb-sep" />
      {btn(s.bold, ['Bold', undefined, 'Mod+B'], <Bold />, () => c().toggleBold().run())}
      {btn(s.italic, ['Italic', undefined, 'Mod+I'], <Italic />, () => c().toggleItalic().run())}
      {btn(s.underline, ['Underline', undefined, 'Mod+U'], <Underline />, () => c().toggleUnderline().run())}
      {btn(s.strike, ['Strikethrough', 'Cross text out', 'Mod+Shift+S'], <Strikethrough />, () => c().toggleStrike().run(), true)}
      {btn(s.sub, ['Subscript', 'Lowered text, as in H₂O', 'Mod+,'], <Subscript />, () => c().toggleSubscript().run())}
      {btn(s.sup, ['Superscript', 'Raised text, as in 10⁶ or µm²', 'Mod+.'], <Superscript />, () => c().toggleSuperscript().run())}
      <HighlightButton editor={editor} />
      <TextStyleButton editor={editor} />
      {btn(s.code, ['Inline code', 'Monospace text, for sequences and commands', 'Mod+E'], <Code />, () => c().toggleCode().run(), true)}
      <LinkButton editor={editor} active={s.link} />
      <span className="gc-tb-sep" />
      {btn(s.bullet, ['Bulleted list', undefined, 'Mod+Shift+8'], <List />, () => c().toggleBulletList().run())}
      {btn(s.ordered, ['Numbered list', 'For steps', 'Mod+Shift+7'], <ListOrdered />, () => c().toggleOrderedList().run())}
      {btn(s.task, ['Checklist', 'Boxes to check off as you go', 'Mod+Shift+9'], <CheckSquare />, () => c().toggleTaskList().run())}
      {btn(s.quote, ['Quote', 'Set text apart, e.g. a note or a warning', 'Mod+Shift+B'], <Quote />, () => c().toggleBlockquote().run(), true)}
      <span className="gc-tb-sep" />
      <button
        className="btn btn-ghost btn-sm gc-tb-insert"
        {...tip('Insert a table', 'Excel-like, with formulas')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertTable(editor)}
      >
        <Table2 /> <span className="gc-tb-label">Table</span>
      </button>
      <button
        className="btn btn-ghost btn-sm gc-tb-insert"
        {...tip('Attach files', 'Images, PDFs, data… or drop them on the page')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handlers.attachFiles()}
      >
        <Paperclip /> <span className="gc-tb-label">File</span>
      </button>
      <button
        className="btn btn-ghost btn-sm gc-tb-insert"
        {...tip('Attach a sequence', 'A SnapGene, GenBank or FASTA file, shown as a plasmid map')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handlers.attachFiles(SEQUENCE_EXTENSIONS.join(','))}
      >
        <Dna /> <span className="gc-tb-label">Sequence</span>
      </button>
      <button
        className="btn btn-ghost btn-sm gc-tb-insert"
        {...tip('Insert a sub-template', 'A reusable block, e.g. a PCR mix or a gel')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handlers.insertSubtemplate()}
      >
        <Blocks /> <span className="gc-tb-label">Sub-template</span>
      </button>
      <button
        ref={insert.ref}
        className="icon-btn"
        {...tip('Insert…', 'Buffer, flow, stock, protocol, date and more. Or type / in the text')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={insert.toggle}
      >
        <Plus />
      </button>
      {insert.open && (
        <Popover anchor={insert.ref.current} onClose={insert.close}>
          <MenuList items={insertItems} onClose={insert.close} />
        </Popover>
      )}
      <span className="gc-tb-sep" />
      <button
        className="icon-btn"
        {...tip('Undo', undefined, 'Mod+Z')}
        disabled={!s.canUndo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c().undo().run()}
      >
        <Undo2 />
      </button>
      <button
        className="icon-btn"
        {...tip('Redo', undefined, 'Mod+Shift+Z')}
        disabled={!s.canRedo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c().redo().run()}
      >
        <Redo2 />
      </button>
    </div>
  );
}
