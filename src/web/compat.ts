export const process = undefined;
export const homeDir = null;
export function md5(s: string): string {
  throw new Error('Not implemented on web.');
}
const fromUTF8 = new TextEncoder();
export async function sha512(s: string) {
  return Array.prototype.map.call(new Uint8Array(await crypto.subtle.digest('SHA-512', fromUTF8.encode(s))),
    (b: number) => b.toString(16).padStart(2, '0')).join('');
}
/** Convert bytes to a base64 string, using either nodejs or web API. */
export function base64(data: Uint8Array) {
  const url = new FileReaderSync().readAsDataURL(new Blob([data]));
  return url.substring(url.indexOf(',', 12) + 1); // `data:${mime};base64,${data}`
}
/** Returns false if the user is not online. */
export async function isOnline(host: string) {
  if (typeof navigator != 'undefined') return navigator.onLine;
  return false;
}
export const rmSync: undefined | ((...args: unknown[]) => void) = undefined;
