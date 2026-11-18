/** How this device introduces itself to the other one: "iPhone · Safari", "Mac · Chrome". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const kind = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || touchMac
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux computer'
                : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${kind} · ${browser}` : kind;
}

/** The first part of the name, for copies kept when both devices changed a file: "(from iPhone)". */
export const shortDevice = (name: string) => name.split(' · ')[0] || 'other device';

/** A random id kept in this browser, so pairing the same phone again replaces its old pairing. */
export function deviceId(): string {
  const key = 'assaycraft:device-id';
  try {
    const known = localStorage.getItem(key);
    if (known) return known;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'unknown';
  }
}

/**
 * An iPhone or iPad, in a Safari tab rather than the app added to the Home Screen. Safari can clear a
 * website's data when it is not opened for about a week; an app on the Home Screen keeps its own.
 */
export function iosBrowserTab(): boolean {
  const kind = deviceName().split(' · ')[0];
  if (kind !== 'iPhone' && kind !== 'iPad') return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia?.('(display-mode: standalone)').matches;
  return !standalone;
}

/** What to do about it, for the pages that copy a notebook onto the device. */
export const IOS_KEEP_NOTE =
  'On iPhone and iPad, Safari can clear a website’s data when it is not opened for about a week, and this copy with it. To keep it, add Assaycraft to your Home Screen (Share → Add to Home Screen), open it from there and connect from it: the Home Screen app keeps its own copy, which Safari does not clear.';
