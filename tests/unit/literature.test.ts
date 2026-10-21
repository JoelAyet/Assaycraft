import { describe, expect, it } from 'vitest';
import {
  citationKey,
  fromCrossref,
  fromPubmed,
  fullCitation,
  normalizeAuthor,
  parseBibtex,
  parseIdentifier,
  parseReferences,
  parseRis,
  refExtra,
  refFromMeta,
  shortCitation,
  toBibtex,
  type RefInfo,
} from '../../src/literature/model';
import { joinFrontMatter, splitFrontMatter } from '../../src/notebook/frontmatter';
import { linkedIds } from '../../src/notebook/text';

const JINEK: RefInfo = {
  title: 'A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity',
  authors: ['Jinek, Martin', 'Chylinski, Krzysztof', 'Fonfara, Ines', 'Hauer, Michael', 'Doudna, Jennifer A.', 'Charpentier, Emmanuelle'],
  year: '2012',
  journal: 'Science',
  volume: '337',
  issue: '6096',
  pages: '816–821',
  doi: '10.1126/science.1225829',
  pmid: '22745249',
};

describe('citations', () => {
  it('cites by family names and year', () => {
    expect(shortCitation(JINEK)).toBe('Jinek et al., 2012');
    expect(shortCitation({ ...JINEK, authors: JINEK.authors.slice(0, 2) })).toBe('Jinek & Chylinski, 2012');
    expect(shortCitation({ ...JINEK, authors: ['Jinek, Martin'] })).toBe('Jinek, 2012');
    expect(shortCitation({ title: 'Untitled preprint on base editing', authors: [] })).toBe('Untitled preprint on');
  });

  it('writes the full reference in journal style', () => {
    expect(fullCitation(JINEK)).toBe(
      'Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E. A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity. Science. 2012;337(6096):816–821. doi:10.1126/science.1225829.',
    );
    const many = { ...JINEK, authors: [...JINEK.authors, 'Doe, John'] };
    expect(fullCitation(many)).toMatch(/^Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E, et al\. A programmable/);
  });

  it('reads author names in any usual order', () => {
    expect(normalizeAuthor('Jinek, Martin')).toBe('Jinek, Martin');
    expect(normalizeAuthor('Martin Jinek')).toBe('Jinek, Martin');
    expect(normalizeAuthor('Doudna JA')).toBe('Doudna, JA');
    expect(normalizeAuthor('{van der Oost}, John')).toBe('van der Oost, John');
    expect(normalizeAuthor('Consortium')).toBe('Consortium');
  });

  it('makes a unique citation key', () => {
    const taken = new Set<string>();
    expect(citationKey(JINEK, taken)).toBe('Jinek2012');
    expect(citationKey(JINEK, new Set(['jinek2012']))).toBe('Jinek2012b');
    expect(citationKey(JINEK, new Set(['jinek2012', 'jinek2012b']))).toBe('Jinek2012c');
    // A key from a BibTeX file is kept when it is free.
    expect(citationKey({ ...JINEK, key: 'jinek_programmable_2012' }, taken)).toBe('jinek_programmable_2012');
    // Accents are folded for the key.
    expect(citationKey({ title: 'X', authors: ['Müller, Jürgen'], year: '2020' }, taken)).toBe('Muller2020');
    expect(citationKey({ title: 'Prime editing', authors: [] }, taken)).toBe('Prime');
  });
});

describe('identifiers', () => {
  it('finds a DOI or a PubMed ID in what was typed or pasted', () => {
    expect(parseIdentifier('10.1126/science.1225829')).toEqual({ kind: 'doi', value: '10.1126/science.1225829' });
    expect(parseIdentifier('https://doi.org/10.1126/science.1225829')).toEqual({ kind: 'doi', value: '10.1126/science.1225829' });
    expect(parseIdentifier('doi:10.1016/j.cell.2014.05.010.')).toEqual({ kind: 'doi', value: '10.1016/j.cell.2014.05.010' });
    expect(parseIdentifier('22745249')).toEqual({ kind: 'pmid', value: '22745249' });
    expect(parseIdentifier('PMID: 22745249')).toEqual({ kind: 'pmid', value: '22745249' });
    expect(parseIdentifier('https://pubmed.ncbi.nlm.nih.gov/22745249/')).toEqual({ kind: 'pmid', value: '22745249' });
    expect(parseIdentifier('CRISPR paper')).toBeNull();
  });

  it('reads Crossref and PubMed answers', () => {
    const cr = fromCrossref({
      message: {
        title: ['A Programmable Dual-RNA–Guided <i>DNA</i> Endonuclease'],
        author: [{ given: 'Martin', family: 'Jinek' }, { name: 'The CRISPR Consortium' }],
        'container-title': ['Science'],
        page: '816-821',
        DOI: '10.1126/science.1225829',
        issued: { 'date-parts': [[2012, 8, 17]] },
      },
    });
    expect(cr).toMatchObject({
      title: 'A Programmable Dual-RNA–Guided DNA Endonuclease',
      authors: ['Jinek, Martin', 'The CRISPR Consortium'],
      year: '2012',
      journal: 'Science',
      pages: '816–821',
      doi: '10.1126/science.1225829',
    });
    const pm = fromPubmed(
      {
        result: {
          '22745249': {
            title: 'A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity.',
            authors: [
              { name: 'Jinek M', authtype: 'Author' },
              { name: 'Doudna JA', authtype: 'Author' },
              { name: 'CRISPR Group', authtype: 'CollectiveName' },
            ],
            pubdate: '2012 Aug 17',
            source: 'Science',
            volume: '337',
            issue: '6096',
            pages: '816-21',
            articleids: [{ idtype: 'doi', value: '10.1126/science.1225829' }],
          },
        },
      },
      '22745249',
    );
    expect(pm).toEqual({
      title: 'A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity',
      authors: ['Jinek, M', 'Doudna, JA'],
      year: '2012',
      journal: 'Science',
      volume: '337',
      issue: '6096',
      pages: '816–21',
      doi: '10.1126/science.1225829',
      pmid: '22745249',
    });
  });
});

describe('BibTeX and RIS', () => {
  it('reads BibTeX from Zotero and Google Scholar', () => {
    const refs = parseBibtex(`@comment{jabref-meta: x}
@article{jinek_2012,
  title = {A programmable dual-{RNA}–guided {DNA} endonuclease in adaptive bacterial immunity},
  author = {Jinek, Martin and Chylinski, Krzysztof and Doudna, Jennifer A.},
  journal = {Science},
  volume = 337,
  number = {6096},
  pages = {816--821},
  year = {2012},
  doi = {https://doi.org/10.1126/science.1225829},
}

@inproceedings{muller2020, title="Base editing in {\\'E}cole plants", author="M{\\"u}ller, J{\\"u}rgen and Fran{\\c{c}}ois, Ana and {\\O}stergaard, Lars", booktitle={Proc. Plant Bio}, year=2020}`);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      key: 'jinek_2012',
      title: 'A programmable dual-RNA–guided DNA endonuclease in adaptive bacterial immunity',
      authors: ['Jinek, Martin', 'Chylinski, Krzysztof', 'Doudna, Jennifer A.'],
      journal: 'Science',
      volume: '337',
      issue: '6096',
      pages: '816–821',
      year: '2012',
      doi: '10.1126/science.1225829',
    });
    expect(refs[1]).toMatchObject({
      title: 'Base editing in École plants',
      authors: ['Müller, Jürgen', 'François, Ana', 'Østergaard, Lars'],
      journal: 'Proc. Plant Bio',
      year: '2020',
    });
  });

  it('reads RIS, and both in one paste', () => {
    const ris = `TY  - JOUR
AU  - Hsu, Patrick D.
AU  - Zhang, Feng
TI  - Development and applications of CRISPR-Cas9 for genome engineering
T2  - Cell
PY  - 2014/06/05
VL  - 157
SP  - 1262
EP  - 1278
DO  - 10.1016/j.cell.2014.05.010
ER  - `;
    expect(parseRis(ris)).toEqual([
      {
        title: 'Development and applications of CRISPR-Cas9 for genome engineering',
        authors: ['Hsu, Patrick D.', 'Zhang, Feng'],
        year: '2014',
        journal: 'Cell',
        volume: '157',
        issue: undefined,
        pages: '1262–1278',
        doi: '10.1016/j.cell.2014.05.010',
        url: undefined,
        abstract: undefined,
      },
    ]);
    const both = parseReferences(`@article{a, title={One}, author={A, B}, year={2001}}\n\n${ris}`);
    expect(both.map((r) => r.title)).toEqual(['One', 'Development and applications of CRISPR-Cas9 for genome engineering']);
    expect(parseReferences('nothing here')).toEqual([]);
  });

  it('writes BibTeX', () => {
    expect(toBibtex(JINEK, 'Jinek2012')).toBe(`@article{Jinek2012,
  title = {A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity},
  author = {Jinek, Martin and Chylinski, Krzysztof and Fonfara, Ines and Hauer, Michael and Doudna, Jennifer A. and Charpentier, Emmanuelle},
  journal = {Science},
  year = {2012},
  volume = {337},
  number = {6096},
  pages = {816--821},
  doi = {10.1126/science.1225829},
  pmid = {22745249}
}
`);
    // What it writes, it reads back.
    expect(parseBibtex(toBibtex(JINEK, 'Jinek2012'))[0]).toMatchObject({ ...JINEK, key: 'Jinek2012' });
  });
});

describe('a paper in the notebook', () => {
  it('keeps the reference in front matter, authors one per line', () => {
    const text = joinFrontMatter({ id: 'Jinek2012', kind: 'reference', title: JINEK.title, tags: ['crispr'], ...refExtra(JINEK) }, '## Notes\n');
    expect(text).toContain(
      'tags: [crispr]\nauthors:\n  - Jinek, Martin\n  - Chylinski, Krzysztof\n  - Fonfara, Ines\n  - Hauer, Michael\n  - Doudna, Jennifer A.\n  - Charpentier, Emmanuelle\nyear: 2012\njournal: Science\nvolume: 337\nissue: 6096\npages: 816–821\ndoi: 10.1126/science.1225829\npmid: 22745249\n',
    );
    const { data } = splitFrontMatter(text);
    expect(refFromMeta({ title: JINEK.title, extra: data })).toEqual({ ...JINEK, url: undefined });
  });

  it('counts a citation as a link to the paper', () => {
    expect(linkedIds('As in [Jinek et al., 2012](../../Literature/Jinek2012%20A%20programmable.md).')).toEqual(['Jinek2012']);
  });
});
