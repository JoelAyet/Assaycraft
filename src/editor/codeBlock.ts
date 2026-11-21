/**
 * Code blocks: colored by language (see CodeBlockView for the bar above them). In Markdown they
 * stay fenced code blocks with the language after the fence (```python).
 */
import { Extension } from '@tiptap/core';
import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { rescanChanged, scanAll } from './incremental';

type Highlighter = typeof import('./codeHighlight');
let highlighter: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

export function loadHighlighter(): Promise<Highlighter> {
  loading ??= import('./codeHighlight').then((m) => (highlighter = m));
  return loading;
}

/** The languages offered, by highlight.js name. Others written after a fence are kept and shown as written. */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell session' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'julia', label: 'Julia' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'ini', label: 'INI / TOML' },
  { value: 'sql', label: 'SQL' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'perl', label: 'Perl' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'diff', label: 'Diff' },
  { value: 'plaintext', label: 'Plain text' },
];

/** Short names people write after the fence. */
const ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  ps1: 'powershell',
  js: 'javascript',
  ts: 'typescript',
  yml: 'yaml',
  toml: 'ini',
  html: 'xml',
  'c++': 'cpp',
  tex: 'latex',
  md: 'markdown',
  text: 'plaintext',
  txt: 'plaintext',
  m: 'matlab',
  jl: 'julia',
  rs: 'rust',
};

export const languageValue = (lang: string | null | undefined) => (lang ? (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) : '');

/** Lines past which a block can be made small. */
export const LONG_CODE_LINES = 15;

const highlightKey = new PluginKey<DecorationSet>('codeHighlight');
const spansOf = new WeakMap<PMNode, ReturnType<Highlighter['highlightSpans']>>();

/** The colors of the code blocks in one top-level block (lists and quotes can hold some). */
function scanBlock(block: PMNode, at: number): Decoration[] {
  const hl = highlighter;
  if (!hl) return [];
  const decos: Decoration[] = [];
  const visit = (node: PMNode, pos: number) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock;
    let spans = spansOf.get(node);
    if (!spans) {
      spans = hl.highlightSpans(node.textContent, languageValue(node.attrs.language as string | null) || null);
      spansOf.set(node, spans);
    }
    for (const s of spans) decos.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.className }));
    return false;
  };
  if (visit(block, at)) block.descendants((node, pos) => visit(node, at + 1 + pos));
  return decos;
}

/** Whether the page has a code block (text is not looked into: no block is inside a line). */
function hasCode(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'codeBlock') found = true;
    return !found && !node.isTextblock;
  });
  return found;
}

export { BaseCodeBlock as CodeBlock };

/** Colors for every code block, once the grammars have loaded (they load when a block first appears). */
export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: (_, state) => (highlighter ? scanAll(state.doc, scanBlock) : DecorationSet.empty),
          // Only the blocks a change touched are colored again, not the whole page at every key.
          apply: (tr, old, _prev, state) =>
            !highlighter ? DecorationSet.empty : tr.getMeta(highlightKey) ? scanAll(state.doc, scanBlock) : rescanChanged(tr, old, scanBlock),
        },
        props: {
          decorations: (state) => highlightKey.getState(state),
        },
        view: (view) => {
          let seen: PMNode | null = null;
          const check = () => {
            // Looked at again only when the text changed, not when the cursor moved.
            if (highlighter || view.state.doc === seen) return;
            seen = view.state.doc;
            if (!hasCode(view.state.doc)) return;
            void loadHighlighter().then(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true));
            });
          };
          check();
          return { update: check };
        },
      }),
    ];
  },
});
