/**
 * A flow: the plan of a series of experiments, kept in the entry that coordinates them. Each step is
 * a title and, once started, the entry that carries it out. In Markdown it is a numbered list under a
 * comment, so the file reads well anywhere:
 *
 *   <!-- gc:flow {"templates":{"4":"protein-expression"}} -->
 *   1. [EXP-0041 Transformation of E. coli](EXP-0041%20Transformation%20of%20E.%20coli.md)
 *   2. Lab-scale production
 *
 * Status, dates and results are not stored here: each step shows those of its entry.
 */
import { basename, encodeLinkPath, safeDecode, stem } from '../lib/path';
import type { DocMeta, FlowStepRef } from '../notebook/model';

export interface FlowStep {
  title: string;
  /** ID of the entry that carries the step out, once it has been started. */
  ref?: string;
  /** Link to that entry, relative to the page that holds the flow. */
  href?: string;
  /** ID of the template a new entry for this step starts from. */
  template?: string;
}

export interface FlowData {
  steps: FlowStep[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function normalizeFlow(input: Partial<FlowData> | null | undefined): FlowData {
  const steps = Array.isArray(input?.steps) ? input.steps : [];
  return {
    steps: steps
      .filter((s): s is FlowStep => !!s && typeof s === 'object')
      .map((s) => {
        const step: FlowStep = { title: str(s.title) };
        if (str(s.ref)) step.ref = str(s.ref);
        if (str(s.href)) step.href = str(s.href);
        if (str(s.template)) step.template = str(s.template);
        return step;
      }),
  };
}

/** The ID in a link to a notebook page: pages with IDs are saved as "<ID> <title>.md". */
export function idFromHref(href: string): string | undefined {
  const path = safeDecode(href.split('#')[0]);
  if (!path.endsWith('.md')) return undefined;
  const first = stem(basename(path)).split(' ')[0];
  return /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(first) ? first : undefined;
}

/** A step read from one list item: its text, and the link if the item is only a link. */
export function stepFromItem(text: string, href: string | undefined): FlowStep {
  const ref = href ? idFromHref(href) : undefined;
  if (!href || !ref) return { title: text.trim() };
  const title = text.trim().startsWith(ref + ' ')
    ? text
        .trim()
        .slice(ref.length + 1)
        .trim()
    : text.trim();
  return { title, ref, href: safeDecode(href) };
}

/** Templates by step number (from 1), as kept in the comment. */
export function flowFromItems(items: { text: string; href?: string }[], meta: Record<string, unknown>): FlowData {
  const templates = (meta.templates && typeof meta.templates === 'object' ? meta.templates : {}) as Record<string, unknown>;
  return {
    steps: items.map((item, i) => {
      const step = stepFromItem(item.text, item.href);
      const t = str(templates[String(i + 1)]);
      return t ? { ...step, template: t } : step;
    }),
  };
}

/** Plain text that stays plain inside a list item. */
function escapeText(s: string): string {
  return s
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2')
    .replace(/^([-+#>])/, '\\$1');
}

/** JSON that is safe inside an HTML comment (no "--"). */
const commentJson = (value: unknown) => JSON.stringify(value).replace(/--/g, '-\\u002d');

export function flowToMarkdown(input: FlowData): string {
  const d = normalizeFlow(input);
  const templates: Record<string, string> = {};
  d.steps.forEach((s, i) => {
    if (s.template) templates[String(i + 1)] = s.template;
  });
  const lines = [`<!-- gc:flow${Object.keys(templates).length ? ' ' + commentJson({ templates }) : ''} -->`];
  d.steps.forEach((s, i) => {
    const title = s.title.replace(/\s+/g, ' ').trim();
    const text =
      s.ref && s.href
        ? `[${`${s.ref} ${title}`.trim().replace(/[\\[\]]/g, '\\$&')}](${encodeLinkPath(s.href)})`
        : escapeText(title) || 'Untitled step';
    lines.push(`${i + 1}. ${text}`);
  });
  return lines.join('\n');
}

const FLOW_RE = /^<!--\s*gc:flow\b[\s\S]*?-->[ \t]*\r?\n((?:[ \t]*\d+[.)][ \t]+.*(?:\r?\n|$))*)/m;
const LINK_ITEM_RE = /^\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)>\s]+)>?\s*\)\s*$/;

/** The steps of the first flow in a Markdown body, for pages that need them without parsing it all. */
export function flowStepRefs(body: string): FlowStepRef[] | undefined {
  const m = FLOW_RE.exec(body);
  if (!m) return undefined;
  const steps: FlowStepRef[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^[ \t]*\d+[.)][ \t]+(.*)$/.exec(line);
    if (!item) continue;
    const text = item[1].trim();
    const link = LINK_ITEM_RE.exec(text);
    const step = link ? stepFromItem(link[1].replace(/\\(.)/g, '$1'), link[2]) : { title: text.replace(/\\(.)/g, '$1') };
    steps.push(step.ref ? { title: step.title, ref: step.ref } : { title: step.title });
  }
  return steps;
}

/** Entries by ID, to look steps up. */
export function entriesById(docs: Iterable<DocMeta>): Map<string, DocMeta> {
  const out = new Map<string, DocMeta>();
  for (const d of docs) if (d.kind === 'entry' && d.id) out.set(d.id, d);
  return out;
}

/** A step is done when its entry is completed. */
export function flowProgress(steps: FlowStepRef[], byId: Map<string, DocMeta>): { done: number; total: number } {
  return { done: steps.filter((s) => s.ref && byId.get(s.ref)?.status === 'completed').length, total: steps.length };
}

/** The flow a page is a step of: the page that holds it, and where in it the step is. */
export function flowOfStep(id: string, docs: Iterable<DocMeta>): { parent: DocMeta; index: number } | undefined {
  if (!id) return undefined;
  for (const d of docs) {
    const index = d.flow?.findIndex((s) => s.ref === id) ?? -1;
    if (index >= 0 && d.id !== id) return { parent: d, index };
  }
  return undefined;
}
