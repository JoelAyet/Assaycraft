/** Starter content for a new notebook: protocols, templates, sub-templates, stocks, a task board, a paper and an example entry. */
import type { Vault } from '../fs/types';
import { encodeLinkPath, join, relative, sanitizeFileName } from '../lib/path';
import { localDate, localIso } from '../lib/dates';
import { bufferToMarkdown, sheetToMarkdown } from '../markdown/serialize';
import { joinFrontMatter } from './frontmatter';
import { DEFAULT_BOARD_COLUMNS, LAYOUT, frontMatterFromMeta, type DocMeta, type NotebookConfig } from './model';
import { stockType, writeStockTable } from '../stocks/model';
import { refExtra, type RefInfo } from '../literature/model';

const table = (rows: string[][]) => sheetToMarkdown({ rows });

/** The example entry, kept apart from your own entries (its id does not use the EXP- numbering). */
export const EXAMPLE_FOLDER = 'Getting started';
export const EXAMPLE_ENTRY_ID = 'EXAMPLE-1';
export const EXAMPLE_ENTRY_TITLE = 'Example: knock out EGFP with Cas9';
export const EXAMPLE_PAPER_ID = 'Jinek2012';

const include = (id: string, name: string) => `<!-- gc:include ${JSON.stringify({ id, name })} -->`;

type SeedMeta = Omit<DocMeta, 'path' | 'mtime' | 'text' | 'extra'> & { extra?: Record<string, unknown> };

function file(meta: SeedMeta, body: string): string {
  return joinFrontMatter(frontMatterFromMeta({ ...meta, extra: meta.extra ?? {} }), body.trim() + '\n');
}

interface SeedProtocol {
  /** Number in the protocol id: 1 → P-0001. */
  n: number;
  meta: Omit<SeedMeta, 'kind' | 'id'>;
  body: string;
}

const PROTOCOLS: SeedProtocol[] = [
  {
    n: 1,
    meta: {
      title: 'Chemically competent E. coli (CaCl₂)',
      status: 'active',
      version: '1.0',
      tags: ['cloning', 'bacteria'],
      description: 'Prepare CaCl₂-competent cells (DH5α, NEB 5-alpha…) for heat-shock transformation.',
    },
    body: `
## Purpose

Chemically competent *E. coli* for routine cloning. Expect 10⁶–10⁷ transformants per µg of pUC19.

## Materials

${table([
  ['Reagent or equipment', 'Amount', 'Notes'],
  ['LB medium', '100 mL', 'in a 500 mL flask'],
  ['0.1 M CaCl₂, ice-cold', '25 mL', 'filter-sterilized'],
  ['0.1 M CaCl₂ + 15 % glycerol, ice-cold', '2 mL', 'filter-sterilized'],
  ['Pre-chilled 1.5 mL tubes', '40', 'on dry ice or at −80 °C'],
])}

## Procedure

1. Grow a 5 mL overnight culture from a single colony (37 °C, 250 rpm).
2. Dilute 1 mL into 100 mL LB and grow to OD600 0.35–0.4 (about 2–3 h).
3. Chill the culture on ice for 20 min. From now on keep cells, tubes and solutions ice-cold.
4. Pellet at 4,000 × g, 10 min, 4 °C. Pour off the medium.
5. Gently resuspend in 20 mL ice-cold 0.1 M CaCl₂ and leave on ice for 30 min.
6. Pellet again and resuspend in 2 mL ice-cold 0.1 M CaCl₂ + 15 % glycerol.
7. Aliquot 50 µL per tube, snap-freeze and store at −80 °C.
8. Test the batch: transform 10 pg pUC19 and count colonies.

## Batches

${table([
  ['Batch', 'Date', 'Strain', 'OD600 at harvest', 'Colonies (10 pg pUC19)', 'Efficiency (cfu/µg)'],
  ['1', '', 'DH5α', '', '', '=E2/0.00001'],
])}

## Notes and safety

- Competence drops quickly if the cells warm up; work fast and on ice.
- Do not vortex competent cells.
`,
  },
  {
    n: 2,
    meta: {
      title: 'Bacterial glycerol stocks',
      status: 'active',
      version: '1.0',
      tags: ['cloning', 'storage'],
      description: 'Long-term storage of strains and plasmids at −80 °C.',
    },
    body: `
## Purpose

Keep every verified clone as a glycerol stock so it can be regrown at any time.

## Procedure

1. Grow 5 mL LB + antibiotic overnight from a single colony.
2. Mix 500 µL culture with 500 µL sterile 50 % glycerol in a labeled cryovial (25 % final).
3. Vortex briefly and freeze at −80 °C.
4. Record the box and position below.
5. To recover a strain, scrape a little of the frozen stock with a sterile tip and streak it on a plate. Do not thaw the vial.

## Freezer log

${table([
  ['Stock', 'Strain', 'Plasmid', 'Box', 'Position', 'Date'],
  ['', '', '', '', '', ''],
])}
`,
  },
  {
    n: 3,
    meta: {
      title: 'Freezing and thawing mammalian cells',
      status: 'active',
      version: '1.1',
      tags: ['cell culture'],
      description: 'Cryopreservation in 10 % DMSO and recovery of frozen cell lines.',
    },
    body: `
## Freezing

1. Use cells in log phase (70–90 % confluent) with more than 90 % viability.
2. Detach, neutralize and count the cells.
3. Pellet at 300 × g for 5 min and resuspend in cold freezing medium (90 % FBS + 10 % DMSO) at 1–5 × 10⁶ cells/mL.
4. Aliquot 1 mL per cryovial and freeze at about −1 °C/min (e.g. in a freezing container) at −80 °C overnight.
5. Move the vials to liquid nitrogen the next day.

## Thawing

1. Thaw the vial in a 37 °C water bath for 1–2 min, until a small ice crystal is left.
2. Add the cells dropwise to 9 mL pre-warmed medium.
3. Pellet at 300 × g for 5 min to remove the DMSO.
4. Resuspend in fresh medium and seed into a T25 or T75 flask.
5. Change the medium after 24 h.

## Safety

- Wear a face shield and cryo-gloves when working with liquid nitrogen.
- DMSO carries other chemicals through the skin: wear nitrile gloves.
`,
  },
];

const protocolId = (config: NotebookConfig, n: number) => `${config.protocolPrefix || 'P-'}${String(n).padStart(4, '0')}`;
const protocolFile = (config: NotebookConfig, p: SeedProtocol) => `${protocolId(config, p.n)} ${sanitizeFileName(p.meta.title)}.md`;

/** Markdown link from a seeded doc's folder to a seeded protocol. */
function protocolLink(config: NotebookConfig, fromFolder: string, n: number): string {
  const p = PROTOCOLS.find((x) => x.n === n)!;
  const href = encodeLinkPath(relative(fromFolder, join(LAYOUT.protocols, protocolFile(config, p))));
  return `[${protocolId(config, n)} ${p.meta.title}](${href})`;
}

const SUBTEMPLATES: { file: string; meta: SeedMeta; body: string }[] = [
  {
    file: 'PCR (Q5).md',
    meta: {
      kind: 'subtemplate',
      id: 'pcr-q5',
      title: 'PCR (Q5)',
      tags: ['pcr'],
      description: 'Q5 High-Fidelity PCR: master mix calculator and cycling program (NEB M0491).',
    },
    body: `
### PCR: {{PCR product|amplicon}}

Template **{{Template DNA}}** · primers {{Forward primer}} / {{Reverse primer}} · expected size {{Expected size (bp)}} bp

${table([
  ['Component', 'Stock', 'Final', '1 rxn (µL)', 'Master mix (µL)'],
  ['Nuclease-free water', '', '', '=D9-SUM(D3:D8)', '=D2*$D$10'],
  ['Q5 Reaction Buffer', '5X', '1X', '10', '=D3*$D$10'],
  ['dNTPs', '10 mM', '200 µM', '1', '=D4*$D$10'],
  ['Forward primer', '10 µM', '0.5 µM', '2.5', '=D5*$D$10'],
  ['Reverse primer', '10 µM', '0.5 µM', '2.5', '=D6*$D$10'],
  ['Q5 High-Fidelity DNA Polymerase', '2 U/µL', '0.02 U/µL', '0.5', '=D7*$D$10'],
  ['Template DNA (add per tube)', '', '1 pg – 1 µg', '1', ''],
  ['Total', '', '', '50', '=SUM(E2:E7)'],
  ['Reactions (incl. 1 extra)', '', '', '4', ''],
])}

${table([
  ['Step', 'Temp (°C)', 'Time', 'Cycles'],
  ['Initial denaturation', '98', '30 s', '1'],
  ['Denaturation', '98', '5–10 s', '30'],
  ['Annealing', '{{Annealing temp (°C)|60}}', '10–30 s', '30'],
  ['Extension', '72', '20–30 s/kb', '30'],
  ['Final extension', '72', '2 min', '1'],
  ['Hold', '4', '∞', ''],
])}

- [ ] Thaw reagents on ice; assemble on ice and add the polymerase last
- [ ] Spin down and move tubes to a thermocycler preheated to 98 °C
- [ ] Check 5 µL on a gel

**Result:**
`,
  },
  {
    file: 'Agarose gel.md',
    meta: {
      kind: 'subtemplate',
      id: 'agarose-gel',
      title: 'Agarose gel',
      tags: ['gel'],
      description: 'Agarose gel electrophoresis with a lane table.',
    },
    body: `
### Agarose gel

{{Agarose (%)|1}} % agarose in 1× TAE with {{Stain|SYBR Safe (1:10,000)}} · ladder {{Ladder|1 kb Plus DNA Ladder}} · {{Voltage (V)|120}} V for {{Run time (min)|30}} min

${table([
  ['Lane', 'Sample', 'Load (µL)', 'Expected (bp)', 'Observed'],
  ['1', 'Ladder', '5', '', ''],
  ['2', '', '5', '', ''],
  ['3', '', '5', '', ''],
  ['4', '', '5', '', ''],
  ['5', '', '5', '', ''],
  ['6', '', '5', '', ''],
])}

*Drop the gel image here.*
`,
  },
  {
    file: 'Restriction digest.md',
    meta: {
      kind: 'subtemplate',
      id: 'restriction-digest',
      title: 'Restriction digest',
      tags: ['cloning'],
      description: 'Double digest of 1 µg DNA in 50 µL (rCutSmart).',
    },
    body: `
### Restriction digest of {{DNA|plasmid}}

${table([
  ['Component', 'Conc. (ng/µL)', 'Amount (ng)', 'Volume (µL)'],
  ['DNA', '{{DNA conc. (ng/µL)|100}}', '1000', '=C2/B2'],
  ['rCutSmart Buffer (10X)', '', '', '5'],
  ['{{Enzyme 1|EcoRI-HF}}', '', '20 U', '1'],
  ['{{Enzyme 2|XbaI}}', '', '20 U', '1'],
  ['Nuclease-free water', '', '', '=D7-SUM(D2:D5)'],
  ['Total', '', '', '50'],
])}

- [ ] Incubate at 37 °C for 1 h (5–15 min for Time-Saver qualified enzymes)
- [ ] Heat-inactivate if needed (65 or 80 °C, 20 min) or gel-purify
`,
  },
  {
    file: 'Gibson assembly (NEBuilder HiFi).md',
    meta: {
      kind: 'subtemplate',
      id: 'gibson-hifi',
      title: 'Gibson assembly (NEBuilder HiFi)',
      tags: ['cloning'],
      description: 'Molar ratio calculator (pmol = ng × 1000 / (bp × 650)) and NEBuilder HiFi assembly.',
    },
    body: `
### Gibson assembly

Vector:insert ≈ 1:2 (molar), 0.03–0.2 pmol total DNA for 2–3 fragments.

${table([
  ['Fragment', 'Length (bp)', 'Conc. (ng/µL)', 'pmol', 'ng needed', 'Volume (µL)'],
  ['Vector: {{Vector}}', '5000', '50', '0.05', '=D2*B2*650/1000', '=ROUND(E2/C2,2)'],
  ['Insert: {{Insert}}', '1000', '30', '0.1', '=D3*B3*650/1000', '=ROUND(E3/C3,2)'],
  ['NEBuilder HiFi Master Mix (2X)', '', '', '', '', '10'],
  ['Nuclease-free water', '', '', '', '', '=20-SUM(F2:F4)'],
  ['Total', '', '', '=SUM(D2:D3)', '', '20'],
])}

- [ ] Incubate at 50 °C for 15 min (2–3 fragments) or 60 min (4–6 fragments)
- [ ] Transform 2 µL into competent cells
`,
  },
  {
    file: 'Transformation (heat shock).md',
    meta: {
      kind: 'subtemplate',
      id: 'transformation',
      title: 'Transformation (heat shock)',
      tags: ['cloning'],
      description: 'Heat-shock transformation of chemically competent E. coli.',
    },
    body: `
### Transformation into {{Cells|NEB 5-alpha}}

- [ ] Thaw competent cells on ice (10 min). Cells made with %%P1%%
- [ ] Add {{DNA volume (µL)|2}} µL DNA to 50 µL cells and flick to mix (do not vortex)
- [ ] Ice for 30 min
- [ ] Heat shock at 42 °C for exactly 30 s, then ice for 5 min
- [ ] Add 950 µL room-temperature SOC; shake at 37 °C, 250 rpm, 60 min
- [ ] Plate 50–100 µL on LB + {{Antibiotic|ampicillin}}; incubate overnight at 37 °C

${table([
  ['Plate', 'DNA', 'Plated (µL)', 'Colonies'],
  ['1', '{{Construct}}', '100', ''],
  ['2', 'Negative control (no DNA)', '100', ''],
])}
`,
  },
  {
    file: 'Miniprep.md',
    meta: { kind: 'subtemplate', id: 'miniprep', title: 'Miniprep', tags: ['cloning'], description: 'Plasmid miniprep checklist and yield table.' },
    body: `
### Miniprep

- [ ] Inoculate 5 mL LB + antibiotic with single colonies; grow overnight (37 °C, 250 rpm)
- [ ] Keep 500 µL of each culture for glycerol stocks (%%P2%%)
- [ ] Pellet, resuspend, lyse (≤ 5 min), neutralize, spin
- [ ] Bind, wash and dry the column
- [ ] Elute in {{Elution volume (µL)|30}} µL

${table([
  ['Clone', 'Conc. (ng/µL)', 'A260/280', 'A260/230', 'Yield (µg)', 'Notes'],
  ['1', '', '', '', '=B2*{{Elution volume (µL)|30}}/1000', ''],
  ['2', '', '', '', '=B3*{{Elution volume (µL)|30}}/1000', ''],
  ['3', '', '', '', '=B4*{{Elution volume (µL)|30}}/1000', ''],
  ['4', '', '', '', '=B5*{{Elution volume (µL)|30}}/1000', ''],
])}
`,
  },
];

const TEMPLATES: { file: string; meta: SeedMeta; body: string; protocols?: number[] }[] = [
  {
    file: 'General experiment.md',
    meta: {
      kind: 'template',
      id: 'general-experiment',
      title: 'General experiment',
      tags: [],
      description: 'Objective, materials, methods, results and next steps.',
      extra: { entryTitle: '{{title}}' },
    },
    body: `
## Objective

*What question does this experiment answer?*

## Materials

-

## Methods

1.

## Results

## Conclusion and next steps

- [ ]
`,
  },
  {
    file: 'Molecular cloning.md',
    meta: {
      kind: 'template',
      id: 'molecular-cloning',
      title: 'Molecular cloning',
      tags: ['cloning'],
      description: 'PCR → gel → Gibson assembly → transformation → miniprep → sequencing. Built from sub-templates.',
      extra: { entryTitle: 'Cloning of {{Construct}}' },
    },
    protocols: [1, 2],
    body: `
## Goal

Clone **{{Insert}}** into **{{Vector}}** to make **{{Construct}}**.

${include('pcr-q5', 'PCR (Q5)')}

${include('agarose-gel', 'Agarose gel')}

${include('gibson-hifi', 'Gibson assembly (NEBuilder HiFi)')}

${include('transformation', 'Transformation (heat shock)')}

${include('miniprep', 'Miniprep')}

### Sequence verification

${table([
  ['Clone', 'Primer', 'Order #', 'Result'],
  ['1', '', '', ''],
  ['2', '', '', ''],
])}

### Maps and files

*Drop the SnapGene map (.dna) of {{Construct}} here.*
`,
  },
  {
    file: 'Protein production.md',
    meta: {
      kind: 'template',
      id: 'protein-production',
      title: 'Protein production',
      tags: ['protein'],
      description: 'A flow from cloning to purified protein: start each step as its own entry.',
      extra: { entryTitle: 'Production of {{Protein}}' },
    },
    body: `
## Goal

Express and purify **{{Protein}}** from {{Construct}}.

## Plan

Start each step when you get to it: it becomes its own entry, and its status and result show here.

<!-- gc:flow {"templates":{"1":"molecular-cloning","2":"general-experiment","3":"general-experiment","4":"general-experiment","5":"general-experiment"}} -->
1. Cloning of {{Construct}}
2. Transformation into {{Strain|BL21(DE3)}}
3. Expression test
4. Lab-scale production
5. Purification of {{Protein}}

## Summary

*Yield, purity and where the protein is stored.*
`,
  },
  {
    file: 'Cell culture passage.md',
    meta: {
      kind: 'template',
      id: 'cell-culture-passage',
      title: 'Cell culture passage',
      tags: ['cell culture'],
      description: 'Passage log with a seeding calculator.',
      extra: { entryTitle: 'Passage {{Cell line|HEK293T}}' },
    },
    protocols: [3],
    body: `
## {{Cell line|HEK293T}} passage

Medium: {{Medium|DMEM + 10% FBS + 1% P/S}} · split ratio {{Split ratio|1:10}}

${table([
  ['Parameter', 'Value'],
  ['Viable cells (cells/mL)', '1000000'],
  ['Viability (%)', '95'],
  ['Cells to seed', '500000'],
  ['Volume of suspension (mL)', '=ROUND(B4/B2,3)'],
])}

${table([
  ['Flask', 'Passage #', 'Confluence (%)', 'Notes'],
  ['T75', '', '', ''],
])}

- [ ] Check morphology and contamination
- [ ] Wash with PBS, trypsinize, neutralize
- [ ] Count and seed
`,
  },
];

/** Replace %%P1%% with a link to protocol 1, written relative to `folder`. */
function withProtocolLinks(config: NotebookConfig, folder: string, body: string): string {
  return body.replace(/%%P(\d+)%%/g, (_, n: string) => protocolLink(config, folder, Number(n)));
}

export async function seedNotebook(vault: Vault, config: NotebookConfig) {
  const now = localIso();
  const today = localDate();
  for (const p of PROTOCOLS) {
    const revisions =
      p.meta.version === '1.1'
        ? [
            { version: '1.1', date: today, note: 'Spin the thawed cells to remove the DMSO.' },
            { version: '1.0', date: today, note: 'First version.' },
          ]
        : [{ version: '1.0', date: today, note: 'First version.' }];
    await vault.write(
      join(LAYOUT.protocols, protocolFile(config, p)),
      file({ ...p.meta, kind: 'protocol', id: protocolId(config, p.n), revisions, created: now, modified: now }, p.body),
    );
  }
  for (const s of SUBTEMPLATES) {
    await vault.write(
      join(LAYOUT.subtemplates, s.file),
      file({ ...s.meta, created: now, modified: now }, withProtocolLinks(config, LAYOUT.subtemplates, s.body)),
    );
  }
  for (const t of TEMPLATES) {
    const protocols = t.protocols?.map((n) => protocolId(config, n));
    await vault.write(
      join(LAYOUT.templates, t.file),
      file({ ...t.meta, protocols, created: now, modified: now }, withProtocolLinks(config, LAYOUT.templates, t.body)),
    );
  }
  await vault.mkdir(join(LAYOUT.projects, 'General'));

  // Two stock collections to start from: primers (Tm worked out from the sequence) and glycerol stocks.
  const primers = stockType('primer');
  const glycerol = stockType('glycerol');
  const collection = (type: typeof primers, rows: string[][]) =>
    file(
      { kind: 'stocks', id: '', title: type.name, tags: [], created: now, modified: now, extra: { stock: type.id, prefix: type.prefix } },
      writeStockTable({
        columns: type.columns,
        rows: rows.map((r) => type.columns.map((_, i) => r[i] ?? '')),
        before: '',
        after: '',
      }),
    );
  await vault.write(
    join(LAYOUT.stocks, `${primers.name}.md`),
    collection(primers, [
      ['PR-0001', 'EGFP-fwd', 'ATGGTGAGCAAGGGCGAGGAG', '', '', '', 'EGFP', 'Primer box 1 · A1', today, ''],
      ['PR-0002', 'EGFP-rev', 'TTACTTGTACAGCTCGTCCATGCC', '', '', '', 'EGFP', 'Primer box 1 · A2', today, ''],
      ['PR-0003', 'M13-fwd (-20)', 'GTAAAACGACGGCCAGT', '', '', '', 'pUC / M13 vectors', 'Primer box 1 · A3', today, 'Sequencing primer'],
    ]),
  );
  await vault.write(
    join(LAYOUT.stocks, `${glycerol.name}.md`),
    collection(glycerol, [['GS-0001', 'pUC19 in NEB 5-alpha', 'NEB 5-alpha', 'pUC19', 'Ampicillin', '−80 °C · Box 2 · A1', today, '']]),
  );

  const board = join(LAYOUT.boards, 'Lab tasks');
  await vault.write(
    join(board, LAYOUT.boardFile),
    file(
      {
        kind: 'board',
        id: 'lab-tasks',
        title: 'Lab tasks',
        tags: [],
        columns: DEFAULT_BOARD_COLUMNS,
        created: now,
        modified: now,
        description: 'Orders, prep and anything else that is not an experiment.',
        extra: { cards: 'tasks' },
      },
      '',
    ),
  );
  const day = (offset: number) => localDate(new Date(Date.now() + offset * 86400000));
  const p = config.cardPrefix;
  const cards: SeedMeta[] = [
    {
      kind: 'card',
      id: `${p}0001`,
      title: 'Order Q5 polymerase and dNTPs',
      status: 'todo',
      order: 1,
      due: day(3),
      priority: 'high',
      tags: ['orders'],
      created: now,
      modified: now,
    },
    {
      kind: 'card',
      id: `${p}0002`,
      title: 'Pour LB + ampicillin plates',
      status: 'doing',
      order: 1,
      due: day(1),
      priority: 'medium',
      tags: ['prep'],
      created: now,
      modified: now,
    },
    { kind: 'card', id: `${p}0003`, title: 'Autoclave pipette tips', status: 'done', order: 1, tags: ['prep'], created: now, modified: now },
  ];
  for (const c of cards) {
    const body = c.id.endsWith('0001') ? '- [ ] Get a quote\n- [ ] Check freezer stock first\n' : '';
    await vault.write(join(board, `${c.id} ${c.title}.md`), file(c, body));
  }
  await vault.write(
    join(LAYOUT.notes, 'Lab meeting.md'),
    file(
      { kind: 'note', id: 'note-lab-meeting', title: 'Lab meeting', tags: ['meeting'], date: today, created: now, modified: now },
      `## Updates

- Cloning of the EGFP construct: colonies on the plate, minipreps tomorrow.

## Ideas

- Try a lower annealing temperature for the GC-rich amplicon.

## Actions

- [ ] Order more Q5 polymerase
- [ ] Book the plate reader for Thursday`,
    ),
  );

  // A paper in the Literature library, cited by the example entry.
  const paper: RefInfo = {
    title: 'A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity',
    authors: ['Jinek, Martin', 'Chylinski, Krzysztof', 'Fonfara, Ines', 'Hauer, Michael', 'Doudna, Jennifer A.', 'Charpentier, Emmanuelle'],
    year: '2012',
    journal: 'Science',
    volume: '337',
    issue: '6096',
    pages: '816–821',
    doi: '10.1126/science.1225829',
    pmid: '22745249',
  };
  const paperPath = join(LAYOUT.literature, `${EXAMPLE_PAPER_ID} ${sanitizeFileName(paper.title)}.md`);
  await vault.write(
    paperPath,
    file(
      { kind: 'reference', id: EXAMPLE_PAPER_ID, title: paper.title, tags: ['crispr'], created: now, modified: now, extra: refExtra(paper) },
      `## Key points

- Cas9 cuts double-stranded DNA where a dual RNA (crRNA and tracrRNA) pairs with the target, next to a PAM.
- Its HNH domain cuts the strand that pairs with the guide; its RuvC-like domain cuts the other one.
- The two RNAs can be joined into a single guide RNA, which can be designed for any target.`,
    ),
  );

  // An example entry with the blocks people miss at first: a flow, a buffer and a citation.
  const folder = join(LAYOUT.projects, EXAMPLE_FOLDER);
  await vault.mkdir(folder);
  const cite = (text: string) => `[${text}](${encodeLinkPath(relative(folder, paperPath))})`;
  const buffer = bufferToMarkdown({
    name: 'RNP buffer',
    volume: '1',
    volumeUnit: 'mL',
    solvent: 'Nuclease-free water',
    rows: [
      { name: 'HEPES-KOH pH 7.5', stock: '1', stockUnit: 'M', final: '20', finalUnit: 'mM' },
      { name: 'KCl', stock: '2', stockUnit: 'M', final: '150', finalUnit: 'mM' },
      { name: 'MgCl₂', stock: '1', stockUnit: 'M', final: '1', finalUnit: 'mM' },
      { name: 'Glycerol', stock: '50', stockUnit: '%', final: '10', finalUnit: '%' },
      { name: 'DTT', stock: '1', stockUnit: 'M', final: '1', finalUnit: 'mM' },
    ],
  });
  await vault.write(
    join(folder, `${EXAMPLE_ENTRY_ID} ${sanitizeFileName(EXAMPLE_ENTRY_TITLE)}.md`),
    file(
      {
        kind: 'entry',
        id: EXAMPLE_ENTRY_ID,
        title: EXAMPLE_ENTRY_TITLE,
        status: 'in-progress',
        date: today,
        tags: ['example'],
        protocols: [protocolId(config, 3)],
        created: now,
        modified: now,
      },
      `> **This is an example entry.** It shows what an entry can hold. Try things here, then delete it (⋯ → Move to trash) when you no longer need it.

## Goal

Knock out EGFP in HEK293-GFP cells with Cas9 and a single guide RNA, as described by ${cite('Jinek et al., 2012')}. A citation is a link to the paper in your Literature: type **/** and choose _Cite a paper_.

## Plan

This is a **flow**: a series of experiments. Click **Start** on a step and it becomes its own entry; its status and result then show here. Add a flow with **/** → _Flow_.

<!-- gc:flow {"templates":{"1":"general-experiment","2":"cell-culture-passage","3":"general-experiment","4":"general-experiment"}} -->
1. Design and order the guide RNAs
2. Expand the HEK293-GFP cells
3. Electroporate the Cas9 RNPs
4. Check the knockout by flow cytometry

## RNP buffer

This is a **buffer**: give each stock and the final concentration you want, and it works out what to add. Change the final volume and every amount follows. Add one with **/** → _Buffer_.

${buffer}

## More blocks

Type **/** on an empty line for tables, files and images, plasmid maps, protocols, stocks and checklists. Hover over a toolbar button to see what it does.

- [ ] Explore the flow and the buffer
- [ ] Open the paper from the citation above`,
    ),
  );
}
