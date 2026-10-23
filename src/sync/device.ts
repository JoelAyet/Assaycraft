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
