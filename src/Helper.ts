// Utility Helpers
import { Uri } from 'vscode';
import { base64 } from './+cross/Platform';

export function jsHash(s: string, seed = 0) { // 53-bit hash, see https://stackoverflow.com/a/52171480
  let a = 0xDEADBEEF ^ seed, b = 0x41C6CE57 ^ seed;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return 0x100000000 * (0x1FFFFF & b) + (a >>> 0);
}
/** Encode text that goes after the comma in a `data:` URI. It tries to encode as few characters as possible.
 * To reduce excessive encoding, prefer using single quotes and collapsing newlines and tabs when possible.
*/
export function encodeDataURIText(data: string) {
  return encodeURI(data).replace(/#|%20/g, s => s == '#' ? '%23' : ' ');
}
/** Text for a number of bytes using the appropriate base-1024 unit (byte(s), KiB, MiB, GiB, TiB). */
export function byteUnits(numBytes: number) {
  if (numBytes == 1) return '1 byte';
  if (numBytes < 1024) return numBytes + ' bytes';
  const k = numBytes / 1024;
  if (k < 1024) return k.toFixed(1) + ' KiB';
  const m = k / 1024;
  if (m < 1024) return m.toFixed(1) + ' MiB';
  const g = m / 1024;
  if (g < 1024) return g.toFixed(1) + ' GiB';
  const t = g / 1024;
  return t.toFixed(1) + ' TiB';
}
/** Converts a name from "PascalCase" convention to "snake_case". */
function _snakeCase(pascalCase: string) {
  return pascalCase.replace(/(?<!^)\d*[A-Z_]/g, s => '_' + s).toLowerCase();
}
/** Fetch a URL, returning its contents as a data URI. */
async function _fetchAsDataUri(url: string) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return Uri.from({ scheme: 'data', path: blob.type + ';base64,' + base64(bytes) });
    } else console.warn(`Could not fetch as data URI: ${response.status} (${response.statusText}) ${url}`);
  } catch (e) { console.error(e); }
  return null;
}
