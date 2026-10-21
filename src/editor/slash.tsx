import { Extension, type Editor, type Range } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
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
  pick: ((item: BlockCommand) => void) | null;
}

export const useSlash = create<SlashState>(() => ({ open: false, items: [], index: 0, rect: null, pick: null }));

export interface SlashOptions {
  commands: () => BlockCommand[];
}

const slashKey = new PluginKey('gc-slash');

/** "/" opens a block menu, like Notion. */
export const SlashCommands = Extension.create<SlashOptions>({
  name: 'slashCommands',
  addOptions() {
    return { commands: () => [] };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockCommand, BlockCommand>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
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
            useSlash.setState({ open: true, items: props.items, index: 0, rect: props.clientRect?.() ?? null, pick: (item) => props.command(item) });
          },
          onUpdate: (props) => {
            useSlash.setState((s) => ({
              items: props.items,
              index: Math.min(s.index, Math.max(0, props.items.length - 1)),
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
          onExit: () => useSlash.setState({ open: false, rect: null, pick: null }),
        }),
      }),
    ];
  },
});

export function SlashMenuHost() {
  const { open, items, index, rect, pick } = useSlash();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !rect || !ref.current) return;
    const h = ref.current.offsetHeight;
    const w = ref.current.offsetWidth;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    const left = Math.min(rect.left, window.innerWidth - w - 8);
    setPos({ left, top });
  }, [open, rect, items.length]);

  useEffect(() => {
    ref.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div ref={ref} className="popover gc-slash" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <div className="menu-label">No matching blocks</div>}
      {items.map((it, i) => {
        const head = it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <div key={it.id}>
            {head && <div className="menu-label">{head}</div>}
            <button
              className={`menu-item gc-slash-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => useSlash.setState({ index: i })}
              onClick={() => pick?.(it)}
            >
              <span className="gc-slash-icon">{it.icon}</span>
              <span className="gc-slash-text">
                <span className="gc-slash-title">{it.title}</span>
                <span className="gc-slash-desc">{it.description}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
