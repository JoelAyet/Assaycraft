import { Extension, type Editor, type Range } from '@tiptap/core';
import { Suggestion, exitSuggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { filterCommands, type BlockCommand } from './commands';

interface SlashState {
  open: boolean;
  items: BlockCommand[];
  index: number;
  rect: DOMRect | null;
  query: string;
  pick: ((item: BlockCommand) => void) | null;
  close: (() => void) | null;
}

export const useSlash = create<SlashState>(() => ({ open: false, items: [], index: 0, rect: null, query: '', pick: null, close: null }));

export interface SlashOptions {
  commands: () => BlockCommand[];
}

const slashKey = new PluginKey('gc-slash');

/** Letters typed past the last one that found blocks, before the menu closes by itself (as in Notion). */
const GIVE_UP = 3;

const GROUP_LABELS: Record<BlockCommand['group'], string> = { Basic: 'Basic blocks', Lab: 'Lab', Insert: 'Insert' };

/** "/" opens a block menu, like Notion. */
export const SlashCommands = Extension.create<SlashOptions>({
  name: 'slashCommands',
  addOptions() {
    return { commands: () => [] };
  },
  addProseMirrorPlugins() {
    // The longest search that still found blocks, while the menu is open.
    let found = 0;
    return [
      Suggestion<BlockCommand, BlockCommand>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        // "/" and what is typed after it are marked, with a hint until something is typed.
        decorationClass: 'gc-slash-query',
        decorationEmptyClass: 'is-empty',
        decorationContent: 'Type to search',
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== 'codeBlock';
        },
        items: ({ query }) => filterCommands(this.options.commands(), query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: BlockCommand }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => ({
          onStart: (props) => {
            found = 0;
            const view = props.editor.view;
            useSlash.setState({
              open: true,
              items: props.items,
              index: 0,
              query: props.query,
              rect: props.clientRect?.() ?? null,
              pick: (item) => props.command(item),
              close: () => exitSuggestion(view, slashKey),
            });
          },
          onUpdate: (props) => {
            if (props.items.length) found = props.query.length;
            else if (props.query.length - found >= GIVE_UP) {
              // Nothing matches what is being typed: it was not meant for the menu.
              const view = props.editor.view;
              setTimeout(() => exitSuggestion(view, slashKey));
            }
            useSlash.setState((s) => ({
              items: props.items,
              query: props.query,
              index: props.query === s.query ? Math.min(s.index, Math.max(0, props.items.length - 1)) : 0,
              rect: props.clientRect?.() ?? s.rect,
              pick: (item) => props.command(item),
            }));
          },
          onKeyDown: ({ event }) => {
            const s = useSlash.getState();
            if (!s.open) return false;
            if (event.key === 'ArrowDown') {
              useSlash.setState({ index: (s.index + 1) % Math.max(1, s.items.length) });
              return true;
            }
            if (event.key === 'ArrowUp') {
              useSlash.setState({ index: (s.index - 1 + s.items.length) % Math.max(1, s.items.length) });
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const item = s.items[s.index];
              if (item && s.pick) {
                s.pick(item);
                return true;
              }
              return false;
            }
            if (event.key === 'Escape') {
              // Keep Escape from also closing a surrounding panel.
              event.stopPropagation();
              useSlash.setState({ open: false });
              return true;
            }
            return false;
          },
          onExit: () => useSlash.setState({ open: false, rect: null, pick: null, close: null, query: '' }),
        }),
      }),
    ];
  },
});

export function SlashMenuHost() {
  const { open, items, index, rect, query, pick, close } = useSlash();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Where the mouse last was: the highlighted block follows the mouse only when it moves, not when
  // the list scrolls under a mouse left still (keys would otherwise lose their place).
  const mouse = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !rect || !ref.current) return;
    const h = ref.current.offsetHeight;
    const w = ref.current.offsetWidth;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    setPos({ left, top });
  }, [open, rect, items.length]);

  useEffect(() => {
    ref.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;
  // While searching, the blocks found are listed in order of match, without their groups.
  const grouped = !query;
  let lastGroup = '';
  return createPortal(
    <div
      ref={ref}
      className="popover gc-slash"
      role="listbox"
      aria-label="Blocks"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="gc-slash-list">
        {items.length === 0 && <div className="gc-slash-empty">No results</div>}
        {items.map((it, i) => {
          const head = grouped && it.group !== lastGroup ? GROUP_LABELS[it.group] : null;
          lastGroup = it.group;
          return (
            <div key={it.id}>
              {head && <div className="menu-label">{head}</div>}
              <button
                className={`menu-item gc-slash-item ${i === index ? 'active' : ''}`}
                role="option"
                aria-selected={i === index}
                title={it.description}
                onMouseMove={(e) => {
                  const m = mouse.current;
                  mouse.current = { x: e.clientX, y: e.clientY };
                  if (m && (m.x !== e.clientX || m.y !== e.clientY) && i !== index) useSlash.setState({ index: i });
                }}
                onClick={() => pick?.(it)}
              >
                <span className="gc-slash-icon">{it.icon}</span>
                <span className="gc-slash-title">{it.title}</span>
                {it.hint ? <kbd className="gc-slash-hint">{it.hint}</kbd> : <span className="gc-slash-desc">{it.description}</span>}
              </button>
            </div>
          );
        })}
      </div>
      <button className="gc-slash-foot" onClick={() => close?.()}>
        <span>Close menu</span>
        <kbd>esc</kbd>
      </button>
    </div>,
    document.body,
  );
}
