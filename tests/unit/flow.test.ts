import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown } from '../../src/markdown/serialize';
import { flowStepRefs, flowToMarkdown, idFromHref, normalizeFlow, replaceFlowStep } from '../../src/flow/model';
import { bodyFacts } from '../../src/notebook/text';
import { collectVariables, fillVariables, resetFlows } from '../../src/templates/engine';
import type { JSONContent } from '@tiptap/core';

const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md));
const flowOf = (md: string) =>
  parseMarkdown(md)
    .toJSON()
    .content.find((n: JSONContent) => n.type === 'flow')?.attrs?.data;

const MD = `## Plan

<!-- gc:flow {"templates":{"3":"protein-expression"}} -->
1. [EXP-0041 Transformation of E. coli](EXP-0041%20Transformation%20of%20E.%20coli.md)
2. [EXP-0042 Incubation](../Other%20project/EXP-0042%20Incubation.md)
3. Lab-scale production
4. Protein purification

Notes after the flow.
`;

describe('flow', () => {
  it('reads a numbered list under the comment as steps, linked or planned', () => {
    expect(flowOf(MD)).toEqual({
      steps: [
        { title: 'Transformation of E. coli', ref: 'EXP-0041', href: 'EXP-0041 Transformation of E. coli.md' },
        { title: 'Incubation', ref: 'EXP-0042', href: '../Other project/EXP-0042 Incubation.md' },
        { title: 'Lab-scale production', template: 'protein-expression' },
        { title: 'Protein purification' },
      ],
    });
  });

  it('writes it back exactly, and other numbered lists stay lists', () => {
    expect(roundTrip(MD)).toBe(MD);
    const plain = '1. One\n2. Two\n';
    expect(roundTrip(plain)).toBe(plain);
    expect(parseMarkdown(plain).toJSON().content[0].type).toBe('orderedList');
  });

  it('keeps step titles plain, whatever they contain', () => {
    const d = { steps: [{ title: '2. PCR *[fast]* <b>' }, { title: '- wash' }, { title: '' }] };
    const md = flowToMarkdown(d) + '\n';
    expect(md).toBe('<!-- gc:flow -->\n1. 2\\. PCR \\*\\[fast\\]\\* \\<b\\>\n2. \\- wash\n3. Untitled step\n');
    expect(flowOf(md).steps.map((s: { title: string }) => s.title)).toEqual(['2. PCR *[fast]* <b>', '- wash', 'Untitled step']);
    expect(roundTrip(md)).toBe(md);
  });

  it('an empty flow is just the comment', () => {
    const md = '<!-- gc:flow -->\n\nText\n';
    expect(flowOf(md)).toEqual({ steps: [] });
    expect(roundTrip(md)).toBe(md);
  });

  it('finds the IDs of linked entries', () => {
    expect(idFromHref('EXP-0041%20Transformation.md')).toBe('EXP-0041');
    expect(idFromHref('../A/GC-12%20x.md#part')).toBe('GC-12');
    // Every prefix Settings allows: letters, digits and hyphens before the number.
    expect(idFromHref('LAB-26-0003%20x.md')).toBe('LAB-26-0003');
    expect(idFromHref('EXP0007%20x.md')).toBe('EXP0007');
    expect(idFromHref('2026-012%20x.md')).toBe('2026-012');
    expect(idFromHref('Lab%20meeting.md')).toBeUndefined();
    expect(idFromHref('Notes/Lab%20meeting.md')).toBeUndefined();
    expect(idFromHref('photo.png')).toBeUndefined();
  });

  it('other pages learn the steps from the body, and the linked entries count as links', () => {
    const body = MD.split('\n').slice(2).join('\n');
    expect(flowStepRefs(body)).toEqual([
      { title: 'Transformation of E. coli', ref: 'EXP-0041' },
      { title: 'Incubation', ref: 'EXP-0042' },
      { title: 'Lab-scale production', template: 'protein-expression' },
      { title: 'Protein purification' },
    ]);
    const facts = bodyFacts(MD);
    expect(facts.flow).toHaveLength(4);
    expect(facts.refs).toEqual(['EXP-0041', 'EXP-0042']);
    expect(bodyFacts('No flow here').flow).toBeUndefined();
  });

  it('templates: step titles take variables, and copies start with no step started', () => {
    const json = parseMarkdown('<!-- gc:flow -->\n1. Transform {{Strain}}\n2. [EXP-0003 Express](EXP-0003%20Express.md)\n').toJSON() as JSONContent;
    expect(collectVariables(json).map((v) => v.name)).toEqual(['Strain']);
    const filled = resetFlows(fillVariables(json, { Strain: 'BL21' }));
    expect(filled.content![0].attrs!.data).toEqual({ steps: [{ title: 'Transform BL21' }, { title: 'Express' }] });
  });

  it('normalizes whatever it is given', () => {
    expect(normalizeFlow(null)).toEqual({ steps: [] });
    expect(normalizeFlow({ steps: [{ title: 'A', ref: '', template: 't' }, null as never] })).toEqual({ steps: [{ title: 'A', template: 't' }] });
  });

  it('links one step of a flow written in a page, leaving the rest of the page as it was', () => {
    const body =
      'Intro\n\n<!-- gc:flow {"templates":{"3":"general-experiment"}} -->\n1. [EXP-0002 Clone](EXP-0002%20Clone.md)\n2. Grow\n3. Express\n\nAfter';
    const next = replaceFlowStep(body, 2, { title: 'Express', ref: 'EXP-0005', href: 'EXP-0005 Express.md' })!;
    expect(next).toBe(
      'Intro\n\n<!-- gc:flow {"templates":{"3":"general-experiment"}} -->\n1. [EXP-0002 Clone](EXP-0002%20Clone.md)\n2. Grow\n3. [EXP-0005 Express](EXP-0005%20Express.md)\n\nAfter',
    );
    expect(flowStepRefs(next)).toEqual([
      { title: 'Clone', ref: 'EXP-0002' },
      { title: 'Grow' },
      { title: 'Express', ref: 'EXP-0005', template: 'general-experiment' },
    ]);
    expect(replaceFlowStep(body, 7, { title: 'x' })).toBeUndefined();
    expect(replaceFlowStep('No flow here', 0, { title: 'x' })).toBeUndefined();
  });
});
