import YAML from 'yaml';

const FM_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n?^---[ \t]*(?:\r?\n|$)/m;

export interface SplitResult {
  data: Record<string, unknown>;
  body: string;
  hasFrontMatter: boolean;
}

/** Split "---\nyaml\n---\nbody" into parsed YAML data and the Markdown body. */
export function splitFrontMatter(text: string): SplitResult {
  const m = FM_RE.exec(text);
  if (!m || m.index !== 0) return { data: {}, body: text.replace(/^﻿/, ''), hasFrontMatter: false };
  try {
    const parsed: unknown = m[1].trim() ? YAML.parse(m[1]) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, body: text.slice(m[0].length).replace(/^\r?\n/, ''), hasFrontMatter: true };
    }
  } catch {
    // Invalid YAML: keep the whole file as the body so nothing is lost.
  }
  return { data: {}, body: text, hasFrontMatter: false };
}

const BLOCK_LISTS = new Set(['authors']);

/** Serialize front matter + body. Scalar lists (tags) are written inline: [a, b]. */
export function joinFrontMatter(data: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  const doc = new YAML.Document(clean);
  YAML.visit(doc, {
    Seq(_, node, path) {
      const parent = path[path.length - 1];
      // Authors are long and many: one per line reads better.
      if (YAML.isPair(parent) && YAML.isScalar(parent.key) && BLOCK_LISTS.has(String(parent.key.value))) return;
      if (node.items.every((it) => YAML.isScalar(it))) node.flow = true;
    },
  });
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const b = body.replace(/^\s*\n/, '');
  return `---\n${yaml}\n---\n\n${b}`;
}
