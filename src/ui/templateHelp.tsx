/** Guidance for building templates and sub-templates: the "New template" dialog, tips and the template check. */
import type { JSONContent } from '@tiptap/core';
import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CircleCheck, LayoutTemplate, Lightbulb, Link2, Puzzle, TriangleAlert } from 'lucide-react';
import { toast, useNotebook } from '../notebook/store';
import { createTemplate, readDoc } from '../notebook/actions';
import type { DocMeta } from '../notebook/model';
import { parseMarkdown } from '../markdown/parse';
import { sheetToMarkdown } from '../markdown/serialize';
import type { TemplateIssue, TemplateVariable } from '../templates/engine';
import { Dialog, openDialog } from './overlay';
import { EntryPicker } from './pickers';
import { dirname } from '../lib/path';

type Kind = 'template' | 'subtemplate';

const include = (d: DocMeta) => `<!-- gc:include ${JSON.stringify({ id: d.id, name: d.title })} -->`;

/** Suggested structure of a new entry template; linked sub-templates go under "Procedure". */
export function templateOutline(subtemplates: DocMeta[] = []): string {
  return [
    '## Aim',
    '',
    '*What question does this experiment answer?*',
    '',
    '**Sample:** {{Sample}} · **Date:** {{date}}',
    '',
    '## Materials',
    '',
    sheetToMarkdown({
      rows: [
        ['Reagent', 'Stock', 'Amount', 'Lot'],
        ['', '', '', ''],
      ],
    }).trim(),
    '',
    '## Procedure',
    '',
    ...(subtemplates.length ? subtemplates.flatMap((d) => [include(d), '']) : ['1.', '']),
    '## Results',
    '',
    '*Add tables, gel images and files here.*',
    '',
    '## Conclusion and next steps',
    '',
    '- [ ]',
    '',
  ].join('\n');
}

/** A small sub-template that shows variables, a calculating table and a checklist. */
export function subtemplateExample(title: string): string {
  return [
    `### ${title || 'Procedure'}`,
    '',
    'Sample **{{Sample}}** · {{Reactions|4}} reactions',
    '',
    sheetToMarkdown({
      rows: [
        ['Component', '1 rxn (µL)', 'Master mix (µL)'],
        ['Buffer', '10', '=B2*{{Reactions|4}}'],
        ['Enzyme', '1', '=B3*{{Reactions|4}}'],
        ['Water', '9', '=B4*{{Reactions|4}}'],
        ['Total', '=SUM(B2:B4)', '=SUM(C2:C4)'],
      ],
    }).trim(),
    '',
    '- [ ] First step',
    '- [ ] Second step',
    '',
  ].join('\n');
}

function V({ children }: { children: string }) {
  return <code>{children}</code>;
}

/** A variable as the editor shows it. */
function T({ children }: { children: string }) {
  return <span className="gc-var-token">{children}</span>;
}

/** What happens to {{brackets}}: in the template, what a new entry asks, what the entry says. */
export function BracketsDemo() {
  return (
    <div className="gc-howto-demo" aria-label="Example: how a template is filled in">
      <div className="gc-howto-demo-col">
        <span className="gc-howto-demo-label">1 · In the template</span>
        <p>
          Digest <T>{'{{Plasmid}}'}</T> with <T>{'{{Enzyme|EcoRI}}'}</T>
        </p>
      </div>
      <ArrowRight className="gc-howto-arrow" aria-hidden="true" />
      <div className="gc-howto-demo-col">
        <span className="gc-howto-demo-label">2 · A new entry asks</span>
        <span className="gc-howto-field">
          <span>Plasmid</span>
          <span className="gc-howto-input">pUC19</span>
        </span>
        <span className="gc-howto-field">
          <span>Enzyme</span>
          <span className="gc-howto-input is-default">EcoRI</span>
        </span>
      </div>
      <ArrowRight className="gc-howto-arrow" aria-hidden="true" />
      <div className="gc-howto-demo-col">
        <span className="gc-howto-demo-label">3 · In the entry</span>
        <p>Digest pUC19 with EcoRI</p>
      </div>
    </div>
  );
}

/** The Templates page's introduction: what templates, brackets and sub-templates are, in three steps. */
export function TemplatesHowTo() {
  return (
    <section className="gc-howto" aria-labelledby="gc-howto-title">
      <h2 id="gc-howto-title" className="gc-howto-title">
        How templates work
      </h2>
      <ol className="gc-howto-steps">
        <li>
          <span className="gc-howto-num" aria-hidden="true">
            1
          </span>
          <div>
            <strong>A template is a ready-made entry.</strong>
            <p>
              Make one for each experiment you repeat. Then <em>New entry</em> → pick the template, and the entry starts as a copy of it.
            </p>
          </div>
        </li>
        <li>
          <span className="gc-howto-num" aria-hidden="true">
            2
          </span>
          <div>
            <strong>{'{{Double brackets}}'} are blanks to fill in.</strong>
            <p>
              Write <V>{'{{Plasmid}}'}</V> where the value changes. A new entry asks for it once and puts the answer in every place. After a bar comes
              a default: <V>{'{{Enzyme|EcoRI}}'}</V>.
            </p>
          </div>
        </li>
        <li>
          <span className="gc-howto-num" aria-hidden="true">
            3
          </span>
          <div>
            <strong>Sub-templates are building blocks.</strong>
            <p>
              A block such as <em>PCR (Q5)</em> can sit in many templates. Improve it once and every template that uses it changes too.
            </p>
          </div>
        </li>
      </ol>
      <BracketsDemo />
      <p className="gc-howto-more">
        Brackets also work in table cells and formulas, buffers and flow steps. <V>{'{{date}}'}</V> <V>{'{{author}}'}</V> <V>{'{{id}}'}</V>{' '}
        <V>{'{{project}}'}</V> fill themselves in.
      </p>
    </section>
  );
}

/** Step-by-step explanation of how templates or sub-templates work. */
export function TemplateGuide({ kind }: { kind: Kind }) {
  if (kind === 'subtemplate')
    return (
      <div className="gc-guide">
        <h3>
          <Puzzle /> How sub-templates work
        </h3>
        <ol className="gc-help-steps">
          <li>
            <strong>One procedure per sub-template</strong>: a PCR mix, a gel, a transformation. Small blocks fit in many templates.
          </li>
          <li>
            <strong>Add it to templates</strong> with <kbd>/</kbd> → <em>Sub-template</em>. <em>Linked</em> blocks stay in sync: improve the
            sub-template once and every template that uses it gets the change for its next entries. Existing entries keep their copy.
          </li>
          <li>
            <strong>Mark what changes</strong> with variables such as <V>{'{{Primer}}'}</V> or <V>{'{{Volume (µL)|20}}'}</V>. The template asks for
            them; a name used in several blocks, such as <V>{'{{Construct}}'}</V>, is asked once.
          </li>
          <li>
            <strong>Let tables calculate</strong>: <V>{'=B2*{{Reactions|4}}'}</V> scales a master mix to the number of reactions.
          </li>
          <li>
            <strong>Already wrote it in an entry?</strong> Select that part and choose <em>⋯ → Save selection as sub-template</em>.
          </li>
        </ol>
        <div className="gc-example" aria-label="Example">
          <span>{'{{Reactions|4}} × 10 µL'}</span>
          <ArrowRight />
          <span>4 × 10 µL</span>
        </div>
      </div>
    );
  return (
    <div className="gc-guide">
      <h3>
        <LayoutTemplate /> How templates work
      </h3>
      <ol className="gc-help-steps">
        <li>
          <strong>Write what every entry needs</strong>: headings, tables, checklists, files. Each new entry starts as a copy.
        </li>
        <li>
          <strong>Put {'{{double brackets}}'} where the value changes</strong>, e.g. <V>{'{{Plasmid}}'}</V>. A new entry asks for it and fills it in
          everywhere. <V>{'{{Enzyme|EcoRI}}'}</V> gives a default.
        </li>
        <li>
          <strong>Reuse blocks</strong> with <kbd>/</kbd> → <em>Sub-template</em>: they stay in step with the sub-template.
        </li>
        <li>
          <strong>Name new entries</strong> with the <em>Entry title</em> above, e.g. <V>{'Cloning of {{Construct}}'}</V>, and link the protocols they
          follow.
        </li>
      </ol>
      <BracketsDemo />
      <p className="gc-help-note">
        Fill themselves in: <V>{'{{date}}'}</V> <V>{'{{time}}'}</V> <V>{'{{weekday}}'}</V> <V>{'{{id}}'}</V> <V>{'{{title}}'}</V>{' '}
        <V>{'{{author}}'}</V> <V>{'{{project}}'}</V>
      </p>
    </div>
  );
}

/** Result of checking a template, shown in its header. */
export function TemplateCheck({ issues, variables }: { issues: TemplateIssue[]; variables: TemplateVariable[] }) {
  const warnings = issues.filter((i) => i.level === 'warning');
  const tips = issues.filter((i) => i.level === 'tip');
  return (
    <div className="gc-check-result">
      {warnings.length === 0 && (
        <span className="gc-check-ok">
          <CircleCheck /> Ready to use
          {variables.length ? ` · asks for ${variables.length} value${variables.length > 1 ? 's' : ''}` : ''}
        </span>
      )}
      {[...warnings, ...tips].map((i) => (
        <span key={i.message} className={`gc-issue is-${i.level}`}>
          {i.level === 'warning' ? <TriangleAlert /> : <Lightbulb />}
          {i.message}
        </span>
      ))}
    </div>
  );
}

// ───────────── New template / sub-template ─────────────

type Start = 'outline' | 'blank' | 'entry';

function NewTemplateDialog({ kind, close }: { kind: Kind; close: () => void }) {
  const docs = useNotebook((s) => s.docs);
  const isTpl = kind === 'template';
  const all = useMemo(() => Object.values(docs), [docs]);
  const subtemplates = useMemo(() => all.filter((d) => d.kind === 'subtemplate').sort((a, b) => a.title.localeCompare(b.title)), [all]);
  const entries = useMemo(
    () =>
      all
        .filter((d) => d.kind === 'entry')
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 200),
    [all],
  );
  const protocolsById = useMemo(() => new Map(all.filter((d) => d.kind === 'protocol').map((d) => [d.id, d])), [all]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [entryTitle, setEntryTitle] = useState('');
  const [start, setStart] = useState<Start>('outline');
  const [entry, setEntry] = useState(entries[0]?.path ?? '');
  const [includes, setIncludes] = useState<string[]>([]);
  const [protocols, setProtocols] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const chosenSubs = includes.map((p) => subtemplates.find((d) => d.path === p)).filter((d): d is DocMeta => !!d);

  const create = async () => {
    setBusy(true);
    try {
      let markdown = '';
      let content: JSONContent | undefined;
      let sourceFolder: string | undefined;
      if (start === 'entry' && entry) {
        const { body } = await readDoc(entry);
        markdown = body.replace(/\s*$/, '\n\n') + chosenSubs.map(include).join('\n\n');
        sourceFolder = dirname(entry);
      } else if (start === 'outline') {
        markdown = isTpl ? templateOutline(chosenSubs) : subtemplateExample(title.trim());
      } else {
        markdown = chosenSubs.map(include).join('\n\n');
      }
      if (markdown.trim()) content = parseMarkdown(markdown).toJSON() as JSONContent;
      await createTemplate({ kind, title, description, entryTitle: isTpl ? entryTitle : undefined, protocols, content, sourceFolder });
      toast(
        isTpl ? 'Template created. Fill it in, then use it from New entry.' : 'Sub-template created. Insert it in templates with / → Sub-template.',
        'success',
      );
      close();
    } catch (err) {
      toast(`Could not create it: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };

  const addProtocol = () =>
    openDialog((closePicker) => (
      <EntryPicker
        title="Link a protocol"
        kinds={['protocol']}
        close={closePicker}
        exclude={protocols.map((id) => protocolsById.get(id)?.path ?? '')}
        placeholder="Search protocols…"
        empty="No protocols yet. Create them on the Protocols page."
        onPick={(d) => setProtocols((cur) => (cur.includes(d.id) ? cur : [...cur, d.id]))}
      />
    ));

  return (
    <Dialog
      title={isTpl ? 'New entry template' : 'New sub-template'}
      icon={isTpl ? <LayoutTemplate className="gc-dialog-icon" /> : <Puzzle className="gc-dialog-icon" />}
      onClose={close}
      wide
      className="gc-create-dialog"
      footer={
        <>
          <span className="muted gc-footer-hint">Saved as a Markdown file in {isTpl ? 'Templates/' : 'Templates/Sub-templates/'}</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void create()}>
            {isTpl ? 'Create template' : 'Create sub-template'}
          </button>
        </>
      }
    >
      <div className="gc-create-grid">
        <form
          className="gc-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void create();
          }}
        >
          <div className="field">
            <label htmlFor="nt-title">Name</label>
            <input
              id="nt-title"
              className="input"
              autoFocus
              value={title}
              placeholder={isTpl ? 'e.g. Western blot' : 'e.g. BCA protein assay'}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="field-hint">
              {isTpl ? 'Name it after the kind of experiment, as you would pick it from New entry.' : 'Name it after the procedure it describes.'}
            </span>
          </div>
          <div className="field">
            <label htmlFor="nt-desc">Description (optional)</label>
            <input
              id="nt-desc"
              className="input"
              value={description}
              placeholder={isTpl ? 'e.g. SDS-PAGE, transfer, blocking and detection' : 'e.g. Protein concentration in a 96-well plate'}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {isTpl && (
            <div className="field">
              <label htmlFor="nt-entry-title">Entry title (optional)</label>
              <input
                id="nt-entry-title"
                className="input mono"
                value={entryTitle}
                placeholder="e.g. Western blot of {{Protein}}"
                onChange={(e) => setEntryTitle(e.target.value)}
              />
              <span className="field-hint">Titles new entries from the values you fill in. Leave empty to type a title each time.</span>
            </div>
          )}
          <fieldset className="gc-choice-group">
            <legend className="field-label">Start from</legend>
            <label className={`gc-choice ${start === 'outline' ? 'active' : ''}`}>
              <input type="radio" name="nt-start" checked={start === 'outline'} onChange={() => setStart('outline')} />
              <span>
                <strong>{isTpl ? 'Suggested outline' : 'Example to adapt'}</strong>
                <small>
                  {isTpl
                    ? 'Aim, materials, procedure, results and next steps, with a {{Sample}} variable to show how values are filled in'
                    : 'A heading, a reagent table whose master mix scales with {{Reactions|4}}, and a checklist'}
                </small>
              </span>
            </label>
            <label className={`gc-choice ${start === 'blank' ? 'active' : ''}`}>
              <input type="radio" name="nt-start" checked={start === 'blank'} onChange={() => setStart('blank')} />
              <span>
                <strong>Blank page</strong>
                <small>Write everything yourself</small>
              </span>
            </label>
            <label className={`gc-choice ${start === 'entry' ? 'active' : ''} ${entries.length ? '' : 'is-disabled'}`}>
              <input type="radio" name="nt-start" disabled={!entries.length} checked={start === 'entry'} onChange={() => setStart('entry')} />
              <span>
                <strong>Copy of an entry</strong>
                <small>Reuse an experiment you already wrote; replace its specific values with {'{{variables}}'} afterwards</small>
              </span>
            </label>
            {start === 'entry' && (
              <select className="select gc-choice-extra" aria-label="Entry to copy" value={entry} onChange={(e) => setEntry(e.target.value)}>
                {entries.map((d) => (
                  <option key={d.path} value={d.path}>
                    {d.id} {d.title}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
          {isTpl && subtemplates.length > 0 && (
            <div className="field">
              <span className="field-label">Include sub-templates (linked)</span>
              <div className="gc-checklist">
                {subtemplates.map((d) => (
                  <label key={d.path} className="gc-check-chip" title={d.description}>
                    <input
                      type="checkbox"
                      checked={includes.includes(d.path)}
                      onChange={(e) => setIncludes((cur) => (e.target.checked ? [...cur, d.path] : cur.filter((p) => p !== d.path)))}
                    />
                    {d.title}
                  </label>
                ))}
              </div>
              <span className="field-hint">They are added in the order you tick them. You can add more later with / → Sub-template.</span>
            </div>
          )}
          {isTpl && (
            <div className="field">
              <span className="field-label">Protocols (optional)</span>
              <div className="gc-tags">
                {protocols.map((id) => (
                  <span key={id} className="gc-link-chip is-protocol">
                    <button type="button" disabled>
                      <BookOpen /> <span className="mono">{id}</span> <span className="gc-link-chip-title">{protocolsById.get(id)?.title}</span>
                    </button>
                    <button
                      type="button"
                      className="gc-tag-x"
                      aria-label={`Remove ${id}`}
                      onClick={() => setProtocols(protocols.filter((x) => x !== id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="gc-add-chip" onClick={addProtocol}>
                  <Link2 /> Link protocol
                </button>
              </div>
              <span className="field-hint">Entries created from this template link these protocols.</span>
            </div>
          )}
          <button type="submit" hidden />
        </form>
        <aside className="gc-help-panel" aria-label={isTpl ? 'How templates work' : 'How sub-templates work'}>
          <TemplateGuide kind={kind} />
        </aside>
      </div>
    </Dialog>
  );
}

export function openNewTemplateDialog(kind: Kind) {
  openDialog((close) => <NewTemplateDialog kind={kind} close={close} />);
}
