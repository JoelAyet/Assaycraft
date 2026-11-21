import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, type DecorationSet } from '@tiptap/pm/view';
import { rescanChanged, scanAll } from './incremental';
import type { Node as PMNode } from '@tiptap/pm/model';

const VAR_RE = /\{\{[^{}\n]+\}\}/g;

function scanBlock(block: PMNode, at: number): Decoration[] {
  const decos: Decoration[] = [];
  const visit = (node: PMNode, pos: number) => {
    if (!node.isText || !node.text?.includes('{{')) return;
    for (const m of node.text.matchAll(VAR_RE)) {
      decos.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: 'gc-var-token' }));
    }
  };
  if (block.isText) visit(block, at);
  else block.descendants((node, pos) => visit(node, at + 1 + pos));
  return decos;
}

/** Highlights {{variables}}: placeholders in templates, values still to fill in entries. */
export const VariableHighlight = Extension.create({
  name: 'variableHighlight',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('gc-variables');
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => scanAll(doc, scanBlock),
          apply: (tr, old) => rescanChanged(tr, old, scanBlock),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
