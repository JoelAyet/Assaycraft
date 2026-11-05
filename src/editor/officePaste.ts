/**
 * Pasting from Word, PowerPoint and other office apps. They put a picture of what was copied on the
 * clipboard as well as its text: the text is what was meant (a picture alone is pasted as one).
 */

/** Text on the clipboard worth pasting as text (not only spaces or an object's placeholder). */
export function hasPastableText(text: string): boolean {
  return text.replace(/[\s ￼​]+/g, '').length > 0;
}

/**
 * Whether files on the clipboard are what to paste: no table (that becomes a table) and no text
 * beside them (that is pasted as text, as Word and PowerPoint mean it).
 */
export function pasteAsFiles(files: number, html: string, text: string): boolean {
  if (!files || /<table/i.test(html)) return false;
  return !hasPastableText(text);
}

/** HTML from office apps, without what only they read: comments for old versions, list bullets kept as text, pictures on the copier's disk. */
export function cleanOfficeHtml(html: string): string {
  if (!/urn:schemas-microsoft-com|mso-|class="?Mso|<o:p/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style]')))
    if (/mso-list:\s*ignore/i.test(el.getAttribute('style') ?? '')) el.remove();
  for (const img of Array.from(doc.querySelectorAll('img')))
    if (/^(file:|cid:|[a-z]:\\)/i.test(img.getAttribute('src') ?? '') || !img.getAttribute('src')) img.remove();
  for (const el of Array.from(doc.getElementsByTagName('o:p'))) el.replaceWith(...Array.from(el.childNodes));
  return doc.body.innerHTML;
}
