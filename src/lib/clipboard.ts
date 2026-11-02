/**
 * Put text on the clipboard. Browsers offer the Clipboard API only on secure pages (HTTPS or
 * localhost); an Assaycraft server reached over plain HTTP falls back to the older copy command.
 */
export async function writeClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* not allowed here: try the older way */
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  active?.focus({ preventScroll: true });
  if (!ok) throw new Error('Copying is not allowed here');
}
