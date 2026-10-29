/**
 * Template engine.
 *
 * Templates and sub-templates are ordinary Markdown documents. They may contain
 *   • variables: {{Plasmid}}, {{Enzyme|EcoRI}} (with a default), and built-ins such as {{date}}
 *   • sub-template references (include nodes) that expand to the sub-template's content
 * Files referenced by a template (images, attachments) are copied into the new entry.
 */
import type { JSONContent } from '@tiptap/core';
import { basename, extname, isRelativeFileLink, join, relative, splitFragment } from '../lib/path';
import { LOCALE } from '../lib/dates';

export const BUILTIN_VARIABLES = ['date', 'time', 'datetime', 'weekday', 'id', 'title', 'author', 'project'] as const;
const VAR_RE = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;
const ASSET_PREFIX = 'gcvault:';

export interface TemplateVariable {
  name: string;
  defaultValue: string;
}

function walk(node: JSONContent, fn: (n: JSONContent) => void) {
  fn(node);
  node.content?.forEach((c) => walk(c, fn));
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

function textsOf(node: JSONContent): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.type === 'text' && n.text) out.push(n.text);
    if (n.type === 'spreadsheet') {
      const rows = (n.attrs?.data as { rows?: string[][] } | null)?.rows ?? [];
      for (const row of rows) for (const cell of row) if (cell) out.push(cell);
    }
    if (n.type === 'image' && n.attrs?.alt) out.push(String(n.attrs.alt));
    if (n.type === 'flow') for (const s of flowSteps(n)) if (s.title) out.push(s.title);
    if (n.type === 'buffer') out.push(...bufferTexts(n));
    if (n.type === 'plate') out.push(...plateTexts(n));
  });
  return out;
}

type BufferFields = { name: string; volume: string; rows: { name: string; stock: string; final: string }[] };
const bufferOf = (n: JSONContent) => n.attrs?.data as BufferFields | null;
/** A buffer's name, final volume and components can hold {{variables}} too. */
const bufferTexts = (n: JSONContent) => {
  const d = bufferOf(n);
  return d ? [d.name, d.volume, ...d.rows.flatMap((r) => [r.name, r.stock, r.final])].filter(Boolean) : [];
};

type PlateFields = { name: string; samples: { name: string }[]; wells: Record<string, string> };
const plateOf = (n: JSONContent) => n.attrs?.data as PlateFields | null;
/** A plate's name and sample names can hold {{variables}}, e.g. a sample called {{Strain}}. */
const plateTexts = (n: JSONContent) => {
  const d = plateOf(n);
  return d ? [d.name, ...d.samples.map((s) => s.name)].filter(Boolean) : [];
};

const flowSteps = (n: JSONContent) => (n.attrs?.data as { steps?: { title: string }[] } | null)?.steps ?? [];

/**
 * Copies of a flow start over: a template, a duplicate or a new entry gets the plan (titles and
 * templates), not the entries that carried out the original's steps.
 */
export function resetFlows(json: JSONContent): JSONContent {
  const out = clone(json);
  walk(out, (n) => {
    if (n.type === 'flow' && n.attrs?.data)
      n.attrs.data = {
        steps: (n.attrs.data as { steps: { title: string; template?: string }[] }).steps.map((s) => ({
          title: s.title,
          ...(s.template ? { template: s.template } : {}),
        })),
      };
  });
  return out;
}

/** Variables the user should be asked for (built-ins excluded), in order of appearance. */
export function collectVariables(json: JSONContent, extraTexts: string[] = []): TemplateVariable[] {
  const found = new Map<string, TemplateVariable>();
  for (const text of [...extraTexts, ...textsOf(json)]) {
    for (const m of text.matchAll(VAR_RE)) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      if ((BUILTIN_VARIABLES as readonly string[]).includes(key)) continue;
      const prev = found.get(key);
      if (!prev) found.set(key, { name, defaultValue: m[2] ?? '' });
      else if (!prev.defaultValue && m[2]) prev.defaultValue = m[2];
    }
  }
  return [...found.values()];
}

/** Replace {{variables}}. Unknown variables without a default are left in place as a reminder. */
export function fillText(text: string, values: Record<string, string>): string {
  if (!text.includes('{{')) return text;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) lower[k.toLowerCase()] = v;
  return text.replace(VAR_RE, (whole, name: string, dflt: string | undefined) => {
    const v = lower[name.trim().toLowerCase()];
    if (v !== undefined && v !== '') return v;
    if (dflt !== undefined) return dflt;
    return v === '' ? '' : whole;
  });
}

export function fillVariables(json: JSONContent, values: Record<string, string>): JSONContent {
  const out = clone(json);
  walk(out, (n) => {
    if (n.type === 'text' && n.text) n.text = fillText(n.text, values);
    if (n.type === 'spreadsheet' && n.attrs?.data) {
      const data = n.attrs.data as { rows: string[][] };
      n.attrs.data = { ...data, rows: data.rows.map((r) => r.map((c) => fillText(c, values))) };
    }
    if (n.type === 'image' && n.attrs?.alt) n.attrs.alt = fillText(String(n.attrs.alt), values);
    if (n.type === 'flow' && n.attrs?.data) {
      const data = n.attrs.data as { steps: { title: string }[] };
      n.attrs.data = { ...data, steps: data.steps.map((s) => ({ ...s, title: fillText(s.title, values) })) };
    }
    const buffer = n.type === 'buffer' ? bufferOf(n) : null;
    if (buffer) {
      const f = (s: string) => fillText(s ?? '', values);
      n.attrs!.data = {
        ...buffer,
        name: f(buffer.name),
        volume: f(buffer.volume),
        rows: buffer.rows.map((r) => ({ ...r, name: f(r.name), stock: f(r.stock), final: f(r.final) })),
      };
    }
    const plate = n.type === 'plate' ? plateOf(n) : null;
    if (plate) {
      // The wells name their samples, so both are filled in alike.
      const f = (s: string) => fillText(s ?? '', values);
      n.attrs!.data = {
        ...plate,
        name: f(plate.name),
        samples: plate.samples.map((x) => ({ ...x, name: f(x.name) })),
        wells: Object.fromEntries(Object.entries(plate.wells).map(([w, x]) => [w, f(x)])),
      };
    }
  });
  // Text nodes that became empty are not allowed in ProseMirror documents.
  const prune = (n: JSONContent) => {
    if (n.content) {
      n.content = n.content.filter((c) => !(c.type === 'text' && !c.text));
      n.content.forEach(prune);
    }
  };
  prune(out);
  return out;
}

/** Link marks pointing at other files in the notebook. */
function fileLinks(n: JSONContent): { href: string; attrs: Record<string, unknown> }[] {
  const out: { href: string; attrs: Record<string, unknown> }[] = [];
  for (const m of n.marks ?? []) {
    if (m.type === 'link' && m.attrs) out.push({ href: String(m.attrs.href ?? ''), attrs: m.attrs });
  }
  return out;
}

/** Mark relative file references with their absolute notebook path (before content moves elsewhere). */
export function markAssets(json: JSONContent, folder: string): JSONContent {
  const out = clone(json);
  walk(out, (n) => {
    if ((n.type === 'image' || n.type === 'attachment') && n.attrs) {
      const src = String(n.attrs.src ?? '');
      if (src && !src.startsWith(ASSET_PREFIX) && isRelativeFileLink(src)) n.attrs.src = ASSET_PREFIX + join(folder, src);
    }
    for (const l of fileLinks(n)) {
      if (l.href && !l.href.startsWith(ASSET_PREFIX) && isRelativeFileLink(l.href)) {
        const [path, fragment] = splitFragment(l.href);
        l.attrs.href = ASSET_PREFIX + join(folder, path) + fragment;
      }
    }
  });
  return out;
}

export interface AssetCopy {
  from: string;
  to: string;
}

/**
 * Point marked file references at `targetFolder/attachments/targetId/…` and list the copies to make.
 * File names are de-duplicated (gel.png, gel (2).png). Links in the text (to entries, protocols or files)
 * are not copied: they are rewritten to point at the same file from the new folder.
 */
export function relocateAssets(
  json: JSONContent,
  targetFolder: string,
  targetId: string,
  taken: Set<string> = new Set(),
): { json: JSONContent; copies: AssetCopy[] } {
  const out = clone(json);
  const copies: AssetCopy[] = [];
  const byFrom = new Map<string, string>();
  walk(out, (n) => {
    for (const l of fileLinks(n)) {
      if (!l.href.startsWith(ASSET_PREFIX)) continue;
      const [path, fragment] = splitFragment(l.href.slice(ASSET_PREFIX.length));
      l.attrs.href = (relative(targetFolder, path) || basename(path)) + fragment;
    }
    if ((n.type !== 'image' && n.type !== 'attachment') || !n.attrs) return;
    const src = String(n.attrs.src ?? '');
    if (!src.startsWith(ASSET_PREFIX)) return;
    const from = src.slice(ASSET_PREFIX.length);
    let rel = byFrom.get(from);
    if (!rel) {
      const name = basename(from);
      const ext = extname(name);
      const base = ext ? name.slice(0, -ext.length) : name;
      let candidate = name;
      for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${name.slice(name.length - ext.length)}`;
      taken.add(candidate.toLowerCase());
      rel = `attachments/${targetId}/${candidate}`;
      byFrom.set(from, rel);
      copies.push({ from, to: join(targetFolder, rel) });
    }
    n.attrs.src = rel;
  });
  return { json: out, copies };
}

export interface ResolvedInclude {
  id: string;
  title: string;
  folder: string;
  json: JSONContent;
}

export type IncludeResolver = (ref: string, name: string) => Promise<ResolvedInclude | null>;

function warning(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'highlight' }], text }] };
}

/**
 * Replace sub-template references by their (recursively expanded) content.
 * File references are marked so they can be relocated afterward.
 */
export async function expandIncludes(json: JSONContent, folder: string, resolve: IncludeResolver, stack: string[] = []): Promise<JSONContent> {
  const root = markAssets(json, folder);
  const visit = async (node: JSONContent): Promise<void> => {
    if (!node.content) return;
    const next: JSONContent[] = [];
    for (const child of node.content) {
      if (child.type !== 'include') {
        await visit(child);
        next.push(child);
        continue;
      }
      const ref = String(child.attrs?.ref ?? '');
      const name = String(child.attrs?.name ?? ref);
      const resolved = await resolve(ref, name);
      if (!resolved) {
        next.push(warning(`⚠ Missing sub-template: ${name}`));
        continue;
      }
      if (stack.includes(resolved.id) || stack.length >= 12) {
        next.push(warning(`⚠ Sub-template “${resolved.title}” includes itself; skipped.`));
        continue;
      }
      const expanded = await expandIncludes(resolved.json, resolved.folder, resolve, [...stack, resolved.id]);
      next.push(...(expanded.content ?? []));
    }
    node.content = next;
  };
  await visit(root);
  return root;
}

/** Ids/names of sub-templates referenced directly by a document. */
export function includesOf(json: JSONContent): { ref: string; name: string }[] {
  const out: { ref: string; name: string }[] = [];
  walk(json, (n) => {
    if (n.type === 'include') out.push({ ref: String(n.attrs?.ref ?? ''), name: String(n.attrs?.name ?? '') });
  });
  return out;
}

export interface TemplateIssue {
  level: 'warning' | 'tip';
  message: string;
}

function hasContent(json: JSONContent): boolean {
  let found = false;
  walk(json, (n) => {
    if (n.type === 'text' ? !!n.text?.trim() : n.type !== 'doc' && n.type !== 'paragraph' && n.type !== 'hardBreak') found = true;
  });
  return found;
}

const short = (s: string) => (s.length > 48 ? s.slice(0, 47) + '…' : s);

/**
 * Problems in a template, found on its expanded content: missing or self-including sub-templates,
 * malformed {{variables}} and variables given different defaults.
 */
export function lintTemplate(expanded: JSONContent, opts: { kind: 'template' | 'subtemplate'; titlePattern?: string }): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const seen = new Set<string>();
  const add = (level: TemplateIssue['level'], message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    issues.push({ level, message });
  };
  const texts = textsOf(expanded);
  for (const t of texts) {
    if (t.startsWith('⚠ Missing sub-template: '))
      add('warning', `The sub-template “${t.slice(24)}” is missing. Insert it again with / → Sub-template, or remove the block.`);
    else if (t.startsWith('⚠ Sub-template')) add('warning', t.slice(2));
  }
  const defaults = new Map<string, { name: string; values: Set<string> }>();
  for (const t of opts.titlePattern ? [opts.titlePattern, ...texts] : texts) {
    const matches = [...t.matchAll(VAR_RE)];
    const opens = t.split('{{').length - 1;
    const closes = t.split('}}').length - 1;
    if (opens > matches.length || closes > matches.length)
      add('warning', `Check the braces in “${short(t.trim())}”. Variables are written {{Name}} or {{Name|default}}.`);
    for (const m of matches) {
      const key = m[1].trim().toLowerCase();
      if ((BUILTIN_VARIABLES as readonly string[]).includes(key) || m[2] === undefined || m[2] === '') continue;
      const d = defaults.get(key) ?? { name: m[1].trim(), values: new Set<string>() };
      d.values.add(m[2]);
      defaults.set(key, d);
    }
  }
  for (const d of defaults.values()) {
    if (d.values.size > 1) {
      const [first] = d.values;
      add('warning', `{{${d.name}}} has different defaults (${[...d.values].join(', ')}). The first one, ${first}, is used.`);
    }
  }
  if (!hasContent(expanded))
    add(
      'tip',
      'This template is empty. Add the headings, tables and checklists every entry needs, or start from an entry with ⋯ → Save as template.',
    );
  else if (opts.kind === 'template' && !opts.titlePattern)
    add('tip', 'No entry title: new entries start with the template’s name. Set one such as “Cloning of {{Construct}}”.');
  return issues;
}

export function builtinValues(ctx: { id: string; title: string; author: string; project: string; now?: Date }): Record<string, string> {
  const now = ctx.now ?? new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}:${p(now.getMinutes())}`;
  return {
    date,
    time,
    datetime: `${date} ${time}`,
    weekday: now.toLocaleDateString(LOCALE, { weekday: 'long' }),
    id: ctx.id,
    title: ctx.title,
    author: ctx.author,
    project: ctx.project,
  };
}
