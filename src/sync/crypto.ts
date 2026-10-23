/**
 * A pairing between a computer and a phone is one random secret, shared through the QR code. From it
 * both devices work out the same relay room (a hash, so the relay never sees the secret) and the same
 * key, which encrypts everything they send through the relay.
 */

const enc = new TextEncoder();

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** 128 random bits, written as 22 characters: short enough for a small, easily scanned QR code. */
export function newSecret(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(16)));
}

export const isSecret = (s: string) => /^[A-Za-z0-9_-]{22}$/.test(s);

export interface PairKeys {
  /** The relay room: 32 hex digits. */
  room: string;
  key: CryptoKey;
}

export async function pairKeys(secret: string): Promise<PairKeys> {
  const raw = fromB64url(secret);
  const label = enc.encode('assaycraft room v1:');
  const named = new Uint8Array(label.length + raw.length);
  named.set(label);
  named.set(raw, label.length);
  const room = hex(await crypto.subtle.digest('SHA-256', named)).slice(0, 32);
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('assaycraft'), info: enc.encode('relay key v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { room, key };
}

/** Encrypt (AES-GCM, random IV): IV followed by the ciphertext. */
export async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

/** Decrypt what `seal` made. Throws if it was not made with this key or was changed on the way. */
export async function unseal(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12)));
}

/** A file's fingerprint for comparing copies: the first 128 bits of its SHA-256, in hex. */
export async function fingerprint(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 32);
}
