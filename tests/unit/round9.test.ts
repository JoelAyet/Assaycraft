// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown } from '../../src/markdown/serialize';
import { moveReminder, remindersIn, setReminderDone } from '../../src/reminders/model';
import { flowStepRefs, setFlowStepDate } from '../../src/flow/model';
import { deleteCols, deleteRows, insertCols, insertRows, setCellColor, sortByColumn } from '../../src/sheet/model';
import { notebookCalendar } from '../../src/calendar/ics';
import { bodyFacts } from '../../src/notebook/text';
import { normalizeAnnotations } from '../../src/editor/annotations';
import { formatTime, longDate } from '../../src/lib/dates';
import type { DocMeta } from '../../src/notebook/model';

const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md));

describe('reminders', () => {
  const body = [
    '# Plan',
    '',
    '- [ ] Order more Q5 (@2026-10-30 14:00)',
    '- [x] Pour plates (@2026-10-31)',
    '',
    'Call the core facility (@2026-11-02)',
    '',
    '```',
    'not a reminder (@2026-11-03)',
    '```',
  ].join('\n');

  it('are found with their day, time, words and tick', () => {
    expect(remindersIn(body)).toEqual([
      { index: 0, date: '2026-10-30', time: '14:00', text: 'Order more Q5', done: false, checkable: true },
      { index: 1, date: '2026-10-31', time: undefined, text: 'Pour plates', done: true, checkable: true },
      { index: 2, date: '2026-11-02', time: undefined, text: 'Call the core facility', done: false, checkable: false },
    ]);
  });

  it('move to another day keeping their time, and check off in the file', () => {
    const moved = moveReminder(body, 0, '2026-11-04')!;
    expect(moved).toContain('- [ ] Order more Q5 (@2026-11-04 14:00)');
    expect(setReminderDone(moved, 0, true)).toContain('- [x] Order more Q5 (@2026-11-04 14:00)');
    expect(setReminderDone(body, 1, false)).toContain('- [ ] Pour plates (@2026-10-31)');
    // Without a checkbox there is nothing to tick; a reminder that is not there cannot move.
    expect(setReminderDone(body, 2, true)).toBeUndefined();
    expect(moveReminder(body, 9, '2026-11-04')).toBeUndefined();
  });

  it('are chips in the editor and the same text in the file', () => {
    const md = '- [ ] Order more Q5 (@2026-10-30 14:00)\n- [x] Pour plates (@2026-10-31)\n';
    const json = JSON.stringify(parseMarkdown(md).toJSON());
    expect(json).toContain('"type":"reminder","attrs":{"date":"2026-10-30","time":"14:00"}');
    expect(roundTrip(md)).toBe(md);
  });

  it('go into the private calendar link while still to do', () => {
    const facts = bodyFacts(body, 'entry');
    const d: DocMeta = { path: 'Projects/A/EXP-0001 Plan.md', kind: 'entry', id: 'EXP-0001', title: 'Plan', tags: [], extra: {}, mtime: 0, ...facts };
    const { ics, count } = notebookCalendar({ [d.path]: d }, { name: 'Lab', feedId: 'abcdefghijklmnopqrstuv', statuses: [], projectOf: () => 'A' });
    expect(count).toBe(2);
    expect(ics).toContain('SUMMARY:Order more Q5');
    expect(ics).toContain('DTSTART:20261030T140000Z\r\nDURATION:PT15M');
    expect(ics).toContain('SUMMARY:Call the core facility');
    expect(ics).not.toContain('Pour plates');
  });
});

describe('colors and sizes in text', () => {
  it('keep their names in the file, with a style for other viewers', () => {
    const md =
      'A <mark data-color="green" style="background:#dcf1e3">green</mark> and a <mark>yellow</mark> highlight, ' +
      '<span class="gc-ink" data-color="red" style="color:#c62828">red</span> and ' +
      '<span class="gc-size" data-size="large" style="font-size:1.25em">large</span> text.\n';
    const json = JSON.stringify(parseMarkdown(md).toJSON());
    expect(json).toContain('"type":"highlight","attrs":{"color":"green"}');
    expect(json).toContain('"type":"textColor","attrs":{"color":"red"}');
    expect(json).toContain('"type":"textSize","attrs":{"size":"large"}');
    expect(roundTrip(md)).toBe(md);
  });

  it('leave other HTML as it is', () => {
    const md = 'A <span style="color:red">styled</span> word.\n';
    expect(roundTrip(md)).toBe(md);
  });
});

describe('tables', () => {
  it('keep cell colors and frozen columns in their comment', () => {
    const md = '<!-- gc:table {"bg":{"A2":"yellow","B3":"green"},"freeze":1} -->\n| Sample | OD |\n| --- | ---: |\n| WT | 0.5 |\n| KO | 0.7 |\n';
    const json = JSON.stringify(parseMarkdown(md).toJSON());
    expect(json).toContain('"colors":{"A2":"yellow","B3":"green"},"freeze":1');
    expect(roundTrip(md)).toBe(md);
  });

  it('move cell colors with their cells', () => {
    const d = setCellColor(
      {
        rows: [
          ['h', 'x'],
          ['b', '2'],
          ['a', '1'],
        ],
      },
      { r1: 1, c1: 0, r2: 1, c2: 1 },
      'yellow',
    );
    expect(d.colors).toEqual({ A2: 'yellow', B2: 'yellow' });
    expect(insertRows(d, 1).colors).toEqual({ A3: 'yellow', B3: 'yellow' });
    expect(deleteRows(d, 1).colors).toBeUndefined();
    expect(insertCols(d, 0).colors).toEqual({ B2: 'yellow', C2: 'yellow' });
    expect(deleteCols(d, 0).colors).toEqual({ A2: 'yellow' });
    // Sorted A→Z by the first column, the colored row ("b") goes last.
    expect(sortByColumn(d, 0, 1, d.rows).colors).toEqual({ A3: 'yellow', B3: 'yellow' });
  });
});

describe('images', () => {
  it('keep the notes drawn on them in a comment above', () => {
    const md =
      '<!-- gc:image {"marks":[{"t":"arrow","a":[0.1,0.2,0.3,0.4],"c":"red"},{"t":"text","a":[0.5,0.6],"c":"white","s":"Ladder"}]} -->\n' +
      '![Gel](attachments/EXP-0001/gel.jpg)\n';
    const json = JSON.stringify(parseMarkdown(md).toJSON());
    expect(json).toContain('"marks":[{"t":"arrow"');
    expect(roundTrip(md)).toBe(md);
  });

  it('drop malformed notes', () => {
    expect(
      normalizeAnnotations([
        { t: 'line', a: [0, 0] },
        { t: 'circle', a: [0, 0, 1, 1] },
        { t: 'text', a: [0.5, 0.5], s: ' ' },
        { t: 'box', a: [0, 0, 2, 1], c: 'pink' },
      ]),
    ).toEqual([{ t: 'box', a: [0, 0, 1, 1], c: 'red' }]);
  });
});

describe('flows', () => {
  it('keep the day a step is planned for until it is started', () => {
    const body = '<!-- gc:flow -->\n1. Transformation\n2. [EXP-0002 Miniprep](EXP-0002%20Miniprep.md)\n';
    const planned = setFlowStepDate(body, 0, '2026-11-03')!;
    expect(planned).toContain('<!-- gc:flow {"dates":{"1":"2026-11-03"}} -->');
    expect(flowStepRefs(planned)).toEqual([
      { title: 'Transformation', date: '2026-11-03' },
      { title: 'Miniprep', ref: 'EXP-0002' },
    ]);
    // A started step's day is its entry's.
    expect(setFlowStepDate(body, 1, '2026-11-05')).not.toContain('dates');
    expect(roundTrip(planned)).toBe(planned);
  });
});

describe('dates', () => {
  it('are written in English', () => {
    expect(longDate(new Date(2026, 9, 28))).toBe('Wednesday, October 28, 2026');
    expect(formatTime('14:30')).toMatch(/^(2:30\sPM|14:30)$/);
  });
});
