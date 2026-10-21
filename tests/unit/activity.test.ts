import { describe, expect, it } from 'vitest';
import { activityByDay, mergeActivity, parseActivity, serializeActivity } from '../../src/notebook/activity';
import type { DocMeta } from '../../src/notebook/model';

const doc = (d: Partial<DocMeta>): DocMeta =>
  ({ path: 'Projects/General/x.md', kind: 'entry', id: '', title: 'x', tags: [], mtime: 0, ...d }) as DocMeta;

describe('activity log', () => {
  it('saves one line per day and reads it back', () => {
    const log = { '2026-10-16': ['GC-0002'], '2026-10-14': ['GC-0001', 'P-0001'] };
    const text = serializeActivity(log);
    expect(text).toBe('{\n  "version": 1,\n  "days": {\n    "2026-10-14": ["GC-0001","P-0001"],\n    "2026-10-16": ["GC-0002"]\n  }\n}\n');
    expect(parseActivity(text)).toEqual(log);
    expect(parseActivity(serializeActivity({}))).toEqual({});
  });

  it('ignores what it cannot read', () => {
    expect(parseActivity('not json')).toEqual({});
    expect(parseActivity('{"days":{"yesterday":["a"],"2026-10-16":"a","2026-10-15":["a",3]}}')).toEqual({ '2026-10-15': ['a'] });
  });

  it('merges two copies of a notebook without counting a document twice', () => {
    expect(mergeActivity({ '2026-10-16': ['A'], '2026-10-15': ['A'] }, { '2026-10-16': ['A', 'B'], '2026-10-01': ['C'] })).toEqual({
      '2026-10-16': ['A', 'B'],
      '2026-10-15': ['A'],
      '2026-10-01': ['C'],
    });
  });

  it('counts documents per day, filling in from the files for days before the log', () => {
    const counts = activityByDay({ '2026-10-16': ['GC-0001', 'Templates/PCR.md'] }, [
      // Edited today (already logged) and created two days before.
      doc({ id: 'GC-0001', created: '2026-10-14T09:00:00+02:00', modified: '2026-10-16T10:00:00+02:00' }),
      // Made and not changed since: its creation day counts for an entry…
      doc({ id: 'GC-0002', created: '2026-10-14T11:00:00+02:00', modified: '2026-10-14T11:00:00+02:00' }),
      // …except the example entry of a new notebook, until you change it.
      doc({ id: 'EXAMPLE-1', created: '2026-09-01T08:00:00+02:00', modified: '2026-09-01T08:00:00+02:00' }),
      // …but not for an example template that came with the notebook.
      doc({ kind: 'template', path: 'Templates/Gel.md', created: '2026-09-01T08:00:00+02:00', modified: '2026-09-01T08:00:00+02:00' }),
      doc({ kind: 'protocol', id: 'P-0001', created: '2026-09-01T08:00:00+02:00', modified: '2026-10-02T15:00:00+02:00' }),
      doc({ kind: 'board', path: 'Boards/Lab tasks/_board.md', modified: '2026-10-03T15:00:00+02:00' }),
    ]);
    expect(Object.fromEntries(counts)).toEqual({ '2026-10-16': 2, '2026-10-14': 2, '2026-10-02': 1 });
  });
});
