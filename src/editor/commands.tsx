/** Block insertion commands shared by the slash menu and the toolbar "Insert" menu. */
import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import {
  Beaker,
  Grid3x3,
  BookMarked,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Code2,
  Dna,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Pilcrow,
  Puzzle,
  Quote,
  Table2,
  TestTubes,
  Workflow,
} from 'lucide-react';
import { emptySheet } from '../sheet/model';
import { focusNextInsertedSheet } from '../sheet/SheetView';
import { focusNextInsertedBuffer } from '../buffer/BufferView';
import { newBuffer } from '../buffer/calc';
import { focusNextInsertedFlow } from '../flow/FlowView';
import { focusNextInsertedPlate } from '../plate/PlateView';
import { newPlate } from '../plate/model';
import { longDate, localDate } from '../lib/dates';
import { SEQUENCE_EXTENSIONS } from '../bio/detect';
import { insertBlocks } from './insertion';

export interface InsertHandlers {
  /** Ask for files and attach them at the cursor. */
  attachFiles: (accept?: string) => void;
  /** Pick a sub-template and insert it (reference in templates, copy in entries). */
  insertSubtemplate: () => void;
  /** Link a protocol, or insert a copy of its steps. */
  insertProtocol: () => void;
  /** Insert a link to another entry. */
  linkEntry: () => void;
  /** Insert a link to a stock (primer, plasmid…). */
  linkStock: () => void;
  /** Cite a paper from the Literature library (a link to its page). */
  cite: () => void;
}

export interface BlockCommand {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  keywords: string;
  group: 'Basic' | 'Lab' | 'Insert';
  run: (editor: Editor) => void;
}

export function insertTable(editor: Editor, rows = 5, cols = 4) {
  focusNextInsertedSheet();
  insertBlocks(editor, { type: 'spreadsheet', attrs: { data: emptySheet(rows, cols) } });
}

export function insertBuffer(editor: Editor) {
  focusNextInsertedBuffer();
  insertBlocks(editor, { type: 'buffer', attrs: { data: newBuffer() } });
}

export function insertPlate(editor: Editor) {
  focusNextInsertedPlate();
  insertBlocks(editor, { type: 'plate', attrs: { data: newPlate(96) } });
}

export function insertFlow(editor: Editor) {
  focusNextInsertedFlow();
  insertBlocks(editor, { type: 'flow', attrs: { data: { steps: [] } } });
}

export function insertDateHeading(editor: Editor) {
  const now = new Date();
  insertBlocks(editor, [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `${localDate(now)} · ${longDate(now).split(',')[0]}` }] },
    { type: 'paragraph' },
  ]);
}

export function blockCommands(h: InsertHandlers, opts: { inTemplate: boolean }): BlockCommand[] {
  return [
    {
      id: 'text',
      title: 'Text',
      description: 'Plain paragraph',
      icon: <Pilcrow />,
      keywords: 'paragraph p',
      group: 'Basic',
      run: (e) => e.chain().focus().setParagraph().run(),
    },
    {
      id: 'h1',
      title: 'Heading 1',
      description: 'Big section heading',
      icon: <Heading1 />,
      keywords: 'title h1 #',
      group: 'Basic',
      run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      title: 'Heading 2',
      description: 'Medium heading',
      icon: <Heading2 />,
      keywords: 'subtitle h2 ##',
      group: 'Basic',
      run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      title: 'Heading 3',
      description: 'Small heading',
      icon: <Heading3 />,
      keywords: 'h3 ###',
      group: 'Basic',
      run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'bullet',
      title: 'Bulleted list',
      description: 'Simple list',
      icon: <List />,
      keywords: 'ul unordered -',
      group: 'Basic',
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered',
      title: 'Numbered list',
      description: 'Steps of a protocol',
      icon: <ListOrdered />,
      keywords: 'ol ordered steps 1.',
      group: 'Basic',
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'task',
      title: 'Checklist',
      description: 'Tick off protocol steps',
      icon: <CheckSquare />,
      keywords: 'todo task checkbox [ ]',
      group: 'Basic',
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      id: 'quote',
      title: 'Quote',
      description: 'Callout or citation',
      icon: <Quote />,
      keywords: 'blockquote callout note >',
      group: 'Basic',
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'code',
      title: 'Code block',
      description: 'Scripts, sequences, raw output',
      icon: <Code2 />,
      keywords: 'pre monospace ```',
      group: 'Basic',
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: 'divider',
      title: 'Divider',
      description: 'Horizontal line',
      icon: <Minus />,
      keywords: 'hr rule ---',
      group: 'Basic',
      run: (e) => insertBlocks(e, { type: 'horizontalRule' }),
    },
    {
      id: 'table',
      title: 'Table',
      description: 'Excel-like table with formulas',
      icon: <Table2 />,
      keywords: 'spreadsheet excel grid sheet calc',
      group: 'Lab',
      run: (e) => insertTable(e),
    },
    {
      id: 'buffer',
      title: 'Buffer',
      description: 'Dilutions and recipes: what to add of each stock',
      icon: <Beaker />,
      keywords: 'buffer dilution solution recipe stock molarity concentration c1v1 media mix reagent',
      group: 'Lab',
      run: (e) => insertBuffer(e),
    },
    {
      id: 'plate',
      title: 'Plate layout',
      description: '96- or 384-well plate map, wells linked to samples',
      icon: <Grid3x3 />,
      keywords: 'plate layout map well wells 96 384 24 48 microplate elisa qpcr pcr samples standards blanks screen',
      group: 'Lab',
      run: (e) => insertPlate(e),
    },
    {
      id: 'flow',
      title: 'Flow',
      description: 'Plan a series of experiments, one entry per step',
      icon: <Workflow />,
      keywords: 'flow workflow pipeline plan steps series sequence experiments project roadmap',
      group: 'Lab',
      run: (e) => insertFlow(e),
    },
    {
      id: 'stock',
      title: 'Stock',
      description: 'Link a primer, plasmid, glycerol stock, seed…',
      icon: <TestTubes />,
      keywords: 'stock primer oligo plasmid glycerol seed strain antibody cell line reagent inventory freezer',
      group: 'Lab',
      run: () => h.linkStock(),
    },
    {
      id: 'file',
      title: 'File or image',
      description: 'Upload files, images, PDFs…',
      icon: <Paperclip />,
      keywords: 'upload attach attachment pdf picture photo',
      group: 'Lab',
      run: () => h.attachFiles(),
    },
    {
      id: 'image',
      title: 'Image',
      description: 'Gel, blot, microscopy…',
      icon: <ImageIcon />,
      keywords: 'picture photo gel blot figure',
      group: 'Lab',
      run: () => h.attachFiles('image/*'),
    },
    {
      id: 'sequence',
      title: 'Sequence (SnapGene)',
      description: '.dna, GenBank, FASTA with a map',
      icon: <Dna />,
      keywords: 'snapgene dna plasmid genbank fasta map construct',
      group: 'Lab',
      run: () => h.attachFiles(SEQUENCE_EXTENSIONS.join(',')),
    },
    {
      id: 'subtemplate',
      title: 'Sub-template',
      description: opts.inTemplate ? 'Reusable block (stays in sync)' : 'Insert a reusable protocol block',
      icon: <Puzzle />,
      keywords: 'template protocol block snippet reuse include',
      group: 'Lab',
      run: () => h.insertSubtemplate(),
    },
    {
      id: 'protocol',
      title: 'Protocol',
      description: 'Link a protocol or insert a copy of its steps',
      icon: <BookOpen />,
      keywords: 'protocol sop method procedure steps',
      group: 'Lab',
      run: () => h.insertProtocol(),
    },
    {
      id: 'date',
      title: 'Today’s date',
      description: 'Date heading for a new day of work',
      icon: <CalendarDays />,
      keywords: 'today day date timestamp',
      group: 'Lab',
      run: (e) => insertDateHeading(e),
    },
    {
      id: 'link',
      title: 'Link to entry',
      description: 'Reference an entry, task or protocol',
      icon: <Link2 />,
      keywords: 'mention reference entry link @',
      group: 'Insert',
      run: () => h.linkEntry(),
    },
    {
      id: 'cite',
      title: 'Cite a paper',
      description: 'From your Literature, or add one by DOI',
      icon: <BookMarked />,
      keywords: 'cite citation paper reference literature article doi pubmed bibliography',
      group: 'Insert',
      run: () => h.cite(),
    },
  ];
}

export function filterCommands(cmds: BlockCommand[], query: string): BlockCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds;
  return cmds
    .map((c) => {
      const t = c.title.toLowerCase();
      const score = t.startsWith(q) ? 0 : t.includes(q) ? 1 : c.keywords.includes(q) ? 2 : c.description.toLowerCase().includes(q) ? 3 : 9;
      return { c, score };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
}
