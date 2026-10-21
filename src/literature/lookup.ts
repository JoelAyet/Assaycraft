/**
 * Looking a paper up by DOI (Crossref) or PubMed ID (NCBI E-utilities). Only the identifier you typed
 * is sent; everything else stays in your notebook. Offline, references are filled in by hand or pasted.
 */
import { fromCrossref, fromPubmed, parseIdentifier, type RefInfo } from './model';

export async function lookupReference(input: string): Promise<RefInfo> {
  const id = parseIdentifier(input);
  if (!id) throw new Error('Type a DOI (it starts with 10.) or a PubMed ID (a number).');
  let res: Response;
  try {
    res =
      id.kind === 'doi'
        ? await fetch(`https://api.crossref.org/works/${id.value.split('/').map(encodeURIComponent).join('/')}`, {
            headers: { Accept: 'application/json' },
          })
        : await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${id.value}`);
  } catch {
    throw new Error(`Could not reach ${id.kind === 'doi' ? 'Crossref' : 'PubMed'}. Are you offline? Fill it in below, or paste BibTeX.`);
  }
  if (res.status === 404) throw new Error(`No paper found with the DOI ${id.value}.`);
  if (!res.ok) throw new Error(`${id.kind === 'doi' ? 'Crossref' : 'PubMed'} could not answer (${res.status}). Try again, or fill it in below.`);
  const json: unknown = await res.json();
  const info = id.kind === 'doi' ? fromCrossref(json) : fromPubmed(json, id.value);
  if (!info.title) throw new Error(`No paper found with the ${id.kind === 'doi' ? 'DOI' : 'PubMed ID'} ${id.value}.`);
  return info;
}
