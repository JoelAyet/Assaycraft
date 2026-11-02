/**
 * Syntax colors for code blocks (highlight.js grammars through lowlight). Loaded on first use,
 * so entries without code do not wait for it.
 */
import { createLowlight } from 'lowlight';
import type { Root, RootContent } from 'hast';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import perl from 'highlight.js/lib/languages/perl';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  julia,
  latex,
  markdown,
  matlab,
  perl,
  plaintext,
  powershell,
  python,
  r,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

/** What a block with no language is guessed among: what labs mostly write. */
const GUESS = ['python', 'r', 'bash', 'matlab', 'julia', 'javascript', 'json', 'yaml', 'sql', 'xml'];

export interface Span {
  from: number;
  to: number;
  className: string;
}

function flatten(nodes: RootContent[], classes: string[], out: Span[], start: number): number {
  let pos = start;
  for (const n of nodes) {
    if (n.type === 'text') {
      if (classes.length && n.value.length) out.push({ from: pos, to: pos + n.value.length, className: classes.join(' ') });
      pos += n.value.length;
    } else if (n.type === 'element') {
      const own = n.properties?.className;
      const names = Array.isArray(own) ? own.map(String) : [];
      pos = flatten(n.children, [...classes, ...names], out, pos);
    }
  }
  return pos;
}

/** The colored stretches of `code`, as offsets into it. */
export function highlightSpans(code: string, language: string | null): Span[] {
  if (!code) return [];
  let tree: Root;
  try {
    if (language && lowlight.registered(language)) tree = lowlight.highlight(language, code);
    else if (!language && code.length <= 20000) tree = lowlight.highlightAuto(code, { subset: GUESS });
    else return [];
  } catch {
    return [];
  }
  const out: Span[] = [];
  flatten(tree.children, [], out, 0);
  return out;
}

/** The language a block is guessed to be in, when it names none. */
export function guessLanguage(code: string): string | null {
  if (!code.trim() || code.length > 20000) return null;
  return (lowlight.highlightAuto(code, { subset: GUESS }).data?.language as string | undefined) ?? null;
}
