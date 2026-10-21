# Assaycraft

**Open it: [assaycraftlab.com](https://assaycraftlab.com)**. It works offline after the first visit and can be installed as an app.

A local-first electronic lab notebook (ELN) that runs in your browser. It has a Benchling-style notebook, a protocol library, Notion-style boards and a calendar. **Every entry is saved as a plain Markdown file** in a folder on your computer.

**New here? Read [How Assaycraft works](docs/GUIDE.md)**, a guide to each feature: entries, dynamic tables, the buffer calculator, templates, protocols, stocks, boards, the calendar, version history and storage.

![An entry created from the Molecular cloning template, with a SnapGene map](docs/screenshots/entry.png)

## What you get

- **Notebook entries** with IDs (`EXP-0001`), projects and folders, status, experiment dates, tags, author and lock/sign-off. Entries are written in a rich editor with headings, lists, checklists, sub/superscript (H₂O, 10⁶), highlights and links between entries; hover over a toolbar button to see what it does and its shortcut. Type `/` to insert blocks.
- **Excel-like tables** in any entry: formulas (`=SUM(B2:B9)`, `=ROUND(AVERAGE(C2:C4),2)`, `=IF(D2>0.5,"ok","low")`, `COUNTIF`, `STDEV`…), click cells to build a formula, fill-down and a drag fill handle, copy/paste with Excel and Google Sheets, insert/delete rows and columns, sorting, resizing, and CSV import/export. You can also paste a table from Excel straight into an entry.
- **Buffers and dilutions** (type `/buffer`): list the components with their stock and final concentrations, pick the units from a list (M, mM, µM, nM, mg/mL, µg/mL, ng/µL, %, X, U/mL…) and set the final volume in L, mL or µL. Assaycraft works out how much of each stock to add (C₁V₁ = C₂V₂) and how much water brings it up to volume. For a powder, choose **g/mol** and enter its molar mass: it tells you how much to weigh. Mistakes are explained ("the final concentration is above the stock"), rows can be pasted from Excel, and in templates `{{variables}}` work in buffers too. [More in the guide](docs/GUIDE.md#the-buffer-and-dilution-calculator).
- **File uploads**: drag and drop or paste images, PDFs, CSVs or anything else. Files are stored next to the entry. Images get captions and sizes (TIFFs from microscopes and gel imagers too, 16-bit included), PDFs preview inline (on phones too), and a CSV can be turned into a table.
- **SnapGene files** (`.dna`, and GenBank / FASTA): drop one into an entry to get a plasmid map using SnapGene's feature colours, a feature table, GC% and the sequence. The original file stays in your folder, ready to open in SnapGene.
- **Protocols**: your lab's reference methods (SOPs), with an ID (`P-0001`), a version, a status (draft, active, retired) and a history of what changed in each version.
- **Stocks**: your primers, plasmids, glycerol stocks, seeds, antibodies and cell lines, one table per collection with an ID for each (`PR-0001`). Primers get their length, GC % and Tm worked out from the sequence (nearest-neighbour, SantaLucia 1998, 50 mM Na⁺, 250 nM primer). Type `/stock` in an entry to link one (`PR-0001 EGFP-fwd`): a click opens its table with that stock picked out, its full sequence and details, and every entry that uses it. Add rows one by one, paste them from Excel or import a CSV; rename, add and remove columns; search finds single stocks too.
  - Link them from an entry's _Protocols_ field, or anywhere in the text with `/` → _Protocol_. You can also insert a copy of the steps to tick them off and note changes.
  - Link them in a template and every new entry from it is linked too. Start an entry straight from a protocol with _New entry with protocol_.
  - Click a linked protocol to read it in a side panel. Each protocol lists where it is used, and each entry lists the pages that link to it.
- **PDF protocols become editable protocols**: import a vendor protocol, a kit handbook or an SOP and it is converted in your browser into headings, numbered steps (with sub-steps), bullet lists, tables you can calculate in, figures, bold/italic, super- and subscripts and links. Page headers, footers and contents pages are left out and two-column pages are read in order. The PDF is kept with the protocol, to compare them side by side.
- **Templates and sub-templates**:
  - _Templates_ are ready-made entries for experiments you repeat, e.g. "Molecular cloning". A new entry starts as a copy.
  - _Sub-templates_ are reusable blocks (Q5 PCR, gel, Gibson, transformation, miniprep…). Templates include them by reference, so improving a sub-template once updates every template that uses it.
  - `{{Double brackets}}` such as `{{Plasmid}}` or `{{Enzyme|EcoRI}}` (with a default) are the blanks: a new entry asks for each one once and writes the answer everywhere it appears, including table cells, formulas, buffers and flow steps. The Templates page shows how, with an example.
  - _New template_ guides you: start from a suggested outline, a blank page or an existing entry, pick sub-templates and protocols, and read how it all works as you go. Each template is checked for missing sub-templates, broken `{{` braces and conflicting defaults.
  - You can save any entry as a template or a protocol, or any selection as a sub-template.
- **Flows** (type `/flow`): plan a series of experiments inside the entry that coordinates them, e.g. _Transformation → Incubation → Expression → Purification_. Each step starts as its own entry (from the step's template) when you click **Start**, and its card then shows that entry's status, date, lock and one-line **Result**. Inside a step, a bar says where it is in the flow (_Step 2 of 5 in EXP-0040_) with the steps before and after. In the file a flow is a numbered list of links. [How flows work](docs/GUIDE.md#flows-a-series-of-experiments).
- **Plate layouts** (type `/plate`): 24-, 48-, 96- or 384-well plate maps. Add samples, standards and blanks, then click or drag across wells, or fill a whole row or column; keyboard works too. Samples link to stocks or entries (the stock then lists the entry as using it), and the well list copies out for Excel or a plate reader. Saved as an ordinary table of wells. [More in the guide](docs/GUIDE.md#plate-layouts).
- **Trash**: deleted pages, boards and folders wait on the Trash page; restore them where they were, with their attachments, or delete them forever. [More in the guide](docs/GUIDE.md#trash).
- **Literature**: a library of the papers you read. Add one by DOI or PubMed ID (looked up on Crossref or PubMed; only the identifier is sent), by hand, or import BibTeX and RIS from Zotero, Mendeley or EndNote. Each paper is a page for your reading notes with its reference, DOI and PubMed links. Type `/cite` in an entry or note to cite one (`Jinek et al., 2012`, a link to the paper), and each paper lists where it is cited. Copy a citation or BibTeX, or export the library as a `.bib` file. [More in the guide](docs/GUIDE.md#literature).
- **Notes**: meeting notes, journal clubs and ideas on their own page, below Templates. A note is written like an entry but has only a date and tags: no ID, project or status, and it stays off the calendar and boards.
- **Kanban boards** (Notion-like):
  - The built-in **Experiments** board shows every entry by status; drag a card to change its status.
  - Your own boards come in two kinds, chosen when you make one (and switchable later from its **⋯** menu):
    - **Things to track** (the default): constructs, samples, orders… moving through the stages you name, e.g. _Designed → PCR → Assembled → Sequenced_. Cards have tags, linked entries and protocols and a full notes editor, but no due date, so they stay off the calendar.
    - **Tasks** (e.g. "Lab tasks"): to-dos with a due date and a priority. They show on the calendar and in Home's open tasks.
- **Calendar**: month, week and agenda views. Entries appear on their experiment date (including multi-day spans) and tasks on their due date. Drag to reschedule, or click a day to plan an entry or a task. The week starts on Monday or Sunday, as you choose in _Settings → Appearance_ (the activity graph on Home follows it too).
- **Version history**: every entry, protocol, template and stock collection keeps its earlier versions. _⋯ → Version history_ shows them by day, with what changed word by word (and in the properties, such as the status), lets you compare any version with the current one and restore it. A restore can be undone, as the version it replaces is kept too.
- **Search everything** with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd>, a home dashboard with a GitHub-style activity graph, a trash with undo, print to PDF, and export/import as a `.zip`.
- **A clean, modern interface**: white and neutral greys with blue highlights, and page properties in the style of Notion. Choose light or dark, an accent colour (blue, violet, green or graphite) and a sans or serif font in _Settings → Appearance_.
- **Works on phones and tablets**: the sidebar becomes a menu, pages and dialogs use the whole screen, boards swipe column by column and the calendar opens as an agenda. Handy for reading a protocol at the bench.

|                                                                   |                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Spreadsheet with formulas](docs/screenshots/table.png)          | ![SnapGene viewer](docs/screenshots/snapgene.png)                                    |
| ![Sub-templates inside a template](docs/screenshots/template.png) | ![New entry from a template](docs/screenshots/new-entry.png)                         |
| ![Kanban board](docs/screenshots/board.png)                       | ![Calendar](docs/screenshots/calendar.png)                                           |
| ![Protocol library](docs/screenshots/protocols.png)               | ![A protocol with its history and where it is used](docs/screenshots/protocol.png)   |
| ![Guided template creation](docs/screenshots/template-help.png)   | ![Home dashboard](docs/screenshots/home.png)                                         |
| ![Welcome screen](docs/screenshots/welcome.png)                   | ![Dark mode](docs/screenshots/dark.png)                                              |
| ![Importing a PDF protocol](docs/screenshots/pdf-import.png)      | ![The converted protocol next to the original PDF](docs/screenshots/pdf-compare.png) |

![Stocks: a primer opened from an entry, with its sequence, Tm and where it is used](docs/screenshots/stocks.png)

![A buffer: what to add of each stock, and how much NaCl to weigh](docs/screenshots/buffer.png)

![A PCR mix in the buffer calculator](docs/screenshots/buffer-pcr.png)

![A flow: each step is an entry, with its status and result on the plan](docs/screenshots/flow.png)

![Version history: the changes of each editing session, word by word](docs/screenshots/history.png)

![Assaycraft on a phone: home, a protocol and the menu](docs/screenshots/mobile.png)

## Getting started

You need [Node.js](https://nodejs.org) 22.13 or later.

```bash
npm install
npm run dev          # opens on http://localhost:5173
```

### Use it without a server (one HTML file)

```bash
npm run build:single # → dist-single/assaycraft.html
```

`assaycraft.html` is the whole app in a single file. Double-click it (or keep it next to your notebook) and it works offline from `file://`.

### Put it online (installable, works offline)

```bash
npm run build        # → dist/
```

Upload the `dist/` folder to any static host (for example Cloudflare Pages, Netlify or GitHub Pages). Only the app is online; notebooks stay on each device, so the host only ever serves the same few files.

**Cloudflare Pages** (free, no bandwidth limit for static files):

- _From GitHub_: Workers & Pages → Create → Pages → Connect to Git, pick this repository, then set the build command to `npm run build` and the output directory to `dist`. Every push publishes a new version.
- _Or by hand_: Workers & Pages → Create → Pages → Upload assets, and drop the `dist/` folder (or `npx wrangler pages deploy dist`).
- Add your own domain under the project's _Custom domains_; Cloudflare Registrar sells domains at cost.

Keep the same address once people use it: notebooks in browser storage, the offline copy, the installed app and the browser's permission to open each notebook folder all belong to the address. To move to a new one, export each browser-storage notebook as a .zip at the old address and open it at the new one (folder notebooks only need to be opened again).

- **It works offline after the first visit**: the app keeps a copy of itself on the device (_Settings → About_ says so).
- **Install it as an app**: in Chrome or Edge, use the install button in the address bar; on a phone, _Add to Home Screen_. It then opens in its own window with the Assaycraft icon.
- **Updates**: when you upload a new version, open copies download it in the background and offer a **Reload**.

### Choosing where the notebook lives

When you start, Assaycraft asks how to store the notebook:

- **Open a notebook folder (recommended).** Pick an empty folder, or one you used before. Everything is saved there as Markdown, so you can back it up, put it in Git or read it with any editor (VS Code, Obsidian, GitHub). This needs a Chromium browser such as Chrome, Edge, Brave or Arc. The browser remembers the folder and may ask you to allow access again after a restart.
- **Browser storage.** Works in any browser (Firefox, Safari…). The notebook lives inside the browser; use _Export notebook (.zip)_ to back it up.

Changes are saved automatically. If you edit a file in another program, Assaycraft picks the change up when you come back to the window.

A new notebook starts a short **tour**: it asks for your name (the author of your entries), points at each part of the app and shows the flow and buffer calculator of an **example entry** (`Projects/Getting started/EXAMPLE-1`, outside your `EXP-` numbering). Skip it, or take it again from _Settings → About_, the notebook menu or search.

## How your notebook is stored

```
My Notebook/
├── assaycraft.json                      notebook settings (name, author, ID prefixes, statuses)
├── .assaycraft/activity.json            the documents you edited each day (the activity graph on Home)
├── .assaycraft/history/EXP-0012.json     earlier versions of each document (Version history)
├── Projects/
│   └── CRISPR screen/
│       ├── EXP-0012 Cloning of pX330-GFP.md
│       └── attachments/
│           └── EXP-0012/
│               ├── gel 1.png
│               └── pX330-GFP.dna
├── Protocols/
│   └── P-0001 Chemically competent E. coli (CaCl₂).md
├── Stocks/
│   ├── Primers.md                     one table per collection: PR-0001, PR-0002…
│   └── Glycerol stocks.md
├── Notes/
│   └── Lab meeting.md                 meeting notes and ideas (no ID or project)
├── Literature/
│   └── Jinek2012 A programmable….md   one paper: its reference and your reading notes
├── Templates/
│   ├── Molecular cloning.md           entry templates
│   └── Sub-templates/
│       └── PCR (Q5).md                reusable blocks
├── Boards/
│   └── Lab tasks/
│       ├── _board.md                  columns of the board
│       └── T-0003 Order Q5 polymerase.md
└── .trash/                            deleted items, and trash.json: where each came from (the Trash page restores them)
```

Notebooks made with Labcraft (this app's earlier name) open as they are: the first time, `labcraft.json` is renamed `assaycraft.json` and `.labcraft/` becomes `.assaycraft/`.

An entry is ordinary Markdown with YAML front matter:

```markdown
---
id: EXP-0012
title: Cloning of pX330-GFP
status: in-progress
date: 2026-10-16
tags: [cloning]
protocols: [P-0001, P-0002]
author: Joel
created: 2026-10-16T09:12:44+02:00
modified: 2026-10-16T11:03:02+02:00
template: Molecular cloning
---

## Goal

Clone **EGFP** into **pX330**. Water is H<sub>2</sub>O.

<!-- gc:table {"f":{"E2":"=D2*$D$10"}} -->

| Component           | Stock | Final | 1 rxn (µL) | Master mix (µL) |
| ------------------- | ----- | ----- | ---------: | --------------: |
| Nuclease-free water |       |       |       32.5 |             130 |

![gel 1](attachments/EXP-0012/gel%201.png)

[pX330-GFP.dna](attachments/EXP-0012/pX330-GFP.dna)

- [x] Transform into NEB 5-alpha
- [ ] Miniprep 4 colonies
```

- **Tables** are standard GFM tables showing the computed values. Formulas and column widths are kept in an HTML comment just above each table, so the file reads well anywhere and nothing is lost.
- **Buffers** are tables too: Component, Stock, Final and the amount to Add, with the final volume and solvent in a comment above: `<!-- gc:buffer {"name":"Lysis buffer","volume":"50 mL","solvent":"Water"} -->`. A buffer table edited by hand is read back and recalculated.
- **Flows** are numbered lists under a comment: each step is its name, or a link to the entry that carries it out, and the comment keeps the template of each step: `<!-- gc:flow {"templates":{"3":"general-experiment"}} -->`. The status, dates and result of a step are read from its entry (`result:` in its front matter).
- **Plate layouts** are a comment with the plate's name, format and samples (their colour and the stock or entry each is linked to), then a table with one cell per well: `<!-- gc:plate {"name":"ELISA 1","format":96,"samples":[{"name":"WT","color":"blue","ref":"GS-0001"}]} -->`. A plate table edited by hand, or pasted from Excel, is read back; new names in it become samples.
- **Attachments** are links to files in `attachments/<entry id>/`.
- **Stocks** are one Markdown file per collection in `Stocks/` (front matter `kind: stocks`, `stock:` the kind, `prefix:` for new IDs) holding a plain table whose first column is the ID. Length, GC % and Tm are written into the table too, so the file reads on its own. A link to one stock is an ordinary link with the ID as its fragment: `[PR-0001 EGFP-fwd](../../Stocks/Primers.md#PR-0001)`.
- **Protocols** an entry follows are listed by ID in `protocols:`. A protocol's file has `version:` and a `revisions:` list (version, date, note). A protocol imported from a PDF has `source:`, the path of the original PDF (kept in `Protocols/attachments/<id>/` with the figures).
- **Papers** are one Markdown file each in `Literature/`, named after the citation key, with `kind: reference` and the reference in the front matter (`authors:` one per line, `year:`, `journal:`, `volume:`, `issue:`, `pages:`, `doi:`, `pmid:`, `url:`). A citation is a relative link whose text is the short citation: `[Jinek et al., 2012](../../Literature/Jinek2012%20A%20programmable….md)`.
- **Links** to other entries or protocols are ordinary relative links: `[P-0001 Competent cells](../../Protocols/P-0001%20Competent%20cells.md)`.
- **Sub-template references** (inside templates only) are comments: `<!-- gc:include {"id":"pcr-q5","name":"PCR (Q5)"} -->`.
- Unknown HTML or Markdown is kept exactly as written.

## Templates in practice

1. Open **Templates → New template** (or **New sub-template**). The dialog explains each step and lets you start from a suggested outline, a blank page or one of your entries. You can also select part of an entry and choose **⋯ → Save selection as sub-template**.
2. In a template, type `/sub` to insert sub-templates. They stay linked; use **Copy** if you want to edit one locally.
3. Write `{{Name}}` or `{{Name|default}}` where a value changes from run to run. Set the template's _Entry title_ (e.g. `Cloning of {{Construct}}`) and link the protocols it follows.
4. Check the template's header: _Check_ says whether it is ready, or what to fix. **How to build it** shows the tips again.
5. **New entry → pick the template → fill in the fields.** The entry gets a full copy, with the values filled in, the template's protocols linked and any template files copied into its own attachments folder.

Built-in variables: `{{date}}`, `{{time}}`, `{{weekday}}`, `{{id}}`, `{{title}}`, `{{author}}`, `{{project}}`.

## Protocols in practice

1. Open **Protocols → New protocol**. Start from the standard outline (purpose, materials, procedure, notes and safety) or copy an entry where you already wrote the method.
2. When you change it, use **Release new version** and say what changed. **Lock** it once it is approved.
3. In an entry, add it to the _Protocols_ field, or type `/protocol` to link it in the text or insert a copy of its steps. From a protocol, **New entry with protocol** does both at once.
4. The protocol's _Used in_ list shows every entry, template and task that links to it.

## Version history

Open it from a page's **⋯** menu (or a stock collection's menu) → _Version history_.

- **When a version is kept**: once per editing session. When you start editing a page again after a break of 10 minutes or more (or after an hour of non-stop editing), the page as it was is kept as a version. Restoring a version also keeps the one it replaces, marked _Before restoring_, so a restore can be undone.
- **What you see**: the versions by day, each with the number of words added and removed. Pick one to see what changed in it (edited lines word by word, changed properties such as the title or status), or switch to _Compare with current_. Long unchanged stretches are folded; click to unfold them.
- **Where it is stored**: in the notebook itself, in `.assaycraft/history/`, one file per page (by its ID, so it follows renames and moves). The newest version is stored whole and each older one only as the changes to the next, so a page edited hundreds of times takes a few times its own size, not hundreds.
- **How long versions are kept**: every version from the last 24 hours, then the last one of each hour for a week, of each day for three months, and of each week after that (at most 500 per page). The very first version and those kept before a restore always stay.
- The page's own Markdown file is always the current version, so other apps see nothing different. History is included when you export the notebook as a .zip, but not brought in when you import a .zip into another notebook (the IDs there may belong to other pages).

## Importing PDF protocols

1. Open **Protocols → Import PDF**, or drop PDFs onto the Protocols page. You can also choose **New protocol → From a PDF**. With one PDF you can check the name and purpose found in it before creating the protocol; several PDFs are imported one after the other.
2. Assaycraft reads the PDF in your browser (nothing is uploaded) and rebuilds it as an editable protocol:
   - the biggest text on the first page becomes the name, and a subtitle under it the purpose;
   - bigger and bold lines become headings; `1.`, `a)`, `Step 3`, `•` and drawn bullets become numbered steps and lists, nested where they are indented, and the numbering continues after a note or a heading;
   - aligned columns and bordered tables become tables, with the column widths of the PDF;
   - figures are saved as images where they appear; running headers, footers, page numbers and contents pages are left out; words split at the end of a line are joined again.
3. The new protocol is a _Draft_ at version 1.0, with “Imported from …” in its history. Click **Compare with the PDF** (or **Original PDF** at the top) to see the original next to it, fix what the conversion missed, then set the status to _Active_.

PDFs made from documents (Word, Google Docs, LaTeX, vendor manuals) convert best. A scanned PDF has no text to read: its pages are added as images, with the PDF attached, so you can type the steps underneath. Very complex layouts (tables inside tables, text in boxes beside other text) may need some tidying.

## On a phone or tablet

Assaycraft adapts to small screens: the ☰ button opens the menu, dialogs and side panels fill the screen, boards scroll one column at a time and the calendar starts as an agenda. Protocols and attached PDFs can be read and ticked off at the bench.

Phones cannot open folders, and they usually cannot run an HTML file saved on the phone, so:

1. **Put the app online once** (see [Put it online](#put-it-online-installable-works-offline)). Open the address on the phone and use _Add to Home Screen_: after the first visit it also works without a connection.
2. **Bring your notebook**: on the computer, use the notebook menu → _Export notebook (.zip)_; on the phone, choose **Open a .zip…** on the welcome screen. The notebook is then stored in the phone's browser.

The copy on the phone does not sync back by itself. To bring notes made on the phone to the computer, export a .zip on the phone and use _Import .zip into notebook…_ on the computer: new files are added, unchanged ones are skipped, and a file that differs is added next to the existing one as a copy (“… (2).md”), so nothing is overwritten.

## Tables

| Action         | How                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Edit           | Type, double-click or press <kbd>Enter</kbd>/<kbd>F2</kbd>. <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a new line in the cell.          |
| Move           | Arrows, <kbd>Tab</kbd>, <kbd>Enter</kbd>. <kbd>Tab</kbd> past the last cell adds a row.                                           |
| Formulas       | Start with `=`. Click or drag over cells while typing a formula to insert references; `$A$1` stays fixed when copied.             |
| Fill           | <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Ctrl</kbd>+<kbd>R</kbd>, or drag the square handle. Number sequences such as `1, 2` continue. |
| Copy / paste   | Works with Excel and Google Sheets; formulas shift when pasted inside Assaycraft.                                                 |
| Rows / columns | Right-click for insert, delete, sort and clear. The `+` buttons on the edges add rows and columns.                                |

Functions: `SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK MEDIAN STDEV STDEVP VAR VARP PRODUCT SUMPRODUCT COUNTIF SUMIF AVERAGEIF ROUND ROUNDUP ROUNDDOWN INT TRUNC ABS SIGN SQRT POWER EXP LN LOG LOG10 LOG2 MOD CEILING FLOOR PI IF IFERROR AND OR NOT ISBLANK ISNUMBER ISTEXT ISERROR CONCAT LEN UPPER LOWER TRIM LEFT RIGHT MID VALUE TEXT`.

## Development

```bash
npm run dev            # dev server
npm run typecheck      # TypeScript
npm test               # unit tests (Vitest)
npm run test:e2e       # browser tests (Playwright; run `npm run build` and `npm run build:single` first to include the offline and single-file tests)
npm run build          # static site in dist/ (deployable to any static host; works offline after the first visit)
npm run build:single   # single offline file in dist-single/
npm run format         # Prettier
```

The Serif font option uses [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, bundled under the SIL Open Font License ([license](docs/licenses/Newsreader-OFL.txt)). PDFs are read with Mozilla's [PDF.js](https://mozilla.github.io/pdf.js/), bundled under the Apache License 2.0 ([license](docs/licenses/pdfjs-Apache-2.0.txt)); it is loaded only when you import or view a PDF. TIFF images are decoded with Photopea's [UTIF.js](https://github.com/photopea/UTIF.js) ([MIT license](docs/licenses/UTIF-MIT.txt)) and [pako](https://github.com/nodeca/pako) ([MIT license](docs/licenses/pako-MIT.txt)), loaded only when an entry has a TIFF.

The PDF tests use sample PDFs made with Word-style (LibreOffice), Chromium and ReportLab output: see [tests/fixtures/pdf](tests/fixtures/pdf/README.md).

Code layout:

| Path             | What                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `src/fs/`        | Storage: a folder on disk (File System Access API), or IndexedDB |
| `src/notebook/`  | Notebook model, front matter, saving, IDs, starter content       |
| `src/markdown/`  | Markdown ⇄ editor document (markdown-it + prosemirror-markdown)  |
| `src/editor/`    | TipTap editor, toolbar, `/` menu, file/image/sub-template blocks |
| `src/sheet/`     | Spreadsheet block and formula engine                             |
| `src/bio/`       | SnapGene / GenBank / FASTA readers and the plasmid map           |
| `src/templates/` | Sub-template expansion, variables, copying attached files        |
| `src/pdf/`       | PDF import: reading pages with PDF.js, rebuilding the layout     |
| `src/offline/`   | Offline copy of the hosted app (service worker)                  |
| `src/ui/`        | Pages: home, entries, protocols, boards, calendar, templates…    |
