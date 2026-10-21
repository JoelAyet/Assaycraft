import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

const VAR_RE = /\{\{[^{}\n]+\}\}/g;

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text?.includes('{{')) return;
    for (const m of node.text.matchAll(VAR_RE)) {
      decos.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: 'gc-var-token' }));
    }
  });
  return DecorationSet.create(doc, decos);
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
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
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
