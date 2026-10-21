import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Search, TestTubes } from 'lucide-react';
import { Dialog, openDialog } from '../ui/overlay';
import { navigate, useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';
import type { DocContextValue } from '../editor/context';
import { relative } from '../lib/path';
import { stockIcon } from './StocksPage';
import type { StockItem } from './model';

interface Pick {
  item: StockItem;
  collection: DocMeta;
}

/** All stocks of the notebook, to link one from an entry. */
export function StockPicker({ close, onPick }: { close: () => void; onPick: (p: Pick) => void }) {
  const docs = useNotebook((s) => s.docs);
  const all = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'stocks')
        .sort((a, b) => a.title.localeCompare(b.title))
        .flatMap((collection) => (collection.stockItems ?? []).map((item) => ({ item, collection }))),
    [docs],
  );
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(({ item, collection }) => {
      const hay = `${item.id} ${item.name} ${item.summary} ${collection.title}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [all, q]);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.gc-picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const pick = (p: Pick) => {
    close();
    onPick(p);
  };
  return (
    <Dialog title="Link a stock" icon={<TestTubes className="gc-dialog-icon" />} onClose={close}>
      <div className="gc-picker-search">
        <Search />
        <input
          className="input"
          autoFocus
          aria-label="Search stocks"
          placeholder="Search by ID, name, sequence, location…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(list.length - 1, i + 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
            if (e.key === 'Enter' && list[index]) pick(list[index]);
          }}
        />
      </div>
      <div className="gc-picker-list" ref={listRef}>
        {list.length === 0 && (
          <div className="empty-state">
            {all.length ? (
              'No stock matches.'
            ) : (
              <>
                <span>No stocks yet.</span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    close();
                    navigate({ name: 'stocks' });
                  }}
                >
                  Open Stocks
                </button>
              </>
            )}
          </div>
        )}
        {list.slice(0, 100).map((p, i) => (
          <button
            key={`${p.collection.path}#${p.item.id}`}
            className={`gc-picker-item ${i === index ? 'active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => pick(p)}
          >
            {stockIcon(p.collection.extra.stock)}
            <span className="gc-picker-main">
              <span className="gc-picker-title">
                <span className="id-chip">{p.item.id}</span> <span className="gc-picker-name">{p.item.name}</span>
              </span>
              <span className="gc-picker-desc">{[p.collection.title, p.item.summary].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/** Pick a stock and insert a link to it at the cursor: "PR-0001 EGFP-fwd". */
export function openStockPicker(editor: Editor, ctx: DocContextValue) {
  openDialog((close) => (
    <StockPicker
      close={close}
      onPick={({ item, collection }) => {
        const href = `${relative(ctx.folder, collection.path)}#${item.id}`;
        // After the dialog has closed, so the cursor stays in the text for typing on.
        requestAnimationFrame(() =>
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'text', text: item.name ? `${item.id} ${item.name}` : item.id, marks: [{ type: 'link', attrs: { href } }] },
              { type: 'text', text: ' ' },
            ])
            .run(),
        );
      }}
    />
  ));
}

/** Where a link to a stock goes: its collection, or (renamed since) wherever that ID lives now. */
export function stockLinkTarget(target: string, fragment: string, docs: Record<string, DocMeta>): { path: string; id?: string } | null {
  const id = decodeURIComponent(fragment.replace(/^#/, ''));
  if (docs[target]?.kind === 'stocks') return { path: target, id: id || undefined };
  if (!id) return null;
  const owner = Object.values(docs).find((d) => d.kind === 'stocks' && d.stockItems?.some((s) => s.id === id));
  return owner ? { path: owner.path, id } : null;
}
